<?php
declare(strict_types=1);
require_once __DIR__ . '/settings_repository.php';
require_once __DIR__ . '/settings_images.php';
$kind = $_GET['kind'] ?? null;
if (!is_string($kind) || !in_array($kind,['logo','cover'],true)) {
    http_response_code(400); exit('Invalid branding image.');
}
try {
    include __DIR__ . '/db_connect.php';
    $settings = system_settings_branding($conn);
    $conn->close();
    $path = (new SettingsImages())->path($settings[$kind . '_filename']);
} catch (mysqli_sql_exception | RuntimeException $exception) {
    error_log('Branding image unavailable.');
    $path = null;
}
if ($path === null) $path = __DIR__ . ($kind === 'logo' ? '/assets/img/gym-logo.svg' : '/assets/img/img.jpg');
$stream = @fopen($path,'rb');
if (!$stream) { http_response_code(404); exit('Branding image unavailable.'); }
$stat = fstat($stream);
header('X-Content-Type-Options: nosniff');
header("Content-Security-Policy: default-src 'none'; frame-ancestors 'none'");
header('Cache-Control: no-store');
header('Content-Type: ' . (str_ends_with($path,'.svg') ? 'image/svg+xml' : (str_ends_with($path,'.png') ? 'image/png' : 'image/jpeg')));
header('Content-Disposition: inline');
if ($stat) header('Content-Length: ' . $stat['size']);
fpassthru($stream); fclose($stream);
