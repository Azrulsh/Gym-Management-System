<?php
require_once __DIR__ . '/auth.php';
require_login();
require_once __DIR__ . '/membership_read.php';
require_once __DIR__ . '/payment_read.php';
$registrationId = $_GET['rid'] ?? null;
if (!is_scalar($registrationId) || is_bool($registrationId)) $registrationId = false;
else $registrationId = filter_var($registrationId, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1, 'max_range' => 2147483647]]);
if ($registrationId === false) {
    http_response_code(400);
    exit('<div class="alert alert-danger">Invalid membership ID.</div>');
}
try {
    include 'db_connect.php';
    $records = membership_read_records($conn, null, $registrationId);
    if (!$records) {
        http_response_code(404);
        exit('<div class="alert alert-danger">Membership details are unavailable. Refresh the page.</div>');
    }
    $details = $records[0];
    $membershipState = membership_read_state($details);
    $id = (int) $details['id'];
    $pamount = $details['pamount'];
    $ppamount = $details['ppamount'];
    $tf = (int) $details['trainer_id'] === 0 ? 0 : $details['trainer_fee'];
    $planRemaining = $pamount === null ? null : payment_plan_balance($conn, $id, $pamount);
    $statement = $conn->prepare('SELECT amount, plan_amount, remarks, date_created FROM payments WHERE registration_id = ? ORDER BY id ASC');
    if (!$statement) throw new RuntimeException('Payment history lookup failed.');
    $statement->bind_param('i', $id);
    if (!$statement->execute()) throw new RuntimeException('Payment history lookup failed.');
    $history = $statement->get_result()->fetch_all(MYSQLI_ASSOC);
    $statement->close();
} catch (mysqli_sql_exception | RuntimeException $exception) {
    error_log('Unable to load payments (error code ' . (int) $exception->getCode() . ').');
    http_response_code(503);
    exit('<div class="alert alert-danger">Unable to load payments. Please try again.</div>');
}
?>
<div class="container-fluid">
	<div class="row">
		<div class="col-md-6">
			<table class="table table-bordered">
				<thead>
					<tr>
						<th>Date</th>
						<th>Amount</th>
						<th>For Plan Fee</th>
						<th>Remarks</th>
					</tr>
				</thead>
				<tbody>
					<?php 
					foreach ($history as $row):
					?>
					<tr>
						<td><?php echo date("M d,Y",strtotime($row['date_created'])) ?></td>
						<td class="text-right"><?php echo number_format($row['amount'], 2) ?></td>
						<td><?php echo $row['plan_amount'] === null ? 'Unallocated (legacy)' : number_format($row['plan_amount'], 2); ?></td>
						<td><?php echo htmlspecialchars($row['remarks'], ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'); ?></td>
					</tr>
					<?php endforeach; ?>
				</tbody>
			</table>
		</div>
		<div class="col-md-6">
			<?php if (!$membershipState['can_pay']): ?>
			<div class="alert alert-warning" role="alert">
				Payment history is kept. New payments are unavailable until membership details are resolved; missing prices are not estimated.
				<ul class="mb-0 pl-3"><?php foreach ($membershipState['issues'] as $issue): ?><li><?php echo membership_read_escape($issue); ?></li><?php endforeach; ?></ul>
			</div>
			<?php else: ?>
			<?php if (($details['price_source'] ?? '') === 'migration_baseline'): ?>
			<p class="small text-muted">Prices recorded at system upgrade; original signup prices could not be verified. These recorded fees stay fixed for this membership.</p>
			<?php endif; ?>
			<large><b>New Payment</b></large>
			<?php if (array_filter($history, function ($payment) { return $payment['plan_amount'] === null; })): ?>
			<div class="alert alert-warning">Legacy payments have no recorded allocation. They are kept in history but do not confirm that the Plan fee is paid. Check the original receipts before collecting any remaining Plan fee.</div>
			<?php endif; ?>
			<form id="manage_payment" action="ajax.php?action=save_payment" method="post">
                <div class="payment-message" role="alert" aria-live="polite"></div>
                <input type="hidden" name="csrf_token" value="<?php echo htmlspecialchars(csrf_token(), ENT_QUOTES, 'UTF-8'); ?>">
				<input type="hidden" name="registration_id" value="<?php echo $id ?>">
				<input type="hidden" name="request_key" value="<?php echo bin2hex(random_bytes(32)); ?>">
				<div class="form-group">
					<p>Plan Fee Remaining: <b class="float-right"><?php echo $planRemaining === 0 ? 'Paid Already' : number_format($planRemaining / 100, 2); ?></b></p>
					<p>Package Amount: </i> <b class="float-right"><?php echo number_format($ppamount,2) ?></b></p>
					<p>Trainer Fee: </i> <b class="float-right"><?php echo number_format($tf, 2) ?></b></p>
				</div>
				<hr>
				<div class="form-group">
					<p>Plan balance + one month Package/Trainer: <b class="float-right"><?php echo number_format($planRemaining / 100 + $ppamount + $tf, 2); ?></b></p>
					<small class="text-muted">Reference amount only. Monthly payment periods and arrears are not tracked here.</small>
				</div>
				<div class="form-group">
					<label for="payment-amount" class="control-label">Amount</label>
					<div class="input-group money-input">
						<input type="number" id="payment-amount" class="form-control" name="amount" min="0.01" max="9999999999.99" step="0.01" required>
						<div class="input-group-append"><div class="btn-group-vertical">
							<button class="btn btn-outline-secondary money-arrow" type="button" data-direction="1" aria-label="Increase Payment amount by RM1">&#9650;</button>
							<button class="btn btn-outline-secondary money-arrow" type="button" data-direction="-1" aria-label="Decrease Payment amount by RM1">&#9660;</button>
						</div></div>
					</div>
				</div>
				<div class="form-group">
					<label for="payment-plan-amount">Of this payment, amount for Plan fee</label>
					<div class="input-group money-input">
						<input type="number" id="payment-plan-amount" class="form-control" name="plan_amount" min="0" max="<?php echo payment_decimal($planRemaining); ?>" step="0.01" value="0.00" required>
						<div class="input-group-append"><div class="btn-group-vertical">
							<button class="btn btn-outline-secondary money-arrow" type="button" data-direction="1" aria-label="Increase Plan allocation by RM1">&#9650;</button>
							<button class="btn btn-outline-secondary money-arrow" type="button" data-direction="-1" aria-label="Decrease Plan allocation by RM1">&#9660;</button>
						</div></div>
					</div>
					<small class="text-muted">Included in Amount above. Enter 0 for Package/Trainer only; the rest of this payment is for Package/Trainer.</small>
				</div>
				<div class="form-group">
					<label for="payment-remarks" class="control-label">Remarks</label>
					<textarea id="payment-remarks" class="form-control" name="remarks" maxlength="65535"></textarea>
				</div>
				<div class="form-group">
					<button type="submit" class="btn btn-primary">Save Payment</button>
				</div>
			</form>
			<?php endif; ?>
		</div>
	</div>
</div>
<div class="modal-footer display">
	<div class="row">
		<div class="col-md-12">
			<button class="btn float-right btn-secondary" type="button" data-dismiss="modal">Close</button>
		</div>
	</div>
</div>
<style>
	p{
		margin:unset;
	}
	td,th{
		padding: 5px
	}
	#uni_modal .modal-footer{
		display: none;
	}
	#uni_modal .modal-footer.display {
		display: block;
	}
</style>
