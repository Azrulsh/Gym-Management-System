<?php
declare(strict_types=1);
require_once __DIR__ . '/auth.php';
require_once __DIR__ . '/settings_service.php';

function system_settings_handle_request(): void
{
    require_admin(true);
    require_post_request('Use POST to save Settings.');
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    if ((int)($_SERVER['CONTENT_LENGTH'] ?? 0) > 5 * 1024 * 1024 || (!$_POST && (int)($_SERVER['CONTENT_LENGTH'] ?? 0) > 0)) {
        http_response_code(413);
        echo json_encode(['error'=>'Upload is too large. Maximum 2 MB per image.']);
        return;
    }
    require_csrf_token();
    try {
        include __DIR__ . '/db_connect.php';
        $saved = (new SettingsService($conn,new SettingsImages()))->save($_POST,$_FILES,(int)$_SESSION['login_id']);
        echo json_encode(['saved'=>true,'version'=>(int)$saved['version']]);
    } catch (SettingsRequestException $exception) {
        http_response_code($exception->status);
        echo json_encode(['error'=>$exception->getMessage()]);
    } catch (mysqli_sql_exception | RuntimeException | ValueError $exception) {
        error_log('Unable to save Settings (code ' . (int)$exception->getCode() . ').');
        http_response_code(503);
        echo json_encode(['error'=>'Unable to save Settings. Please try again. If uploading an image, check image processing and storage availability with your administrator.']);
    } finally { if (isset($conn)) $conn->close(); }
}
