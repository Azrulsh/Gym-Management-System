<?php
require_once __DIR__ . '/app_config.php';

$conn = null;
try {
    mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);
    $conn = new mysqli('localhost', 'root', '', 'gym');
    configure_database_timezone($conn);
} catch (mysqli_sql_exception | RuntimeException $exception) {
    error_log('Database connection unavailable (error code ' . (int)$exception->getCode() . ').');
    if ($conn) $conn->close();
    $conn = null;
    $json = strcasecmp($_SERVER['HTTP_X_REQUESTED_WITH'] ?? '', 'XMLHttpRequest') === 0
        || basename($_SERVER['SCRIPT_NAME'] ?? '') === 'ajax.php';
    if (!headers_sent()) {
        http_response_code(503);
        header('Cache-Control: no-store');
        header('Content-Type: ' . ($json ? 'application/json' : 'text/html') . '; charset=utf-8');
    }
    $message = 'Unable to connect to the database. Please try again later.';
    if ($json) echo json_encode(['error' => $message]);
    else echo '<div class="alert alert-danger" role="alert">' . $message . '</div>';
    exit;
}
