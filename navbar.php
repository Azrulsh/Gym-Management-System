<?php
require_once __DIR__ . '/auth.php';
require_login();
$navigationPages = ['home', 'members', 'registered_members', 'schedule'];
if (is_admin()) {
	$navigationPages = array_merge($navigationPages, ['plans', 'packages', 'trainer', 'users']);
}
$requestedPage = $_GET['page'] ?? 'home';
$activeNavigationPage = is_string($requestedPage) && in_array($requestedPage, $navigationPages, true)
	? $requestedPage : 'home';
// Legacy Settings cover reference: $_SESSION['system']['cover_img'].
// Keep disabled until Settings and validated image loading are implemented.
?>
<style>
	.collapse a{
		text-indent:10px;
	}
	nav#sidebar{
		background: #343a40 !important;
	}
</style>

<nav id="sidebar" class='mx-lt-5 bg-dark' >
		
		<div class="sidebar-list">
				<a href="index.php?page=home" class="nav-item nav-home"><span class='icon-field'><i class="fa fa-home"></i></span> Home</a>
				<a href="index.php?page=members" class="nav-item nav-members"><span class='icon-field'><i class="fa fa-user-friends"></i></span> Members</a>
				<a href="index.php?page=registered_members" class="nav-item nav-registered_members"><span class='icon-field'><i class="fa fa-id-card"></i></span> Membership Validity</a>
				<a href="index.php?page=schedule" class="nav-item nav-schedule"><span class='icon-field'><i class="fa fa-calendar-day"></i></span> Schedule</a>
				<?php if(is_admin()): ?>
				<a href="index.php?page=plans" class="nav-item nav-plans"><span class='icon-field'><i class="fa fa-th-list"></i></span> Plans</a>
				<a href="index.php?page=packages" class="nav-item nav-packages"><span class='icon-field'><i class="fa fa-list"></i></span> Packages</a>
				<a href="index.php?page=trainer" class="nav-item nav-trainer"><span class='icon-field'><i class="fa fa-user"></i></span> Trainers</a>
				<a href="index.php?page=users" class="nav-item nav-users"><span class='icon-field'><i class="fa fa-users"></i></span> Users</a>
			<?php endif; ?>
		</div>

</nav>
<script>
	$('.nav_collapse').click(function(){
		console.log($(this).attr('href'))
		$($(this).attr('href')).collapse()
	})
	$(<?php echo json_encode('.nav-' . $activeNavigationPage, JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT); ?>).addClass('active')
</script>
