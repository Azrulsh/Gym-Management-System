<?php
declare(strict_types=1);
require_once __DIR__ . '/auth.php';
require_once __DIR__ . '/member_portal_repository.php';

/** Deliberately separate from require_login(), which remains the operations guard. */
function require_member(bool $api = false): array
{
    header('Cache-Control: no-store');
    if (isset($_SESSION['login_id']) && current_role() !== 3) deny_access($api);
    $account = null;
    try {
        if (isset($_SESSION['login_id'])) {
            include __DIR__ . '/db_connect.php';
            $account=(new MemberPortalRepository($conn))->account((int)$_SESSION['login_id']);
        }
    } catch (mysqli_sql_exception | RuntimeException $exception) {
        error_log('Member session verification unavailable.');
        http_response_code(503);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['error'=>'Unable to verify your session. Please try again.']);
        exit;
    } finally { if (isset($conn)) $conn->close(); }
    if ($account && (int)$account['type']===3 && (int)$account['enabled']===1
        && (int)$account['auth_version']===(int)($_SESSION['login_auth_version'] ?? 0)) {
        return $account;
    }
    clear_login_session();
    if ($api) {
        http_response_code(401); header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['error'=>'Your session expired or your portal account is disabled. Sign in again.']);
    } else header('Location: login.php');
    exit;
}
