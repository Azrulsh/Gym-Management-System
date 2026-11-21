(function ($) {
    'use strict';
    const modal = document.getElementById('viewer_modal');
    if (!modal || modal.dataset.initialized) return;
    modal.dataset.initialized = 'true';
    const content = modal.querySelector('[data-media-content]');
    const status = modal.querySelector('#media-viewer-status');
    const title = modal.querySelector('#media-viewer-title');
    const retry = modal.querySelector('[data-media-retry]');
    const previewUrls = new Set();
    let generation = 0, timer = null, image = null, current = null, opener = null;

    // Only Settings-created object URLs may be previewed, never arbitrary blob/data URLs.
    window.mediaViewerPreviews = Object.freeze({
        register(url) {
            if (typeof url !== 'string') return;
            try {
                const preview = new URL(url);
                if (preview.protocol === 'blob:' && preview.origin === location.origin && !preview.hash && !preview.search) previewUrls.add(url);
            } catch (_) { /* Invalid previews are rejected by allowedSource(). */ }
        },
        release(url) {
            previewUrls.delete(url);
            if (current && current.src === url) fail('This preview changed. Close the viewer and open the image again.');
        }
    });

    function allowedSource(source) {
        if (typeof source !== 'string' || !source || source !== source.trim()) return null;
        if (previewUrls.has(source)) return source;
        let url;
        try { url = new URL(source, document.baseURI); } catch (_) { return null; }
        if (!['http:', 'https:'].includes(url.protocol) || url.origin !== location.origin || url.username || url.password || url.hash) return null;
        const app = new URL('.', document.baseURI);
        const routes = {
            'member_avatar.php': params => params.size === 0,
            'attendance_avatar.php': params => params.size === 1 && /^[1-9][0-9]*$/.test(params.get('id') || ''),
            'branding_image.php': params => params.size === 2 && ['logo', 'cover'].includes(params.get('kind')) && /^[1-9][0-9]*$/.test(params.get('v') || ''),
            'assets/img/gym-logo.svg': params => params.size === 0,
            'assets/img/img.jpg': params => params.size === 0
        };
        for (const [route, validate] of Object.entries(routes)) {
            if (url.pathname === new URL(route, app).pathname && validate(url.searchParams)) return url.href;
        }
        return null;
    }

    function clearImage() {
        generation++;
        clearTimeout(timer);
        timer = null;
        if (image) { image.onload = null; image.onerror = null; image.removeAttribute('src'); }
        image = null;
        content.replaceChildren();
        content.removeAttribute('aria-busy');
    }
    function fail(message) {
        clearImage();
        status.textContent = message;
        retry.hidden = !current || !allowedSource(current.src);
    }
    function load() {
        clearImage();
        retry.hidden = true;
        const src = current && allowedSource(current.src);
        if (!src) { fail('This image source is unavailable. Close the viewer and open a current image.'); return; }
        status.textContent = 'Loading image...';
        content.setAttribute('aria-busy', 'true');
        const request = generation;
        const next = document.createElement('img');
        image = next;
        next.alt = current.alt;
        next.hidden = true;
        next.onload = function () {
            if (request !== generation) return;
            clearTimeout(timer);
            content.removeAttribute('aria-busy');
            next.hidden = false;
            status.textContent = '';
        };
        next.onerror = function () {
            if (request === generation) fail('Unable to load this image. Your session may have expired. Try again or sign in again.');
        };
        content.append(next);
        timer = setTimeout(function () {
            if (request === generation) fail('Loading took too long. Please try again.');
        }, 15000);
        next.src = src;
    }

    // Preserve the legacy helper name; content is now image-only and uses DOM properties.
    window.viewer_modal = function (source = '', label = 'View image', trigger = document.activeElement) {
        opener = trigger;
        current = {src: source, alt: typeof label === 'string' ? label : 'View image'};
        title.textContent = current.alt;
        $(modal).modal({show: true, backdrop: true, keyboard: true, focus: true});
        load();
    };
    retry.addEventListener('click', load);
    document.addEventListener('click', function (event) {
        const trigger = event.target.closest('[data-media-viewer]');
        if (!trigger || trigger.disabled) return;
        const preview = trigger.querySelector('img');
        if (!preview) return;
        event.preventDefault();
        window.viewer_modal(preview.getAttribute('src') || '', preview.alt || 'View image', trigger);
    });
    $(modal).on('hide.bs.modal', function () {
        clearImage();
        current = null;
        retry.hidden = true;
        status.textContent = '';
    }).on('hidden.bs.modal', function () {
        if (opener && opener.isConnected && !opener.disabled) opener.focus();
        opener = null;
    });
})(jQuery);
