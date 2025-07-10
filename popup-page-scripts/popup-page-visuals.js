// popup-page-visuals.js
// Version: 1.1
// Visual functions for Max Extension configuration interface

'use strict';

// -------------------------
// Toast Notification Function
// -------------------------
const toastContainer = document.getElementById('toastContainer');

/**
 * Displays a toast notification.
 *
 * @param {string} message - The message to display in the toast.
 * @param {string} type - The type of toast ('success', 'error', 'info').
 * @param {number} duration - Duration in milliseconds before the toast disappears. Defaults to 3000ms.
 */
function showToast(message, type = 'info', duration = 3000) {
    const toast = document.createElement('div');
    toast.classList.add('toast', type);
    toast.textContent = message;

    toastContainer.appendChild(toast);

    // Trigger reflow to enable CSS transition
    void toast.offsetWidth;

    toast.classList.add('show');

    // Remove toast after specified duration
    setTimeout(() => {
        toast.classList.remove('show');
        // Remove the toast from DOM after transition
        toast.addEventListener('transitionend', () => {
            toast.remove();
        });
    }, duration);
}


/**
 * Creates a ripple effect at the mouse cursor's position.
 * This is used to provide visual feedback on actions like adding a button.
 *
 * @param {MouseEvent} event - The mouse event that triggered the effect.
 */
function showMouseEffect(event) {
    // Ensure event is provided
    if (!event) return;

    const effect = document.createElement('div');
    effect.className = 'mouse-effect';
    document.body.appendChild(effect);

    // Position at mouse coordinates. Use clientX/Y for viewport-relative position.
    effect.style.left = `${event.clientX}px`;
    effect.style.top = `${event.clientY}px`;

    // Remove the element after the animation finishes to keep the DOM clean.
    effect.addEventListener('animationend', () => {
        effect.remove();
    });
}
