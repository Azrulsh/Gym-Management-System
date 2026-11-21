<?php
declare(strict_types=1);
require_once __DIR__ . '/app_config.php';
require_once __DIR__ . '/events_repository.php';

/** Business rules. Every write locks the actor and event; participant writes also lock the member. */
final class EventsService
{
    private EventsRepository $repository;
    public function __construct(private mysqli $db) { $this->repository = new EventsRepository($db); }

    private function transaction(int $actorId, int $authVersion, bool $admin, callable $work): array
    {
        $this->db->begin_transaction();
        try {
            $actor = $this->repository->rows('SELECT type,auth_version FROM users WHERE id=? FOR UPDATE','i',[$actorId])[0] ?? null;
            if (!$actor || (int)$actor['auth_version'] !== $authVersion || !in_array((int)$actor['type'], $admin ? [1] : [1,2], true)) {
                throw new EventRequestException(403, 'Your access changed. Sign in again before continuing.');
            }
            $result = $work();
            $this->db->commit();
            return $result;
        } catch (Throwable $exception) { $this->db->rollback(); throw $exception; }
    }

    private function text(array $post, string $name, int $limit, bool $required = true): string
    {
        $value = $post[$name] ?? '';
        if (!is_string($value) || !preg_match('//u', $value)) throw new EventRequestException(422, 'Enter valid event details.');
        $value = trim($value);
        if (($required && $value === '') || mb_strlen($value,'UTF-8') > $limit || preg_match('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/',$value)
            || ($name !== 'description' && preg_match('/[\r\n\t]/',$value))) throw new EventRequestException(422, 'Check ' . str_replace('_',' ',$name) . ' and its maximum length.');
        return $value;
    }

    private function datetime(mixed $value, bool $optional = false): ?string
    {
        if ($optional && $value === '') return null;
        if (!is_string($value) || !preg_match('/\A[1-9][0-9]{3}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}\z/',$value)) throw new EventRequestException(422,'Enter a valid date and time.');
        $parsed = DateTimeImmutable::createFromFormat('!Y-m-d\TH:i',$value);
        if (!$parsed || $parsed->format('Y-m-d\TH:i') !== $value) throw new EventRequestException(422,'Enter a valid date and time.');
        return $parsed->format('Y-m-d H:i:s');
    }

    private function checkVersion(array $event, int $version): void
    {
        if ((int)$event['version'] !== $version) throw new EventRequestException(409,'This event or its participants changed. Reload and review before trying again.');
    }

