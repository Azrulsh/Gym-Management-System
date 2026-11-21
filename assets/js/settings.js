(function ($) {
    'use strict';
    const form = document.getElementById('settings-form');
    if (!form) return;
    const message = form.querySelector('.settings-message');
    const previews = new Map();
    let submitting = false;

    function showError(text) {
        message.className = 'settings-message alert alert-danger';
        message.textContent = text;
    }
    function release(kind) {
        if (previews.has(kind)) {
            if (window.mediaViewerPreviews) window.mediaViewerPreviews.release(previews.get(kind));
            URL.revokeObjectURL(previews.get(kind));
        }
        previews.delete(kind);
    }
    function resetPreviews() {
        for (const kind of ['logo', 'cover']) {
            release(kind);
            const input = form.elements[kind];
            input.setCustomValidity('');
            const image = document.getElementById('preview-' + kind);
            image.src = image.dataset.currentSrc;
        }
    }
    for (const kind of ['logo', 'cover']) {
        const input = form.elements[kind];
        const remove = form.elements['remove_' + kind];
        const image = document.getElementById('preview-' + kind);
        input.addEventListener('change', function () {
            release(kind);
            input.setCustomValidity('');
            const file = input.files[0];
            if (!file) { image.src = remove.checked ? image.dataset.defaultSrc : image.dataset.currentSrc; return; }
            if (!['image/jpeg', 'image/png'].includes(file.type) || file.size > 2097152) {
                image.src = image.dataset.currentSrc;
                input.setCustomValidity('Choose a JPEG or PNG image up to 2 MB.');
                input.reportValidity();
                return;
            }
            remove.checked = false;
            const url = URL.createObjectURL(file);
            if (window.mediaViewerPreviews) window.mediaViewerPreviews.register(url);
            previews.set(kind, url);
            image.src = url;
        });
        remove.addEventListener('change', function () {
            release(kind);
            input.value = '';
            input.setCustomValidity('');
            image.src = remove.checked ? image.dataset.defaultSrc : image.dataset.currentSrc;
        });
    }
    form.addEventListener('reset', function (event) {
        if (submitting) { event.preventDefault(); return; }
        resetPreviews();
        message.className = 'settings-message';
        message.textContent = '';
    });
    window.addEventListener('pagehide', function () { for (const kind of ['logo', 'cover']) release(kind); });
    form.addEventListener('submit', function (event) {
        event.preventDefault();
        if (submitting || !form.reportValidity()) return;
        const data = new FormData(form);
        const controls = Array.from(form.elements).map(control => [control, control.disabled]);
        let saved = false;
        submitting = true;
        message.className = 'settings-message'; message.textContent = '';
        controls.forEach(([control]) => { control.disabled = true; });
        window.start_load();
        $.ajax({
            url: form.action, method: 'POST', data: data, contentType: false, processData: false,
            dataType: 'json', timeout: 15000,
            success: function (response) {
                if (!response || response.saved !== true) { showError('Unable to confirm the save. Reload Settings and check the latest values.'); return; }
                saved = true;
            },
            error: function (xhr, status) {
                if (xhr.status === 401 || xhr.status === 403) return;
                const error = xhr.responseJSON && xhr.responseJSON.error;
                showError(status === 'timeout' || xhr.status === 0
                    ? 'Save status could not be confirmed. Reload Settings and check the latest values before trying again.'
                    : (typeof error === 'string' ? error : 'Unable to save Settings. Please try again.'));
            },
            complete: function () {
                window.end_load();
                if (saved) window.location.reload();
                else { submitting = false; controls.forEach(([control, disabled]) => { control.disabled = disabled; }); }
            }
        });
    });
})(jQuery);
