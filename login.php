<?php
require_once __DIR__ . '/auth.php';
header('Cache-Control: no-store');
if (isset($_SESSION['login_id'])) {
    header('Location: index.php?page=home');
    exit;
}
include('./db_connect.php');
require_once __DIR__ . '/settings_repository.php';
$branding = system_settings_branding($conn ?? null);
?>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta content="width=device-width, initial-scale=1.0" name="viewport">

  <title><?php echo settings_escape($branding['gym_name']); ?></title>
 	

<?php include('./header.php'); ?>

</head>
<style>
	body{
		width: 100%;
	    height: calc(100%);
	    /*background: #007bff;*/
	}
	main#main{
		width:100%;
		height: calc(100%);
		background:white;
	}
	#login-right{
		position: absolute;
		right:0;
		width:40%;
		height: calc(100%);
		background:white;
		display: flex;
		align-items: center;
	}
	#login-left{
		position: absolute;
		left:0;
		width:60%;
		height: calc(100%);
		background:#59b6ec61;
		display: flex;
		align-items: center;
	    background-repeat: no-repeat;
	    background-size: cover;
	}
	#login-right .card{
		margin: auto;
		z-index: 1
	}
	.logo {
    margin: auto;
    font-size: 8rem;
    background: white;
    padding: .5em 0.7em;
    border-radius: 50% 50%;
    color: #000000b3;
    z-index: 10;
}
div#login-right::before {
    content: "";
    position: absolute;
    top: 0;
    left: 0;
    width: calc(100%);
    height: calc(100%);
    background: #000000e0;
}

</style>
<style>
  #login-left > img { width:100%;height:100%;object-fit:cover; }
  .login-brand-logo { max-width:80px;max-height:80px;object-fit:contain; }
  .gym-description { white-space:pre-line; }
  #login-right { padding:1rem 0;overflow-y:auto; }
  #login-right .card { max-height:calc(100vh - 2rem);overflow-y:auto;overflow-wrap:anywhere; }
  .login-brand-logo + h1 { overflow-wrap:anywhere; }
  @media (max-width:767px) { #login-left { display:none; } #login-right { width:100%;position:relative;min-height:100vh; } }
</style>

<body>


  <main id="main" class=" bg-dark">
  		<div id="login-left">
            <img src="<?php echo settings_escape(settings_image_url($branding,'cover')); ?>" alt="Gym cover">
  		</div>
<div class="login-form-wrapper">
  		<div id="login-right">
  			<div class="card col-md-8">
  				<div class="card-body">
                        <div class="text-center mb-3">
                            <img class="login-brand-logo mb-2" src="<?php echo settings_escape(settings_image_url($branding,'logo')); ?>" alt="Gym logo">
                            <h1 class="h4"><?php echo settings_escape($branding['gym_name']); ?></h1>
                            <?php if ($branding['about'] !== ''): ?><p class="small text-muted gym-description"><?php echo settings_escape($branding['about']); ?></p><?php endif; ?>
                        </div>
  						
					<form id="login-form" action="ajax.php?action=login" method="post">
                            <input type="hidden" name="csrf_token" value="<?php echo htmlspecialchars(csrf_token(), ENT_QUOTES, 'UTF-8'); ?>">
                            <div class="login-message" role="alert" aria-live="polite"></div>
  						<div class="form-group">
  							<label for="username" class="control-label">Username</label>
							<input type="text" id="username" name="username" class="form-control" maxlength="200" autocomplete="username" required>
  						</div>
  						<div class="form-group">
  							<label for="password" class="control-label">Password</label>
							<input type="password" id="password" name="password" class="form-control" maxlength="4096" autocomplete="current-password" required>
  						</div>
						<center><button type="submit" class="btn-md btn-block btn-wave col-md-5 btn-primary">Login</button></center>
  					</form>
                        <div class="small text-muted mt-3 gym-description">
                            <?php foreach (['address','contact','email'] as $field): ?>
                            <?php if ($branding[$field] !== ''): ?><div><?php echo settings_escape($branding[$field]); ?></div><?php endif; ?>
                            <?php endforeach; ?>
                        </div>
  				</div>
  			</div>
  		</div>
  	</div>
   

  </main>

  <a href="#" class="back-to-top"><i class="icofont-simple-up"></i></a>


</body>
<script src="assets/js/login.js"></script>
</html>
