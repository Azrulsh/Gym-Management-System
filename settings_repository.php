<?php
declare(strict_types=1);

function system_settings_defaults(): array
{
    return ['id'=>1, 'gym_name'=>'Gym Management System', 'email'=>'', 'contact'=>'',
        'address'=>'', 'about'=>'', 'logo_filename'=>null, 'cover_filename'=>null,
        'version'=>1, 'updated_at'=>null, 'updated_by'=>null];
}

function system_settings_read($db): array
{
    $result = $db->query('SELECT id, gym_name, email, contact, address, about, logo_filename, cover_filename, version, updated_at, updated_by FROM system_settings WHERE id = 1');
    if (!$result) throw new RuntimeException('Settings lookup unavailable.');
    try { $settings = $result->fetch_assoc(); } finally { $result->free(); }
    if (!$settings) throw new RuntimeException('Settings record unavailable.');
    return $settings;
}

// Branding must not prevent sign-in if the optional settings record is unavailable.
// Read once per page request; never keep mutable global settings in a user session.
function system_settings_branding($db = null): array
{
    if ($db === null) return system_settings_defaults();
    try { return system_settings_read($db); }
    catch (mysqli_sql_exception | RuntimeException $exception) {
        error_log('Branding unavailable (code ' . (int)$exception->getCode() . ').');
        return system_settings_defaults();
    }
}

function settings_escape($value): string
{
    return htmlspecialchars((string)$value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function settings_image_url(array $settings, string $kind): string
{
    if (!in_array($kind, ['logo','cover'], true)) throw new InvalidArgumentException('Invalid image kind.');
    if (empty($settings[$kind . '_filename'])) return $kind === 'logo' ? 'assets/img/gym-logo.svg' : 'assets/img/img.jpg';
    return 'branding_image.php?kind=' . $kind . '&v=' . (int)$settings['version'];
}
