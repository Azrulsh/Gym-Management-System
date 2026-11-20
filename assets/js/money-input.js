(function () {
    'use strict';

    function cents(value, fallback) {
        if (typeof value !== 'string' || !/^\d{1,10}(?:\.\d{1,2})?$/.test(value)) return fallback;
        const parts = value.split('.');
        return Number(parts[0]) * 100 + Number((parts[1] || '').padEnd(2, '0'));
    }

    function adjust(input, direction) {
        if (!input || input.disabled || input.readOnly || ![1, -1].includes(direction)) return;
        // Do not silently round invalid manually entered prices.
        if (input.validity.badInput || (input.value !== '' && !/^\d{1,10}(?:\.\d{1,2})?$/.test(input.value))) {
            input.reportValidity();
            return;
        }
        const minimum = cents(input.min, 0);
        const maximum = cents(input.max, 999999999999);
        if (minimum > maximum) { input.reportValidity(); return; }
        const next = Math.max(minimum, Math.min(maximum, cents(input.value, 0) + direction * 100));
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
