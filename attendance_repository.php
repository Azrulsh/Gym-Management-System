<?php
declare(strict_types=1);
require_once __DIR__ . '/database_queries.php';
require_once __DIR__ . '/membership_read.php';

final class AttendanceRequestException extends RuntimeException
{
    public function __construct(public readonly int $status, string $message) { parent::__construct($message); }
}

function attendance_id(mixed $value, string $label): int
{
    $id=is_string($value) && preg_match('/\A[1-9][0-9]*\z/',$value)
        ? filter_var($value,FILTER_VALIDATE_INT,['options'=>['min_range'=>1,'max_range'=>2147483647]]) : false;
    if ($id===false) throw new AttendanceRequestException(422,'Enter a valid '.$label.'.');
    return $id;
}

final class AttendanceRepository extends DatabaseQueries
{
    public function visit(int $id, bool $lock=false): array
    {
        $row=$this->rows('SELECT * FROM attendance_visits WHERE id=?'.($lock?' FOR UPDATE':''),'i',[$id])[0] ?? null;
        if (!$row) throw new AttendanceRequestException(404,'Attendance record no longer exists. Reload the page.');
        return $row;
    }

    public function openVisit(int $member): ?array
    {
        return $this->rows('SELECT * FROM attendance_visits WHERE open_member_id=?','i',[$member])[0] ?? null;
    }

    /** The same membership state as Dashboard/Validity determines admission. */
    public function eligibility(int $member, ?string $today=null): array
    {
        $records=membership_read_records($this->connection(),$member);
        foreach ($records as $record) {
            if (membership_read_state($record,$today)['label']==='Active') return ['allowed'=>true,'label'=>'Active','registration_id'=>(int)$record['id'],'end_date'=>$record['end_date'],'reason'=>'Membership is active. Verify identity before check-in.'];
        }
        $open=array_values(array_filter($records,fn($record)=>(int)$record['status']===1));
        $label=$open ? membership_read_state($open[0],$today)['label'] : ($records?'Closed':'No membership');
        return ['allowed'=>false,'label'=>$label,'registration_id'=>null,'end_date'=>$open[0]['end_date'] ?? null,
            'reason'=>'Check-in unavailable: '.$label.'. Ask the gym to review or renew the membership.'];
    }

    public function listing(string $from, string $to, bool $inside): array
    {
        $sql="SELECT v.*,m.member_id AS member_number,CONCAT_WS(' ',m.firstname,m.middlename,m.lastname) AS member_name
            FROM attendance_visits v JOIN members m ON m.id=v.member_id WHERE ";
        if ($inside) return $this->rows($sql.'v.open_member_id IS NOT NULL ORDER BY v.checked_in_at ASC LIMIT 200');
        return $this->rows($sql.'v.checked_in_at>=? AND v.checked_in_at<? ORDER BY v.checked_in_at DESC,v.id DESC LIMIT 200','ss',[$from.' 00:00:00',(new DateTimeImmutable($to))->modify('+1 day')->format('Y-m-d').' 00:00:00']);
    }

    public function summary(): array
    {
        return $this->rows('SELECT (SELECT COUNT(*) FROM attendance_visits WHERE open_member_id IS NOT NULL) AS inside_count,
            (SELECT COUNT(*) FROM attendance_visits WHERE voided_at IS NULL AND checked_in_at>=CURDATE() AND checked_in_at<DATE_ADD(CURDATE(),INTERVAL 1 DAY)) AS today_count')[0];
    }
}
