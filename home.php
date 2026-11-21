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
<div class="row mt-4 ml-3 mr-3 mb-3">
    <div class="col-lg-12" id="attendance-module">
        <?php include __DIR__ . '/attendance_form.php'; ?>
        <a href="index.php?page=attendance">View Attendance and current visitors</a>
    </div>
</div>
<script src="assets/js/attendance.js?v=<?php echo filemtime(__DIR__ . '/assets/js/attendance.js'); ?>"></script>
