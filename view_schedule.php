<?php
require_once __DIR__ . '/auth.php';
require_login();
$value = $_GET['id'] ?? null;
$scheduleId = is_string($value) || is_int($value)
    ? filter_var($value, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1, 'max_range' => 2147483647]])
    : false;
if ($scheduleId === false) {
    http_response_code(400);
    echo '<div class="alert alert-danger" role="alert">Invalid schedule ID.</div>';
    return;
}
try {
    include 'db_connect.php';
    $statement = $conn->prepare("SELECT s.id, s.member_id, s.time_from, s.time_to,
        m.id AS existing_member_id, CONCAT_WS(', ', m.lastname, CONCAT_WS(' ', m.firstname, m.middlename)) AS name
        FROM schedules s LEFT JOIN members m ON m.id = s.member_id WHERE s.id = ?");
    if (!$statement) throw new RuntimeException('Schedule lookup unavailable.');
    $statement->bind_param('i', $scheduleId);
    try {
        if (!$statement->execute()) throw new RuntimeException('Schedule lookup unavailable.');
        $schedule = $statement->get_result()->fetch_assoc();
    } finally { $statement->close(); }
    if (!$schedule) {
        http_response_code(404);
        echo '<div class="alert alert-danger" role="alert">Schedule not found. It may have been deleted. Refresh the calendar.</div>';
        return;
    }
} catch (mysqli_sql_exception | RuntimeException $exception) {
    error_log('Unable to load schedule details.');
    http_response_code(503);
    echo '<div class="alert alert-danger" role="alert">Unable to load schedule details. Please try again.</div>';
    return;
}
$escapeSchedule = static function ($value) {
    return htmlspecialchars((string)$value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
};
$scheduleTime = static function ($value) {
    $time = DateTimeImmutable::createFromFormat('!H:i:s', (string)$value);
    return $time && $time->format('H:i:s') === $value ? $time->format('h:i A') : 'Invalid schedule time';
};
$name = $schedule['existing_member_id'] !== null ? ucwords($schedule['name']) : 'Member profile missing (ID ' . (int)$schedule['member_id'] . ')';
?>
<div id="view-schedule-details" data-id="<?php echo (int)$schedule['id']; ?>" data-csrf-token="<?php echo $escapeSchedule(csrf_token()); ?>">
<div class="container-fluid">
	<div class="schedule-view-message" role="alert" aria-live="polite"></div>
	<p>Schedule for: <b><?php echo $escapeSchedule($name); ?></b></p>
	<p>Time Start: <b><?php echo $escapeSchedule($scheduleTime($schedule['time_from'])); ?></b></p>
	<p>Time End: <b><?php echo $escapeSchedule($scheduleTime($schedule['time_to'])); ?></b></p>
	<hr class="divider">
	<div class="schedule-view-confirm alert alert-warning d-none" role="alert">
		<p>Delete this entire recurring schedule? All its sessions will be removed from the calendar. The member profile and membership history will be kept.</p>
		<button type="button" class="btn btn-danger confirm-view-delete">Confirm Delete</button>
		<button type="button" class="btn btn-secondary cancel-view-delete">Cancel Delete</button>
	</div>
</div>
<div class="modal-footer display">
	<div class="row">
		<div class="col-md-12">
			<button class="btn float-right btn-secondary" type="button" data-dismiss="modal">Close</button>
			<button class="btn float-right btn-danger mr-2" type="button" id="delete_schedule">Delete</button>
			<button class="btn float-right btn-primary mr-2" type="button" id="edit">Edit</button>
		</div>
	</div>
</div>
</div>
<style>
	#view-schedule-details p{
		margin:unset;
	}
	#uni_modal > .modal-dialog > .modal-content > .modal-footer{
		display: none;
	}
	#uni_modal .modal-footer.display {
		display: block;
	}
</style>
<script>
(function ($) {
    'use strict';
    // Keep the details view; scope controls without replacing shared schedule handlers.
    const view = $('#view-schedule-details');
    const id = Number(view.attr('data-id'));
    const token = view.attr('data-csrf-token');
    const message = view.find('.schedule-view-message');
    const confirmation = view.find('.schedule-view-confirm');
    let busy = false;
    if (!Number.isSafeInteger(id) || id < 1 || id > 2147483647 || !token) return;
    view.find('#edit').on('click', function () {
        if (!busy) window.uni_modal('Edit Schedule', 'manage_schedule.php?id=' + encodeURIComponent(id), 'mid-large');
    });
    view.find('#delete_schedule').on('click', function () {
        if (!busy) confirmation.removeClass('d-none');
    });
    view.find('.cancel-view-delete').on('click', function () {
        if (!busy) confirmation.addClass('d-none');
    });
    view.find('.confirm-view-delete').on('click', function () {
        if (busy || confirmation.hasClass('d-none')) return;
        busy = true;
        let deleted = false;
        view.find('button').prop('disabled', true);
        message.removeClass('alert alert-danger').empty();
        window.start_load();
        $.ajax({
            url: 'ajax.php?action=delete_schedule', method: 'POST', timeout: 15000,
            data: { id: id, csrf_token: token },
            success: function (response) {
                if (String(response).trim() !== '1') {
                    message.addClass('alert alert-danger').text('Unable to delete schedule. Please try again.');
                    return;
                }
                deleted = true;
            },
            error: function (xhr, status) {
                if (xhr.status === 401 || xhr.status === 403) return;
                const error = xhr.responseJSON && xhr.responseJSON.error;
                message.addClass('alert alert-danger').text(status === 'timeout'
                    ? 'Delete status could not be confirmed because the request timed out. Refresh the calendar and check whether the schedule still exists before trying again.'
                    : typeof error === 'string' ? error : 'Unable to delete schedule. Please try again.');
            },
            complete: function () {
                window.end_load();
                if (deleted) {
                    window.alert_toast('Schedule successfully deleted.', 'success');
                    window.setTimeout(function () { window.location.reload(); }, 750);
                } else {
                    busy = false;
                    view.find('button').prop('disabled', false);
                }
            }
        });
    });
})(jQuery);
</script>
