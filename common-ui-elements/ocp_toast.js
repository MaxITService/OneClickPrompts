// common-ui-elements/ocp_toast.js
// Version: 1.0
// Handles displaying toast notifications.

'use strict';

// This script assumes an element with id="toastContainer" exists in the DOM.
const toastContainer = document.getElementById('toastContainer');

/**
 * Displays a toast notification.
 *
 * @param {string} message - The message to display in the toast.
 * @param {string} type - The type of toast ('success', 'error', 'info').
 * @param {number} duration - Duration in milliseconds before the toast disappears. Defaults to 3000ms.
 */
function showToast(message, type = 'info', duration = 3000) {
    if (!toastContainer) {
        console.error('Toast container not found. Please add <div id="toastContainer" class="toast-container"></div> to your HTML.');
        return;
    }

    const toast = document.createElement('div');
    toast.classList.add('toast');

    // Map types to specific classes
    const typeClassMap = {
        success: 'toast-success',
        error: 'toast-error',
        info: 'toast-info'
    };

    if (type && typeClassMap[type]) {
        toast.classList.add(typeClassMap[type]);
    }

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