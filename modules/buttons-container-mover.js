// modules/buttons-container-mover.js
// Version: 1.0
// Handles the logic for moving and saving the buttons container location.

'use strict';

window.MaxExtensionContainerMover = {
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
        const containerId = window.InjectionTargetsOnWebsite.selectors.buttonsContainerId;
        const container = document.getElementById(containerId);

        if (!container) {
            window.showToast('Container not found.', 'error');
            return;
        }

        // History of valid parents we've successfully attached to.
        // We initialize it with the current parent if it exists.
        const visitedPath = [];
        if (container.parentElement) {
            visitedPath.push(container.parentElement);
        }

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

                if (el.offsetParent === null && el.tagName !== 'BODY' && el.tagName !== 'HTML') return false;

                return true;
            };

            const walker = document.createTreeWalker(
                document.body,
                NodeFilter.SHOW_ELEMENT,
                {
                    acceptNode: (node) => {
                        return NodeFilter.FILTER_ACCEPT;
                    }
                }
            );

            walker.currentNode = startNode;

            let found = null;
            let attempts = 0;
            const maxAttempts = 500;

            while (attempts < maxAttempts) {
                attempts++;
                const node = direction === 'forward' ? walker.nextNode() : walker.previousNode();

                if (!node) {
                    logConCgp(`[moveContainer] End of DOM reached after ${attempts} attempts.`);
                    break;
                }

                if (isValidContainer(node)) {
                    found = node;
                    logConCgp(`[moveContainer] Found valid container after ${attempts} attempts:`, found);
                    break;
                }
            }

            if (found) {
                try {
                    found.appendChild(container);
                    // Add to history
                    visitedPath.push(found);

                    container.scrollIntoView({ behavior: 'smooth', block: 'center' });

                    const originalOutline = found.style.outline;
                    found.style.outline = '2px solid #4CAF50';
                    setTimeout(() => {
                        found.style.outline = originalOutline;
                    }, 1000);

                    if (recovered) {
                        window.showToast('Something went wrong. Movement blocked. Restored to last valid position. Maybe try the other direction?', 'warning', 3000);
                    }

                } catch (err) {
                    logConCgp('[moveContainer] Failed to append to found container:', err);
                    window.showToast('Could not move there (protected element). Try the other direction.', 'error');
                }

            } else {
                logConCgp(`[moveContainer] No valid container found after ${attempts} attempts.`);
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

            if (window.OCPSelectorPersistence && typeof window.OCPSelectorPersistence.saveSelectorFromElement === 'function') {
                const site = window.InjectionTargetsOnWebsite.activeSite;
                const result = await window.OCPSelectorPersistence.saveSelectorFromElement({
                    site: site,
                    type: 'container',
                    element: parent
                });

                if (result.ok) {
                    window.showToast(`Location saved! Selector: ${result.selector}`, 'success', 4000);
                } else {
                    window.showToast(`Failed to save: ${result.reason}`, 'error');
                }
            } else {
                window.showToast('Selector persistence module not loaded.', 'error');
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
                    const panelContent = document.getElementById('max-extension-floating-panel-content');

                    if (panelElement && panelContent) {
                        panelContent.innerHTML = '';
                        if (window.MaxExtensionButtonsInit && typeof window.MaxExtensionButtonsInit.createAndInsertCustomElements === 'function') {
                            window.MaxExtensionButtonsInit.createAndInsertCustomElements(panelContent);
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
            ? 'We found an alternative spot for your buttons.\n\nUse Forward/Back to find the best location, or switch to floating panel.'
            : 'Move Buttons Container\n\nUse Forward/Back to find the best spot. If buttons disappear, keep clicking to find them.';

        window.showToast(message, 'info', {
            duration: 0,
            customButtons: customButtons
        });
    }
};
