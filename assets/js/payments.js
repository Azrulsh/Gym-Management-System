(function ($) {
    'use strict';

    // Loaded once by the page shell; payment forms are replaced inside the modal.
    $(document).on('submit', '#manage_payment', function (event) {
        event.preventDefault();
        const form = this;
        if (form.dataset.submitting === 'true' || !form.reportValidity()) return;
        const message = $(form).find('.payment-message');
        const button = $(form).find('button[type="submit"]');
        const registrationId = $(form).find('[name="registration_id"]').val();
        let saved = false;
        function showError(text) {
            message.addClass('alert alert-danger').text(text);
        }
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
                    showError('Unable to save payment. Please try again.');
                    return;
                }
                saved = true;
            },
            error: function (xhr) {
                const error = xhr.responseJSON && xhr.responseJSON.error;
                showError(typeof error === 'string' ? error : 'Payment status could not be confirmed. Retry this form with the same details; check history before starting a new payment.');
            },
            complete: function () {
                if (!saved) form.dataset.submitting = 'false';
                button.prop('disabled', false);
                window.end_load();
                if (saved) {
                    window.alert_toast('Payment successfully saved.', 'success');
                    window.uni_modal('Payments', 'payment.php?rid=' + encodeURIComponent(registrationId), 'large');
                }
            }
        });
    });
})(jQuery);
