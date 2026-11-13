<?php

final class LoginThrottle
{
    const WINDOW_SECONDS = 900;
    const ACCOUNT_LIMIT = 5;
    // A shared office IP can serve multiple users, but cannot try unlimited usernames.
    const IP_LIMIT = 30;

    private $db;
    private $active = false;
    private $accountBucket;

    public function __construct($db)
    {
        $this->db = $db;
    }

    private function execute($sql, $types = '', ...$values)
    {
        $statement = $this->db->prepare($sql);
        if (!$statement) throw new RuntimeException('Login throttle unavailable.');
        if ($types !== '') $statement->bind_param($types, ...$values);
        if (!$statement->execute()) {
            $statement->close();
            throw new RuntimeException('Login throttle unavailable.');
        }
        return $statement;
    }

    public function begin($account, $ip)
    {
        // Use the server-observed address. Forwarded headers are not trusted.
        $packedIp = @inet_pton($ip);
        $ip = $packedIp === false ? 'unknown' : bin2hex($packedIp);
        $this->accountBucket = hash('sha256', 'account:' . $account);
        $limits = [
            $this->accountBucket => self::ACCOUNT_LIMIT,
            hash('sha256', 'ip:' . $ip) => self::IP_LIMIT,
        ];
        ksort($limits);
        $clock = $this->execute('SELECT UNIX_TIMESTAMP() AS current_time_seconds');
        $now = (int) $clock->get_result()->fetch_assoc()['current_time_seconds'];
        $clock->close();
        // Bounded cleanup keeps obsolete usernames/IPs from accumulating indefinitely.
        $cleanup = $this->execute('DELETE FROM login_throttle WHERE expires_at <= ? LIMIT 100', 'i', $now);
        $cleanup->close();
        if (!$this->db->begin_transaction()) throw new RuntimeException('Login throttle unavailable.');
        $this->active = true;
        $retryAfter = 0;
        foreach ($limits as $bucket => $limit) {
            $expires = $now + self::WINDOW_SECONDS;
            $insert = $this->execute('INSERT INTO login_throttle (bucket, attempts, expires_at) VALUES (?, 0, ?) ON DUPLICATE KEY UPDATE bucket = VALUES(bucket)', 'si', $bucket, $expires);
            $insert->close();
            $select = $this->execute('SELECT attempts, expires_at FROM login_throttle WHERE bucket = ? FOR UPDATE', 's', $bucket);
            $row = $select->get_result()->fetch_assoc();
            $select->close();
            if (!$row) throw new RuntimeException('Login throttle unavailable.');
            if ((int) $row['expires_at'] <= $now) {
                $reset = $this->execute('UPDATE login_throttle SET attempts = 0, expires_at = ? WHERE bucket = ?', 'is', $expires, $bucket);
                $reset->close();
            } elseif ((int) $row['attempts'] >= $limit) {
                $retryAfter = max($retryAfter, (int) $row['expires_at'] - $now);
            }
        }
        if ($retryAfter > 0) {
            $this->cancel();
            return $retryAfter;
        }
        // Locks remain held through verification so parallel requests share the limit.
        foreach ($limits as $bucket => $limit) {
            $update = $this->execute('UPDATE login_throttle SET attempts = attempts + 1 WHERE bucket = ?', 's', $bucket);
            $update->close();
        }
        return 0;
    }

    public function finish($success)
    {
        if (!$this->active) throw new RuntimeException('Login throttle not started.');
        if ($success) {
            $reset = $this->execute('UPDATE login_throttle SET attempts = 0 WHERE bucket = ?', 's', $this->accountBucket);
            $reset->close();
        }
        // IP counts all admitted attempts, even successful ones, to prevent password spraying.
        if (!$this->db->commit()) throw new RuntimeException('Login throttle unavailable.');
        $this->active = false;
    }

    public function cancel()
    {
        if ($this->active) {
            $this->db->rollback();
            $this->active = false;
        }
    }
}
