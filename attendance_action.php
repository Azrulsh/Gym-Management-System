<?php
declare(strict_types=1);
require_once __DIR__ . '/auth.php';
require_once __DIR__ . '/attendance_service.php';

function attendance_handle_request(string $action): void
{
    require_action_access($action);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    if ((int)($_SERVER['CONTENT_LENGTH'] ?? 0)>16384) {
        http_response_code(413); echo json_encode(['error'=>'Attendance request is too large.']); return;
    }
    try {
        include __DIR__.'/db_connect.php';
        $service=new AttendanceService($conn);
        $actor=(int)$_SESSION['login_id']; $version=(int)$_SESSION['login_auth_version'];
        $result=match($action) {
            'attendance_lookup'=>$service->lookup($_POST),
            'attendance_checkin'=>$service->checkIn($_POST,$actor,$version),
            'attendance_checkout'=>$service->checkOut($_POST,$actor,$version),
            'attendance_correct'=>$service->correct($_POST,$actor,$version),
        };
        echo json_encode($result);
    } catch (AttendanceRequestException $exception) {
        http_response_code($exception->status); echo json_encode(['error'=>$exception->getMessage()]);
    } catch (mysqli_sql_exception | RuntimeException $exception) {
        error_log('Attendance request unavailable (code '.(int)$exception->getCode().').');
        http_response_code((int)$exception->getCode()===1062?409:503);
        echo json_encode(['error'=>(int)$exception->getCode()===1062?'Attendance changed or this request was already used. Reload before trying again.':'Unable to process Attendance. Reload to check the current state before trying again.']);
    } finally { if(isset($conn)) $conn->close(); }
}
