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
            timeout: 15000,
            data: $(form).serialize(),
            success: function (response) {
                const result = String(response).trim();
                if (result === '1' || result === '4') {
                    loggedIn = true;
                    window.location.assign(result === '4' ? 'member_portal.php' : 'index.php?page=home');
                } else if (result === '2' || result === '3') {
                    showError('Username or password is incorrect.');
                } else {
                    showError('Unable to log in right now. Please try again.');
                }
            },
            error: function (xhr, status) {
                if (xhr.status === 419) {
                    showError('Login form has expired. Refresh the page and try again.');
                    return;
                }
                if (status === 'timeout') {
                    showError('Login status could not be confirmed because the request timed out. Refresh the page to check whether you are signed in before trying again.');
                    return;
                }
                if (xhr.status === 429) {
                    const seconds = Number(xhr.responseJSON && xhr.responseJSON.retry_after);
                    showError(Number.isInteger(seconds) && seconds > 0 && seconds <= 900
                        ? 'Too many login attempts. Retry in ' + Math.ceil(seconds / 60) + ' min.'
                        : 'Too many login attempts. Please try again later.');
                    return;
                }
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
