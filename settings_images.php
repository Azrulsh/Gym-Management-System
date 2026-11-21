<?php
declare(strict_types=1);

final class SettingsRequestException extends RuntimeException
{
    public function __construct(public readonly int $status, string $message) { parent::__construct($message); }
}

final class SettingsImages
{
    public const MAX_BYTES = 2097152;
    public const MAX_PIXELS = 8000000;

    private function within(string $path, string $parent): bool
    {
        $path = rtrim(str_replace('\\', '/', $path), '/');
        $parent = rtrim(str_replace('\\', '/', $parent), '/');
        if (PHP_OS_FAMILY === 'Windows') { $path = strtolower($path); $parent = strtolower($parent); }
        return $path === $parent || str_starts_with($path, $parent . '/');
    }

    public function directory(bool $create = false): ?string
    {
        $configured = getenv('GYM_BRANDING_STORAGE') ?: dirname(__DIR__, 2) . '/gym-storage/branding';
        if (str_contains($configured, "\0") || !preg_match('~^(?:[A-Za-z]:[\\\\/]|/)~', $configured)) throw new RuntimeException('Invalid branding storage configuration.');
        // Resolve the existing ancestor too, so a symlink cannot redirect new storage into webroot.
        $ancestor = $configured; $suffix = [];
        while (!file_exists($ancestor)) {
            $suffix[] = basename($ancestor);
            $next = dirname($ancestor);
            if ($next === $ancestor) throw new RuntimeException('Invalid storage ancestor.');
            $ancestor = $next;
        }
        $resolved = realpath($ancestor);
        if ($resolved === false) throw new RuntimeException('Storage resolution failed.');
        foreach (array_reverse($suffix) as $segment) {
            if ($segment === '.' || $segment === '..') throw new RuntimeException('Invalid storage path.');
            $resolved .= DIRECTORY_SEPARATOR . $segment;
        }
        $webroot = realpath($_SERVER['DOCUMENT_ROOT'] ?? dirname(__DIR__)) ?: dirname(__DIR__);
        if ($this->within($resolved, $webroot) || $this->within($resolved, __DIR__)) throw new RuntimeException('Branding storage must be outside webroot.');
        if (!is_dir($resolved)) {
            if (!$create) return null;
            if (!@mkdir($resolved, 0700, true) && !is_dir($resolved)) throw new RuntimeException('Unable to create branding storage.');
        }
        $canonical = realpath($resolved);
        if ($canonical === false || $this->within($canonical, $webroot) || $this->within($canonical, __DIR__)) throw new RuntimeException('Unsafe branding storage.');
        return $canonical;
    }

    public function path(?string $filename): ?string
    {
        if ($filename === null || !preg_match('/\A[a-f0-9]{64}\.(?:jpg|png)\z/', $filename)) return null;
        $directory = $this->directory();
        if ($directory === null) return null;
        $path = $directory . DIRECTORY_SEPARATOR . $filename;
        if (is_link($path) || !is_file($path)) return null;
        return $path;
    }

    public function remove(?string $filename): void
    {
        try {
            $path = $this->path($filename);
            if ($path !== null && !@unlink($path)) error_log('Unable to clean up obsolete branding image.');
        } catch (RuntimeException $exception) { error_log('Branding cleanup storage unavailable.'); }
    }

    public function store(array $upload, string $kind): ?string
    {
        if (!in_array($kind, ['logo','cover'], true)) throw new InvalidArgumentException('Invalid image kind.');
        $error = $upload['error'] ?? null;
        if ($error === UPLOAD_ERR_NO_FILE) return null;
        if (!is_int($error)) throw new SettingsRequestException(422, 'Invalid image upload.');
        if (in_array($error, [UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE], true)) throw new SettingsRequestException(413, 'Maximum image size is 2 MB.');
        if ($error !== UPLOAD_ERR_OK) throw new SettingsRequestException(422, 'Image upload was incomplete. Choose the file again.');
        $originalName = $upload['name'] ?? null;
        if (!is_string($originalName) || strlen($originalName) > 255 || preg_match('~[\\\\/\x00:]~',$originalName)
            || !preg_match('/\.(?:jpe?g|png)\z/i',$originalName)) throw new SettingsRequestException(422,'Choose a JPEG or PNG file.');
        $tmp = $upload['tmp_name'] ?? null;
        if (!is_string($tmp) || !is_uploaded_file($tmp)) throw new SettingsRequestException(422, 'Invalid image upload.');
        $bytes = filesize($tmp);
        if ($bytes === false || $bytes < 1 || $bytes > self::MAX_BYTES) throw new SettingsRequestException(413, 'Maximum image size is 2 MB.');
        $info = @getimagesize($tmp);
        $mime = (new finfo(FILEINFO_MIME_TYPE))->file($tmp);
        if (!$info || !in_array($info[2], [IMAGETYPE_JPEG,IMAGETYPE_PNG], true)
            || $mime !== ($info[2] === IMAGETYPE_PNG ? 'image/png' : 'image/jpeg')) throw new SettingsRequestException(422, 'Choose a valid JPEG or PNG image.');
        if ($info[0] < 1 || $info[1] < 1 || $info[0] > 4096 || $info[1] > 4096 || $info[0] * $info[1] > self::MAX_PIXELS) throw new SettingsRequestException(422, 'Image dimensions must be within 4096 pixels per side and 8 megapixels.');
        if (!extension_loaded('gd')) throw new RuntimeException('GD image processing is unavailable.');
        $image = @imagecreatefromstring(file_get_contents($tmp));
        if ($image === false) throw new SettingsRequestException(422, 'Unable to decode this image. Choose another JPEG or PNG.');
        $output = null; $stream = null; $path = null;
        try {
            $limit = $kind === 'logo' ? 512 : 1920;
            $scale = min(1, $limit / max($info[0], $info[1]));
            $width = max(1, (int)round($info[0] * $scale)); $height = max(1, (int)round($info[1] * $scale));
            $output = imagecreatetruecolor($width, $height);
            if (!$output) throw new RuntimeException('Image processing failed.');
            imagealphablending($output, false); imagesavealpha($output, true);
            if (!imagecopyresampled($output, $image, 0,0,0,0,$width,$height,$info[0],$info[1])) throw new RuntimeException('Image resampling failed.');
            $filename = bin2hex(random_bytes(32)) . ($info[2] === IMAGETYPE_PNG ? '.png' : '.jpg');
            $path = $this->directory(true) . DIRECTORY_SEPARATOR . $filename;
            $stream = @fopen($path, 'xb');
            if (!$stream) throw new RuntimeException('Unable to store branding image.');
            $saved = $info[2] === IMAGETYPE_PNG ? imagepng($output,$stream,6) : imagejpeg($output,$stream,85);
            if (!$saved || !fflush($stream)) throw new RuntimeException('Image encoding failed.');
            $stat = fstat($stream);
            if (!$stat || $stat['size'] < 1 || $stat['size'] > self::MAX_BYTES) throw new SettingsRequestException(413, 'Processed image is too large. Choose a simpler image.');
            fclose($stream); $stream = null;
            @chmod($path, 0600);
            return $filename;
        } catch (Throwable $exception) {
            if (is_resource($stream)) { fclose($stream); $stream = null; }
            if ($path !== null && is_file($path)) @unlink($path);
            throw $exception;
        } finally {
            if (is_resource($stream)) fclose($stream);
            if ($output) imagedestroy($output);
            imagedestroy($image);
        }
    }
}
