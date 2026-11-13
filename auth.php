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
        if (!in_array(current_role(), [1, 2], true)) {
            deny_access($api);
        }
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

function current_role()
{
    $role = $_SESSION['login_type'] ?? null;
    return in_array($role, [1, 2, '1', '2'], true) ? (int) $role : 0;
}

function is_admin()
{
    return isset($_SESSION['login_id']) && current_role() === 1;
}

function deny_access($api = false)
{
    http_response_code(403);
    header('Cache-Control: no-store');
    $ajax = strcasecmp($_SERVER['HTTP_X_REQUESTED_WITH'] ?? '', 'XMLHttpRequest') === 0;
    if ($api || $ajax) {
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['error' => 'You do not have permission to perform this action.']);
    } else {
        header('Content-Type: text/html; charset=utf-8');
        echo '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">'
            . '<meta name="viewport" content="width=device-width, initial-scale=1">'
            . '<title>Access denied</title>'
            . '<link rel="stylesheet" href="assets/vendor/bootstrap/css/bootstrap.min.css">'
            . '</head><body class="bg-light"><main class="container py-5">'
            . '<div class="card"><div class="card-body"><h1 class="h4">Access denied</h1>'
            . '<p>You do not have permission to access this page.</p>'
            . '<a class="btn btn-primary" href="index.php?page=home">Back to dashboard</a>'
            . '</div></div></main></body></html>';
    }
    exit;
}

function require_admin($api = false)
{
    require_login($api);
    if (!is_admin()) {
        deny_access($api);
    }
}

function require_own_account($id, $api = false)
{
    require_login($api);
    $id = filter_var($id, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
    if ($id === false || $id !== (int) $_SESSION['login_id']) {
        deny_access($api);
    }
}

function can_access_action($action)
{
    if (!isset($_SESSION['login_id']) || !in_array(current_role(), [1, 2], true)) {
        return false;
    }
    $sharedActions = [
        'logout', 'save_member', 'delete_member', 'save_membership',
        'renew_membership', 'end_membership', 'save_schedule', 'delete_schedule',
        'get_schecdule', 'save_payment', 'save_account',
    ];
    $adminActions = [
        'save_user', 'delete_user', 'save_plan', 'delete_plan',
        'save_package', 'delete_package', 'save_trainer', 'delete_trainer', 'save_settings',
    ];
    return in_array($action, $sharedActions, true)
        || (is_admin() && in_array($action, $adminActions, true));
}

function require_action_access($action)
{
    require_login(true);
    if (!can_access_action($action)) {
        deny_access(true);
    }
    if ($action === 'save_account') {
        require_own_account($_POST['id'] ?? null, true);
        // Account owners may change profile fields, never their own role.
        if (isset($_POST['type']) && (!is_scalar($_POST['type']) || (string) $_POST['type'] !== (string) current_role())) {
            deny_access(true);
        }
    }
    $postActions = [
        'end_membership' => 'Use POST to end a membership.',
        'save_member' => 'Use POST to save a member.',
        'save_user' => 'Use POST to save a user.',
        'save_plan' => 'Use POST to save a plan.',
        'save_package' => 'Use POST to save a package.',
    ];
    if (isset($postActions[$action])) {
        require_post_request($postActions[$action]);
    }
    if (in_array($action, ['save_account', 'end_membership', 'save_member', 'save_user', 'save_plan', 'save_package'], true)) {
        require_csrf_token();
    }
}

function require_post_request($message)
{
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
        http_response_code(405);
        header('Allow: POST');
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['error' => $message]);
        exit;
    }
}

function require_csrf_token()
{
    $token = $_POST['csrf_token'] ?? null;
    if (!is_string($token) || !isset($_SESSION['csrf_token']) || !hash_equals($_SESSION['csrf_token'], $token)) {
        deny_access(true);
    }
}

function csrf_token()
{
    if (!isset($_SESSION['csrf_token'])) {
        $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
    }
    return $_SESSION['csrf_token'];
}
