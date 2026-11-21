<?php
require_once __DIR__.'/auth.php'; require_admin();
require_once __DIR__.'/attendance_repository.php';
try {
    $id=attendance_id($_GET['id'] ?? null,'visit ID');
    include __DIR__.'/db_connect.php'; $repository=new AttendanceRepository($conn);
    $visit=$repository->visit($id);
    $member=$repository->rows("SELECT member_id,CONCAT_WS(' ',firstname,middlename,lastname) AS name FROM members WHERE id=?",'i',[(int)$visit['member_id']])[0];
    $audit=$repository->rows('SELECT * FROM attendance_audit WHERE visit_id=? ORDER BY id DESC','i',[$id]);
} catch (AttendanceRequestException $exception) {
    http_response_code($exception->status); echo '<div class="alert alert-warning">'.membership_read_escape($exception->getMessage()).'</div>'; return;
} catch (mysqli_sql_exception | RuntimeException $exception) {
    error_log('Attendance review unavailable.'); http_response_code(503); echo '<div class="alert alert-danger">Unable to load Attendance review.</div>'; return;
} finally { if(isset($conn))$conn->close(); }
?>
<div class="container-fluid py-3" id="attendance-module">
    <h1 class="h4">Review Attendance #<?php echo $id; ?></h1><p><?php echo membership_read_escape($member['member_id'].' — '.$member['name']); ?></p>
    <div data-attendance-message role="alert" aria-live="polite"></div>
    <?php if($visit['voided_at']===null): ?>
    <div class="card mb-3"><div class="card-body"><form method="post" action="ajax.php?action=attendance_correct" data-attendance-form data-confirm="Apply this correction? The previous values and your reason will be retained in the audit history.">
        <input type="hidden" name="csrf_token" value="<?php echo membership_read_escape(csrf_token()); ?>"><input type="hidden" name="visit_id" value="<?php echo $id; ?>"><input type="hidden" name="version" value="<?php echo (int)$visit['version']; ?>">
        <div class="form-group"><label for="attendance-mode">Action</label><select id="attendance-mode" name="mode" class="form-control"><option value="correct">Correct times</option><option value="void">Void incorrect record (preserve history)</option></select></div>
        <div class="form-row"><div class="form-group col-md-6"><label for="correct-in">Check-in (Malaysia)</label><input class="form-control" id="correct-in" name="checked_in_at" type="datetime-local" step="1" required value="<?php echo membership_read_escape(str_replace(' ','T',$visit['checked_in_at'])); ?>"></div>
            <div class="form-group col-md-6"><label for="correct-out">Check-out (blank = still inside)</label><input class="form-control" id="correct-out" name="checked_out_at" type="datetime-local" step="1" value="<?php echo membership_read_escape(str_replace(' ','T',$visit['checked_out_at'] ?? '')); ?>"></div></div>
        <p class="text-muted">Times cannot be in the future or overlap another visit. Check-in must remain within the recorded membership dates. Void preserves the existing times and removes the visit from attendance totals.</p>
        <div class="form-group"><label for="attendance-reason">Reason</label><textarea class="form-control" id="attendance-reason" name="reason" minlength="10" maxlength="1000" rows="3" required></textarea></div>
        <button type="submit" class="btn btn-primary">Save Correction</button> <a class="btn btn-outline-secondary" href="index.php?page=attendance">Back</a>
    </form></div></div>
    <?php else: ?><div class="alert alert-info">This visit is voided and retained as locked history.</div><?php endif; ?>
    <div class="card"><div class="card-header">Audit history (Malaysia time)</div><div class="card-body">
        <?php foreach($audit as $entry): ?><details class="mb-3"><summary><?php echo membership_read_escape($entry['created_at'].' · '.$entry['action'].' · User #'.$entry['actor_id']); ?></summary>
            <p><?php echo membership_read_escape($entry['reason']); ?></p><pre class="text-wrap">Before: <?php echo membership_read_escape($entry['before_state'] ?? 'New visit'); ?></pre><pre class="text-wrap">After: <?php echo membership_read_escape($entry['after_state']); ?></pre>
        </details><?php endforeach; ?>
    </div></div>
</div><script src="assets/js/attendance.js?v=<?php echo filemtime(__DIR__ . '/assets/js/attendance.js'); ?>"></script>
