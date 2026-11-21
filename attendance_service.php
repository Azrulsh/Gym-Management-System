<?php
declare(strict_types=1);
require_once __DIR__ . '/app_config.php';
require_once __DIR__ . '/attendance_repository.php';

final class AttendanceService
{
    private AttendanceRepository $repository;
    public function __construct(private mysqli $db) { $this->repository=new AttendanceRepository($db); }

    private function transaction(int $actor, int $authVersion, bool $admin, callable $work): array
    {
        $this->db->begin_transaction();
        try {
            $user=$this->repository->rows('SELECT type,auth_version FROM users WHERE id=? FOR UPDATE','i',[$actor])[0] ?? null;
            if (!$user || !in_array((int)$user['type'],$admin?[1]:[1,2],true) || (int)$user['auth_version']!==$authVersion) throw new AttendanceRequestException(403,'Your access changed. Sign in again before continuing.');
            $result=$work(); $this->db->commit(); return $result;
        } catch (Throwable $exception) { $this->db->rollback(); throw $exception; }
    }

    private function lockMember(int $member): void
    {
        // Existing membership creation, renewal, closure and member deletion use this lock too.
        if (!$this->repository->rows('SELECT id FROM members WHERE id=? FOR UPDATE','i',[$member])) throw new AttendanceRequestException(404,'Member no longer exists.');
    }

    private function key(mixed $key): string
    {
        if (!is_string($key) || !preg_match('/\A[a-f0-9]{64}\z/',$key)) throw new AttendanceRequestException(422,'Reload Attendance before trying again.');
        return $key;
    }

    private function audit(int $visit, int $actor, string $action, ?array $before, array $after, string $reason=''): void
    {
        // Append-only through this service. Never delete or rewrite previous audit entries.
        $this->repository->execute('INSERT INTO attendance_audit (visit_id,actor_id,action,reason,before_state,after_state) VALUES (?,?,?,?,?,?)','iissss',
            [$visit,$actor,$action,$reason,$before===null?null:json_encode($before,JSON_THROW_ON_ERROR),json_encode($after,JSON_THROW_ON_ERROR)]);
    }

    public function lookup(array $post): array
    {
        $number=attendance_id($post['tracking_id'] ?? null,'member number');
        $member=$this->repository->rows("SELECT id,member_id,CONCAT_WS(' ',firstname,middlename,lastname) AS name FROM members WHERE member_id=?",'i',[$number])[0] ?? null;
        if (!$member) throw new AttendanceRequestException(404,'Member number not found. Check the number and try again.');
        $open=$this->repository->openVisit((int)$member['id']);
        // Return minimal fields, not the complete member profile or account record.
        return ['member'=>$member,'eligibility'=>$this->repository->eligibility((int)$member['id']),
            'open_visit'=>$open===null?null:['id'=>(int)$open['id'],'version'=>(int)$open['version'],'checked_in_at'=>$open['checked_in_at']],
            'avatar_url'=>'attendance_avatar.php?id='.(int)$member['id']];
    }

    public function checkIn(array $post, int $actor, int $authVersion): array
    {
        $member=attendance_id($post['person_id'] ?? null,'member ID');
        $key=$this->key($post['request_key'] ?? null);
        if (($post['identity_confirmed'] ?? null)!=='1') throw new AttendanceRequestException(422,'Verify the member identity and tick the confirmation before check-in.');
        return $this->transaction($actor,$authVersion,false,function() use($member,$key,$actor) {
            $this->lockMember($member);
            $previous=$this->repository->rows('SELECT * FROM attendance_visits WHERE checkin_key=?','s',[$key])[0] ?? null;
            if ($previous) {
                if ((int)$previous['member_id']!==$member || (int)$previous['checked_in_by']!==$actor) throw new AttendanceRequestException(409,'This request was already used. Reload Attendance.');
                return ['saved'=>true,'id'=>(int)$previous['id']];
            }
            if ($this->repository->openVisit($member)) throw new AttendanceRequestException(409,'Member is already checked in. Check out the existing visit first.');
            $now=date('Y-m-d H:i:s');
            $eligibility=$this->repository->eligibility($member,substr($now,0,10));
            if (!$eligibility['allowed']) throw new AttendanceRequestException(409,$eligibility['reason']);
            $this->repository->execute('INSERT INTO attendance_visits (member_id,registration_id,checked_in_at,checked_in_by,updated_by,checkin_key) VALUES (?,?,?,?,?,?)','iisiis',[$member,$eligibility['registration_id'],$now,$actor,$actor,$key]);
            $id=(int)$this->db->insert_id;
            $this->audit($id,$actor,'checkin',null,$this->repository->visit($id));
            return ['saved'=>true,'id'=>$id];
        });
    }

