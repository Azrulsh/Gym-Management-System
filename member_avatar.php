<?php
declare(strict_types=1);
require_once __DIR__ . '/member_portal_auth.php';
require_once __DIR__ . '/member_portal_service.php';
$account=require_member();
try {
    $path=member_avatar_storage()->path($account['avatar_filename']);
    $path=$path ?? __DIR__.'/assets/img/gym-logo.svg';
    $stream=@fopen($path,'rb');
    if (!$stream) throw new RuntimeException('Avatar unavailable.');
    header('Content-Type: '.match(pathinfo($path,PATHINFO_EXTENSION)) {'png'=>'image/png','jpg'=>'image/jpeg',default=>'image/svg+xml'});
    header('X-Content-Type-Options: nosniff');
    header("Content-Security-Policy: default-src 'none'; frame-ancestors 'none'");
    header('Cache-Control: no-store');
    fpassthru($stream); fclose($stream);
} catch (RuntimeException $exception) { error_log('Member avatar unavailable.'); http_response_code(503); }
