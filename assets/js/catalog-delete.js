(function ($) {
    'use strict';

    let pending = null;
    let submitting = false;
    const kinds = ['plan', 'package', 'trainer', 'member'];

    kinds.forEach(function (kind) {
        $(document).on('click', '.delete_' + kind, function () {
            const id = Number($(this).attr('data-id'));
            const token = $(this).attr('data-csrf-token');
            if (submitting || !Number.isSafeInteger(id) || id < 1 || id > 2147483647 || !token) return;
            pending = { kind: kind, id: id, token: token };
            $('#confirm_modal #confirm').prop('disabled', false);
            const explanation = kind === 'member'
                ? 'Members with membership history or schedule records cannot be deleted.'
                : 'Records used by membership history cannot be deleted.';
            window._conf('Delete this ' + kind + '? ' + explanation, 'delete_' + kind, [id]);
            $('#confirm_modal .modal-body').append('<div class="catalog-delete-message" role="alert" aria-live="polite"></div>');
        });

        // The existing confirmation modal calls these named functions.
        window['delete_' + kind] = function (id) {
            if (submitting || !pending || pending.kind !== kind || pending.id !== id) return;
            const request = pending;
            const message = $('#confirm_modal .catalog-delete-message');
            let deleted = false;
            function showError(text) {
                message.addClass('alert alert-danger mt-3').text(text);
            }
            submitting = true;
            message.removeClass('alert alert-danger mt-3').empty();
            $('#confirm_modal #confirm').prop('disabled', true);
            window.start_load();
            $.ajax({
                url: 'ajax.php?action=delete_' + kind,
                method: 'POST',
                timeout: 15000,
                data: { id: id, csrf_token: request.token },
                success: function (response) {
                    if (String(response).trim() !== '1') {
                        showError('Unable to delete ' + kind + '. Please try again.');
                        return;
                    }
                    deleted = true;
                    pending = null;
                    $('#confirm_modal').modal('hide');
                    window.alert_toast('Record successfully deleted.', 'success');
                    window.setTimeout(function () { window.location.reload(); }, 750);
                },
                error: function (xhr, status) {
                    if (status === 'timeout') {
                        showError('Delete status could not be confirmed because the request timed out. Refresh the list and check whether the record still exists before trying again.');
                        return;
                    }
                    const error = xhr.responseJSON && xhr.responseJSON.error;
                    showError(typeof error === 'string' ? error : 'Unable to delete ' + kind + '. Please try again.');
                },
                complete: function () {
                    submitting = false;
                    $('#confirm_modal #confirm').prop('disabled', false);
                    window.end_load();
                    if (deleted) pending = null;
                }
            });
        };
    });
})(jQuery);
