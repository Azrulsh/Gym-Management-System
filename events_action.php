<?php
declare(strict_types=1);
require_once __DIR__ . '/auth.php';
require_once __DIR__ . '/events_service.php';

function events_handle_request(string $action): void
{
    require_action_access($action);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    if ((int)($_SERVER['CONTENT_LENGTH'] ?? 0) > 32768) {
        http_response_code(413); echo json_encode(['error'=>'Event request is too large.']); return;
    }
    try {
        include __DIR__ . '/db_connect.php';
        $service = new EventsService($conn);
        $arguments = [$_POST,(int)$_SESSION['login_id'],(int)$_SESSION['login_auth_version']];
        $result = match($action) {
            'save_event' => $service->save(...$arguments),
            'delete_event' => $service->delete(...$arguments),
            'save_event_participant' => $service->participant(...$arguments),
        };
        echo json_encode($result);
    } catch (EventRequestException $exception) {
        http_response_code($exception->status); echo json_encode(['error'=>$exception->getMessage()]);
    } catch (mysqli_sql_exception | RuntimeException $exception) {
        error_log('Event write unavailable (code ' . (int)$exception->getCode() . ').');
        http_response_code(503); echo json_encode(['error'=>'Unable to save this event change. Reload to check its current state before trying again.']);
    } finally { if (isset($conn)) $conn->close(); }
}
