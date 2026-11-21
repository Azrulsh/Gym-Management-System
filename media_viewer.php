<?php // Shared presentation only. Image endpoints enforce authorization on every request. ?>
<link rel="stylesheet" href="assets/css/media-viewer.css?v=<?php echo filemtime(__DIR__ . '/assets/css/media-viewer.css'); ?>">
<div class="modal fade" id="viewer_modal" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="media-viewer-title" aria-describedby="media-viewer-status">
    <div class="modal-dialog modal-lg modal-dialog-centered" role="document">
        <div class="modal-content">
            <div class="modal-header">
                <h2 class="modal-title h5" id="media-viewer-title">View image</h2>
                <button type="button" class="close" data-dismiss="modal" aria-label="Close image viewer"><span aria-hidden="true">&times;</span></button>
            </div>
            <div class="modal-body text-center">
                <p id="media-viewer-status" role="status" aria-live="polite"></p>
                <div data-media-content></div>
                <button type="button" class="btn btn-outline-primary" data-media-retry hidden>Try Again</button>
            </div>
        </div>
    </div>
</div>
<script src="assets/js/media-viewer.js?v=<?php echo filemtime(__DIR__ . '/assets/js/media-viewer.js'); ?>"></script>
