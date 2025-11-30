// common-ui-elements/ocp_toast.js
// Version: 1.2
// Handles displaying toast notifications.

'use strict';

/**
 * Displays a toast notification.
 *
 * @param {string} message - The message to display in the toast.
 * @param {string} type - The type of toast ('success', 'error', 'info').
 * @param {number|Object} options - Duration in ms or options object { duration, actionLabel, onAction, tooltip, actionTooltip, customButtons, onDismiss }.
 */
function showToast(message, type = 'info', options = 3000) {
    const normalized = typeof options === 'number' ? { duration: options } : (options || {});
    const rawDuration = Number.isFinite(normalized.duration) ? normalized.duration : 3000;
    // If duration is 0, it means infinite (no auto-hide). Otherwise clamp between 1.5s and 30s.
    const duration = rawDuration === 0 ? 0 : Math.min(Math.max(rawDuration, 1500), 30000);

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

    if (normalized.tooltip) {
        toast.title = normalized.tooltip;
    }

    const content = document.createElement('span');
    content.className = 'toast-message';
    content.textContent = message;
    toast.appendChild(content);

    if (normalized.customButtons && Array.isArray(normalized.customButtons)) {
        const buttonGroup = document.createElement('div');
        buttonGroup.className = 'toast-button-group';

        normalized.customButtons.forEach(btnConfig => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'toast-action ' + (btnConfig.className || '');
            btn.textContent = btnConfig.text;
            if (btnConfig.title) btn.title = btnConfig.title;

            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                if (typeof btnConfig.onClick === 'function') {
                    try {
                        const shouldClose = await btnConfig.onClick(e);
                        if (shouldClose !== false) hideToast();
                    } catch (err) {
                        console.error('[toast] Button action failed', err);
                    }
                }
            });
            buttonGroup.appendChild(btn);
        });
        toast.appendChild(buttonGroup);
    } else if (normalized.actionLabel && typeof normalized.onAction === 'function') {
        const actionButton = document.createElement('button');
        actionButton.type = 'button';
        actionButton.className = 'toast-action';
        actionButton.textContent = normalized.actionLabel;
        if (normalized.actionTooltip || normalized.tooltip) {
            actionButton.title = normalized.actionTooltip || normalized.tooltip;
        }
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

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'toast-close';
    closeButton.setAttribute('aria-label', 'Close');
    closeButton.textContent = '×';
    toast.appendChild(closeButton);

    // Identify if this toast should stick to the bottom (persistent or has complex interactions)
    const isSticky = duration === 0 || (normalized.customButtons && normalized.customButtons.length > 0);
    if (isSticky) {
        toast.classList.add('toast-sticky');
    }

    // Insert logic: Sticky toasts go to the bottom (end of list).
    // Transient toasts go before the first sticky toast, or at the bottom if no sticky toasts exist.
    if (isSticky) {
        toastContainer.appendChild(toast);
    } else {
        const firstSticky = toastContainer.querySelector('.toast-sticky');
        if (firstSticky) {
            toastContainer.insertBefore(toast, firstSticky);
        } else {
            toastContainer.appendChild(toast);
        }
    }

    // Trigger reflow to enable CSS transition
    void toast.offsetWidth;

    toast.classList.add('show');

    let hidden = false;
    const hideToast = () => {
        if (hidden) return;
        hidden = true;
        toast.classList.remove('show');

        // Call onDismiss callback if provided
        if (typeof normalized.onDismiss === 'function') {
            try {
                normalized.onDismiss();
            } catch (err) {
                console.error('[toast] onDismiss callback failed', err);
            }
        }

        // Remove the toast from DOM after transition
        toast.addEventListener('transitionend', () => {
            toast.remove();
        }, { once: true });
    };

    closeButton.addEventListener('click', (event) => {
        event.stopPropagation();
        hideToast();
    });

    // Remove toast after specified duration, unless it is 0 (persistent)
    if (duration > 0) {
        setTimeout(hideToast, duration);
    }
}