    public function save(array $post, int $actorId, int $authVersion): array
    {
        $id = ($post['id'] ?? '') === '' ? 0 : event_positive_id($post['id'],'event ID');
        $version = $id ? event_positive_id($post['version'] ?? null,'event version') : 0;
        $title = $this->text($post,'title',150);
        $description = $this->text($post,'description',5000,false);
        $location = $this->text($post,'location',250);
        $start = $this->datetime($post['starts_at'] ?? null);
        $end = $this->datetime($post['ends_at'] ?? null);
        $deadline = $this->datetime($post['registration_closes_at'] ?? '',true);
        $capacity = ($post['capacity'] ?? '') === '' ? null : event_positive_id($post['capacity'],'capacity');
        $status = $post['status'] ?? null;
        if (!in_array($status,['draft','published','cancelled','completed'],true)) throw new EventRequestException(422,'Choose a valid event status.');
        if ($end <= $start || ($deadline !== null && $deadline > $start)) throw new EventRequestException(422,'End must be after start. Registration deadline must be at or before start.');
        $key = $post['request_key'] ?? null;
        if (!$id && (!is_string($key) || !preg_match('/\A[a-f0-9]{64}\z/',$key))) throw new EventRequestException(422,'Reopen New Event before saving.');

        return $this->transaction($actorId,$authVersion,true,function() use ($id,$version,$title,$description,$location,$start,$end,$deadline,$capacity,$status,$key,$post,$actorId) {
            $now = date('Y-m-d H:i:s');
            if (!$id) {
                $existing = $this->repository->rows('SELECT id,created_by FROM events WHERE request_key=?','s',[$key])[0] ?? null;
                if ($existing) {
                    if ((int)$existing['created_by'] !== $actorId) throw new EventRequestException(409,'This form was already used. Open a new form.');
                    return ['id'=>(int)$existing['id'],'saved'=>true];
                }
                if (!in_array($status,['draft','published'],true)) throw new EventRequestException(422,'Create an event as Draft or Published.');
                if ($status === 'published' && $start <= $now) throw new EventRequestException(422,'A new published event must start in the future.');
                $this->repository->execute('INSERT INTO events (title,description,location,starts_at,ends_at,registration_closes_at,capacity,status,request_key,created_by,updated_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
                    'ssssssissii',[$title,$description,$location,$start,$end,$deadline,$capacity,$status,$key,$actorId,$actorId]);
                return ['id'=>(int)$this->db->insert_id,'saved'=>true];
            }
            $event = $this->repository->find($id,true);
            $this->checkVersion($event,$version);
            if (in_array($event['status'],['cancelled','completed'],true)) throw new EventRequestException(409,'Cancelled and completed event details are locked.');
            $counts = $this->repository->counts($id);
            if ($capacity !== null && $capacity < (int)$counts['occupied']) throw new EventRequestException(409,'Capacity cannot be less than the number of current participants.');
            if ($event['status'] === 'published' && $status === 'draft') throw new EventRequestException(409,'Published events cannot return to Draft. Cancel the event instead.');
            if ($status === 'completed' && ($event['status'] !== 'published' || $event['ends_at'] > $now)) throw new EventRequestException(409,'An event can be completed only after its scheduled end.');
            $changed = false;
            foreach (['title'=>$title,'description'=>$description,'location'=>$location,'starts_at'=>$start,'ends_at'=>$end,'registration_closes_at'=>$deadline,'capacity'=>$capacity] as $field=>$value) {
                if ((string)($event[$field] ?? '') !== (string)($value ?? '')) $changed = true;
            }
            if ($event['status'] === 'published' && $event['starts_at'] <= $now && $changed) throw new EventRequestException(409,'Event details are locked once it starts. Only cancellation or completion is available.');
            if ($status === 'published' && ($event['status'] === 'draft' || $changed) && $start <= $now) throw new EventRequestException(422,'Published event changes must keep its start in the future.');
            if ((int)$counts['history'] > 0 && ($start !== $event['starts_at'] || $end !== $event['ends_at'] || $location !== $event['location'])) {
                if (($post['confirm_changes'] ?? '') !== '1') throw new EventRequestException(422,'Confirm the time/location change and notify the participants separately.');
                // Moving the date must preserve membership eligibility for every current participant.
                $date = substr($start,0,10);
                $invalid = $this->repository->rows("SELECT p.id FROM event_registrations p WHERE p.event_id=? AND p.status<>'cancelled' AND NOT EXISTS
                    (SELECT 1 FROM registration_info r WHERE r.member_id=p.member_id AND r.status=1 AND r.start_date<=? AND r.end_date>=?) LIMIT 1",'iss',[$id,$date,$date]);
                if ($invalid) throw new EventRequestException(409,'A participant has no active membership on the proposed event date. Resolve their participation before moving the event.');
            }
            $this->repository->execute('UPDATE events SET title=?,description=?,location=?,starts_at=?,ends_at=?,registration_closes_at=?,capacity=?,status=?,version=version+1,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?',
                'ssssssisii',[$title,$description,$location,$start,$end,$deadline,$capacity,$status,$actorId,$id]);
            return ['id'=>$id,'saved'=>true];
        });
    }

    public function delete(array $post, int $actorId, int $authVersion): array
    {
        $id=event_positive_id($post['id'] ?? null,'event ID');
        $version=event_positive_id($post['version'] ?? null,'event version');
        return $this->transaction($actorId,$authVersion,true,function() use($id,$version) {
            $event=$this->repository->find($id,true); $this->checkVersion($event,$version);
            if ($event['status'] !== 'draft' || (int)$this->repository->counts($id)['history'] > 0) throw new EventRequestException(409,'Only a Draft without participant history can be deleted. Cancel this event to preserve its records.');
            $this->repository->execute('DELETE FROM events WHERE id=?','i',[$id]);
            return ['deleted'=>true];
        });
    }

    public function participant(array $post, int $actorId, int $authVersion): array
    {
        $id=event_positive_id($post['id'] ?? null,'event ID');
        $memberId=event_positive_id($post['member_id'] ?? null,'member ID');
        $version=event_positive_id($post['version'] ?? null,'event version');
        $status=$post['participant_status'] ?? null;
        if (!in_array($status,['registered','cancelled','attended','no_show'],true)) throw new EventRequestException(422,'Choose a valid participation status.');
        return $this->transaction($actorId,$authVersion,false,function() use($id,$memberId,$version,$status,$post,$actorId) {
            // Coordinate with existing membership writes and Delete Member before taking the event lock.
            if (!$this->repository->rows('SELECT id FROM members WHERE id=? FOR UPDATE','i',[$memberId])) throw new EventRequestException(404,'Member no longer exists.');
            $event=$this->repository->find($id,true); $this->checkVersion($event,$version);
            $participant=$this->repository->rows('SELECT * FROM event_registrations WHERE event_id=? AND member_id=? FOR UPDATE','ii',[$id,$memberId])[0] ?? null;
            if ($participant) {
                $participantVersion=event_positive_id($post['participant_version'] ?? null,'participation version');
                if ($participantVersion !== (int)$participant['version']) throw new EventRequestException(409,'Participation changed. Reload before trying again.');
            }
            $now=date('Y-m-d H:i:s');
            if (in_array($event['status'],['draft','cancelled'],true)) throw new EventRequestException(409,'Participation cannot change for Draft or Cancelled events.');
            if ($status === 'registered') {
                if ($participant && $participant['status'] !== 'cancelled') throw new EventRequestException(409,'This member is already registered.');
                if ($event['status'] !== 'published' || $now >= $event['starts_at'] || ($event['registration_closes_at'] !== null && $now >= $event['registration_closes_at'])) throw new EventRequestException(409,'Registration is closed for this event.');
                $date=substr($event['starts_at'],0,10);
                if (!$this->repository->rows('SELECT id FROM registration_info WHERE member_id=? AND status=1 AND start_date<=? AND end_date>=? LIMIT 1','iss',[$memberId,$date,$date])) throw new EventRequestException(422,'Member must have an active membership on the event start date.');
                $occupied=(int)$this->repository->counts($id)['occupied'];
                if ($event['capacity'] !== null && $occupied >= (int)$event['capacity']) throw new EventRequestException(409,'This event is full.');
            } elseif ($status === 'cancelled') {
                if (!$participant || $participant['status'] !== 'registered' || $event['status'] !== 'published' || $now >= $event['ends_at']) throw new EventRequestException(409,'Only a current registration can be cancelled before the event ends.');
            } else {
                if (!$participant || $participant['status'] === 'cancelled' || $now < $event['starts_at'] || ($status === 'no_show' && $now < $event['ends_at'])) throw new EventRequestException(409,'Attendance requires an existing registration. Mark attendance after start and no-show after end.');
            }
            if ($participant) {
                $this->repository->execute('UPDATE event_registrations SET status=?,version=version+1,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?','sii',[$status,$actorId,(int)$participant['id']]);
            } else {
                $this->repository->execute('INSERT INTO event_registrations (event_id,member_id,created_by,updated_by) VALUES (?,?,?,?)','iiii',[$id,$memberId,$actorId,$actorId]);
            }
            $this->repository->execute('UPDATE events SET version=version+1,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?','ii',[$actorId,$id]);
            return ['id'=>$id,'saved'=>true];
        });
    }
}
