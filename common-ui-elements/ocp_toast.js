// common-ui-elements/ocp_toast.js
// Version: 1.1
// Handles displaying toast notifications.

'use strict';

/**
 * Displays a toast notification.
 *
 * @param {string} message - The message to display in the toast.
 * @param {string} type - The type of toast ('success', 'error', 'info').
 * @param {number|Object} options - Duration in ms or options object { duration, actionLabel, onAction }.
 */
function showToast(message, type = 'info', options = 3000) {
    const normalized = typeof options === 'number' ? { duration: options } : (options || {});
    const duration = Number.isFinite(normalized.duration) ? normalized.duration : 3000;

    // Ensure the toast container exists, creating it if necessary.
    let toastContainer = document.getElementById('toastContainer');
    if (!toastContainer) {
        toastContainer = document.createElement('div');
        toastContainer.id = 'toastContainer';
        toastContainer.className = 'toast-container';
        document.body.appendChild(toastContainer);
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

    const content = document.createElement('span');
    content.className = 'toast-message';
    content.textContent = message;
    toast.appendChild(content);

    if (normalized.actionLabel && typeof normalized.onAction === 'function') {
        const actionButton = document.createElement('button');
        actionButton.type = 'button';
        actionButton.className = 'toast-action';
        actionButton.textContent = normalized.actionLabel;
        actionButton.addEventListener('click', async (event) => {
            event.stopPropagation();
            try {
                await normalized.onAction();
            } catch (error) {
                console.error('[toast] Action handler failed', error);
            } finally {
                hideToast();
            }
        });
        toast.appendChild(actionButton);
    }

    toastContainer.appendChild(toast);

    // Trigger reflow to enable CSS transition
    void toast.offsetWidth;

    toast.classList.add('show');

    const hideToast = () => {
        toast.classList.remove('show');
        // Remove the toast from DOM after transition
        toast.addEventListener('transitionend', () => {
            toast.remove();
        }, { once: true });
    };

    // Remove toast after specified duration
    setTimeout(hideToast, duration);
}
