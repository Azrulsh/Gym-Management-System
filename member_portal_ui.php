<?php
declare(strict_types=1);
require_once __DIR__ . '/events_repository.php';

function portal_hidden(string $name, mixed $value): void
{
    echo '<input type="hidden" name="'.event_escape($name).'" value="'.event_escape($value).'">';
}

function portal_csrf(): void { portal_hidden('csrf_token',csrf_token()); }

function portal_script(): void
{
    echo '<script src="assets/js/member-portal.js?v='.(int)filemtime(__DIR__ . '/assets/js/member-portal.js').'" defer></script>';
}

function portal_password_fields(bool $current = false): void
{
    if ($current) echo '<div class="form-group"><label for="current-password">Current password</label><input class="form-control" id="current-password" name="current_password" type="password" autocomplete="current-password" required maxlength="4096"></div>';
    echo '<div class="form-group"><label for="new-password">New password</label><input class="form-control" id="new-password" name="password" type="password" autocomplete="new-password" minlength="12" maxlength="128" required><small class="form-text text-muted">12–128 bytes. Use a long, unique passphrase.</small></div>';
    echo '<div class="form-group"><label for="password-confirm">Confirm new password</label><input class="form-control" id="password-confirm" name="password_confirm" type="password" autocomplete="new-password" minlength="12" maxlength="128" required></div>';
}
