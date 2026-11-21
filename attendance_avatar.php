<?php
require_once __DIR__.'/auth.php';
require_login();
require_once __DIR__.'/attendance_repository.php';
require_once __DIR__.'/member_portal_service.php';
try {
    $id=attendance_id($_GET['id'] ?? null,'member ID');
    include __DIR__.'/db_connect.php';
    $row=(new DatabaseQueries($conn))->rows('SELECT p.avatar_filename FROM members m LEFT JOIN member_portal_accounts p ON p.member_id=m.id WHERE m.id=?','i',[$id])[0] ?? null;
    if (!$row) throw new AttendanceRequestException(404,'Member not found.');
    $path=member_avatar_storage()->path($row['avatar_filename']) ?? __DIR__.'/assets/img/gym-logo.svg';
    $stream=@fopen($path,'rb');
    if (!$stream) throw new RuntimeException('Image unavailable.');
    header('Content-Type: '.match(pathinfo($path,PATHINFO_EXTENSION)){'png'=>'image/png','jpg'=>'image/jpeg',default=>'image/svg+xml'});
    header('X-Content-Type-Options: nosniff'); header('Cache-Control: no-store');
    header("Content-Security-Policy: default-src 'none'; frame-ancestors 'none'");
    fpassthru($stream); fclose($stream);
} catch (AttendanceRequestException $exception) { http_response_code($exception->status); }
catch (mysqli_sql_exception | RuntimeException $exception) { error_log('Attendance image unavailable.'); http_response_code(503); }
finally { if(isset($conn))$conn->close(); }
