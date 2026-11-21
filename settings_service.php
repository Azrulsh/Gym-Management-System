<?php
declare(strict_types=1);
require_once __DIR__ . '/settings_repository.php';
require_once __DIR__ . '/settings_images.php';

final class SettingsService
{
    public function __construct(private $db, private SettingsImages $images) {}

    private function details(array $post): array
    {
        $fields = [];
        foreach (['gym_name'=>100,'email'=>254,'contact'=>50,'address'=>1000,'about'=>3000] as $name=>$limit) {
            $value = $post[$name] ?? '';
            if (!is_string($value) || !preg_match('//u',$value)) throw new SettingsRequestException(422, 'Enter valid gym details.');
            $value = trim($value);
            if (mb_strlen($value,'UTF-8') > $limit || preg_match('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/',$value)
                || (!in_array($name,['address','about'],true) && preg_match('/[\r\n\t]/',$value))) throw new SettingsRequestException(422, 'Gym details contain invalid text or exceed the allowed length.');
            $fields[$name] = $value;
        }
        if ($fields['gym_name'] === '') throw new SettingsRequestException(422, 'Gym name is required.');
        if ($fields['email'] !== '' && !filter_var($fields['email'],FILTER_VALIDATE_EMAIL)) throw new SettingsRequestException(422, 'Enter a valid contact email.');
        if ($fields['contact'] !== '' && !preg_match('/\A[+0-9() .-]{3,50}\z/',$fields['contact'])) throw new SettingsRequestException(422, 'Enter a valid contact phone number.');
        return $fields;
    }

    public function save(array $post, array $files, int $actorId): array
    {
        $fields = $this->details($post);
        $rawVersion = $post['version'] ?? null;
        $version = is_string($rawVersion) && ctype_digit($rawVersion)
            ? filter_var($rawVersion,FILTER_VALIDATE_INT,['options'=>['min_range'=>1,'max_range'=>2147483647]]) : false;
        if ($version === false) throw new SettingsRequestException(422, 'Reload Settings before saving.');
        $previous = system_settings_read($this->db);
        if ((int)$previous['version'] !== $version) throw new SettingsRequestException(409, 'Settings changed. Reload the page and review the latest values before saving.');
        $created = []; $transaction = false; $commitAttempted = false;
        try {
            foreach (['logo','cover'] as $kind) {
                $remove = $post['remove_' . $kind] ?? '0';
                if (!in_array($remove,['0','1'],true)) throw new SettingsRequestException(422, 'Invalid image removal option.');
                $upload = $files[$kind] ?? ['error'=>UPLOAD_ERR_NO_FILE];
                if (!is_array($upload)) throw new SettingsRequestException(422,'Invalid image upload.');
                if ($remove === '1' && ($upload['error'] ?? null) !== UPLOAD_ERR_NO_FILE) throw new SettingsRequestException(422,'Choose either a new image or Remove, then save again.');
                $filename = $this->images->store($upload,$kind);
                if ($filename !== null) $created[] = $filename;
                $fields[$kind . '_filename'] = $remove === '1' ? null : ($filename ?? $previous[$kind . '_filename']);
            }
            if (!$this->db->begin_transaction()) throw new RuntimeException('Settings transaction unavailable.');
            $transaction = true;
            // Recheck authority inside the write transaction after potentially expensive image work.
            $actor = $this->db->prepare('SELECT type FROM users WHERE id = ? FOR UPDATE');
            if (!$actor) throw new RuntimeException('Settings authority lookup failed.');
            try {
                $actor->bind_param('i',$actorId);
                if (!$actor->execute()) throw new RuntimeException('Settings authority lookup failed.');
                $user = $actor->get_result()->fetch_assoc();
            } finally { $actor->close(); }
            if (!$user || (int)$user['type'] !== 1) throw new SettingsRequestException(403,'Your account no longer has Admin access.');
            $statement = $this->db->prepare('UPDATE system_settings SET gym_name=?, email=?, contact=?, address=?, about=?, logo_filename=?, cover_filename=?, version=version+1, updated_at=CURRENT_TIMESTAMP, updated_by=? WHERE id=1 AND version=?');
            if (!$statement) throw new RuntimeException('Settings update unavailable.');
            try {
                $statement->bind_param('sssssssii',$fields['gym_name'],$fields['email'],$fields['contact'],$fields['address'],$fields['about'],$fields['logo_filename'],$fields['cover_filename'],$actorId,$version);
                if (!$statement->execute()) throw new RuntimeException('Settings update failed.');
                if ($statement->affected_rows !== 1) throw new SettingsRequestException(409,'Settings changed. Reload the page and review the latest values before saving.');
            } finally { $statement->close(); }
            $saved = system_settings_read($this->db);
            $commitAttempted = true;
            if (!$this->db->commit()) throw new RuntimeException('Settings commit failed.');
            $transaction = false;
        } catch (Throwable $exception) {
            if ($transaction) $this->db->rollback();
            // Keep new files when commit outcome is uncertain rather than delete a possibly referenced image.
            if (!$commitAttempted) foreach ($created as $filename) $this->images->remove($filename);
            throw $exception;
        }
        foreach (['logo','cover'] as $kind) {
            if ($previous[$kind . '_filename'] !== $fields[$kind . '_filename']) $this->images->remove($previous[$kind . '_filename']);
        }
        return $saved;
    }
}
