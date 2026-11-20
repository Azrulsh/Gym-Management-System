<?php 
require_once __DIR__ . '/auth.php';
require_admin();
try {
    include 'db_connect.php';
    $result = $conn->query("SELECT * FROM users order by name asc");
    if (!$result) throw new RuntimeException('List lookup unavailable.');
    $userRows = $result->fetch_all(MYSQLI_ASSOC);
    $result->free();
} catch (mysqli_sql_exception | RuntimeException $exception) {
    error_log('Unable to load users (error code ' . (int)$exception->getCode() . ').');
    http_response_code(503);
    echo '<div class="alert alert-danger" role="alert">Unable to load users. Please try again.</div>';
    return;
}
?>

<div class="container-fluid">
	
	<div class="row">
	<div class="col-lg-12">
			<button class="btn btn-success float-right btn-sm" id="new_user"><i class="fa fa-plus"></i> New user</button>
	</div>
	</div>
	<br>
	<div class="row">
		<div class="card col-lg-12">
			<div class="card-body">
				<table class="table-striped table-bordered">
			<thead>
				<tr>
					<th class="text-center">#</th>
					<th class="text-center">Name</th>
					<th class="text-center">Username</th>
					<th class="text-center">Type</th>
					<th class="text-center">Action</th>
				</tr>
			</thead>
			<tbody>
				<?php
 					$type = array("","Admin","Staff","Alumnus/Alumna");
 					$i = 1;
					foreach ($userRows as $row):
				 ?>
				 <tr>
				 	<td class="text-center">
				 		<?php echo $i++ ?>
				 	</td>
				 	<td>
						<?php echo htmlspecialchars(ucwords($row['name']), ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'); ?>
				 	</td>
				 	
				 	<td>
						<?php echo htmlspecialchars($row['username'], ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'); ?>
				 	</td>
				 	<td>
				 		<?php echo $type[$row['type']] ?>
				 	</td>
				 	<td>
				 		<center>
								<div class="btn-group">
								  <button type="button" class="btn btn-success">Action</button>
								  <button type="button" class="btn btn-success dropdown-toggle dropdown-toggle-split" data-toggle="dropdown" aria-haspopup="true" aria-expanded="false">
								    <span class="sr-only">Toggle Dropdown</span>
								  </button>
								  <div class="dropdown-menu">
								    <a class="dropdown-item edit_user" href="javascript:void(0)" data-id = '<?php echo $row['id'] ?>'>Edit</a>
								    <div class="dropdown-divider"></div>
								    <a class="dropdown-item delete_user" href="javascript:void(0)" data-id="<?php echo (int)$row['id']; ?>" data-self="<?php echo (int)$row['id'] === (int)$_SESSION['login_id'] ? '1' : '0'; ?>" data-csrf-token="<?php echo csrf_token(); ?>">Delete</a>
								  </div>
								</div>
								</center>
				 	</td>
				 </tr>
				<?php endforeach; ?>
			</tbody>
		</table>
			</div>
		</div>
	</div>

</div>
<script>
	$('table').dataTable();
$('#new_user').click(function(){
	uni_modal('New User','manage_user.php')
})
$(document).on('click', '.edit_user', function(){
	uni_modal('Edit User','manage_user.php?id='+$(this).attr('data-id'))
})
</script>
