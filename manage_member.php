<?php
require_once __DIR__ . '/auth.php';
require_login();
$member = [];
$recordId = null;
if (isset($_GET['id'])) {
    $recordId = filter_var($_GET['id'], FILTER_VALIDATE_INT, ['options' => ['min_range' => 1, 'max_range' => 2147483647]]);
    if ($recordId === false) {
        http_response_code(400);
        exit('Invalid member record ID.');
    }
}
include 'db_connect.php';
if ($recordId !== null) {
    try {
        $statement = $conn->prepare('SELECT id, version, member_id, lastname, firstname, middlename, email, contact, gender, address FROM members WHERE id = ?');
        $statement->bind_param('i', $recordId);
        $statement->execute();
        $member = $statement->get_result()->fetch_assoc();
        $statement->close();
        if (!$member) {
            http_response_code(404);
            exit('Member no longer exists. Refresh the page.');
        }
    } catch (mysqli_sql_exception $exception) {
        error_log('Unable to load member: ' . $exception->getMessage());
        http_response_code(500);
        exit('Unable to load member. Please try again.');
    }
}
$escapeMember = static function ($value) {
    return htmlspecialchars((string) $value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
};
?>
<div class="container-fluid">
	<form action="ajax.php?action=save_member" method="post" id="manage-member-profile">
		<div class="member-message" role="alert" aria-live="polite"></div>
		<input type="hidden" name="id" value="<?php echo $escapeMember($member['id'] ?? ''); ?>">
		<input type="hidden" name="version" value="<?php echo $escapeMember($member['version'] ?? ''); ?>">
		<input type="hidden" name="csrf_token" value="<?php echo $escapeMember(csrf_token()); ?>">
		<div class="row form-group">
			<div class="col-md-4">
						<label class="control-label">ID No.</label>
						<input type="text" name="member_id" class="form-control" inputmode="numeric" pattern="[0-9]+" maxlength="10" value="<?php echo $escapeMember($member['member_id'] ?? ''); ?>">
						<small><i><?php echo $recordId === null ? 'Leave blank to generate an 8-digit ID number.' : 'Leave blank to keep the current ID number.'; ?></i></small>
					</div>
		</div>
		<div class="row form-group">
			<div class="col-md-4">
				<label class="control-label">Last Name</label>
				<input type="text" name="lastname" class="form-control" maxlength="100" value="<?php echo $escapeMember($member['lastname'] ?? ''); ?>" required>
			</div>
			<div class="col-md-4">
				<label class="control-label">First Name</label>
				<input type="text" name="firstname" class="form-control" maxlength="100" value="<?php echo $escapeMember($member['firstname'] ?? ''); ?>" required>
			</div>
			<div class="col-md-4">
				<label class="control-label">Middle Name</label>
				<input type="text" name="middlename" class="form-control" maxlength="100" value="<?php echo $escapeMember($member['middlename'] ?? ''); ?>">
			</div>
		</div>
		<div class="row form-group">
			<div class="col-md-4">
				<label class="control-label">Email</label>
				<input type="email" name="email" class="form-control" maxlength="100" value="<?php echo $escapeMember($member['email'] ?? ''); ?>" required>
			</div>
			<div class="col-md-4">
				<label class="control-label">Contact #</label>
				<input type="text" name="contact" class="form-control" maxlength="100" value="<?php echo $escapeMember($member['contact'] ?? ''); ?>" required>
			</div>
			<div class="col-md-4">
				<label class="control-label">Gender</label>
				<select name="gender" required="" class="custom-select" id="">
					<option value="Male" <?php echo ($member['gender'] ?? 'Male') === 'Male' ? 'selected' : ''; ?>>Male</option>
					<option value="Female" <?php echo ($member['gender'] ?? '') === 'Female' ? 'selected' : ''; ?>>Female</option>
				</select>
			</div>
		</div>
		<div class="row form-group">
			<div class="col-md-12">
				<label class="control-label">Address</label>
				<textarea name="address" class="form-control" maxlength="65535"><?php echo $escapeMember($member['address'] ?? ''); ?></textarea>
			</div>
		</div>
		
	</form>
</div>
