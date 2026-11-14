<?php
require_once __DIR__ . '/auth.php';
require_admin();
include 'db_connect.php';
?>

<div class="container-fluid">
	
	<div class="col-lg-12">
		<div class="row">
			<!-- FORM Panel -->
			<div class="col-md-4">
			<form action="ajax.php?action=save_package" method="post" id="manage-package">
				<div class="card">
					<div class="card-header">
						    <span class="package-form-title" aria-live="polite">Add Package</span>
				  	</div>
					<div class="card-body">
							<p class="package-mode-help text-muted">Fill in the form to create a new package.</p>
							<div class="package-message" role="alert" aria-live="polite"></div>
							<input type="hidden" name="csrf_token" value="<?php echo htmlspecialchars(csrf_token(), ENT_QUOTES, 'UTF-8'); ?>">
							<input type="hidden" name="id">
							<div class="form-group">
								<label class="control-label" for="package-name">Package Name</label>
								<input type="text" id="package-name" class="form-control" name="package" maxlength="200" required>
							</div>
							<div class="form-group">
								<label class="control-label" for="package-description">Description</label>
								<textarea id="package-description" class="form-control" cols="30" rows="3" name="description" maxlength="65535"></textarea>
							</div>
							<div class="form-group">
								<label class="control-label" for="package-amount">Amount</label>
								<div class="input-group money-input">
								<input type="number" id="package-amount" class="form-control" min="0" step="0.01" name="amount" max="9999999999.99" required>
								<div class="input-group-append"><div class="btn-group-vertical">
								<button class="btn btn-outline-secondary money-arrow" type="button" data-direction="1" aria-label="Increase Package amount by RM1">&#9650;</button>
								<button class="btn btn-outline-secondary money-arrow" type="button" data-direction="-1" aria-label="Decrease Package amount by RM1">&#9660;</button>
								</div></div></div>
							</div>
							
					</div>
							
					<div class="card-footer">
						<div class="row">
							<div class="col-md-12">
								<button type="submit" class="btn btn-md btn-success col-sm-4 offset-md-2">Create</button>
								<button class="btn btn-md btn-secondary col-sm-4 reset-package" type="button">Clear</button>
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
						<b>Package List</b>
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
									<th class="text-center">package</th>
									<th class="text-center">Amount</th>
									<th class="text-center">Action</th>
								</tr>
							</thead>
							<tbody>
								<?php 
								$i = 1;
								$package = $conn->query("SELECT * FROM packages order by id asc");
								while($row=$package->fetch_assoc()):
								?>
								<tr>
									<td class="text-center"><?php echo $i++ ?></td>
									<td class="">
										<p>Package: <b><?php echo htmlspecialchars($row['package'], ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'); ?></b></p>
										<p>Description: <small><b><?php echo htmlspecialchars($row['description'], ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'); ?></b></small></p>
										
									</td>
									<td class="text-right">
										<b><?php echo number_format($row['amount'],2) ?></b>
									</td>
									<td class="text-center">
										<button class="btn btn-md btn-outline-success edit_package" type="button" data-id="<?php echo (int) $row['id'] ?>" data-package="<?php echo htmlspecialchars($row['package'], ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'); ?>" data-description="<?php echo htmlspecialchars($row['description'], ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'); ?>" data-amount="<?php echo htmlspecialchars((string) $row['amount'], ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'); ?>">Edit</button>
										<button class="btn btn-md btn-outline-danger delete_package" type="button" data-id="<?php echo $row['id'] ?>" data-csrf-token="<?php echo htmlspecialchars(csrf_token(), ENT_QUOTES, 'UTF-8'); ?>">Delete</button>
									</td>
								</tr>
								<?php endwhile; ?>
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
<script src="assets/js/packages.js?v=<?php echo filemtime(__DIR__ . '/assets/js/packages.js'); ?>"></script>
<script>
	$('table').dataTable()
</script>
