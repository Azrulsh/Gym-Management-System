<?php
// Load this file before output so redirects and session cookies can be sent.
if (session_status() !== PHP_SESSION_ACTIVE) {
    ini_set('session.use_strict_mode', '1');
    ini_set('session.use_only_cookies', '1');
    session_set_cookie_params([
        'httponly' => true,
        'secure' => !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off',
        'samesite' => 'Lax',
    ]);
    session_start();
}

function require_login($api = false)
{
    if (!headers_sent()) {
        header('Cache-Control: no-store');
    }

    if (isset($_SESSION['login_id'])) {
        return;
    }

    $ajax = strcasecmp($_SERVER['HTTP_X_REQUESTED_WITH'] ?? '', 'XMLHttpRequest') === 0;
    if ($api || $ajax) {
        http_response_code(401);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['error' => 'Authentication required.']);
        exit;
    }

    header('Location: login.php');
    exit;
}
