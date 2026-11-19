(function ($) {
    'use strict';

    $(document).on('submit', '#manage-user', function (event) {
        event.preventDefault();
        const form = this;
        if (form.dataset.submitting === 'true' || !form.reportValidity()) return;

        const message = $(form).find('.user-message');
        const saveButton = $('#uni_modal #submit');
        let saved = false;
        function showError(text) {
            message.addClass('alert alert-danger').text(text);
        }

        form.dataset.submitting = 'true';
        message.removeClass('alert alert-danger').empty();
        saveButton.prop('disabled', true);
        window.start_load();
        $.ajax({
            url: $(form).attr('action'),
            method: 'POST',
            timeout: 15000,
            data: $(form).serialize(),
            success: function (response) {
                if (String(response).trim() !== '1') {
                    // save_account keeps its existing numeric duplicate response.
                    showError(String(response).trim() === '2'
                        ? 'Username already exists.'
                        : 'Unable to save user. Check the required fields and try again.');
                    return;
                }
                saved = true;
                window.alert_toast('User successfully saved.', 'success');
                window.setTimeout(function () { window.location.reload(); }, 750);
            },
            error: function (xhr, status) {
                if (status === 'timeout') {
                    showError('Save status could not be confirmed because the request timed out. Refresh the page and check account details before trying again. If you changed your password, you may need to sign in again.');
                    return;
                }
                if (xhr.status === 401 || xhr.status === 403) return;
                const error = xhr.responseJSON && xhr.responseJSON.error;
                showError(typeof error === 'string' ? error : 'Unable to save user. Please try again.');
            },
            complete: function () {
                if (!saved) form.dataset.submitting = 'false';
                saveButton.prop('disabled', false);
                window.end_load();
            }
        });
    });
})(jQuery);
