(function ($) {
    'use strict';
    let pending = null;
    let busy = false;
    $(document).on('click', '.delete_user', function () {
        if (busy) return;
        const id = Number($(this).attr('data-id'));
        const token = $(this).attr('data-csrf-token');
        if (!Number.isSafeInteger(id) || id < 1 || id > 2147483647 || !token) return;
        pending = { id: id, token: token, self: $(this).attr('data-self') === '1' };
        window._conf(pending.self ? 'Delete your account? You will be signed out. Another Admin must remain.' : 'Delete this user? The last Admin cannot be deleted.', 'delete_user', [id]);
        if (pending.self) $('#confirm_modal .modal-body').append('<label for="delete-user-password">Confirm your current password</label><input type="password" id="delete-user-password" class="form-control" autocomplete="current-password" maxlength="4096">');
        $('#confirm_modal .modal-body').append('<div class="user-delete-message" role="alert" aria-live="polite"></div>');
        $('#confirm_modal #confirm').prop('disabled', false);
    });
    window.delete_user = function (id) {
        if (busy || !pending || pending.id !== id) return;
        const request = pending;
        const message = $('#confirm_modal .user-delete-message');
        const password = request.self ? $('#delete-user-password').val() : '';
        message.removeClass('alert alert-danger mt-3').empty();
        if (request.self && !password) {
            message.addClass('alert alert-danger mt-3').text('Enter your current password to delete your account.');
            return;
        }
        busy = true;
        $('#confirm_modal #confirm').prop('disabled', true);
        window.start_load();
        $.ajax({
            url: 'ajax.php?action=delete_user', method: 'POST',
            timeout: 15000,
            data: { id: id, csrf_token: request.token, password: password },
            success: function (response) {
                if (response && response.deleted === true && response.self_deleted === true) {
                    pending = null;
                    window.location.replace('login.php');
                } else if (String(response).trim() === '1') {
                    pending = null;
                    $('#confirm_modal').modal('hide');
                    window.alert_toast('User successfully deleted.', 'success');
                    window.setTimeout(function () { window.location.reload(); }, 750);
                } else message.addClass('alert alert-danger mt-3').text('Unable to delete user. Please try again.');
            },
            error: function (xhr, status) {
                if (status === 'timeout') {
                    message.addClass('alert alert-danger').text('Delete status could not be confirmed because the request timed out. Refresh Users and check whether the account still exists before trying again. If deleting your own account, refresh the page to check your sign-in status.');
                    return;
                }
                const error = xhr.responseJSON && xhr.responseJSON.error;
                message.addClass('alert alert-danger mt-3').text(typeof error === 'string' ? error : 'Unable to delete user. Please try again.');
            },
            complete: function () {
                busy = false;
                $('#delete-user-password').val('');
                $('#confirm_modal #confirm').prop('disabled', false);
                window.end_load();
            }
        });
    };
})(jQuery);
