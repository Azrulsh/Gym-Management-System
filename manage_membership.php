<?php
require_once __DIR__ . '/auth.php';
require_login();
$member_id = null;
if (array_key_exists('id', $_GET)) {
	$value = $_GET['id'];
	$member_id = is_scalar($value) && !is_bool($value)
		? filter_var($value, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1, 'max_range' => 2147483647]]) : false;
	if ($member_id === false) {
		http_response_code(400);
		exit('<div class="alert alert-danger">Invalid member ID.</div>');
	}
}
include 'db_connect.php';
?>
<div class="container-fluid">
	<form action="ajax.php?action=save_membership" method="post" id="manage-member">
		<div class="membership-message" role="alert" aria-live="polite"></div>
		<input type="hidden" name="csrf_token" value="<?php echo htmlspecialchars(csrf_token(), ENT_QUOTES, 'UTF-8'); ?>">
			<div class="form-group">
				<label class="control-label">Member</label>
				<select name="member_id" required="required" class="custom-select select2" id="">
					<option value=""></option>
					<?php
						$qry = $conn->query("SELECT *,concat(lastname,', ',firstname,' ',middlename) as name FROM members where id not in (SELECT member_id from registration_info where status = 1) order by concat(lastname,', ',firstname,' ',middlename) asc");
						while($row= $qry->fetch_assoc()):
					?>
					<option value="<?php echo $row['id'] ?>" <?php echo isset($member_id) && $member_id == $row['id'] ? 'selected' : '' ?>><?php echo htmlspecialchars(ucwords($row['name']), ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'); ?></option>
					<?php endwhile; ?>
				</select>
			</div>
			<div class="form-group">
				<label class="control-label">Plan</label>
				<select name="plan_id" required="required" class="custom-select select2" id="">
					<option value=""></option>
					<?php
						$qry = $conn->query("SELECT * FROM plans order by plan asc");
						while($row= $qry->fetch_assoc()):
					?>
					<option value="<?php echo $row['id'] ?>" <?php echo isset($plan_id) && $plan_id == $row['id'] ? 'selected' : '' ?>><?php echo ucwords($row['plan']) ?></option>
					<?php endwhile; ?>
				</select>
			</div>
			<div class="form-group">
				<label class="control-label">Package</label>
				<select name="package_id" required="required" class="custom-select select2" id="">
					<option value=""></option>
					<?php
						$qry = $conn->query("SELECT * FROM packages order by package asc");
						while($row= $qry->fetch_assoc()):
					?>
					<option value="<?php echo $row['id'] ?>" <?php echo isset($package_id) && $package_id == $row['id'] ? 'selected' : '' ?>><?php echo htmlspecialchars(ucwords($row['package']), ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'); ?></option>
					<?php endwhile; ?>
				</select>
			</div>
			<div class="form-group">
				<label class="control-label">Trainer</label>
				<select name="trainer_id" class="custom-select select2" id="">
					<option value=""></option>
					<?php
						$qry = $conn->query("SELECT * FROM trainers order by name asc");
						while($row= $qry->fetch_assoc()):
					?>
					<option value="<?php echo $row['id'] ?>" <?php echo isset($trainer_id) && $trainer_id == $row['id'] ? 'selected' : '' ?>><?php echo htmlspecialchars(ucwords($row['name']), ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'); ?></option>
					<?php endwhile; ?>
				</select>
			</div>
	</form>
</div>

<script>
	$('.select2').select2({
		placeholder:'Select Here',
		width:'100%'
	})
</script>