    public function checkOut(array $post, int $actor, int $authVersion): array
    {
        $id=attendance_id($post['visit_id'] ?? null,'visit ID');
        $version=attendance_id($post['version'] ?? null,'visit version');
        $key=$this->key($post['request_key'] ?? null);
        return $this->transaction($actor,$authVersion,false,function() use($id,$version,$key,$actor) {
            $hint=$this->repository->visit($id);
            $this->lockMember((int)$hint['member_id']);
            $before=$this->repository->visit($id,true);
            if ($before['checkout_key']===$key && (int)$before['checked_out_by']===$actor) return ['saved'=>true,'id'=>$id];
            if ((int)$before['version']!==$version) throw new AttendanceRequestException(409,'Attendance changed. Reload and review before checking out.');
            if ($before['voided_at']!==null || $before['checked_out_at']!==null) throw new AttendanceRequestException(409,'This visit is voided or already checked out.');
            // Checkout intentionally does not require an active membership.
            $this->repository->execute('UPDATE attendance_visits SET checked_out_at=CURRENT_TIMESTAMP,checked_out_by=?,checkout_key=?,version=version+1,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?','isii',[$actor,$key,$actor,$id]);
            $this->audit($id,$actor,'checkout',$before,$this->repository->visit($id));
            return ['saved'=>true,'id'=>$id];
        });
    }

    private function datetime(mixed $value): string
    {
        if (!is_string($value) || !preg_match('/\A[1-9][0-9]{3}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\z/',$value)) throw new AttendanceRequestException(422,'Enter valid Malaysia dates and times, including seconds.');
        $date=DateTimeImmutable::createFromFormat('!Y-m-d\TH:i:s',$value);
        if (!$date || $date->format('Y-m-d\TH:i:s')!==$value || $date>new DateTimeImmutable()) throw new AttendanceRequestException(422,'Attendance times must be valid and cannot be in the future.');
        return $date->format('Y-m-d H:i:s');
    }

    public function correct(array $post, int $actor, int $authVersion): array
    {
        $id=attendance_id($post['visit_id'] ?? null,'visit ID');
        $version=attendance_id($post['version'] ?? null,'visit version');
        $reason=$post['reason'] ?? null;
        if (!is_string($reason) || !preg_match('//u',$reason) || mb_strlen(trim($reason),'UTF-8')<10 || mb_strlen($reason,'UTF-8')>1000 || preg_match('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/',$reason)) throw new AttendanceRequestException(422,'Enter a correction reason of 10–1000 characters.');
        $mode=$post['mode'] ?? null;
        if (!in_array($mode,['correct','void'],true)) throw new AttendanceRequestException(422,'Choose Correct times or Void record.');
        $in=$mode==='correct'?$this->datetime($post['checked_in_at'] ?? null):null;
        $out=$mode==='correct' && ($post['checked_out_at'] ?? '')!==''?$this->datetime($post['checked_out_at']):null;
        if ($out!==null && $out<$in) throw new AttendanceRequestException(422,'Check-out cannot be before check-in.');
        return $this->transaction($actor,$authVersion,true,function() use($id,$version,$mode,$in,$out,$reason,$actor) {
            $hint=$this->repository->visit($id);
            $this->lockMember((int)$hint['member_id']);
            $before=$this->repository->visit($id,true);
            if ((int)$before['version']!==$version) throw new AttendanceRequestException(409,'Attendance changed. Reload and review before correcting.');
            if ($before['voided_at']!==null) throw new AttendanceRequestException(409,'A voided visit is retained as locked history.');
            if ($mode==='void') {
                $this->repository->execute('UPDATE attendance_visits SET voided_at=CURRENT_TIMESTAMP,updated_by=?,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=?','ii',[$actor,$id]);
            } else {
                $agreement=$this->repository->rows('SELECT start_date,end_date FROM registration_info WHERE id=?','i',[(int)$before['registration_id']])[0] ?? null;
                if (!$agreement || substr($in,0,10)<$agreement['start_date'] || substr($in,0,10)>$agreement['end_date']) throw new AttendanceRequestException(409,'Corrected check-in must be within its recorded membership dates. Void an invalid visit instead.');
                $overlap=$this->repository->rows("SELECT id FROM attendance_visits WHERE member_id=? AND id<>? AND voided_at IS NULL
                    AND checked_in_at<COALESCE(?,'9999-12-31 23:59:59') AND COALESCE(checked_out_at,'9999-12-31 23:59:59')>? LIMIT 1",'iiss',[(int)$before['member_id'],$id,$out,$in]);
                if ($overlap) throw new AttendanceRequestException(409,'Corrected times overlap another visit. Resolve that visit first.');
                $outActor=$out===null?null:($before['checked_out_by'] ?? $actor);
                $outKey=$out===null?null:$before['checkout_key'];
                $this->repository->execute('UPDATE attendance_visits SET checked_in_at=?,checked_out_at=?,checked_out_by=?,checkout_key=?,updated_by=?,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=?','ssisii',[$in,$out,$outActor,$outKey,$actor,$id]);
            }
            $this->audit($id,$actor,$mode==='void'?'void':'correction',$before,$this->repository->visit($id),trim($reason));
            return ['saved'=>true,'id'=>$id];
        });
    }
}
