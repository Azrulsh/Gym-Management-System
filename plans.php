<?php
require_once __DIR__ . '/auth.php';
require_admin();
require_once __DIR__ . '/membership_dates.php';
try {
    include 'db_connect.php';
    $result = $conn->query("SELECT * FROM plans order by id asc");
    if (!$result) throw new RuntimeException('List lookup unavailable.');
    $planRows = $result->fetch_all(MYSQLI_ASSOC);
    $result->free();
} catch (mysqli_sql_exception | RuntimeException $exception) {
    error_log('Unable to load plans (error code ' . (int)$exception->getCode() . ').');
    http_response_code(503);
    echo '<div class="alert alert-danger" role="alert">Unable to load plans. Please try again.</div>';
    return;
}
?>

<div class="container-fluid">
	
	<div class="col-lg-12">
		<div class="row">
			<!-- FORM Panel -->
			<div class="col-md-4">
			<form action="ajax.php?action=save_plan" method="post" id="manage-plan">
				<div class="card">
					<div class="card-header">
						    <span class="plan-form-title" aria-live="polite">Add Plan</span>
				  	</div>
					<div class="card-body">
							<p class="plan-mode-help text-muted">Fill in the form to create a new plan.</p>
							<div class="plan-message" role="alert" aria-live="polite"></div>
							<input type="hidden" name="csrf_token" value="<?php echo htmlspecialchars(csrf_token(), ENT_QUOTES, 'UTF-8'); ?>">
							<input type="hidden" name="id">
							<input type="hidden" name="version">
							<div class="form-group">
								<label class="control-label" for="plan-months">Plan (months)</label>
								<input type="number" id="plan-months" class="form-control" min="1" max="<?php echo membership_max_months(new DateTimeImmutable('today')); ?>" step="1" name="plan" required>
							</div>
							<div class="form-group">
								<label class="control-label" for="plan-amount">Amount</label>
								<div class="input-group money-input">
								<input type="number" id="plan-amount" class="form-control" min="0" step="0.01" name="amount" max="9999999999.99" required>
								<div class="input-group-append"><div class="btn-group-vertical">
								<button class="btn btn-outline-secondary money-arrow" type="button" data-direction="1" aria-label="Increase Plan amount by RM1">&#9650;</button>
								<button class="btn btn-outline-secondary money-arrow" type="button" data-direction="-1" aria-label="Decrease Plan amount by RM1">&#9660;</button>
								</div></div></div>
							</div>
							
					</div>
							
					<div class="card-footer">
						<div class="row">
							<div class="col-md-12">
								<button type="submit" class="btn btn-md btn-success col-sm-4 offset-md-2">Create</button>
								<button class="btn btn-md btn-secondary col-sm-4 reset-plan" type="button">Clear</button>
							</div>
						</div>
					</div>
				</div>
			</form>
			</div>
			<!-- FORM Panel -->

			<!-- Table Panel -->
			<div class="col-md-8">
				<div class="card">
					<div class="card-header">
						<b>Plan List</b>
					</div>
					<div class="card-body">
						<table class="table table-bordered table-hover">
							<colgroup>
								<col width="5%">
								<col width="55%">
								<col width="20%">
								<col width="20%">
							</colgroup>
							<thead>
								<tr>
									<th class="text-center">#</th>
									<th class="text-center">Plan</th>
									<th class="text-center">Amount</th>
									<th class="text-center">Action</th>
								</tr>
							</thead>
							<tbody>
								<?php 
								$i = 1;
								foreach ($planRows as $row):
								?>
								<tr>
									<td class="text-center"><?php echo $i++ ?></td>
									<td class="">
										<p><b><?php echo (int) $row['plan'] ?></b> month/s</p>
									</td>
									<td class="text-right">
										<b><?php echo number_format($row['amount'],2) ?></b>
									</td>
									<td class="text-center">
										<button class="btn btn-md btn-outline-success edit_plan" type="button" data-id="<?php echo (int) $row['id'] ?>" data-plan="<?php echo (int) $row['plan'] ?>" data-amount="<?php echo htmlspecialchars((string) $row['amount'], ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'); ?>" data-version="<?php echo (int)$row['version']; ?>">Edit</button>
										<button class="btn btn-md btn-outline-danger delete_plan" type="button" data-id="<?php echo $row['id'] ?>" data-csrf-token="<?php echo htmlspecialchars(csrf_token(), ENT_QUOTES, 'UTF-8'); ?>">Delete</button>
									</td>
								</tr>
								<?php endforeach; ?>
							</tbody>
						</table>
					</div>
				</div>
			</div>
			<!-- Table Panel -->
		</div>
	</div>	

</div>
<style>
	
	td{
		vertical-align: middle !important;
	}
</style>
<script src="assets/js/plans.js?v=<?php echo filemtime(__DIR__ . '/assets/js/plans.js'); ?>"></script>
<script>
	$('table').dataTable()
</script>
