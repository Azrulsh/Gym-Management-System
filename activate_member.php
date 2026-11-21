<?php
require_once __DIR__ . '/auth.php';
require_once __DIR__ . '/member_portal_ui.php';
header('Cache-Control: no-store');
header('Referrer-Policy: no-referrer');
header('X-Content-Type-Options: nosniff');
header("Content-Security-Policy: default-src 'self'; style-src 'self'; script-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
?>
<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Member account activation and recovery</title><link rel="stylesheet" href="assets/vendor/bootstrap/css/bootstrap.min.css"></head>
<body class="bg-light"><main class="container py-5" id="member-portal">
    <div class="row justify-content-center"><div class="col-md-7 col-lg-5"><div class="card"><div class="card-body">
        <h1 class="h4">Member account activation / recovery</h1>
        <p>Use the private link provided by your gym. Links expire after 24 hours and work once.</p>
        <div data-portal-message role="alert" aria-live="polite"></div>
        <?php if (isset($_SESSION['login_id'])): ?><p>Log out of your current account before using this link.</p><a href="login.php">Back to your account</a>
        <?php else: ?><form action="ajax.php?action=portal_activate" method="post" data-portal-form>
            <?php portal_csrf(); portal_hidden('token',''); ?>
            <div class="form-group"><label for="activation-username">Username (new accounts only)</label><input class="form-control" name="username" id="activation-username" autocomplete="username" maxlength="100"><small class="form-text text-muted">3–100 letters, numbers, dots, underscores, @ or hyphens. Leave blank for password recovery.</small></div>
            <?php portal_password_fields(); ?>
            <button class="btn btn-primary" type="submit">Set Password</button> <a href="login.php">Back to Login</a>
        </form><?php endif; ?>
    </div></div></div></div>
</main><?php portal_script(); ?></body></html>
