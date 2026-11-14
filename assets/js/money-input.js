(function () {
    'use strict';

    function adjust(input, direction) {
        if (!input || input.disabled || input.readOnly) return;
        // Do not silently round invalid manually entered prices.
        if (input.validity.badInput || (input.value !== '' && !/^\d{1,10}(?:\.\d{1,2})?$/.test(input.value))) {
            input.reportValidity();
            return;
        }
        const parts = (input.value || '0').split('.');
        const cents = Number(parts[0]) * 100 + Number((parts[1] || '').padEnd(2, '0'));
        const next = Math.max(0, Math.min(999999999999, cents + direction * 100));
        input.value = Math.floor(next / 100) + '.' + String(next % 100).padStart(2, '0');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    document.addEventListener('click', function (event) {
        const button = event.target.closest('.money-arrow');
        if (!button || button.disabled) return;
        const group = button.closest('.money-input');
        if (!group) return;
        event.preventDefault();
        adjust(group.querySelector('input'), Number(button.dataset.direction));
    });

    document.addEventListener('keydown', function (event) {
        const input = event.target;
        if (!input.matches('.money-input input[type="number"]') || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
        event.preventDefault();
        adjust(input, event.key === 'ArrowUp' ? 1 : -1);
    });
})();
