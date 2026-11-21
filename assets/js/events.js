(function ($) {
    'use strict';
    const root = document.getElementById('events-module');
    if (!root) return;
    const message = root.querySelector('.events-message');
    let busy = false;
    function showError(text) {
        message.className = 'events-message alert alert-danger';
        message.textContent = text;
        message.scrollIntoView({block: 'nearest'});
    }
    const table = root.querySelector('#events-table');
    if (table && $.fn.DataTable) {
        const listing = $(table).DataTable({order: [[1, 'desc']], columnDefs: [{targets: 5, orderable: false, searchable: false}]});
        root.querySelector('#event-filter').addEventListener('change', function () {
            listing.column(3).search(this.value ? '^' + this.value + '$' : '', true, false).draw();
        });
    }
    const participants = root.querySelector('#event-participants');
    if (participants && $.fn.DataTable) $(participants).DataTable({columnDefs: [{targets: 3, orderable: false, searchable: false}]});

    // Delegation keeps controls working after DataTables pagination/search redraws rows.
    root.addEventListener('submit', function (event) {
        const form = event.target;
        if (!form.matches('.event-action-form')) return;
        event.preventDefault();
        if (busy || !form.reportValidity()) return;
        const status = form.querySelector('[name="status"]');
        const confirmText = form.dataset.confirm || (status && status.value === 'cancelled' ? 'Cancel this event? Participant history will be retained. Notify participants separately.' : '');
        if (confirmText && !window.confirm(confirmText)) return;
        const member = form.querySelector('[name="member_id"]');
        if (member && member.tagName === 'SELECT') {
            form.querySelector('[name="participant_version"]').value = member.selectedOptions[0].dataset.version || '';
        }
        const body = new FormData(form);
        const controls = Array.from(root.querySelectorAll('button, input, textarea, select'));
        const disabled = controls.map(control => control.disabled);
        controls.forEach(control => { control.disabled = true; });
        busy = true;
        message.className = 'events-message'; message.textContent = '';
        let destination = null;
        if (typeof window.start_load === 'function') window.start_load();
        $.ajax({
            url: form.getAttribute('action'), method: 'POST', data: body,
            processData: false, contentType: false, dataType: 'json', timeout: 15000,
            success: function (response) {
                if (response && response.deleted === true) destination = 'index.php?page=events';
                else if (response && response.saved === true && Number.isSafeInteger(response.id) && response.id > 0) destination = 'index.php?page=view_event&id=' + response.id;
                else showError('Unexpected response. Reload to check whether the change was saved before trying again.');
            },
            error: function (xhr, statusText) {
                if (xhr.status === 401 || xhr.status === 403) {
                    showError('Your session or access changed. Sign in again before continuing.');
                } else if (xhr.responseJSON && typeof xhr.responseJSON.error === 'string') showError(xhr.responseJSON.error);
                else showError(statusText === 'timeout' || xhr.status === 0
                    ? 'Connection interrupted. Reload to check whether the change was saved before trying again.'
                    : 'Unable to save. Reload to check the current state before trying again.');
            },
            complete: function () {
                controls.forEach((control, index) => { control.disabled = disabled[index]; });
                busy = false;
                if (typeof window.end_load === 'function') window.end_load();
                if (destination) window.location.assign(destination);
            }
        });
    });
})(jQuery);
