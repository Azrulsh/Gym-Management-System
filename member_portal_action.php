<?php
declare(strict_types=1);
require_once __DIR__ . '/member_portal_auth.php';
require_once __DIR__ . '/member_portal_service.php';

function member_portal_handle_request(string $action): void
{
    if (in_array($action,['portal_invite','portal_access'],true)) require_admin(true);
    elseif ($action!=='portal_activate') require_member(true);
    require_post_request('Use POST for Member Portal changes.');
    require_csrf_token();
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    if ((int)($_SERVER['CONTENT_LENGTH'] ?? 0)>3*1024*1024) {
        http_response_code(413); echo json_encode(['error'=>'Request too large. Maximum avatar size is 2 MB.']); return;
    }
    if ($action==='portal_logout') {
        clear_login_session(); echo json_encode(['saved'=>true,'redirect'=>'login.php']); return;
    }
    if ($action==='portal_activate' && isset($_SESSION['login_id'])) {
        http_response_code(409); echo json_encode(['error'=>'Log out before using an activation or recovery link.']); return;
    }
    try {
        include __DIR__ . '/db_connect.php';
        $service=new MemberPortalService($conn);
        $id=(int)($_SESSION['login_id'] ?? 0); $version=(int)($_SESSION['login_auth_version'] ?? 0);
        $result=match($action) {
            'portal_invite'=>$service->invite($_POST,$id,$version),
            'portal_access'=>$service->setAccess($_POST,$id,$version),
            'portal_activate'=>$service->activate($_POST,$_SERVER['REMOTE_ADDR'] ?? 'unknown'),
            'portal_profile'=>$service->profile($_POST,$_FILES,$id,$version),
            'portal_password'=>$service->changePassword($_POST,$id,$version,$_SERVER['REMOTE_ADDR'] ?? 'unknown'),
            'portal_event'=>member_portal_event($conn,$id,$version),
        };
        if (!empty($result['logout'])) clear_login_session();
        echo json_encode($result);
    } catch (EventRequestException | SettingsRequestException $exception) {
        http_response_code($exception->status); echo json_encode(['error'=>$exception->getMessage()]);
    } catch (mysqli_sql_exception | RuntimeException | ValueError $exception) {
        error_log('Member Portal write unavailable (code '.(int)$exception->getCode().').');
        http_response_code(503); echo json_encode(['error'=>'Unable to save. Reload to check the current state before trying again.']);
    } finally { if (isset($conn)) $conn->close(); }
}

function member_portal_event(mysqli $db, int $actor, int $authVersion): array
{
    require_once __DIR__ . '/events_service.php';
    return (new EventsService($db))->participant($_POST,$actor,$authVersion,true);
}
