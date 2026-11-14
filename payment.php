<?php
require_once __DIR__ . '/auth.php';
require_login();
require_once __DIR__ . '/membership_read.php';
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
    $statement = $conn->prepare('SELECT amount, remarks, date_created FROM payments WHERE registration_id = ? ORDER BY id ASC');
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
						<th>Remarks</th>
					</tr>
				</thead>
				<tbody>
					<?php 
						$pcount=0;
					foreach ($history as $row):
						$pcount++;
					?>
					<tr>
						<td><?php echo date("M d,Y",strtotime($row['date_created'])) ?></td>
						<td class="text-right"><?php echo number_format($row['amount'], 2) ?></td>
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
			<form id="manage_payment" action="ajax.php?action=save_payment" method="post">
                <div class="payment-message" role="alert" aria-live="polite"></div>
                <input type="hidden" name="csrf_token" value="<?php echo htmlspecialchars(csrf_token(), ENT_QUOTES, 'UTF-8'); ?>">
				<input type="hidden" name="registration_id" value="<?php echo $id ?>">
				<div class="form-group">
					<p>Plan Membership Fee: </i> <b class="float-right"><?php echo ($pcount<=0)? number_format($pamount,2).' (One-time amount only)': 'Paid Already' ?></b></p>
					<p>Package Amount: </i> <b class="float-right"><?php echo number_format($ppamount,2) ?></b></p>
					<p>Trainer Fee: </i> <b class="float-right"><?php echo number_format($tf, 2) ?></b></p>
				</div>
				<hr>
				<div class="form-group">
					<p>Amount Payable: </i> <b class="float-right"><?php echo ($pcount<=0)? number_format(($ppamount + $tf+$pamount),2) : number_format(($ppamount + $tf),2) ?></b></p>
				</div>
				<div class="form-group">
					<label for="payment-amount" class="control-label">Amount</label>
					<input type="number" id="payment-amount" class="form-control" name="amount" min="0.01" max="9999999999.99" step="0.01" required>
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
