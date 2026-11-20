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
try {
	include 'db_connect.php';
	$eligibleResult = $conn->query("SELECT m.*, CONCAT_WS(', ', m.lastname, CONCAT_WS(' ', m.firstname, m.middlename)) AS name FROM members m WHERE NOT EXISTS (SELECT 1 FROM registration_info r WHERE r.member_id = m.id AND r.status = 1) ORDER BY m.lastname, m.firstname, m.middlename");
	if (!$eligibleResult) throw new RuntimeException('Member lookup unavailable.');
	$eligibleMembers = $eligibleResult->fetch_all(MYSQLI_ASSOC);
	$eligibleResult->free();
	$planResult = $conn->query('SELECT * FROM plans order by plan asc');
	if (!$planResult) throw new RuntimeException('Plan lookup unavailable.');
	$plans = $planResult->fetch_all(MYSQLI_ASSOC);
	$planResult->free();
	$packageResult = $conn->query('SELECT * FROM packages order by package asc');
	if (!$packageResult) throw new RuntimeException('Package lookup unavailable.');
	$packages = $packageResult->fetch_all(MYSQLI_ASSOC);
	$packageResult->free();
	$trainerResult = $conn->query('SELECT * FROM trainers order by name asc');
	if (!$trainerResult) throw new RuntimeException('Trainer lookup unavailable.');
	$trainers = $trainerResult->fetch_all(MYSQLI_ASSOC);
	$trainerResult->free();
} catch (mysqli_sql_exception | RuntimeException $exception) {
	error_log('Unable to load membership choices.');
	http_response_code(503);
	echo '<div class="alert alert-danger" role="alert">Unable to load membership choices. Please try again.</div>';
	return;
}
?>
<div class="container-fluid">
	<form action="ajax.php?action=save_membership" method="post" id="manage-member">
		<div class="membership-message" role="alert" aria-live="polite"></div>
		<input type="hidden" name="csrf_token" value="<?php echo htmlspecialchars(csrf_token(), ENT_QUOTES, 'UTF-8'); ?>">
		<?php if (!$eligibleMembers): ?>
		<div class="alert alert-info" role="status">
			No eligible members are available. Members with an open membership remain unavailable even if it is expired or needs attention.
			<a href="index.php?page=registered_members">Review Membership Validity</a>: Renew an eligible expired membership, or End all open records before selecting a new plan.
			If there is no member profile, <a href="index.php?page=members">add a member</a> first.
		</div>
		<?php endif; ?>
			<div class="form-group">
				<label class="control-label">Member</label>
				<select name="member_id" required="required" class="custom-select select2" id="">
					<option value=""></option>
					<?php
						foreach ($eligibleMembers as $row):
					?>
					<option value="<?php echo $row['id'] ?>" <?php echo isset($member_id) && $member_id == $row['id'] ? 'selected' : '' ?>><?php echo htmlspecialchars(ucwords($row['name']), ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'); ?></option>
						<?php endforeach; ?>
				</select>
			</div>
			<div class="form-group">
				<label class="control-label">Plan</label>
				<select name="plan_id" required="required" class="custom-select select2" id="">
					<option value=""></option>
					<?php
						foreach ($plans as $row):
					?>
					<option value="<?php echo $row['id'] ?>" <?php echo isset($plan_id) && $plan_id == $row['id'] ? 'selected' : '' ?>><?php echo ucwords($row['plan']) ?></option>
					<?php endforeach; ?>
				</select>
			</div>
			<div class="form-group">
				<label class="control-label">Package</label>
				<select name="package_id" required="required" class="custom-select select2" id="">
					<option value=""></option>
					<?php
						foreach ($packages as $row):
					?>
					<option value="<?php echo $row['id'] ?>" <?php echo isset($package_id) && $package_id == $row['id'] ? 'selected' : '' ?>><?php echo htmlspecialchars(ucwords($row['package']), ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'); ?></option>
					<?php endforeach; ?>
				</select>
			</div>
			<div class="form-group">
				<label class="control-label">Trainer</label>
				<select name="trainer_id" class="custom-select select2" id="">
					<option value=""></option>
					<?php
						foreach ($trainers as $row):
					?>
					<option value="<?php echo $row['id'] ?>" <?php echo isset($trainer_id) && $trainer_id == $row['id'] ? 'selected' : '' ?>><?php echo htmlspecialchars(ucwords($row['name']), ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'); ?></option>
					<?php endforeach; ?>
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
