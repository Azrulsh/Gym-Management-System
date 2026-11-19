(function ($) {
    'use strict';

    function clearMessage(form) {
        $(form).find('.plan-message').removeClass('alert alert-danger').empty();
    }

    function setMode(form, editing) {
        $(form).find('.plan-form-title').text(editing ? 'Edit Plan' : 'Add Plan');
        $(form).find('button[type="submit"]').text(editing ? 'Update' : 'Create');
        $(form).find('.reset-plan').text(editing ? 'Cancel Edit' : 'Clear');
        $(form).find('.plan-mode-help').text(editing
            ? 'Update this plan, or cancel to create a new plan.'
            : 'Fill in the form to create a new plan.');
    }

    $(document).on('click', '.edit_plan', function () {
        const form = $('#manage-plan').get(0);
        if (!form || form.dataset.submitting === 'true') return;
        form.reset();
        for (const name of ['id', 'plan', 'amount', 'version']) {
            $(form).find('[name="' + name + '"]').val($(this).attr('data-' + name));
        }
        setMode(form, true);
        clearMessage(form);
        $(form).find('[name="plan"]').trigger('focus');
    });

    $(document).on('click', '.reset-plan', function () {
        const form = $('#manage-plan').get(0);
        if (!form || form.dataset.submitting === 'true') return;
        form.reset();
        $(form).find('[name="id"]').val('');
        $(form).find('[name="version"]').val('');
        setMode(form, false);
        clearMessage(form);
    });

    $(document).on('submit', '#manage-plan', function (event) {
        event.preventDefault();
        const form = this;
        if (form.dataset.submitting === 'true' || !form.reportValidity()) return;
        const message = $(form).find('.plan-message');
        const buttons = $('#manage-plan button, .edit_plan');
        let saved = false;
        function showError(text) {
            message.addClass('alert alert-danger').text(text);
        }
        form.dataset.submitting = 'true';
        clearMessage(form);
        buttons.prop('disabled', true);
        window.start_load();
        $.ajax({
            url: $(form).attr('action'),
            method: 'POST',
            timeout: 15000,
            data: $(form).serialize(),
            success: function (response) {
                if (String(response).trim() !== '1') {
                    showError('Unable to save plan. Please try again.');
                    return;
                }
                saved = true;
                window.alert_toast('Plan successfully saved.', 'success');
                window.setTimeout(function () { window.location.reload(); }, 750);
            },
            error: function (xhr, status) {
                if (status === 'timeout') {
                    showError('Save status could not be confirmed because the request timed out. Refresh Plans and check the record before trying again.');
                    return;
                }
                const error = xhr.responseJSON && xhr.responseJSON.error;
                showError(typeof error === 'string' ? error : 'Unable to save plan. Please try again.');
            },
            complete: function () {
                if (!saved) form.dataset.submitting = 'false';
                buttons.prop('disabled', false);
                window.end_load();
            }
        });
    });
})(jQuery);
