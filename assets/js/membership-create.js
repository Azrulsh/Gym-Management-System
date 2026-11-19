(function ($) {
    'use strict';

    $(document).on('submit', '#manage-member', function (event) {
        event.preventDefault();
        const form = this;
        if (form.dataset.submitting === 'true' || !form.reportValidity()) return;
        const message = $(form).find('.membership-message');
        const button = $('#uni_modal #submit');
        let saved = false;
        form.dataset.submitting = 'true';
        message.removeClass('alert alert-danger').empty();
        button.prop('disabled', true);
        window.start_load();
        $.ajax({
            url: $(form).attr('action'),
            method: 'POST',
            timeout: 15000,
            data: $(form).serialize(),
            success: function (response) {
                if (String(response).trim() !== '1') {
                    message.addClass('alert alert-danger').text('Unable to save membership. Please try again.');
                    return;
                }
                saved = true;
                window.alert_toast('Membership successfully saved.', 'success');
                window.setTimeout(function () { window.location.reload(); }, 750);
            },
            error: function (xhr, status) {
                if (status === 'timeout') {
                    message.addClass('alert alert-danger').text('Save status could not be confirmed because the request timed out. Refresh Membership Validity and check the record before trying again.');
                    return;
                }
                const error = xhr.responseJSON && xhr.responseJSON.error;
                message.addClass('alert alert-danger').text(typeof error === 'string' ? error : 'Unable to save membership. Please try again.');
            },
            complete: function () {
                if (!saved) form.dataset.submitting = 'false';
                button.prop('disabled', false);
                window.end_load();
            }
        });
    });
})(jQuery);
