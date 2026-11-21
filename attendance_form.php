<?php
require_once __DIR__.'/auth.php';
require_login();
require_once __DIR__.'/membership_read.php';
?>
<div class="card mb-3">
    <div class="card-header"><b>Member Check-in / Check-out</b></div>
    <div class="card-body">
        <p class="text-muted">Enter the member number, then verify identity. All times use Malaysia time.</p>
        <div data-attendance-message role="alert" aria-live="polite"></div>
        <form id="attendance-lookup" class="form-inline" action="ajax.php?action=attendance_lookup" method="post">
            <input type="hidden" name="csrf_token" value="<?php echo membership_read_escape(csrf_token()); ?>">
            <label for="tracking_id" class="mr-2">Member number</label>
            <input id="tracking_id" name="tracking_id" class="form-control mr-2 mb-2" inputmode="numeric" pattern="[1-9][0-9]*" maxlength="10" required autocomplete="off">
            <button id="check" type="submit" class="btn btn-primary mb-2">Find Member</button>
        </form>
        <div id="details" class="d-none mt-3" aria-live="polite">
            <button type="button" class="media-viewer-trigger mb-2" data-media-viewer aria-label="View member avatar"><img data-attendance-avatar width="80" height="80" alt="Member avatar" class="rounded"><span class="d-block small">View image</span></button>
            <p><strong id="name"></strong><br><span data-attendance-number></span></p>
            <p data-attendance-state></p>
            <p data-attendance-explanation></p>
            <form id="manage-records" action="ajax.php?action=attendance_checkin" method="post" data-attendance-form>
                <input type="hidden" name="csrf_token" value="<?php echo membership_read_escape(csrf_token()); ?>">
                <input type="hidden" name="person_id"><input type="hidden" name="visit_id"><input type="hidden" name="version">
                <input type="hidden" name="request_key" value="<?php echo bin2hex(random_bytes(32)); ?>">
                <div class="form-check mb-2" data-attendance-verification><input class="form-check-input" id="attendance-identity" name="identity_confirmed" type="checkbox" value="1"><label class="form-check-label" for="attendance-identity">I verified this member's identity.</label></div>
                <button type="submit" class="btn btn-success" data-attendance-submit>Check In</button>
            </form>
        </div>
    </div>
</div>
