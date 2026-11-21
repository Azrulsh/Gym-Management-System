<?php
declare(strict_types=1);
require_once __DIR__ . '/events_repository.php';

/** Portal reads always derive the owner from a verified account, never request member_id. */
final class MemberPortalRepository
{
    private DatabaseQueries $sql;
    public function __construct(private mysqli $db) { $this->sql = new DatabaseQueries($db); }

    public function account(int $userId, bool $lock = false): ?array
    {
        return $this->sql->rows('SELECT u.id AS user_id,u.username,u.password,u.type,u.auth_version,u.version AS account_version,
            p.member_id AS profile_id,p.enabled,p.avatar_filename,m.* FROM users u
            JOIN member_portal_accounts p ON p.user_id=u.id JOIN members m ON m.id=p.member_id
            WHERE u.id=?' . ($lock ? ' FOR UPDATE' : ''), 'i', [$userId])[0] ?? null;
    }

    public function memberships(int $owner): array
    {
        require_once __DIR__ . '/membership_read.php';
        return membership_read_records($this->db,$owner);
    }

    public function payments(int $owner): array
    {
        return $this->sql->rows('SELECT p.* FROM payments p JOIN registration_info r ON r.id=p.registration_id WHERE r.member_id=? ORDER BY p.date_created DESC,p.id DESC','i',[$owner]);
    }

    public function schedules(int $owner): array
    {
        return $this->sql->rows('SELECT * FROM schedules WHERE member_id=? ORDER BY date_to DESC,id DESC','i',[$owner]);
    }

    public function events(int $owner): array
    {
        return $this->sql->rows("SELECT e.*,p.status AS participation,p.version AS participant_version,
            (SELECT COUNT(*) FROM event_registrations other WHERE other.event_id=e.id AND other.status<>'cancelled') AS occupied
            FROM events e LEFT JOIN event_registrations p ON p.event_id=e.id AND p.member_id=?
            WHERE e.status<>'draft' ORDER BY e.starts_at DESC,e.id DESC",'i',[$owner]);
    }

    public function administration(): array
    {
        return $this->sql->rows("SELECT m.id,m.member_id,CONCAT_WS(' ',m.firstname,m.middlename,m.lastname) AS name,
            u.id AS user_id,u.username,u.version AS account_version,p.enabled FROM members m
            LEFT JOIN member_portal_accounts p ON p.member_id=m.id LEFT JOIN users u ON u.id=p.user_id ORDER BY m.firstname,m.id");
    }
}
