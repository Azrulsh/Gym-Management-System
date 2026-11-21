<?php
require_once __DIR__ . '/auth.php';
require_admin();
require_once __DIR__ . '/settings_repository.php';
try {
    include 'db_connect.php';
    $settings = system_settings_read($conn);
} catch (mysqli_sql_exception | RuntimeException $exception) {
    error_log('Unable to load Settings.');
    http_response_code(503);
    echo '<div class="alert alert-danger" role="alert">Unable to load Settings. Please try again.</div>';
    return;
}
?>
<div class="container-fluid py-3">
    <div class="mb-3"><h1 class="h4">System Settings</h1><p class="text-muted">Manage the gym information and branding shown across the system.</p></div>
    <form id="settings-form" action="ajax.php?action=save_settings" method="post" enctype="multipart/form-data">
        <input type="hidden" name="csrf_token" value="<?php echo settings_escape(csrf_token()); ?>">
        <input type="hidden" name="version" value="<?php echo (int)$settings['version']; ?>">
        <div class="settings-message" role="alert" aria-live="polite"></div>
        <div class="row">
            <div class="col-lg-7 mb-3"><div class="card h-100">
                <div class="card-header"><b>Gym Information</b></div>
                <div class="card-body">
                    <div class="form-group"><label for="settings-name">Gym name</label><input id="settings-name" name="gym_name" type="text" class="form-control" maxlength="100" required value="<?php echo settings_escape($settings['gym_name']); ?>"></div>
                    <div class="form-row">
                        <div class="form-group col-md-6"><label for="settings-email">Contact email</label><input id="settings-email" name="email" type="email" class="form-control" maxlength="254" value="<?php echo settings_escape($settings['email']); ?>"></div>
                        <div class="form-group col-md-6"><label for="settings-contact">Phone number</label><input id="settings-contact" name="contact" type="tel" class="form-control" maxlength="50" value="<?php echo settings_escape($settings['contact']); ?>"></div>
                    </div>
                    <div class="form-group"><label for="settings-address">Gym address</label><textarea id="settings-address" name="address" class="form-control" maxlength="1000" rows="3"><?php echo settings_escape($settings['address']); ?></textarea></div>
                    <div class="form-group"><label for="settings-about">About the gym</label><textarea id="settings-about" name="about" class="form-control" maxlength="3000" rows="4"><?php echo settings_escape($settings['about']); ?></textarea><small class="form-text text-muted">Shown as plain text on the Login page.</small></div>
                </div>
            </div></div>
            <div class="col-lg-5 mb-3"><div class="card h-100">
                <div class="card-header"><b>Branding</b></div>
                <div class="card-body">
                    <p class="small text-muted">JPEG or PNG, up to 2 MB each. Maximum 4096 pixels per side and 8 megapixels. Changes are applied when you save.</p>
                    <?php if (!extension_loaded('gd')): ?><div class="alert alert-warning" role="alert">Image uploads are currently unavailable. Contact your administrator to enable image processing. You can still update gym information or remove an image.</div><?php endif; ?>
                    <?php foreach (['logo'=>'Logo','cover'=>'Login cover'] as $kind=>$label): ?>
                    <div class="form-group border-bottom pb-3" data-branding-kind="<?php echo $kind; ?>">
                        <label for="settings-<?php echo $kind; ?>"><?php echo $label; ?></label>
                        <div class="mb-2"><button type="button" class="media-viewer-trigger" data-media-viewer aria-label="View <?php echo strtolower($label); ?>"><img id="preview-<?php echo $kind; ?>" src="<?php echo settings_escape(settings_image_url($settings,$kind)); ?>" data-current-src="<?php echo settings_escape(settings_image_url($settings,$kind)); ?>" data-default-src="<?php echo $kind==='logo'?'assets/img/gym-logo.svg':'assets/img/img.jpg'; ?>" alt="Current <?php echo strtolower($label); ?>" style="max-width:100%;max-height:<?php echo $kind==='logo'?'90':'160'; ?>px;object-fit:contain"><span class="d-block small">View image</span></button></div>
                        <input id="settings-<?php echo $kind; ?>" name="<?php echo $kind; ?>" type="file" class="form-control-file" accept="image/jpeg,image/png" <?php echo extension_loaded('gd')?'':'disabled'; ?>>
                        <div class="form-check mt-2"><input id="remove-<?php echo $kind; ?>" name="remove_<?php echo $kind; ?>" type="checkbox" value="1" class="form-check-input"><label class="form-check-label" for="remove-<?php echo $kind; ?>">Use default <?php echo strtolower($label); ?></label></div>
                    </div>
                    <?php endforeach; ?>
                </div>
            </div></div>
        </div>
        <div class="d-flex flex-wrap align-items-center mb-4">
            <button type="submit" class="btn btn-success mr-2 mb-2">Save Changes</button>
            <button type="reset" class="btn btn-outline-secondary mb-2">Cancel Changes</button>
            <?php if ($settings['updated_at'] !== null): ?><small class="text-muted ml-md-auto">Last updated: <?php echo settings_escape($settings['updated_at']); ?> (Malaysia)</small><?php endif; ?>
        </div>
    </form>
</div>
<script src="assets/js/settings.js?v=<?php echo filemtime(__DIR__ . '/assets/js/settings.js'); ?>"></script>
