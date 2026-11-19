(function ($) {
    'use strict';

    let pendingRequest = null;
    let submitting = false;

    $(document).on('click', '.end-membership', function () {
        const registrationId = Number($(this).attr('data-registration-id'));
        const token = $(this).attr('data-csrf-token');
        if (submitting || !Number.isSafeInteger(registrationId) || registrationId < 1 || !token) {
            return;
        }
        pendingRequest = { registrationId: registrationId, csrfToken: token };
        window._conf(
            'End this membership? Member details and payment history will be kept.',
            'end_membership',
            [registrationId]
        );
    });

    // Called by the existing shared confirmation modal.
    window.end_membership = function (registrationId) {
        if (submitting || !pendingRequest || pendingRequest.registrationId !== registrationId) {
            return;
        }
        submitting = true;
        $('#confirm_modal #confirm').prop('disabled', true);
        window.start_load();
        $.ajax({
            url: 'ajax.php?action=end_membership',
            method: 'POST',
            timeout: 15000,
            data: { rid: registrationId, csrf_token: pendingRequest.csrfToken },
            success: function (response) {
                if (String(response).trim() !== '1') {
                    window.alert_toast('Unable to end membership. Please try again.', 'danger');
                    return;
                }
                pendingRequest = null;
                $('#confirm_modal, #uni_modal').modal('hide');
                window.alert_toast('Membership successfully ended.', 'success');
                window.setTimeout(function () { window.location.reload(); }, 750);
            },
            error: function (xhr, status) {
                if (status === 'timeout') {
                    window.alert_toast('End status could not be confirmed because the request timed out. Refresh Membership Validity and check the membership status before trying again.', 'danger');
                    return;
                }
                // Shared AJAX handling displays permission errors and redirects expired sessions.
                if (xhr.status === 401 || xhr.status === 403) return;
                const message = xhr.status === 409
                    ? 'Membership is already ended or no longer exists. Refresh the page.'
                    : 'Unable to end membership. Please try again.';
                window.alert_toast(message, 'danger');
            },
            complete: function () {
                submitting = false;
                $('#confirm_modal #confirm').prop('disabled', false);
                window.end_load();
            }
        });
    };
})(jQuery);
