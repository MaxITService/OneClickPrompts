// modules/buttons-container-mover.js
// Version: 2.0
// Click-to-place flow for moving and saving the inline buttons container location.

'use strict';

window.MaxExtensionContainerMover = {
    __selectorSaverPromise: null,
    __autoRecoveryToastShown: false,
    __autoRecoveryToastDismissed: false,

    __activeSession: null,
    __highlightedElement: null,
    __highlightedElementOriginalOutline: null,

    __toast: function (message, type = 'info', options = 3000) {
        try {
            if (typeof window.showToast === 'function') {
                window.showToast(message, type, options);
                return;
            }
        } catch (_) { /* ignore */ }
        try {
            logConCgp('[ContainerMover] Toast unavailable:', { type, message });
        } catch (_) { /* ignore */ }
    },

    __clearHighlight: function () {
        if (!this.__highlightedElement) return;
        try {
            this.__highlightedElement.style.outline = this.__highlightedElementOriginalOutline || '';
        } catch (_) { /* ignore */ }
        this.__highlightedElement = null;
        this.__highlightedElementOriginalOutline = null;
    },

    __highlight: function (el, color = '#4CAF50') {
        if (!el) return;
        if (this.__highlightedElement && this.__highlightedElement !== el) {
            this.__clearHighlight();
        }
        if (!this.__highlightedElement) {
            this.__highlightedElement = el;
            this.__highlightedElementOriginalOutline = el.style.outline;
        }
        try {
            el.style.outline = `2px solid ${color}`;
        } catch (_) { /* ignore */ }
    },

    __getContainer: function () {
        const containerId = window?.InjectionTargetsOnWebsite?.selectors?.buttonsContainerId;
        if (!containerId) return null;
        return document.getElementById(containerId);
    },

    __getUiRoots: function (container) {
        const roots = [];
        try {
            const toastContainer = document.getElementById('toastContainer');
            if (toastContainer) roots.push(toastContainer);
        } catch (_) { /* ignore */ }

        try {
            const floatingPanel = document.getElementById('max-extension-floating-panel');
            if (floatingPanel) roots.push(floatingPanel);
        } catch (_) { /* ignore */ }

        if (container) roots.push(container);
        return roots;
    },

    __isInUiRoots: function (el, roots) {
        if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
        for (const root of roots) {
            try {
                if (root && root.contains(el)) return true;
            } catch (_) { /* ignore */ }
        }
        return false;
    },

    __getEventTargetElement: function (event) {
        if (!event) return null;
        const path = typeof event.composedPath === 'function' ? event.composedPath() : null;
        if (Array.isArray(path)) {
            for (const node of path) {
                if (!node || node.nodeType !== Node.ELEMENT_NODE) continue;
                try {
                    if (node.getRootNode && node.getRootNode() === document) {
                        return node;
                    }
                } catch (_) { /* ignore */ }
            }
        }
        return event.target && event.target.nodeType === Node.ELEMENT_NODE ? event.target : null;
    },

    __findPlaceableContainer: function (startEl, roots) {
        if (!startEl || startEl.nodeType !== Node.ELEMENT_NODE) return null;

        const voidTags = new Set([
            'AREA', 'BASE', 'BR', 'COL', 'EMBED', 'HR', 'IMG', 'INPUT', 'LINK', 'META',
            'PARAM', 'SOURCE', 'TRACK', 'WBR'
        ]);
        const skipTags = new Set([
            'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TITLE',
            'SVG', 'PATH',
            'IFRAME', 'VIDEO', 'AUDIO', 'CANVAS', 'MAP',
            'SPAN', 'A', 'I', 'B', 'STRONG', 'EM',
            'P', 'PRE', 'CODE',
            'UL', 'OL', 'LI', 'DL', 'DT', 'DD',
            'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'COLGROUP', 'CAPTION',
            'H1', 'H2', 'H3', 'H4', 'H5', 'H6'
        ]);
        const skipSelectors = ['input', 'textarea', 'button', 'select', 'option', 'optgroup', 'label'];

        let el = startEl;
        while (el && el.nodeType === Node.ELEMENT_NODE) {
            if (this.__isInUiRoots(el, roots)) return null;

            const tag = el.tagName;
            if (skipTags.has(tag) || voidTags.has(tag)) {
                el = el.parentElement;
                continue;
            }

            try {
                if (skipSelectors.some(sel => el.matches(sel))) {
                    el = el.parentElement;
                    continue;
                }
            } catch (_) { /* ignore */ }

            try {
                if (el.isContentEditable || el.getAttribute('contenteditable') === 'true') {
                    el = el.parentElement;
                    continue;
                }
            } catch (_) { /* ignore */ }

            if (tag === 'HTML') return document.body;

            try {
                const style = window.getComputedStyle(el);
                if (style.display === 'none' || style.visibility === 'hidden') {
                    el = el.parentElement;
                    continue;
                }
            } catch (_) { /* ignore */ }

            try {
                const rect = el.getBoundingClientRect();
                if (rect.width <= 0 || rect.height <= 0) {
                    el = el.parentElement;
                    continue;
                }
            } catch (_) { /* ignore */ }

            return el;
        }

        return document.body;
    },

    __moveContainerTo: function (container, target) {
        if (!container || !target) return false;
        if (container === target) return false;

        try {
            if (container.parentElement !== target) {
                target.appendChild(container);
            }
            container.scrollIntoView({ behavior: 'smooth', block: 'center' });
            return true;
        } catch (err) {
            logConCgp('[ContainerMover] Failed to move container:', err);
            return false;
        }
    },

    __cancelSession: function (session) {
        if (!session || !session.active) return;
        session.active = false;
        try {
            if (session.pickClickHandler) {
                document.removeEventListener('click', session.pickClickHandler, true);
            }
        } catch (_) { /* ignore */ }
        session.pickClickHandler = null;
        session.isPicking = false;
        this.__clearHighlight();
        if (this.__activeSession === session) {
            this.__activeSession = null;
        }
    },

    /**
     * Lazy-loads the selector persistence module so Save works even if it wasn't preloaded.
     * @returns {Promise<object|null>}
     */
    loadSelectorPersistence: async function () {
        if (window.OCPSelectorPersistence) {
            return window.OCPSelectorPersistence;
        }
        if (this.__selectorSaverPromise) {
            return this.__selectorSaverPromise;
        }
        const saverUrl = chrome?.runtime?.getURL ? chrome.runtime.getURL('modules/selector-auto-detector/selector-save.js') : null;
        if (!saverUrl) {
            logConCgp('[ContainerMover] Missing saver URL.');
            return null;
        }
        this.__selectorSaverPromise = import(saverUrl).then(mod => mod?.OCPSelectorPersistence || window.OCPSelectorPersistence || null).catch(err => {
            logConCgp('[ContainerMover] Failed to load selector saver module.', err);
            return null;
        });
        return this.__selectorSaverPromise;
    },

    /**
     * Initiates the container move/save flow.
     * @param {Event} event - The click event that triggered this.
     */
    handleShiftClick: function (event) {
        if (!event || !event.shiftKey) return;
        event.preventDefault();
        event.stopPropagation();
        this.enterMoveMode('manual');
    },

    __restoreOriginal: function (session) {
        if (!session || !session.container) return false;
        const container = session.container;
        const parent = session.originalParent;
        const next = session.originalNextSibling;

        try {
            if (parent && parent.isConnected) {
                parent.insertBefore(container, next && next.isConnected ? next : null);
                container.scrollIntoView({ behavior: 'smooth', block: 'center' });
                this.__highlight(parent, '#FFC107');
                return true;
            }
        } catch (err) {
            logConCgp('[ContainerMover] Failed restoring original parent:', err);
        }

        try {
            document.body.appendChild(container);
            container.scrollIntoView({ behavior: 'smooth', block: 'center' });
            this.__highlight(document.body, '#FFC107');
            return true;
        } catch (err) {
            logConCgp('[ContainerMover] Failed restoring to body:', err);
            return false;
        }
    },

    __saveLocation: async function (container) {
        const parent = container?.parentElement;
        if (!parent) {
            this.__toast('Cannot save: container has no parent.', 'error');
            return false;
        }

        const saver = await this.loadSelectorPersistence();
        if (!saver || typeof saver.saveSelectorFromElement !== 'function') {
            this.__toast('Selector persistence module not loaded.', 'error');
            return false;
        }

        const site = window?.InjectionTargetsOnWebsite?.activeSite;
        const result = await saver.saveSelectorFromElement({
            site: site,
            type: 'container',
            element: parent
        });

        if (result?.ok) {
            this.__toast(`Location saved! Selector: ${result.selector}`, 'success', 8000);
            return true;
        }

        this.__toast(`Failed to save: ${result?.reason || 'unknown'}`, 'error');
        return false;
    },

    __useFloatingPanel: async function (container) {
        logConCgp('[ContainerMover] User chose floating panel fallback.');

        try {
            if (container && container.parentElement) {
                container.remove();
            }
        } catch (_) { /* ignore */ }

        window.__OCP_inlineHealthy = false;
        window.__OCP_userDisabledFallback = false;

        if (window.MaxExtensionFloatingPanel && typeof window.MaxExtensionFloatingPanel.createFloatingPanel === 'function') {
            try {
                await window.MaxExtensionFloatingPanel.createFloatingPanel();
                const panelElement = window.MaxExtensionFloatingPanel.panelElement;
                const buttonsArea = document.getElementById('max-extension-buttons-area');

                if (panelElement && buttonsArea) {
                    buttonsArea.innerHTML = '';
                    if (window.MaxExtensionButtonsInit && typeof window.MaxExtensionButtonsInit.createAndInsertCustomElements === 'function') {
                        window.MaxExtensionButtonsInit.createAndInsertCustomElements(buttonsArea);
                    }

                    if (typeof window.MaxExtensionFloatingPanel.positionPanelTopRight === 'function') {
                        window.MaxExtensionFloatingPanel.positionPanelTopRight();
                    }

                    panelElement.style.display = 'flex';
                    window.MaxExtensionFloatingPanel.isPanelVisible = true;

                    if (window.MaxExtensionFloatingPanel.currentPanelSettings) {
                        window.MaxExtensionFloatingPanel.currentPanelSettings.isVisible = true;
                        window.MaxExtensionFloatingPanel.debouncedSavePanelSettings?.();
                    }

                    this.__toast('Switched to floating panel mode.', 'success', 3000);
                }
            } catch (err) {
                logConCgp('[ContainerMover] Error creating floating panel:', err);
                this.__toast('Error creating floating panel. Please try again.', 'error');
            }
        }
    },

    __startPickMode: function (session) {
        if (!session || !session.active) return;
        if (session.isPicking) {
            this.__toast('Pick mode already active: click a spot on the page.', 'info', 2000);
            return;
        }

        session.isPicking = true;
        this.__toast('Pick mode: click a spot on the page to move the buttons there.', 'info', 2500);

        const mover = this;
        session.pickClickHandler = (event) => {
            if (!session.active) return;
            const rawTarget = mover.__getEventTargetElement(event);
            if (!rawTarget) return;

            if (mover.__isInUiRoots(rawTarget, session.uiRoots)) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();

            const pickedParent = mover.__findPlaceableContainer(rawTarget, session.uiRoots);
            if (!pickedParent) {
                mover.__toast('Could not pick that spot. Try another element.', 'warning', 2500);
                return;
            }

            const moved = mover.__moveContainerTo(session.container, pickedParent);
            if (!moved) {
                mover.__toast('Could not move there (protected element). Try another spot.', 'error', 3000);
                return;
            }

            mover.__highlight(pickedParent, '#4CAF50');

            try {
                document.removeEventListener('click', session.pickClickHandler, true);
            } catch (_) { /* ignore */ }
            session.pickClickHandler = null;
            session.isPicking = false;
        };

        document.addEventListener('click', session.pickClickHandler, true);
    },

    /**
     * Enters move mode (can be triggered manually or automatically).
     * @param {string} mode - 'manual' (Shift+Click) or 'auto-recovery' (heuristic found alternative)
     */
    enterMoveMode: function (mode = 'manual') {
        if (mode === 'auto-recovery') {
            if (this.__autoRecoveryToastShown || this.__autoRecoveryToastDismissed) {
                logConCgp('[ContainerMover] Auto-recovery toast already shown or dismissed this session. Skipping.');
                return;
            }
            this.__autoRecoveryToastShown = true;
        }

        const container = this.__getContainer();
        if (!container) {
            this.__toast('Buttons container not found.', 'error');
            return;
        }

        if (this.__activeSession) {
            this.__cancelSession(this.__activeSession);
        }

        const session = {
            active: true,
            mode,
            container,
            uiRoots: this.__getUiRoots(container),
            originalParent: container.parentElement,
            originalNextSibling: container.nextSibling,
            isPicking: false,
            pickClickHandler: null
        };

        this.__activeSession = session;

        if (container.parentElement) {
            this.__highlight(container.parentElement, '#FFC107');
        }

        const mover = this;
        const isManual = mode === 'manual';
        const dismissLabel = isManual ? '❌ Cancel' : '✖ Dismiss';
        const dismissTitle = isManual ? 'Restore previous location and close' : 'Close this helper';

        const customButtons = [
            {
                text: '🎯 Pick',
                title: 'Click this, then click a spot on the page',
                onClick: () => { mover.__startPickMode(session); return false; }
            },
            {
                text: '💾 Save',
                title: 'Save current location for next time',
                className: 'toast-action-primary',
                onClick: async () => {
                    const ok = await mover.__saveLocation(container);
                    return ok === true;
                }
            },
            {
                text: dismissLabel,
                title: dismissTitle,
                className: isManual ? 'toast-action-secondary' : '',
                onClick: () => {
                    if (isManual) {
                        mover.__restoreOriginal(session);
                    }
                    return true;
                }
            }
        ];

        if (mode === 'auto-recovery') {
            customButtons.push({
                text: '🎈 Floating Panel',
                title: 'Give up and switch to floating panel mode',
                className: 'toast-action-secondary',
                onClick: async () => { await mover.__useFloatingPanel(container); return true; }
            });
        }

        const message = mode === 'auto-recovery'
            ? 'We found an alternative spot for your buttons. Use Pick to choose a better spot, then Save if you like it.'
            : 'Move Buttons Container: click Pick, then click a spot on the page. Save when happy.';

        this.__toast(message, 'info', {
            duration: mode === 'auto-recovery' ? 12000 : 0,
            customButtons,
            onDismiss: () => {
                mover.__cancelSession(session);
                if (mode === 'auto-recovery') {
                    mover.__autoRecoveryToastDismissed = true;
                    logConCgp('[ContainerMover] Auto-recovery toast dismissed by user.');
                }
            }
        });
    }
};
