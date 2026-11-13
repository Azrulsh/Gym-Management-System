(function ($) {
    'use strict';

    function clearMessage(form) {
        $(form).find('.trainer-message').removeClass('alert alert-danger').empty();
    }

    function setMode(form, editing) {
        $(form).find('.trainer-form-title').text(editing ? 'Edit Trainer' : 'Add Trainer');
        $(form).find('button[type="submit"]').text(editing ? 'Update' : 'Create');
        $(form).find('.reset-trainer').text(editing ? 'Cancel Edit' : 'Clear');
        $(form).find('.trainer-mode-help').text(editing
            ? 'Update this trainer, or cancel to create a new trainer.'
            : 'Fill in the form to create a new trainer.');
    }

    $(document).on('click', '.edit_trainer', function () {
        const form = $('#manage-trainer').get(0);
        if (!form || form.dataset.submitting === 'true') return;
        form.reset();
        for (const name of ['id', 'name', 'email', 'contact', 'rate']) {
            $(form).find('[name="' + name + '"]').val($(this).attr('data-' + name));
        }
        setMode(form, true);
        clearMessage(form);
        $(form).find('[name="name"]').trigger('focus');
    });

    $(document).on('click', '.reset-trainer', function () {
        const form = $('#manage-trainer').get(0);
        if (!form || form.dataset.submitting === 'true') return;
        form.reset();
        $(form).find('[name="id"]').val('');
        setMode(form, false);
        clearMessage(form);
    });

    $(document).on('submit', '#manage-trainer', function (event) {
        event.preventDefault();
        const form = this;
        if (form.dataset.submitting === 'true' || !form.reportValidity()) return;
        const message = $(form).find('.trainer-message');
        const buttons = $('#manage-trainer button, .edit_trainer');
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
            data: $(form).serialize(),
            success: function (response) {
                if (String(response).trim() !== '1') {
                    showError('Unable to save trainer. Please try again.');
                    return;
                }
                saved = true;
                window.alert_toast('Trainer successfully saved.', 'success');
                window.setTimeout(function () { window.location.reload(); }, 750);
            },
            error: function (xhr) {
                const error = xhr.responseJSON && xhr.responseJSON.error;
                showError(typeof error === 'string' ? error : 'Unable to save trainer. Please try again.');
            },
            complete: function () {
                if (!saved) form.dataset.submitting = 'false';
                buttons.prop('disabled', false);
                window.end_load();
            }
        });
    });
})(jQuery);
