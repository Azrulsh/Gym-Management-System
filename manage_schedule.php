<?php
require_once __DIR__ . '/auth.php';
require_login();
// No ID means Add; a supplied ID must identify exactly one existing schedule.
$scheduleId = null;
if (array_key_exists('id', $_GET)) {
    $value = $_GET['id'];
    $scheduleId = is_string($value) || is_int($value)
        ? filter_var($value, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1, 'max_range' => 2147483647]])
        : false;
    if ($scheduleId === false) {
        http_response_code(400);
        echo '<div class="alert alert-danger" role="alert">Invalid schedule ID.</div>';
        return;
    }
}
$id = $member_id = $date_from = $date_to = $time_from = $time_to = '';
$dow_arr = [];
try {
    include 'db_connect.php';
    if ($scheduleId !== null) {
        $statement = $conn->prepare('SELECT id, version, member_id, dow, date_from, date_to, time_from, time_to FROM schedules WHERE id = ?');
        if (!$statement) throw new RuntimeException('Schedule lookup unavailable.');
        $statement->bind_param('i', $scheduleId);
        try {
            if (!$statement->execute()) throw new RuntimeException('Schedule lookup unavailable.');
            $schedule = $statement->get_result()->fetch_assoc();
        } finally {
            $statement->close();
        }
        if (!$schedule) {
            http_response_code(404);
            echo '<div class="alert alert-danger" role="alert">Schedule not found. It may have been deleted. Refresh the calendar.</div>';
            return;
        }
        $id = (int) $schedule['id'];
        $member_id = (int) $schedule['member_id'];
        $date_from = substr($schedule['date_from'], 0, 7);
        $date_to = substr($schedule['date_to'], 0, 7);
        $time_from = $schedule['time_from'];
        $time_to = $schedule['time_to'];
        $dow_arr = explode(',', $schedule['dow']);
    }
    $result = $conn->query("SELECT id, CONCAT_WS(', ', lastname, CONCAT_WS(' ', firstname, middlename)) AS name FROM members ORDER BY name ASC");
    if (!$result) throw new RuntimeException('Member lookup unavailable.');
    $scheduleMembers = $result->fetch_all(MYSQLI_ASSOC);
    $result->free();
} catch (mysqli_sql_exception | RuntimeException $exception) {
    error_log('Unable to load schedule form.');
    http_response_code(503);
    echo '<div class="alert alert-danger" role="alert">Unable to load schedule. Please try again.</div>';
    return;
}
?>
<style>
	
	
</style>
<div class="container-fluid">
	<form action="ajax.php?action=save_schedule" id="manage-schedule">
		<input type="hidden" name="csrf_token" value="<?php echo csrf_token(); ?>">
		<div class="schedule-message" role="alert" aria-live="polite"></div>
		<input type="hidden" name="id" value="<?php echo isset($id) ? $id : '' ?>">
		<input type="hidden" name="version" value="<?php echo isset($schedule['version']) ? (int) $schedule['version'] : ''; ?>">
		<div class="col-lg-12">
			<div class="row">
				<div class="col-md-12">
					<div class="form-group">
						<label for="" class="control-label">Member</label>
						<select name="member_id" id="" class="custom-select select2" required>
							<option value=""></option>
						<?php foreach ($scheduleMembers as $row): ?>
							<option value="<?php echo $row['id'] ?>" <?php echo isset($member_id) && $member_id == $row['id'] ? 'selected' : '' ?>><?php echo htmlspecialchars(ucwords($row['name']), ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'); ?></option>
						<?php endforeach; ?>
						</select>
					</div>
					<div class="form-group">
						<label for="" class="control-label">Days of Week</label>
						<select name="dow[]" id="schedule-days" class="custom-select select2" multiple="multiple" required>
							<?php 
							$dow = array("Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday");
							for($i = 0; $i < 7;$i++):
							?>
							<option value="<?php echo $i ?>" <?php echo !empty($dow_arr) && in_array($i,$dow_arr) ? 'selected' : '' ?>><?php echo $dow[$i] ?></option>
						<?php endfor; ?>
						</select>
					</div>
					<div class="form-group">
						<label for="" class="control-label">Month From</label>
						<input type="month" name="date_from" id="date_from" class="form-control" min="1000-01" max="9999-12" required value="<?php echo htmlspecialchars($date_from, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'); ?>">
					</div>
					<div class="form-group">
						<label for="" class="control-label">Month To</label>
						<input type="month" name="date_to" id="date_to" class="form-control" min="1000-01" max="9999-12" required value="<?php echo htmlspecialchars($date_to, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'); ?>">
					</div>
					<div class="form-group">
						<label for="" class="control-label">Time From</label>
						<input type="time" name="time_from" id="time_from" class="form-control" step="1" required value="<?php echo htmlspecialchars($time_from, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'); ?>">
					</div>
					<div class="form-group">
						<label for="" class="control-label">Time To</label>
						<input type="time" name="time_to" id="time_to" class="form-control" step="1" required value="<?php echo htmlspecialchars($time_to, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'); ?>">
						<small class="form-text text-muted">End time must be after start time on the same day.</small>
					</div>
				</div>
			</div>
		</div>
		<?php if ($scheduleId !== null): ?>
		<div class="border-top pt-3 mt-3">
			<button type="button" class="btn btn-outline-danger request-schedule-delete">Delete Schedule</button>
			<div class="schedule-delete-confirm alert alert-warning mt-3 d-none" role="alert">
				<p>Delete this entire recurring schedule? All its sessions will be removed from the calendar. The member profile and membership history will be kept.</p>
				<button type="button" class="btn btn-danger confirm-schedule-delete" data-id="<?php echo $id; ?>" data-csrf-token="<?php echo csrf_token(); ?>">Confirm Delete</button>
				<button type="button" class="btn btn-secondary cancel-schedule-delete">Cancel Delete</button>
			</div>
		</div>
		<?php endif; ?>
	</form>
</div>
<script>
	$('.select2').select2({
		placeholder:'Please Select Here',
		width:'100%'
	})
	
</script>
