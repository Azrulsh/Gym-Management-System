<?php
require_once __DIR__ . '/auth.php';
require_login();
try {
    include 'db_connect.php';
    $result = $conn->query("SELECT *,concat(lastname,', ',firstname,' ',middlename) as name from members order by concat(lastname,', ',firstname,' ',middlename) asc");
    if (!$result) throw new RuntimeException('List lookup unavailable.');
    $memberRows = $result->fetch_all(MYSQLI_ASSOC);
    $result->free();
} catch (mysqli_sql_exception | RuntimeException $exception) {
    error_log('Unable to load members (error code ' . (int)$exception->getCode() . ').');
    http_response_code(503);
    echo '<div class="alert alert-danger" role="alert">Unable to load members. Please try again.</div>';
    return;
}
?>

<div class="container-fluid">
<style>
	input[type=checkbox]
{
  /* Double-sized Checkboxes */
  -ms-transform: scale(1.5); /* IE */
  -moz-transform: scale(1.5); /* FF */
  -webkit-transform: scale(1.5); /* Safari and Chrome */
  -o-transform: scale(1.5); /* Opera */
  transform: scale(1.5);
  padding: 10px;
}
</style>
	<div class="col-lg-12">
		<div class="row mb-4 mt-4">
			<div class="col-md-12">
				
			</div>
		</div>
		<div class="row">
			<!-- FORM Panel -->

			<!-- Table Panel -->
			<div class="col-md-12">
				<div class="card">
					<div class="card-header">
						<b>Member List</b>
						<span class="">

							<button class="btn btn-success btn-block btn-sm col-sm-2 float-right" type="button" id="new_member">
					<i class="fa fa-plus"></i> New</button>
				</span>
					</div>
					<div class="card-body">
						
						<table class="table table-bordered table-condensed table-hover">
							<colgroup>
								<col width="5%">
								<col width="15%">
								<col width="20%">
								<col width="20%">
								<col width="20%">
								<col width="20%">
							</colgroup>
							<thead>
								<tr>
									<th class="text-center">#</th>
									<th class="">Member ID</th>
									<th class="">Name</th>
									<th class="">Email</th>
									<th class="">Contact</th>
									<th class="text-center">Action</th>
								</tr>
							</thead>
							<tbody>
								<?php 
								$i = 1;
								foreach ($memberRows as $row):
								?>
								<tr>
									
									<td class="text-center"><?php echo $i++ ?></td>
									<td class="">
										 <p><b><?php echo $row['member_id'] ?></b></p>
										 
									</td>
									<td class="">
										 <p><b><?php echo htmlspecialchars(ucwords($row['name']), ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'); ?></b></p>
										 
									</td>
									<td class="">
										 <p><b><?php echo htmlspecialchars($row['email'], ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'); ?></b></p>
									</td>
									<td class="">
										 <p><b><?php echo htmlspecialchars($row['contact'], ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'); ?></b></p>
										 
									</td>
									<td class="text-center">
										<button class="btn btn-sm btn-outline-success view_member" type="button" data-id="<?php echo $row['id'] ?>" >View</button>
										<button class="btn btn-sm btn-outline-primary edit_member" type="button" data-id="<?php echo $row['id'] ?>" >Edit</button>
										<button class="btn btn-sm btn-outline-danger delete_member" type="button" data-id="<?php echo (int) $row['id']; ?>" data-csrf-token="<?php echo htmlspecialchars(csrf_token(), ENT_QUOTES, 'UTF-8'); ?>">Delete</button>
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
	td p{
		margin: unset
	}
	img{
		max-width:100px;
		max-height: :150px;
	}
</style>
<script>
	$(document).ready(function(){
		$('table').dataTable()
	})
	$('#new_member').click(function(){
		uni_modal("New Member","manage_member.php",'mid-large')
	})
	$('.view_member').click(function(){
		uni_modal("Member Details","view_member.php?id="+$(this).attr('data-id'),'large')
		
	})
	$('.edit_member').click(function(){
		uni_modal("Manage Member Details","manage_member.php?id="+$(this).attr('data-id'),'mid-large')
		
	})
</script>
