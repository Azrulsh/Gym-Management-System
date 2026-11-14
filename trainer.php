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
			<form action="ajax.php?action=save_trainer" method="post" id="manage-trainer">
				<div class="card">
					<div class="card-header">
						    <span class="trainer-form-title" aria-live="polite">Add Trainer</span>
				  	</div>
					<div class="card-body">
                            <p class="trainer-mode-help text-muted">Fill in the form to create a new trainer.</p>
                            <div class="trainer-message" role="alert" aria-live="polite"></div>
                            <input type="hidden" name="csrf_token" value="<?php echo htmlspecialchars(csrf_token(), ENT_QUOTES, 'UTF-8'); ?>">
							<input type="hidden" name="id">
							<div class="form-group">
								<label class="control-label" for="trainer-name">Name</label>
								<input type="text" id="trainer-name" class="form-control" name="name" maxlength="200" required>
							</div>
							<div class="form-group">
								<label class="control-label" for="trainer-email">Email</label>
								<input type="email" id="trainer-email" class="form-control" name="email" maxlength="100" required>
							</div>
							<div class="form-group">
								<label class="control-label" for="trainer-contact">Contact</label>
								<input type="text" id="trainer-contact" class="form-control" name="contact" maxlength="100" required>
							</div>
							<div class="form-group">
								<label class="control-label" for="trainer-rate">Rate</label>
								<input type="number" id="trainer-rate" class="form-control" min="0" step="1" name="rate" max="9999999999.99" required>
							</div>
					</div>
							
					<div class="card-footer">
						<div class="row">
							<div class="col-md-12">
								<button type="submit" class="btn btn-md btn-success col-sm-4 offset-md-2">Create</button>
								<button class="btn btn-md btn-secondary col-sm-4 reset-trainer" type="button">Clear</button>
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
						<b>List of Trainers</b>
					</div>
					<div class="card-body">
						<table class="table table-bordered table-hover">
							<thead>
								<tr>
									<th class="text-center">#</th>
									<th class="text-center">Information</th>
									<th class="text-center">Action</th>
								</tr>
							</thead>
							<tbody>
								<?php 
								$i = 1;
								$trainer = $conn->query("SELECT * FROM trainers order by id asc");
								while($row=$trainer->fetch_assoc()):
								?>
								<tr>
									<td class="text-center"><?php echo $i++ ?></td>
									<td class="">
										<p><i class="fa fa-user"></i> <b><?php echo htmlspecialchars((string) $row['name'], ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'); ?></b></p>
										<p><small><i class="fa fa-at"></i> <b><?php echo htmlspecialchars((string) $row['email'], ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'); ?></b></small></p>
										<p><small><i class="fa fa-phone-square-alt"></i> <b><?php echo htmlspecialchars((string) $row['contact'], ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'); ?></b></small></p>
										<p><small><i class="fa fa-money-bill"></i> <b><?php echo number_format($row['rate'],2) ?></b></small></p>
										
									</td>
									<td class="text-center">
										<button class="btn btn-md btn-outline-success edit_trainer" type="button" data-id="<?php echo (int) $row['id'] ?>" data-name="<?php echo htmlspecialchars((string) $row['name'], ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'); ?>" data-email="<?php echo htmlspecialchars((string) $row['email'], ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'); ?>" data-contact="<?php echo htmlspecialchars((string) $row['contact'], ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'); ?>" data-rate="<?php echo htmlspecialchars((string) $row['rate'], ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'); ?>" >Edit</button>
										<button class="btn btn-md btn-outline-danger delete_trainer" type="button" data-id="<?php echo (int) $row['id'] ?>" data-csrf-token="<?php echo htmlspecialchars(csrf_token(), ENT_QUOTES, 'UTF-8'); ?>">Delete</button>
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
	td p{
		margin:unset;
	}
</style>
<script src="assets/js/trainers.js?v=<?php echo filemtime(__DIR__ . '/assets/js/trainers.js'); ?>"></script>
<script>
	$('table').dataTable()
</script>
