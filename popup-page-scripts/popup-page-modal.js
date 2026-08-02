/**
 * popup-page-modal.js
 * Provides a premium, Promise-based modal dialog system to replace native alert/confirm.
 */

window.OCPModal = {
    init: function () {
        if (document.getElementById('ocp-modal-overlay')) return;

        const overlay = document.createElement('div');
        overlay.id = 'ocp-modal-overlay';
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="modal-content">
                <h3 id="ocp-modal-title" class="modal-title">Confirm</h3>
                <p id="ocp-modal-body" class="modal-body">Are you sure?</p>
                <div class="modal-actions">
                    <button id="ocp-modal-cancel" class="modal-btn modal-btn-cancel">Cancel</button>
                    <button id="ocp-modal-confirm" class="modal-btn modal-btn-confirm">Confirm</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        // Bind events
        this.overlay = overlay;
        this.titleEl = overlay.querySelector('#ocp-modal-title');
        this.bodyEl = overlay.querySelector('#ocp-modal-body');
        this.cancelBtn = overlay.querySelector('#ocp-modal-cancel');
        this.confirmBtn = overlay.querySelector('#ocp-modal-confirm');
        this.contentEl = overlay.querySelector('.modal-content');

        this.cancelBtn.addEventListener('click', () => this.handleAction(false));
        this.confirmBtn.addEventListener('click', () => this.handleAction(true));

        // Close on clicking background
        this.overlay.addEventListener('click', (e) => {
            if (e.target === this.overlay) this.handleAction(false);
        });

        // Close on visual Escape (handled by keydown in show but nice to have logic here if needed)
    },

    /**
     * Shows a modal dialog.
     * @param {Object} options
     * @param {string} options.title
     * @param {string} options.text
     * @param {string} [options.confirmText='OK']
     * @param {string} [options.cancelText='Cancel'] - Pass null to hide cancel button (alert mode)
     * @param {string} [options.type='info'] - 'info', 'confirm', 'error'
     * @returns {Promise<boolean>} Resolves true on confirm, false on cancel.
     */
    show: function ({ title, text, confirmText = 'OK', cancelText = 'Cancel', type = 'info' }) {
        this.init(); // Ensure DOM exists

        return new Promise((resolve) => {
            this.currentResolve = resolve;

            this.titleEl.textContent = title;
            this.bodyEl.textContent = text;
            this.confirmBtn.textContent = confirmText;

            // Handle Type Styling
            this.contentEl.className = 'modal-content'; // Reset
            if (type === 'error' || type === 'danger') {
                this.contentEl.classList.add('modal-type-error');
            }

            // Handle Buttons
            if (cancelText === null) {
                this.cancelBtn.style.display = 'none';
            } else {
                this.cancelBtn.style.display = 'inline-block';
                this.cancelBtn.textContent = cancelText;
            }

            // Show
            // Small delay to allow transition
            this.overlay.style.display = 'flex';
            requestAnimationFrame(() => {
                this.overlay.classList.add('is-visible');
            });

            // Focus confirm for accessibility
            this.confirmBtn.focus();

            this.onKeyDown = (e) => {
                if (e.key === 'Escape') {
                    this.handleAction(false);
                } else if (e.key === 'Enter') {
                    // Only trigger if focus is not on cancel
                    if (document.activeElement !== this.cancelBtn) {
                        this.handleAction(true);
                    }
                }
            };
            document.addEventListener('keydown', this.onKeyDown);
        });
    },

    handleAction: function (result) {
        if (this.currentResolve) {
            this.currentResolve(result);
            this.currentResolve = null;
        }
        this.hide();
    },

    hide: function () {
        if (!this.overlay) return;
        this.overlay.classList.remove('is-visible');
        document.removeEventListener('keydown', this.onKeyDown);

        // Wait for transition to finish before display: none
        setTimeout(() => {
            this.overlay.style.display = 'none';
        }, 300);
    },

    // Shortcuts
    alert: function (text, title = 'Alert') {
        return this.show({ title, text, cancelText: null, type: 'info' });
    },

    confirm: function (text, title = 'Confirm', type = 'confirm') {
        return this.show({ title, text, confirmText: 'Yes', cancelText: 'No', type });
    }
};
