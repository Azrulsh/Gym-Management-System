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
if(isset($_GET['id'])){
    $userId = filter_var($_GET['id'], FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
    if ($userId === false) {
        http_response_code(400);
        exit('Invalid user ID.');
    }
    $user = $conn->prepare('SELECT id, name, username, type FROM users WHERE id = ?');
    $user->bind_param('i', $userId);
    $user->execute();
    $meta = $user->get_result()->fetch_assoc();
    if (!$meta) {
        http_response_code(404);
        exit('User not found.');
    }
}
?>
<div class="container-fluid">
	<div id="msg"></div>
	
	<form action="" id="manage-user">	
		<input type="hidden" name="id" value="<?php echo isset($meta['id']) ? $meta['id']: '' ?>">
		<?php if ($ownAccount): ?>
		<input type="hidden" name="csrf_token" value="<?php echo htmlspecialchars(csrf_token(), ENT_QUOTES, 'UTF-8'); ?>">
		<?php endif; ?>
		<div class="form-group">
			<label for="name">Name</label>
			<input type="text" name="name" id="name" class="form-control" value="<?php echo htmlspecialchars($meta['name'] ?? '', ENT_QUOTES, 'UTF-8'); ?>" required>
		</div>
		<div class="form-group">
			<label for="username">Username</label>
			<input type="text" name="username" id="username" class="form-control" value="<?php echo htmlspecialchars($meta['username'] ?? '', ENT_QUOTES, 'UTF-8'); ?>" required  autocomplete="off">
		</div>
		<div class="form-group">
			<label for="password">Password</label>
			<input type="password" name="password" id="password" class="form-control" value="" autocomplete="off">
			<?php if(isset($meta['id'])): ?>
			<small><i>Leave this blank if you dont want to change the password.</i></small>
		<?php endif; ?>
		</div>
		<?php if (!$ownAccount): ?>
		<?php if(isset($meta['type']) && $meta['type'] == 3): ?>
			<input type="hidden" name="type" value="3">
		<?php else: ?>
		<div class="form-group">
			<label for="type">User Type</label>
			<select name="type" id="type" class="custom-select">
				<option value="2" <?php echo isset($meta['type']) && $meta['type'] == 2 ? 'selected': '' ?>>Staff</option>
				<option value="1" <?php echo isset($meta['type']) && $meta['type'] == 1 ? 'selected': '' ?>>Admin</option>
			</select>
		</div>
		<?php endif; ?>
		<?php endif; ?>
		

	</form>
</div>
<script>
	
	$('#manage-user').submit(function(e){
		e.preventDefault();
		start_load()
		$.ajax({
			url:'ajax.php?action=<?php echo $ownAccount ? 'save_account' : 'save_user'; ?>',
			method:'POST',
			data:$(this).serialize(),
			success:function(resp){
				if(resp ==1){
					alert_toast("Data successfully saved",'success')
					setTimeout(function(){
						location.reload()
					},1500)
				}else if(resp == 2){
					$('#msg').html('<div class="alert alert-danger">Username already exist</div>')
					end_load()
				}else{
					$('#msg').html('<div class="alert alert-danger">Unable to save. Check the required fields and try again.</div>')
					end_load()
				}
			},
			error:function(){
				end_load()
			}
		})
	})

</script>
