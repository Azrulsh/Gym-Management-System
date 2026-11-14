<?php 
require_once __DIR__ . '/auth.php';
require_login();
$ownAccount = ($_GET['mtype'] ?? '') === 'own';
if ($ownAccount) {
    require_own_account($_GET['id'] ?? null);
} else {
    require_admin();
}
include('db_connect.php');
$meta = [];
if(isset($_GET['id'])){
    $userId = filter_var($_GET['id'], FILTER_VALIDATE_INT, ['options' => ['min_range' => 1, 'max_range' => 2147483647]]);
    if ($userId === false) {
        http_response_code(400);
        exit('Invalid user ID.');
    }
    try {
        $user = $conn->prepare('SELECT id, name, username, type FROM users WHERE id = ?');
        $user->bind_param('i', $userId);
        $user->execute();
        $meta = $user->get_result()->fetch_assoc();
        $user->close();
    } catch (mysqli_sql_exception $exception) {
        error_log('Unable to load user: ' . $exception->getMessage());
        http_response_code(500);
        exit('Unable to load user. Please try again.');
    }
    if (!$meta) {
        http_response_code(404);
        exit('User not found.');
    }
}
 $confirmOwnPassword = $ownAccount || (isset($meta['id']) && (int)$meta['id'] === (int)$_SESSION['login_id']);
?>
<div class="container-fluid">
	<form action="ajax.php?action=<?php echo $ownAccount ? 'save_account' : 'save_user'; ?>" method="post" id="manage-user">
		<div class="user-message" role="alert" aria-live="polite"></div>
		<input type="hidden" name="id" value="<?php echo isset($meta['id']) ? $meta['id']: '' ?>">
		<input type="hidden" name="csrf_token" value="<?php echo htmlspecialchars(csrf_token(), ENT_QUOTES, 'UTF-8'); ?>">
		<div class="form-group">
			<label for="name">Name</label>
			<input type="text" name="name" id="name" class="form-control" maxlength="200" value="<?php echo htmlspecialchars($meta['name'] ?? '', ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'); ?>" required>
		</div>
		<div class="form-group">
			<label for="username">Username</label>
			<input type="text" name="username" id="username" class="form-control" maxlength="200" value="<?php echo htmlspecialchars($meta['username'] ?? '', ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'); ?>" required autocomplete="off">
		</div>
		<div class="form-group">
			<label for="password"><?php echo $ownAccount ? 'New Password' : 'Password'; ?></label>
			<input type="password" name="password" id="password" class="form-control" value="" maxlength="4096" autocomplete="new-password" <?php echo !isset($meta['id']) ? 'required' : ''; ?>>
			<?php if(isset($meta['id'])): ?>
			<small><i>Leave this blank if you dont want to change the password.</i></small>
		<?php endif; ?>
		</div>
		<?php if ($confirmOwnPassword): ?>
		<div class="form-group">
			<label for="current_password">Current Password</label>
			<input type="password" name="current_password" id="current_password" class="form-control" maxlength="4096" autocomplete="current-password" aria-describedby="current-password-help">
			<small id="current-password-help" class="form-text text-muted">Required only when setting a new password. Leave both password fields blank to update your profile only.</small>
		</div>
		<?php endif; ?>
		<?php if (!$ownAccount): ?>
		<div class="form-group">
			<label for="type">User Type</label>
			<select name="type" id="type" class="custom-select">
				<option value="2" <?php echo isset($meta['type']) && $meta['type'] == 2 ? 'selected': '' ?>>Staff</option>
				<option value="1" <?php echo isset($meta['type']) && $meta['type'] == 1 ? 'selected': '' ?>>Admin</option>
			</select>
		</div>
		<?php endif; ?>
		

	</form>
</div>
