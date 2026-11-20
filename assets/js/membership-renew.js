(function ($) {
    'use strict';

    $(document).on('click', '.renew-membership', function () {
        const button = this;
        if (button.dataset.submitting === 'true') return;
        const rid = $(button).attr('data-registration-id');
        const token = $(button).attr('data-csrf-token');
        const message = $('#uni_modal .renewal-message');
        let newId = null;
        if (!/^[1-9][0-9]*$/.test(rid || '') || !token) return;
        button.dataset.submitting = 'true';
        $(button).prop('disabled', true);
        message.removeClass('alert alert-danger').empty();
        window.start_load();
        $.ajax({
            url: 'ajax.php?action=renew_membership',
            method: 'POST',
            timeout: 15000,
            data: { rid: rid, csrf_token: token },
            success: function (response) {
                const value = String(response).trim();
                const id = Number(value);
                if (!/^[1-9][0-9]*$/.test(value) || !Number.isSafeInteger(id) || id > 2147483647) {
                    message.addClass('alert alert-danger').text('Unable to renew membership. Please try again.');
                    return;
                }
                newId = id;
            },
            error: function (xhr, status) {
                if (status === 'timeout') {
                    message.addClass('alert alert-danger').text('Renewal status could not be confirmed because the request timed out. Refresh Membership Validity and check for the renewed membership before trying again.');
                    return;
                }
                const error = xhr.responseJSON && xhr.responseJSON.error;
                message.addClass('alert alert-danger').text(typeof error === 'string' ? error : 'Unable to renew membership. Please try again.');
            },
            complete: function () {
                window.end_load();
                if (newId !== null) {
                    // The shared modal survives detail/payment content replacements.
                    // Refresh only after it closes so the new agreement can be reviewed first.
                    $('#uni_modal').off('hidden.bs.modal.membershipRenew')
                        .one('hidden.bs.modal.membershipRenew', function () {
                            window.location.reload();
                        });
                    window.alert_toast('Membership successfully renewed.', 'success');
                    window.uni_modal('Member Plan Details', 'view_pdetails.php?id=' + newId, '');
                } else {
                    button.dataset.submitting = 'false';
                    $(button).prop('disabled', false);
                }
            }
        });
    });
})(jQuery);
