(function ($) {
    'use strict';

    $(document).on('submit', '#login-form', function (event) {
        event.preventDefault();
        const form = this;
        if (form.dataset.submitting === 'true' || !form.reportValidity()) return;

        const message = $(form).find('.login-message');
        const button = $(form).find('button[type="submit"]');
        let loggedIn = false;
        function showError(text) {
            message.addClass('alert alert-danger').text(text);
        }

        form.dataset.submitting = 'true';
        message.removeClass('alert alert-danger').empty();
        button.prop('disabled', true).text('Logging in...');
        $.ajax({
            url: 'ajax.php?action=login',
            method: 'POST',
            data: $(form).serialize(),
            success: function (response) {
                const result = String(response).trim();
                if (result === '1') {
                    loggedIn = true;
                    window.location.assign('index.php?page=home');
                } else if (result === '2' || result === '3') {
                    showError('Username or password is incorrect.');
                } else {
                    showError('Unable to log in right now. Please try again.');
                }
            },
            error: function (xhr) {
                showError(xhr.status === 400
                    ? 'Enter a valid username and password.'
                    : 'Unable to log in right now. Please try again.');
            },
            complete: function () {
                if (!loggedIn) {
                    form.dataset.submitting = 'false';
                    button.prop('disabled', false).text('Login');
                }
            }
        });
    });
})(jQuery);
