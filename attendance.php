<?php
require_once __DIR__.'/auth.php';
require_login();
require_once __DIR__.'/attendance_repository.php';
try {
    $from=$_GET['from'] ?? date('Y-m-d'); $to=$_GET['to'] ?? date('Y-m-d');
    $filter=$_GET['filter'] ?? 'inside';
    if (!membership_valid_date($from) || !membership_valid_date($to) || $to<'1000-01-01' || $to>='9999-12-31' || $from>$to
        || (new DateTimeImmutable($from))->diff(new DateTimeImmutable($to))->days>366 || !in_array($filter,['inside','history'],true)) throw new AttendanceRequestException(422,'Choose a valid date range up to 366 days and an Attendance filter.');
    include __DIR__.'/db_connect.php'; $repository=new AttendanceRepository($conn);
    $visits=$repository->listing($from,$to,$filter==='inside'); $summary=$repository->summary();
} catch (AttendanceRequestException $exception) {
    http_response_code($exception->status); echo '<div class="alert alert-warning">'.membership_read_escape($exception->getMessage()).'</div><a href="index.php?page=attendance">Back to Attendance</a>'; return;
} catch (mysqli_sql_exception | RuntimeException $exception) {
    error_log('Attendance read unavailable.'); http_response_code(503); echo '<div class="alert alert-danger">Unable to load Attendance. Please try again.</div>'; return;
} finally { if(isset($conn))$conn->close(); }
?>
<div class="container-fluid py-3" id="attendance-module">
    <h1 class="h4">Attendance</h1>
    <p><strong><?php echo (int)$summary['inside_count']; ?></strong> currently inside · <strong><?php echo (int)$summary['today_count']; ?></strong> visits today (voided records excluded).</p>
    <?php include __DIR__.'/attendance_form.php'; ?>
    <div class="card"><div class="card-header"><b>Visit records</b></div><div class="card-body">
        <form method="get" action="index.php" class="form-row align-items-end mb-3">
            <input type="hidden" name="page" value="attendance">
            <div class="form-group col-md-3"><label for="attendance-filter">Show</label><select name="filter" id="attendance-filter" class="form-control"><option value="inside" <?php if($filter==='inside')echo 'selected'; ?>>Currently inside (all dates)</option><option value="history" <?php if($filter==='history')echo 'selected'; ?>>History by check-in date</option></select></div>
            <div class="form-group col-md-3"><label for="attendance-from">From</label><input id="attendance-from" class="form-control" type="date" name="from" required value="<?php echo membership_read_escape($from); ?>"></div>
            <div class="form-group col-md-3"><label for="attendance-to">To</label><input id="attendance-to" class="form-control" type="date" name="to" required value="<?php echo membership_read_escape($to); ?>"></div>
            <div class="form-group col-md-3"><button class="btn btn-primary" type="submit">Filter</button></div>
        </form>
        <p class="text-muted">Up to 200 records. Inside includes overnight visits; history includes voided records. Narrow the date range to review older visits.</p>
        <div class="table-responsive"><table class="table table-bordered table-hover"><thead><tr><th>Member</th><th>Check-in (Malaysia)</th><th>Check-out (Malaysia)</th><th>Status</th><th>Action</th></tr></thead><tbody>
            <?php foreach($visits as $visit): ?><tr>
                <td><?php echo membership_read_escape($visit['member_number'].' — '.$visit['member_name']); ?></td><td><?php echo membership_read_escape($visit['checked_in_at']); ?></td><td><?php echo membership_read_escape($visit['checked_out_at'] ?? '—'); ?></td>
                <td><?php echo $visit['voided_at']!==null?'Voided':($visit['checked_out_at']===null?'Inside':'Checked out'); ?></td>
                <td><?php if($visit['open_member_id']!==null): ?><form class="d-inline-block mb-1" method="post" action="ajax.php?action=attendance_checkout" data-attendance-form data-confirm="Check out this member?">
                    <input type="hidden" name="csrf_token" value="<?php echo membership_read_escape(csrf_token()); ?>"><input type="hidden" name="visit_id" value="<?php echo (int)$visit['id']; ?>"><input type="hidden" name="version" value="<?php echo (int)$visit['version']; ?>"><input type="hidden" name="request_key" value="<?php echo bin2hex(random_bytes(32)); ?>"><button type="submit" class="btn btn-sm btn-outline-success">Check Out</button>
                </form><?php endif; ?>
                <?php if(is_admin()): ?><a class="btn btn-sm btn-outline-secondary mb-1" href="index.php?page=manage_attendance&amp;id=<?php echo (int)$visit['id']; ?>">Review / Correct</a><?php endif; ?></td>
            </tr><?php endforeach; ?>
        </tbody></table></div><?php if(!$visits): ?><p>No matching visits found.</p><?php endif; ?>
    </div></div>
</div><script src="assets/js/attendance.js?v=<?php echo filemtime(__DIR__ . '/assets/js/attendance.js'); ?>"></script>
