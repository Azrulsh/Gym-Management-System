(function ($) {
    'use strict';

    $(document).on('submit', '#manage-schedule', function (event) {
        event.preventDefault();
        const form = this;
        if (form.dataset.submitting === 'true') return;
        const message = $(form).find('.schedule-message');
        message.removeClass('alert alert-danger').empty();
        const fields = form.elements;
        let error = '';
        if (!fields['dow[]'].selectedOptions.length) error = 'Choose at least one schedule day.';
        else if (fields.date_to.value < fields.date_from.value) error = 'Month To must be the same as or after Month From.';
        else {
            const start = fields.time_from.value;
            const end = fields.time_to.value;
            if (start && end && (end.length === 5 ? end + ':00' : end) <= (start.length === 5 ? start + ':00' : start)) {
                error = 'Time To must be after Time From on the same day.';
            }
        }
        if (error) {
            message.addClass('alert alert-danger').text(error);
            return;
        }
        if (!form.reportValidity()) return;
        const button = $('#uni_modal #submit');
        let saved = false;
        form.dataset.submitting = 'true';
        button.prop('disabled', true);
        window.start_load();
        $.ajax({
            url: $(form).attr('action'),
            method: 'POST',
            data: $(form).serialize(),
            success: function (response) {
                if (String(response).trim() !== '1') {
                    message.addClass('alert alert-danger').text('Unable to save schedule. Please try again.');
                    return;
                }
                saved = true;
                window.alert_toast('Schedule successfully saved.', 'success');
                window.setTimeout(function () { window.location.reload(); }, 750);
            },
            error: function (xhr) {
                const error = xhr.responseJSON && xhr.responseJSON.error;
                message.addClass('alert alert-danger').text(typeof error === 'string' ? error : 'Unable to save schedule. Please try again.');
            },
            complete: function () {
                if (!saved) form.dataset.submitting = 'false';
                button.prop('disabled', false);
                window.end_load();
            }
        });
    });
})(jQuery);
