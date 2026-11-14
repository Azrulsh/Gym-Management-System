<?php
require_once __DIR__ . '/auth.php';
require_login();
include 'db_connect.php';
require_once __DIR__ . '/membership_read.php';
try {
    $summary = membership_read_summary($conn, membership_read_records($conn));
} catch (mysqli_sql_exception | RuntimeException $exception) {
    error_log('Unable to load membership summary.');
    http_response_code(503);
    exit('<div class="alert alert-danger">Unable to load dashboard. Please try again.</div>');
}
?>
<style>
   span.float-right.summary_icon {
    font-size: 3rem;
    position: absolute;
    right: 1rem;
    color: #ffffff96;
}
.imgs{
		margin: .5em;
		max-width: calc(100%);
		max-height: calc(100%);
	}
	.imgs img{
		max-width: calc(100%);
		max-height: calc(100%);
		cursor: pointer;
	}
	#imagesCarousel,#imagesCarousel .carousel-inner,#imagesCarousel .carousel-item{
		height: 60vh !important;background: black;
	}
	#imagesCarousel .carousel-item.active{
		display: flex !important;
	}
	#imagesCarousel .carousel-item-next{
		display: flex !important;
	}
	#imagesCarousel .carousel-item img{
		margin: auto;
	}
	#imagesCarousel img{
		width: auto!important;
		height: auto!important;
		max-height: calc(100%)!important;
		max-width: calc(100%)!important;
	}
</style>

<div class="containe-fluid">
	<div class="row mt-3 ml-3 mr-3">
        <div class="col-lg-12">
            <div class="card">
                <div class="card-body">
                    <?php echo "Welcome back ". membership_read_escape($_SESSION['login_name'])."!"  ?>
                    <hr>
                    <?php if ($summary['needs_attention'] > 0): ?>
                    <div class="alert alert-warning" role="alert">
                        <?php echo $summary['needs_attention']; ?> open membership record(s) need attention.
                        <a href="index.php?page=registered_members">Review Membership Validity</a> to resolve missing details or duplicate records.
                    </div>
                    <?php endif; ?>
                    <div class="row">
                        <div class="col-md-4">
                            <div class="card">
                                <div class="card-body bg-success">
                                    <div class="card-body text-white">
                                        <span class="float-right summary_icon"><i class="fa fa-users"></i></span>
                                        <h4><b>
                                            <?php echo $summary['active_members']; ?>
                                        </b></h4>
                                        <p><b>Active Members</b></p>
                                        <small><?php echo $summary['total_members']; ?> member profiles total. Active means one complete, current membership.</small>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="col-md-4">
                            <div class="card">
                                <div class="card-body bg-success">
                                    <div class="card-body text-white">
                                        <span class="float-right summary_icon"><i class="fa fa-th-list"></i></span>
                                        <h4><b>
                                            <?php echo $conn->query("SELECT * FROM plans")->num_rows; ?>
                                        </b></h4>
                                        <p><b>Total Membership Plans</b></p>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="col-md-4">
                            <div class="card">
                                <div class="card-body bg-success">
                                    <div class="card-body text-white">
                                        <span class="float-right summary_icon"><i class="fa fa-list"></i></span>
                                        <h4><b>
                                            <?php echo $conn->query("SELECT * FROM packages")->num_rows; ?>
                                        </b></h4>
                                        <p><b>Total Packages</b></p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>	

                    
                </div>
            </div>      			
        </div>
    </div>
</div>
<script>
	$('#manage-records').submit(function(e){
        e.preventDefault()
        start_load()
        $.ajax({
            url:'ajax.php?action=save_track',
            data: new FormData($(this)[0]),
            cache: false,
            contentType: false,
            processData: false,
            method: 'POST',
            type: 'POST',
            success:function(resp){
                resp=JSON.parse(resp)
                if(resp.status==1){
                    alert_toast("Data successfully saved",'success')
                    setTimeout(function(){
                        location.reload()
                    },800)

                }
                
            }
        })
    })
    $('#tracking_id').on('keypress',function(e){
        if(e.which == 13){
            get_person()
        }
    })
    $('#check').on('click',function(e){
            get_person()
    })
    function get_person(){
            start_load()
        $.ajax({
                url:'ajax.php?action=get_pdetails',
                method:"POST",
                data:{tracking_id : $('#tracking_id').val()},
                success:function(resp){
                    if(resp){
                        resp = JSON.parse(resp)
                        if(resp.status == 1){
                            $('#name').html(resp.name)
                            $('#address').html(resp.address)
                            $('[name="person_id"]').val(resp.id)
                            $('#details').show()
                            end_load()

                        }else if(resp.status == 2){
                            alert_toast("Unknow tracking id.",'danger');
                            end_load();
                        }
                    }
                }
            })
    }
</script>
