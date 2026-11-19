(function ($) {
    'use strict';

    $(document).on('submit', '#manage-schedule', function (event) {
        event.preventDefault();
        const form = this;
        if (form.dataset.submitting === 'true' || form.dataset.deleting === 'true') return;
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
            timeout: 15000,
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
            error: function (xhr, status) {
                if (status === 'timeout') {
                    message.addClass('alert alert-danger').text('Save status could not be confirmed because the request timed out. Refresh the calendar and check the schedule before trying again.');
                    return;
                }
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

    $(document).on('click', '.request-schedule-delete, .cancel-schedule-delete', function () {
        const form = $(this).closest('form')[0];
        if (form.dataset.submitting === 'true' || form.dataset.deleting === 'true') return;
        $(form).find('.schedule-delete-confirm').toggleClass('d-none', $(this).hasClass('cancel-schedule-delete'));
    });

    $(document).on('click', '.confirm-schedule-delete', function () {
        const control = this;
        const form = $(control).closest('form')[0];
        const id = Number($(control).attr('data-id'));
        const token = $(control).attr('data-csrf-token');
        if (form.dataset.submitting === 'true' || form.dataset.deleting === 'true'
            || !Number.isSafeInteger(id) || id < 1 || id > 2147483647 || !token) return;
        const message = $(form).find('.schedule-message');
        const buttons = $(form).find('button');
        let deleted = false;
        form.dataset.deleting = 'true';
        message.removeClass('alert alert-danger').empty();
        buttons.prop('disabled', true);
        $('#uni_modal #submit').prop('disabled', true);
        window.start_load();
        $.ajax({
            url: 'ajax.php?action=delete_schedule', method: 'POST',
            timeout: 15000,
            data: { id: id, csrf_token: token },
            success: function (response) {
                if (String(response).trim() !== '1') {
                    message.addClass('alert alert-danger').text('Unable to delete schedule. Please try again.');
                    return;
                }
                deleted = true;
                window.alert_toast('Schedule successfully deleted.', 'success');
                window.setTimeout(function () { window.location.reload(); }, 750);
            },
            error: function (xhr, status) {
                if (status === 'timeout') {
                    message.addClass('alert alert-danger').text('Delete status could not be confirmed because the request timed out. Refresh the calendar and check whether the schedule still exists before trying again.');
                    return;
                }
                const error = xhr.responseJSON && xhr.responseJSON.error;
                message.addClass('alert alert-danger').text(typeof error === 'string' ? error : 'Unable to delete schedule. Please try again.');
            },
            complete: function () {
                if (!deleted) form.dataset.deleting = 'false';
                buttons.prop('disabled', false);
                $('#uni_modal #submit').prop('disabled', false);
                window.end_load();
            }
        });
    });
})(jQuery);
