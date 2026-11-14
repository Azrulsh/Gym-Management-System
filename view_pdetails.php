<?php
require_once __DIR__ . '/auth.php';
require_login();
require_once __DIR__ . '/membership_read.php';
$id = membership_read_id($_GET['id'] ?? null);
if ($id === false) {
    http_response_code(400);
    exit('<div class="alert alert-danger">Invalid membership ID.</div>');
}
try {
    include 'db_connect.php';
    $rows = membership_read_records($conn, null, $id);
    if (!$rows) {
        http_response_code(404);
        exit('<div class="alert alert-danger">Membership no longer exists.</div>');
    }
    $row = $rows[0];
    $state = membership_read_state($row);
    $trainerFee = (int) $row['trainer_id'] === 0 ? 0 : $row['trainer_fee'];
} catch (mysqli_sql_exception | RuntimeException $exception) {
    error_log('Unable to load membership details.');
    http_response_code(503);
    exit('<div class="alert alert-danger">Unable to load membership details. Please try again.</div>');
}
?>
<div class="container-fluid">
    <div class="renewal-message" role="alert" aria-live="polite"></div>
    <p>Membership: <b>#<?php echo $id; ?></b> <span class="badge badge-<?php echo $state['class']; ?>"><?php echo $state['label']; ?></span></p>
    <?php if ($state['issues']): ?>
    <div class="alert alert-warning" role="alert">
        <ul class="mb-1 pl-3"><?php foreach ($state['issues'] as $issue): ?><li><?php echo membership_read_escape($issue); ?></li><?php endforeach; ?></ul>
        <?php if ((int) $row['status'] === 1): ?>
        Resolve missing details or End this membership before creating a new one. Previous history is kept.
        <?php else: ?>This closed record is kept as history. Missing prices are not estimated.<?php endif; ?>
    </div>
    <?php endif; ?>
    <p>Member ID: <b><?php echo $row['existing_member_id'] !== null ? membership_read_escape($row['member_number']) : 'Member profile missing'; ?></b></p>
    <p>Name: <b><?php echo $row['existing_member_id'] !== null ? membership_read_escape(ucwords($row['name'])) : 'Member profile missing'; ?></b></p>
    <p>Plan: <b><?php echo $row['existing_plan_id'] !== null ? (int) $row['plan'] . ' month(s)' : 'Plan missing (ID ' . (int) $row['plan_id'] . ')'; ?></b></p>
    <p>Package: <b><?php echo $row['existing_package_id'] !== null ? membership_read_escape($row['package']) : 'Package missing (ID ' . (int) $row['package_id'] . ')'; ?></b></p>
    <p>Trainer: <b><?php echo (int) $row['trainer_id'] === 0 ? 'None' : ($row['existing_trainer_id'] !== null ? membership_read_escape($row['trainer_name']) : 'Trainer missing'); ?></b></p>
    <p>Start: <b><?php echo membership_read_escape($row['start_date']); ?></b></p>
    <p>End: <b><?php echo membership_read_escape($row['end_date']); ?></b></p>
    <hr>
    <?php if (($row['price_source'] ?? '') === 'migration_baseline'): ?>
    <p class="small text-muted">Prices recorded at system upgrade; original signup prices could not be verified. These recorded fees stay fixed for this membership.</p>
    <?php endif; ?>
    <p>Plan Membership Fee: <b><?php echo $row['pamount'] !== null ? number_format($row['pamount'], 2) : 'Unavailable'; ?></b></p>
    <p>Package Amount: <b><?php echo $row['ppamount'] !== null ? number_format($row['ppamount'], 2) : 'Unavailable'; ?></b></p>
    <p>Trainer Fee: <b><?php echo $trainerFee !== null ? number_format($trainerFee, 2) : 'Unavailable'; ?></b></p>
    <p>Monthly Payable: <b><?php echo $row['ppamount'] !== null && $trainerFee !== null ? number_format($row['ppamount'] + $trainerFee, 2) : 'Unavailable'; ?></b></p>
</div>
<div class="modal-footer display">
    <button class="btn btn-secondary" type="button" data-dismiss="modal">Close</button>
    <button class="btn btn-primary mr-2" type="button" id="payment">Payment</button>
    <?php if ($state['can_renew']): ?>
    <button class="btn btn-primary mr-2 renew-membership" type="button" data-registration-id="<?php echo $id; ?>" data-csrf-token="<?php echo membership_read_escape(csrf_token()); ?>">Renew</button>
    <?php endif; ?>
    <?php if ((int) $row['status'] === 1): ?>
    <button class="btn btn-outline-danger mr-2 end-membership" type="button" data-registration-id="<?php echo $id; ?>" data-csrf-token="<?php echo membership_read_escape(csrf_token()); ?>">End Membership</button>
    <?php endif; ?>
</div>
<style>#uni_modal .modal-footer{display:none}#uni_modal .modal-footer.display{display:flex}</style>
<script>$('#payment').click(function(){uni_modal('Payments','payment.php?rid=<?php echo $id; ?>','large');});</script>
