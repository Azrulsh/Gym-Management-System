<?php
require_once __DIR__ . '/auth.php';
require_login();
include 'db_connect.php';
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
						<b>Active Member List</b>
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
								<col width="10%">
							</colgroup>
							<thead>
								<tr>
									<th class="text-center">#</th>
									<th class="">Member ID</th>
									<th class="">Name</th>
									<th class="">Plan</th>
									<th class="">Package</th>
									<th class="">Status</th>
									<th class="text-center">Action</th>
								</tr>
							</thead>
							<tbody>
								<?php 
								$i = 1;
								$member = $conn->query("SELECT r.id AS registration_id,r.end_date,p.plan,pp.package,concat(m.lastname,', ',m.firstname,' ',m.middlename) as name,m.member_id AS member_number from registration_info r inner join members m on m.id = r.member_id inner join plans p on p.id = r.plan_id inner join packages pp on pp.id = r.package_id where r.status = 1 order by r.id asc");
								while($row=$member->fetch_assoc()):
								?>
								<tr>
									
									<td class="text-center"><?php echo $i++ ?></td>
									<td class="">
										 <p><b><?php echo $row['member_number'] ?></b></p>
										 
									</td>
									<td class="">
										 <p><b><?php echo htmlspecialchars(ucwords($row['name']), ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'); ?></b></p>
										 
									</td>
									<td class="">
										 <p><b><?php echo $row['plan']. 'Months' ?></b></p>
									</td>
									<td class="">
										 <p><b><?php echo $row['package'] ?></b></p>
										 
									</td>
									<td class="text-center">
										<?php if(strtotime(date('Y-m-d')) <= strtotime($row['end_date'])): ?>
										<span class="badge badge-success">Active</span>
										<?php else: ?>
										<span class="badge badge-danger">Exprired</span>
										<?php endif; ?>
									</td>
									<td class="text-center">
										<button class="btn btn-sm btn-outline-success view_member" type="button" data-id="<?php echo (int) $row['registration_id']; ?>" >View</button>
										<button class="btn btn-sm btn-outline-danger end-membership" type="button" data-registration-id="<?php echo (int) $row['registration_id']; ?>" data-csrf-token="<?php echo htmlspecialchars(csrf_token(), ENT_QUOTES, 'UTF-8'); ?>">End Membership</button>
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
		uni_modal("<i class='fa fa-plus'></i> New Membership Plan","manage_membership.php",'')
	})
	$('.view_member').click(function(){
		uni_modal("<i class='fa fa-address-card'></i> Member Plan Details","view_pdetails.php?id="+$(this).attr('data-id'),'')
		
	})
</script>
