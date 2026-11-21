(function ($) {
    'use strict';
    const root = document.getElementById('attendance-module');
    if (!root) return;
    const message = root.querySelector('[data-attendance-message]');
    const lookup = root.querySelector('#attendance-lookup');
    const details = root.querySelector('#details');
    const recordForm = root.querySelector('#manage-records');
    let busy = false;
    function error(text) {
        message.className = 'alert alert-danger';
        message.textContent = text;
    }
    function hidePerson() { if (details) details.classList.add('d-none'); }
    if (lookup) lookup.querySelector('[name="tracking_id"]').addEventListener('input', hidePerson);
    function renderPerson(response) {
        const member = response && response.member;
        const eligibility = response && response.eligibility;
        const open = response && response.open_visit;
        if (!member || !Number.isSafeInteger(Number(member.id)) || Number(member.id) < 1 || typeof member.name !== 'string'
            || !eligibility || typeof eligibility.allowed !== 'boolean' || typeof eligibility.label !== 'string' || typeof eligibility.reason !== 'string'
            || !/^attendance_avatar\.php\?id=[1-9][0-9]*$/.test(response.avatar_url)
            || (open !== null && (!open || !Number.isSafeInteger(open.id) || !Number.isSafeInteger(open.version) || typeof open.checked_in_at !== 'string'))) {
            throw new Error('Unexpected lookup response. Search for the member again.');
        }
        root.querySelector('#name').textContent = member.name;
        root.querySelector('[data-attendance-number]').textContent = 'Member ' + member.member_id;
        root.querySelector('[data-attendance-state]').textContent = 'Membership: ' + eligibility.label;
        root.querySelector('[data-attendance-explanation]').textContent = open ? 'Inside since ' + open.checked_in_at + '. Check-out remains available if membership has expired.' : eligibility.reason;
        root.querySelector('[data-attendance-avatar]').src = response.avatar_url;
        recordForm.querySelector('[name="person_id"]').value = member.id;
        recordForm.querySelector('[name="visit_id"]').value = open ? open.id : '';
        recordForm.querySelector('[name="version"]').value = open ? open.version : '';
        const confirmation = recordForm.querySelector('[name="identity_confirmed"]');
        confirmation.checked = false; confirmation.required = !open && eligibility.allowed;
        root.querySelector('[data-attendance-verification]').classList.toggle('d-none', !!open || !eligibility.allowed);
        recordForm.action = 'ajax.php?action=' + (open ? 'attendance_checkout' : 'attendance_checkin');
        const button = root.querySelector('[data-attendance-submit]');
        button.textContent = open ? 'Check Out' : 'Check In';
        button.disabled = !open && !eligibility.allowed;
        details.classList.remove('d-none');
    }
    root.addEventListener('submit', function (event) {
        const form = event.target;
        const isLookup = form === lookup;
        if (!isLookup && !form.matches('[data-attendance-form]')) return;
        event.preventDefault();
        if (busy || !form.reportValidity()) return;
        if (form.dataset.confirm && !window.confirm(form.dataset.confirm)) return;
        if (isLookup) hidePerson();
        const data = new FormData(form);
        const controls = Array.from(root.querySelectorAll('input, select, textarea, button'));
        const disabled = controls.map(control => control.disabled);
        controls.forEach(control => { control.disabled = true; });
        busy = true;
        message.className = ''; message.textContent = '';
        let reload = false, person = null;
        $.ajax({
            url: form.getAttribute('action'), method: 'POST', data, processData: false, contentType: false, dataType: 'json', timeout: 15000,
            success(response) {
                if (isLookup) person = response;
                else if (response && response.saved === true) reload = true;
                else error('Unexpected response. Reload to check whether the visit was saved before trying again.');
            },
            error(xhr) {
                if (xhr.status === 401 || xhr.status === 403) error('Your session or access changed. Sign in again.');
                else error(xhr.responseJSON && typeof xhr.responseJSON.error === 'string' ? xhr.responseJSON.error
                    : 'Unable to confirm Attendance. Reload to check the current state before trying again.');
            },
            complete() {
                controls.forEach((control, index) => { control.disabled = disabled[index]; });
                busy = false;
                if (person) { try { renderPerson(person); } catch (exception) { hidePerson(); error(exception.message); } }
                else if (isLookup && !message.textContent) error('Unexpected lookup response. Search again.');
                if (reload) window.location.reload();
            }
        });
    });
})(jQuery);
