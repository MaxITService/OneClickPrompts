// modules/buttons-container-mover.js
// Version: 1.0
// Handles the logic for moving and saving the buttons container location.

'use strict';

window.MaxExtensionContainerMover = {
    __selectorSaverPromise: null,
    __autoRecoveryToastShown: false,     // Track if auto-recovery toast has been shown this session
    __autoRecoveryToastDismissed: false, // Track if user explicitly closed the toast
    __highlightedElement: null,
    __highlightedElementOriginalOutline: null,
    __highlightedElementClearTimerId: null,

    __clearHighlight: function () {
        if (this.__highlightedElementClearTimerId) {
            clearTimeout(this.__highlightedElementClearTimerId);
            this.__highlightedElementClearTimerId = null;
        }
        if (this.__highlightedElement) {
            try {
                this.__highlightedElement.style.outline = this.__highlightedElementOriginalOutline || '';
            } catch (_) {
                // ignore
            }
        }
        this.__highlightedElement = null;
        this.__highlightedElementOriginalOutline = null;
    },

    __highlightElementOnce: function (el, durationMs = 1000) {
        if (!el) return;
        this.__clearHighlight();

        this.__highlightedElement = el;
        this.__highlightedElementOriginalOutline = el.style.outline;
        el.style.outline = '2px solid #4CAF50';

        this.__highlightedElementClearTimerId = setTimeout(() => {
            this.__clearHighlight();
        }, durationMs);
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

    /**
     * Enters move mode (can be triggered manually or automatically).
     * @param {string} mode - 'manual' (Shift+Click) or 'auto-recovery' (heuristic found alternative)
     */
    enterMoveMode: function (mode = 'manual') {
        // For auto-recovery mode, check if we should show the toast at all
        if (mode === 'auto-recovery') {
            if (this.__autoRecoveryToastShown || this.__autoRecoveryToastDismissed) {
                logConCgp('[ContainerMover] Auto-recovery toast already shown or dismissed this session. Skipping.');
                return;
            }
            // Mark as shown
            this.__autoRecoveryToastShown = true;
        }

        const containerId = window.InjectionTargetsOnWebsite.selectors.buttonsContainerId;
        const container = document.getElementById(containerId);

        if (!container) {
            window.showToast('Container not found.', 'error');
            return;
        }

        const mover = this;

        // History of valid parents we've successfully attached to.
        // We initialize it with the current parent if it exists.
        const visitedPath = [];
        if (container.parentElement) {
            visitedPath.push(container.parentElement);
        }

        let wrapToastShown = false;

        const moveContainer = (direction) => {
            let startNode = container.parentElement;
            let recovered = false;

            // 1. Recovery Logic: If current parent is missing or dead, look back in history.
            if (!startNode || !startNode.isConnected) {
                logConCgp('[moveContainer] Container detached or parent dead. Searching history...');

                // Find the most recent valid node in history
                while (visitedPath.length > 0) {
                    const candidate = visitedPath[visitedPath.length - 1];
                    if (candidate && candidate.isConnected) {
                        startNode = candidate;
                        recovered = true;
                        logConCgp('[moveContainer] Recovered start node from history:', startNode);
                        break;
                    } else {
                        logConCgp('[moveContainer] History node dead, removing:', candidate);
                        visitedPath.pop();
                    }
                }

                // Fallback if history is empty
                if (!startNode) {
                    startNode = document.body;
                    logConCgp('[moveContainer] History exhausted. Resetting to body.');
                }
            }

            logConCgp(`[moveContainer] Starting move ${direction}. Reference node:`, startNode);

            const isValidContainer = (el) => {
                if (!el || el === container || container.contains(el)) return false;
                // If we recovered, startNode is where we ARE (conceptually), so we skip it to move away from it.
                if (el === startNode) return false;

                // Tags that cannot contain a DIV or are not suitable containers
                const invalidTags = [
                    'SCRIPT', 'STYLE', 'LINK', 'META', 'TITLE', 'NOSCRIPT', 'TEMPLATE',
                    'INPUT', 'TEXTAREA', 'BUTTON', 'SELECT', 'OPTION', 'OPTGROUP', 'LABEL',
                    'SVG', 'PATH', 'IMG', 'BR', 'HR', 'PRE', 'CODE', 'SPAN', 'I', 'B', 'STRONG', 'EM', 'A',
                    'IFRAME', 'VIDEO', 'AUDIO', 'CANVAS', 'MAP', 'AREA',
                    'P', 'UL', 'OL', 'DL', 'DT', 'DD',
                    'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'COL', 'COLGROUP', 'CAPTION',
                    'H1', 'H2', 'H3', 'H4', 'H5', 'H6'
                ];
                if (invalidTags.includes(el.tagName)) return false;

                if (el.tagName !== 'BODY' && el.tagName !== 'HTML') {
                    const rects = el.getClientRects();
                    if (rects.length === 0) {
                        // Some useful layout containers have 0 rects (e.g. display: contents).
                        // If the element is totally empty, treat it as not useful.
                        if (!el.firstElementChild && !el.textContent?.trim()) return false;
                    }
                }

                return true;
            };

            const buildCandidates = () => {
                const candidates = [];
                const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
                let scanned = 0;
                const maxScanned = 35000;
                const maxCandidates = 7000;

                while (walker.nextNode()) {
                    scanned++;
                    if (scanned > maxScanned) break;
                    const node = walker.currentNode;
                    if (isValidContainer(node)) {
                        candidates.push(node);
                        if (candidates.length >= maxCandidates) break;
                    }
                }

                logConCgp('[moveContainer] Candidate scan:', { scanned, candidates: candidates.length });
                return candidates;
            };

            const pickCandidate = () => {
                const candidates = buildCandidates();
                if (!candidates.length) return null;

                const findPreviousIndex = () => {
                    const exact = candidates.indexOf(startNode);
                    if (exact !== -1) return exact - 1;

                    let previous = -1;
                    for (let index = 0; index < candidates.length; index++) {
                        const candidate = candidates[index];
                        const pos = candidate.compareDocumentPosition(startNode);
                        if (pos & Node.DOCUMENT_POSITION_FOLLOWING) {
                            previous = index;
                        } else {
                            break;
                        }
                    }
                    return previous;
                };

                const previousIndex = findPreviousIndex();
                const nextIndex = previousIndex + 1;

                if (direction === 'forward') {
                    const preferEscape = true;
                    if (preferEscape) {
                        for (let index = nextIndex; index < candidates.length; index++) {
                            const candidate = candidates[index];
                            if (candidate === startNode) continue;
                            if (!startNode.contains(candidate)) return candidate;
                        }
                    }
                    return candidates[nextIndex] || null;
                }

                // back
                return previousIndex >= 0 ? candidates[previousIndex] : null;
            };

            let found = pickCandidate();
            if (!found) {
                const candidates = buildCandidates();
                if (candidates.length) {
                    found = direction === 'forward' ? candidates[0] : candidates[candidates.length - 1];
                    if (!wrapToastShown) {
                        wrapToastShown = true;
                        window.showToast('Wrapped around the document (no more spots in that direction).', 'info', 2000);
                    }
                }
            }

            if (found) {
                try {
                    mover.__clearHighlight();
                    found.appendChild(container);
                    // Add to history
                    visitedPath.push(found);

                    container.scrollIntoView({ behavior: 'smooth', block: 'center' });

                    mover.__highlightElementOnce(found, 1000);

                    if (recovered) {
                        window.showToast('Something went wrong. Movement blocked. Restored to last valid position. Maybe try the other direction?', 'warning', 3000);
                    }

                } catch (err) {
                    logConCgp('[moveContainer] Failed to append to found container:', err);
                    window.showToast('Could not move there (protected element). Try the other direction.', 'error');
                }

            } else {
                window.showToast(`End of document reached. Cannot move further ${direction}.`, 'warning', 3000);

                // If we failed to find a NEW place, but we were in a "recovered" state (container detached),
                // we should at least put the container back to startNode so it's not lost.
                if (recovered && !container.parentElement) {
                    try {
                        startNode.appendChild(container);
                        window.showToast('Could not move further, but kept container safe.', 'info', 3000);
                    } catch (e) {
                        document.body.appendChild(container);
                    }
                }
            }
        };

        const saveLocation = async () => {
            const parent = container.parentElement;
            if (!parent) {
                window.showToast('Cannot save: no parent element.', 'error');
                return;
            }

            const saver = await this.loadSelectorPersistence();
            if (!saver || typeof saver.saveSelectorFromElement !== 'function') {
                window.showToast('Selector persistence module not loaded.', 'error');
                return;
            }

            const site = window.InjectionTargetsOnWebsite.activeSite;
            const result = await saver.saveSelectorFromElement({
                site: site,
                type: 'container',
                element: parent
            });

            if (result.ok) {
                window.showToast(`Location saved! Selector: ${result.selector}`, 'success', 8000);
            } else {
                window.showToast(`Failed to save: ${result.reason}`, 'error');
            }
        };

        const useFloatingPanel = async () => {
            logConCgp('[ContainerMover] User chose floating panel fallback.');
            // Remove the inline container
            if (container && container.parentElement) {
                container.remove();
            }
            // Mark inline as not healthy so the auto-fallback triggers
            window.__OCP_inlineHealthy = false;
            // Don't block the auto-fallback
            window.__OCP_userDisabledFallback = false;

            // Trigger floating panel creation
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

                        window.showToast('Switched to floating panel mode.', 'success', 3000);
                    }
                } catch (err) {
                    logConCgp('[ContainerMover] Error creating floating panel:', err);
                    window.showToast('Error creating floating panel. Please try again.', 'error');
                }
            }
        };

        // Build custom buttons array
        const customButtons = [
            {
                text: '⬅️ Back',
                title: 'Move container to previous element',
                onClick: () => { moveContainer('back'); return false; }
            },
            {
                text: '💾 Save',
                title: 'Save current location',
                className: 'toast-action-primary',
                onClick: async () => { await saveLocation(); return true; }
            },
            {
                text: 'Forward ➡️',
                title: 'Move container to next element',
                onClick: () => { moveContainer('forward'); return false; }
            }
        ];

        // Add floating panel button only in auto-recovery mode
        if (mode === 'auto-recovery') {
            customButtons.push({
                text: '🎈 Floating Panel',
                title: 'Give up and use floating panel instead',
                className: 'toast-action-secondary',
                onClick: async () => { await useFloatingPanel(); return true; }
            });
        }

        const message = mode === 'auto-recovery'
            ? 'We found an alternative spot for your buttons. Use Forward/Back to find the best location, or switch to floating panel. If you are satisfied, just press Save.'
            : 'Move Buttons Container. Use Forward/Back to find the best spot. If buttons disappear, keep clicking to find them. If you are satisfied, just press Save.';

        window.showToast(message, 'info', {
            duration: mode === 'auto-recovery' ? 10000 : 0,
            customButtons: customButtons,
            onDismiss: () => {
                mover.__clearHighlight();
                // Mark as dismissed when user manually closes it
                if (mode === 'auto-recovery') {
                    mover.__autoRecoveryToastDismissed = true;
                    logConCgp('[ContainerMover] Auto-recovery toast dismissed by user.');
                }
            }
        });
    }
};
