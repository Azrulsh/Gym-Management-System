<?php
declare(strict_types=1);

/** Shared prepared-query execution. Repositories own SQL; callers own transactions. */
class DatabaseQueries
{
    public function __construct(private mysqli $db) {}

    public function query(string $sql, string $types = '', array $values = []): mysqli_stmt
    {
        $statement = $this->db->prepare($sql);
        try {
            if ($types !== '') $statement->bind_param($types, ...$values);
            $statement->execute();
            return $statement;
        } catch (Throwable $exception) { $statement->close(); throw $exception; }
    }

    public function rows(string $sql, string $types = '', array $values = []): array
    {
        $statement = $this->query($sql, $types, $values);
        try { return $statement->get_result()->fetch_all(MYSQLI_ASSOC); }
        finally { $statement->close(); }
    }

    public function execute(string $sql, string $types = '', array $values = []): int
    {
        $statement = $this->query($sql, $types, $values);
        try { return $statement->affected_rows; } finally { $statement->close(); }
    }

}
