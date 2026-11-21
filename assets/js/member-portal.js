(function () {
    'use strict';
    const root = document.getElementById('member-portal');
    if (!root) return;
    const message = root.querySelector('[data-portal-message]');
    const activation = root.querySelector('[name="token"]');
    if (activation) {
        activation.value = new URLSearchParams(window.location.hash.slice(1)).get('token') || '';
        window.history.replaceState(null, '', window.location.pathname);
    }
    let busy = false;
    root.addEventListener('submit', async function (event) {
        const form = event.target;
        if (!form.matches('[data-portal-form]')) return;
        event.preventDefault();
        if (busy || !form.reportValidity()) return;
        if (form.dataset.confirm && !window.confirm(form.dataset.confirm)) return;
        const body = new FormData(form);
        const controls = Array.from(root.querySelectorAll('input, button, select, textarea'));
        const disabled = controls.map(control => control.disabled);
        controls.forEach(control => { control.disabled = true; });
        busy = true;
        message.className = 'alert alert-info';
        message.textContent = 'Saving…';
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15000);
        let destination = null;
        try {
            const response = await fetch(form.getAttribute('action'), {
                method: 'POST', body, signal: controller.signal, credentials: 'same-origin',
                headers: {'X-Requested-With': 'XMLHttpRequest'}
            });
            const result = await response.json();
            if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : 'Unable to save this change.');
            if (result.saved !== true) throw new Error('Unexpected response. Reload to check whether the change was saved.');
            if (typeof result.activation_path === 'string' && /^activate_member\.php#token=[a-f0-9]{64}$/.test(result.activation_path)) {
                message.className = 'alert alert-success';
                message.textContent = result.message + ' ';
                const link = document.createElement('input');
                link.type = 'text'; link.readOnly = true;
                link.className = 'form-control mt-2';
                link.setAttribute('aria-label', 'Private activation or recovery link');
                link.value = new URL(result.activation_path, window.location.href).href;
                link.addEventListener('click', () => link.select());
                message.appendChild(link);
            } else if (result.redirect === 'login.php') destination = 'login.php';
            else destination = window.location.href;
        } catch (error) {
            message.className = 'alert alert-danger';
            message.textContent = error.name === 'AbortError' || error instanceof TypeError || error instanceof SyntaxError
                ? 'Connection interrupted or response unavailable. Reload to check whether the change was saved before trying again.'
                : error.message;
            message.scrollIntoView({block: 'nearest'});
        } finally {
            clearTimeout(timer);
            controls.forEach((control, index) => { control.disabled = disabled[index]; });
            busy = false;
        }
        if (destination) window.location.assign(destination);
    });
})();
