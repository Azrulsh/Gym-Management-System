<?php
declare(strict_types=1);
require_once __DIR__ . '/database_queries.php';

final class EventRequestException extends RuntimeException
{
    public function __construct(public readonly int $status, string $message) { parent::__construct($message); }
}

/** Event queries use the same prepared execution layer as Member Portal queries. */
final class EventsRepository extends DatabaseQueries
{
    public function find(int $id, bool $lock = false): array
    {
        $rows = $this->rows('SELECT * FROM events WHERE id=?' . ($lock ? ' FOR UPDATE' : ''), 'i', [$id]);
        if (!$rows) throw new EventRequestException(404, 'Event no longer exists. Return to the event list.');
        return $rows[0];
    }

    public function counts(int $id): array
    {
        return $this->rows("SELECT COUNT(*) AS history, COALESCE(SUM(status <> 'cancelled'),0) AS occupied FROM event_registrations WHERE event_id=?", 'i', [$id])[0];
    }

    public function listing(): array
    {
        return $this->rows("SELECT e.*, COALESCE(p.occupied,0) AS occupied FROM events e
            LEFT JOIN (SELECT event_id, SUM(status <> 'cancelled') AS occupied FROM event_registrations GROUP BY event_id) p ON p.event_id=e.id
            ORDER BY e.starts_at DESC, e.id DESC");
    }

    public function participants(int $id): array
    {
        return $this->rows("SELECT p.*, m.member_id AS member_number, CONCAT_WS(' ',m.firstname,m.middlename,m.lastname) AS member_name
            FROM event_registrations p JOIN members m ON m.id=p.member_id WHERE p.event_id=? ORDER BY p.id", 'i', [$id]);
    }
}

function event_escape(mixed $value): string
{
    return htmlspecialchars((string)$value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function event_positive_id(mixed $value, string $label = 'ID'): int
{
    $id = is_string($value) && preg_match('/\A[1-9][0-9]*\z/', $value)
        ? filter_var($value, FILTER_VALIDATE_INT, ['options'=>['min_range'=>1,'max_range'=>2147483647]]) : false;
    if ($id === false) throw new EventRequestException(422, 'Invalid ' . $label . '. Reload the page and try again.');
    return $id;
}

function event_phase(array $event): string
{
    if ($event['status'] !== 'published') return ucfirst($event['status']);
    $now = date('Y-m-d H:i:s');
    if ($now >= $event['ends_at']) return 'Ended';
    return $now >= $event['starts_at'] ? 'Ongoing' : 'Upcoming';
}
