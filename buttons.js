// buttons.js
/* 
     Version: 1.0

     Documentation:
     Button creation + click orchestration.
     - Builds both custom send buttons (from profile/global config) and Cross-Chat buttons ("Copy", "Paste").
     - Assigns numeric shortcuts (1–10) to the first 10 non-separator buttons (configurable via globalMaxExtensionConfig.enableShortcuts).
     - Composes titles that include autosend status and shortcut hints.
     - Handles click behavior across supported sites and integrates with queue mode in the floating panel.

     Exposed methods:
     - MaxExtensionButtons.createCustomSendButton(buttonConfig, index, onClickHandler, overrideShortcutKey?)
     - MaxExtensionButtons.createCrossChatButton(type: 'copy'|'paste', shortcutKey?)
     - MaxExtensionButtons.determineShortcutKeyForButtonIndex(buttonIndex, offset?)

     Click flow:
     - processCustomSendButtonClick(event, customText, autoSend)
         * Shift inverts autoSend at click time.
         * If the floating panel is visible and queue mode is enabled, the button is enqueued instead of sending immediately.
         * Routes to site-specific handlers based on InjectionTargetsOnWebsite.activeSite:
             - ChatGPT, Claude, Copilot, DeepSeek, AIStudio, Grok, Gemini

     Cross-Chat notes:
     - "Copy": reads from the active editor, saves via service worker, briefly shows "Copied!" in tooltip,
         and triggers autosend with the existing text when configured.
     - "Paste": fetches stored prompt; tooltip shows a debounced preview on hover.

     Usage:
     Load order should ensure `utils.js` and any site-specific clicking modules are present before use.
     Rendering order and placement are orchestrated by buttons-init-and-render.js; this file focuses on element creation and behavior.

     Depends on:
     - utils.js (selectors and shared utilities)
     - buttons-init-and-render.js (composition/placement)
     - per-website-button-clicking-mechanics/buttons-clicking-*.js (site handlers: chatgpt/claude/copilot/deepseek/aistudio/grok/gemini)

     Instructions for AI: do not remove comments! MUST NOT REMOVE COMMENTS. This one too!
*/
'use strict';

// Escape tooltip body text so user-provided strings don't break HTML parsing in the tooltip renderer.
const escapeTooltipHtml = (text) => {
    if (text === null || text === undefined) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
};

/**
 * Namespace object containing functions related to creating and managing custom buttons.
 */
window.MaxExtensionButtons = {
    /**
     * Creates a cross-chat prompt sharing button ('Copy' or 'Paste').
     * @param {string} type - The type of button, either 'copy' or 'paste'.
     * @param {number|null} shortcutKey - The shortcut key (1-10) to assign, or null.
     * @returns {HTMLButtonElement} - The newly created button element.
     */
    createCrossChatButton: function (type, shortcutKey) {
        const buttonElement = document.createElement('button');
        buttonElement.type = 'button';

        buttonElement.style.cssText = `
            background-color: transparent;
            border: none;
            cursor: pointer;
            padding: 1px;
            font-size: 20px;
            margin-right: 5px;
            margin-bottom: 5px;
        `;

        if (type === 'broadcast') {
            const ICON_ACTIVE = '⬆️';
            const ICON_SHIELD = '😷';

            const isShielded = () => window.__OCP_dangerReceiveBlocked === true;
            const setShielded = (value) => {
                window.__OCP_dangerReceiveBlocked = !!value;
            };

            const buildTooltip = () => {
                const intro = 'Broadcast stored prompt to every supported tab - resulting in the other tabs will autosend messages.';
                const shieldInfo = isShielded()
                    ? ' • This tab is shielding itself from incoming broadcasts.'
                    : ' • This tab will receive and auto-send broadcasts.';
                return `${intro}. Danger: this .${shieldInfo} Shift+Click to toggle the shield.`;
            };

            const updateBroadcastVisuals = () => {
                buttonElement.innerHTML = isShielded() ? ICON_SHIELD : ICON_ACTIVE;
                buttonElement.setAttribute('title', buildTooltip());
            };

            updateBroadcastVisuals();

            buttonElement.addEventListener('click', (event) => {
                event.preventDefault();

                if (event.shiftKey) {
                    const nextState = !isShielded();
                    setShielded(nextState);
                    updateBroadcastVisuals();
                    if (typeof window.showToast === 'function') {
                        window.showToast(nextState
                            ? 'Incoming danger broadcasts are blocked in this tab.'
                            : 'This tab will accept danger broadcasts again.', 'info');
                    }
                    return;
                }

                if (!window.globalCrossChatConfig?.dangerAutoSendAll) {
                    if (typeof window.showToast === 'function') {
                        window.showToast('Enable "Danger: Auto sent to all instances of chats" in the popup first.', 'warning');
                    }
                    return;
                }

                const selectors = window?.InjectionTargetsOnWebsite?.selectors?.editors || [];
                const editor = selectors
                    .map(selector => document.querySelector(selector))
                    .find(el => el);

                if (!editor) {
                    logConCgp('[buttons-cross-chat] Editor area not found for broadcast.');
                    if (typeof window.showToast === 'function') {
                        window.showToast('Could not locate the chat editor for broadcasting.', 'error');
                    }
                    return;
                }

                const rawText = editor.value || editor.innerText || '';
                const trimmed = typeof rawText === 'string' ? rawText.trim() : '';
                if (!trimmed) {
                    if (typeof window.showToast === 'function') {
                        window.showToast('Nothing to send. Type your prompt first.', 'warning');
                    }
                    return;
                }

                chrome.runtime.sendMessage({ type: 'saveStoredPrompt', promptText: rawText }, () => {
                    logConCgp('[buttons-cross-chat] Prompt saved for broadcast.');
                });

                const localDispatchEvent = {
                    preventDefault() { },
                    stopPropagation() { },
                    __fromDangerBroadcast: true,
                    __fromQueue: true,
                    shiftKey: false,
                };
                processCustomSendButtonClick(localDispatchEvent, '', true);

                chrome.runtime.sendMessage({
                    type: 'triggerDangerCrossChatSend',
                    promptText: trimmed
                }, (response) => {
                    const dispatched = response?.dispatched || 0;
                    const failed = response?.failed || 0;
                    const skipped = response?.skipped || 0;
                    if (!response?.success) {
                        logConCgp('[buttons-cross-chat] Danger broadcast request failed or was rejected.', {
                            reason: response?.reason || response?.error || '',
                            dispatched,
                            failed,
                            skipped,
                            reasons: response?.reasons || []
                        });
                        if (typeof window.showToast === 'function') {
                            let failMessage;
                            if (failed > 0) {
                                failMessage = `Broadcast rejected by all ${failed} tab${failed === 1 ? '' : 's'}.`;
                            } else if ((response?.reason === 'noRecipientsReachable') && skipped > 0) {
                                failMessage = 'No other tabs are ready to receive this broadcast.';
                            } else {
                                failMessage = 'Broadcast failed or was rejected by other tabs.';
                            }
                            window.showToast(failMessage, 'error');
                        }
                        return;
                    }

                    logConCgp('[buttons-cross-chat] Danger broadcast results.', { dispatched, failed, skipped, reasons: response?.reasons || [] });
                    if (typeof window.showToast === 'function') {
                        let message = `Broadcast sent to ${dispatched} other tab${dispatched === 1 ? '' : 's'}.`;
                        if (failed > 0) {
                            message += ` ${failed} tab${failed === 1 ? '' : 's'} declined.`;
                        }
                        const toastType = failed > 0 ? 'warning' : 'success';
                        window.showToast(message, toastType);
                    }
                });
            });

            return buttonElement;
        }

        const icons = { copy: '📋', paste: '📥' };
        const baseTooltips = { copy: 'Copy prompt from input area', paste: 'Paste stored prompt' };

        buttonElement.innerHTML = icons[type];

        const autoSendEnabled = (type === 'copy')
            ? window.globalCrossChatConfig?.autosendCopy
            : window.globalCrossChatConfig?.autosendPaste;
        const autoSendDescription = autoSendEnabled
            ? ' <span class="ocp-tooltip__system-msg"><i><b>(Auto-sends)</b></i></span>'
            : '';

        let shortcutDescription = '';
        if (shortcutKey) {
            const fallbackHotkey = window.MaxExtensionHotkeys?.fromLegacyShortcutKey(shortcutKey);
            buttonElement.dataset.shortcutKey = shortcutKey.toString();
            if (fallbackHotkey) {
                buttonElement.dataset.hotkeyCombo = fallbackHotkey.combo;
                shortcutDescription = ` <span class="ocp-tooltip__system-msg"><i><b>(Shortcut: ${fallbackHotkey.label})</b></i></span>`;
            }
        }

        const updateTooltip = (text) => {
            const safeText = escapeTooltipHtml(text);
            buttonElement.setAttribute('title', safeText + autoSendDescription + shortcutDescription);
        };

        updateTooltip(baseTooltips[type]);

        buttonElement.addEventListener('click', (event) => {
            event.preventDefault();
            if (type === 'copy') {
                const editorSelectors = window?.InjectionTargetsOnWebsite?.selectors?.editors;
                const editor = (Array.isArray(editorSelectors) ? editorSelectors : [])
                    .map((selector) => {
                        try {
                            return document.querySelector(selector);
                        } catch (_) {
                            return null;
                        }
                    })
                    .find((el) => el);

                if (!editor) {
                    logConCgp('[buttons-cross-chat] Editor area not found for copy.');
                    return;
                }
                const text = editor.value || editor.innerText || '';

                chrome.runtime.sendMessage({ type: 'saveStoredPrompt', promptText: text }, () => {
                    logConCgp('[buttons-cross-chat] Prompt saved.');
                    updateTooltip('Copied!');
                    setTimeout(() => updateTooltip(baseTooltips.copy), 1500);
                });

                const autoSend = window.globalCrossChatConfig?.autosendCopy;
                processCustomSendButtonClick(event, '', autoSend);

            } else if (type === 'paste') {
                chrome.runtime.sendMessage({ type: 'getStoredPrompt' }, (response) => {
                    if (response?.promptText) {
                        const autoSend = window.globalCrossChatConfig.autosendPaste;
                        processCustomSendButtonClick(event, response.promptText, autoSend);
                    } else {
                        logConCgp('[buttons-cross-chat] No prompt to paste.');
                        updateTooltip('*No prompt has been saved*');
                        setTimeout(() => updateTooltip(baseTooltips.paste), 2000);
                    }
                });
            }
        });

        if (type === 'paste') {
            let tooltipFetchTimeout;
            buttonElement.addEventListener('mouseover', () => {
                clearTimeout(tooltipFetchTimeout);
                tooltipFetchTimeout = setTimeout(() => {
                    chrome.runtime.sendMessage({ type: 'getStoredPrompt' }, (response) => {
                        const promptText = response?.promptText;
                        if (promptText) {
                            const truncatedPrompt = promptText.length > 200 ? promptText.substring(0, 197) + '...' : promptText;
                            updateTooltip(truncatedPrompt);
                        } else {
                            updateTooltip('*No prompt has been saved*');
                        }
                    });
                }, 300);
            });

            buttonElement.addEventListener('mouseout', () => {
                clearTimeout(tooltipFetchTimeout);
                updateTooltip(baseTooltips.paste);
            });
        }

        return buttonElement;
    },
    /**
     * Creates a custom send button based on the provided configuration.
     * @param {Object} buttonConfig - The configuration object for the custom button.
     * @param {number} buttonIndex - The index of the button in the custom buttons array.
     * @param {Function} onClickHandler - The function to handle the button's click event.
     * @param {number|null|undefined} [overrideShortcutKey] - Optional shortcut key. Use null to suppress legacy fallback.
     * @returns {HTMLButtonElement} - The newly created custom send button element.
     */
    createCustomSendButton: function (buttonConfig, buttonIndex, onClickHandler, overrideShortcutKey = undefined) {
        const customButtonElement = document.createElement('button');
        customButtonElement.type = 'button'; // Prevent form being defaut type, that is "submit".
        customButtonElement.innerHTML = buttonConfig.icon;
        customButtonElement.setAttribute('data-testid', `custom-send-button-${buttonIndex}`);

        // Assign keyboard shortcuts to the first 10 non-separator buttons if shortcuts are enabled
        let assignedShortcutKey = overrideShortcutKey;
        if (assignedShortcutKey === undefined && globalMaxExtensionConfig.enableShortcuts) {
            assignedShortcutKey = this.determineShortcutKeyForButtonIndex(buttonIndex, 0); // Pass 0 as offset for old logic
        }

        const explicitHotkey = window.MaxExtensionHotkeys?.normalizeStoredHotkey(buttonConfig.hotkey);
        const fallbackHotkey = explicitHotkey
            ? null
            : window.MaxExtensionHotkeys?.fromLegacyShortcutKey(assignedShortcutKey);
        const effectiveHotkey = explicitHotkey || fallbackHotkey;

        if (assignedShortcutKey !== null && assignedShortcutKey !== undefined && !explicitHotkey) {
            customButtonElement.dataset.shortcutKey = assignedShortcutKey.toString();
        }
        if (effectiveHotkey) {
            customButtonElement.dataset.hotkeyCombo = effectiveHotkey.combo;
        }

        // Prepare tooltip parts: append (Auto-sends) if autoSend behavior is enabled
        // We wrap these in a specific class so the tooltip system can strip them out and place them in the footer,
        // preventing them from being truncated if the main text is long.
        const autoSendDescription = buttonConfig.autoSend
            ? ' <span class="ocp-tooltip__system-msg"><i><b>(Auto-sends)</b></i></span>'
            : '';

        const shortcutDescription = effectiveHotkey
            ? ` <span class="ocp-tooltip__system-msg"><i><b>(Shortcut: ${effectiveHotkey.label})</b></i></span>`
            : '';

        // Set the tooltip (title attribute) combining the button text (or a custom tooltip) with auto-send and shortcut info
        const baseTooltipText = escapeTooltipHtml(buttonConfig.tooltip || buttonConfig.text);
        customButtonElement.setAttribute('title', `${baseTooltipText}${autoSendDescription}${shortcutDescription}`);

        customButtonElement.style.cssText = `
            background-color: transparent;
            border: none;
            cursor: pointer;
            padding: 1px;
            font-size: 20px;
            margin-right: 5px;
            margin-bottom: 5px;
        `;

        // Attach the click event listener to handle custom send actions
        customButtonElement.addEventListener('click', (event) => onClickHandler(event, buttonConfig.text, buttonConfig.autoSend));

        return customButtonElement;
    },

    /**
     * Copies the last ChatGPT assistant response. It prefers ChatGPT's native copy
     * button so copied formatting matches ChatGPT behavior, with a direct text
     * clipboard fallback if that button is unavailable.
     * @param {Event} event
     * @returns {Promise<Object>}
     */
    copyLastChatGPTResponse: async function (event) {
        if (event && typeof event.preventDefault === 'function') {
            event.preventDefault();
        }
        if (event && typeof event.stopPropagation === 'function') {
            event.stopPropagation();
        }

        const activeSite = window?.InjectionTargetsOnWebsite?.activeSite;
        if (activeSite !== 'ChatGPT') {
            this.__toast('Copy last response is only active on ChatGPT.', 'info');
            return { status: 'failed', reason: 'wrong_site' };
        }

        const messageRoot = this.__findLastChatGPTAssistantMessage();
        if (!messageRoot) {
            this.__toast('Could not find the last ChatGPT response.', 'error');
            logConCgp('[buttons][ChatGPT-copy] Last assistant response not found.');
            return { status: 'failed', reason: 'response_not_found' };
        }

        const nativeCopyButton = this.__findChatGPTResponseCopyButton(messageRoot);
        if (nativeCopyButton) {
            nativeCopyButton.click();
            this.__toast('Copied last ChatGPT response.', 'success');
            logConCgp('[buttons][ChatGPT-copy] Clicked native ChatGPT copy button.');
            return { status: 'success', copiedVia: 'native_copy_button' };
        }

        const responseText = this.__extractChatGPTResponseText(messageRoot);
        if (!responseText.trim()) {
            this.__toast('Found the response, but it looked empty.', 'warning');
            logConCgp('[buttons][ChatGPT-copy] Response text extraction returned empty text.');
            return { status: 'failed', reason: 'empty_response' };
        }

        try {
            await this.__writeTextToClipboard(responseText);
            this.__toast('Copied last ChatGPT response.', 'success');
            logConCgp('[buttons][ChatGPT-copy] Copied response text with fallback clipboard path.');
            return { status: 'success', copiedVia: 'text_fallback' };
        } catch (error) {
            this.__toast('Could not copy the last ChatGPT response.', 'error');
            logConCgp('[buttons][ChatGPT-copy] Clipboard write failed:', error?.message || error);
            return { status: 'failed', reason: 'clipboard_failed' };
        }
    },

    /**
     * Queues the current editor text, clears the editor for the next item, and
     * starts the existing queue engine with the configured initial delay.
     * @param {Event} event
     * @returns {Promise<Object>}
     */
    queueCurrentEditorText: async function (event, defaultDelaySeconds) {
        if (event && typeof event.preventDefault === 'function') {
            event.preventDefault();
        }
        if (event && typeof event.stopPropagation === 'function') {
            event.stopPropagation();
        }

        // Shift + click on Queue button opens slider + entry flyout over cursor to edit delay in seconds
        if (event && event.shiftKey) {
            this.__showDelayFlyout(event);
            return { status: 'flyout_opened' };
        }

        const queue = window.MaxExtensionFloatingPanel;

        // Apply custom defaultDelaySeconds if provided on regular click
        if (defaultDelaySeconds !== undefined && defaultDelaySeconds !== null) {
            const parsedDelay = parseInt(defaultDelaySeconds, 10);
            if (Number.isFinite(parsedDelay) && parsedDelay > 0) {
                if (!window.globalMaxExtensionConfig) {
                    window.globalMaxExtensionConfig = {};
                }
                window.globalMaxExtensionConfig.queueDelaySeconds = parsedDelay;
                window.globalMaxExtensionConfig.queueDelayUnit = 'sec';
                if (queue && typeof queue.recalculateRunningTimer === 'function') {
                    queue.recalculateRunningTimer();
                }
                if (queue && typeof queue.syncQueueModeUiFromConfig === 'function') {
                    queue.syncQueueModeUiFromConfig();
                }
            }
        }

        const editor = this.__findActiveEditor();
        if (!editor) {
            this.__toast('Could not find the chat editor.', 'error');
            logConCgp('[buttons][queue] Editor not found.');
            return { status: 'failed', reason: 'editor_not_found' };
        }

        const text = this.__readEditorText(editor).trim();
        if (!text) {
            this.__toast('Nothing to queue. Type text in the editor first.', 'warning');
            return { status: 'failed', reason: 'empty_editor' };
        }

        if (!queue || typeof queue.addToQueue !== 'function' || typeof queue.startQueue !== 'function') {
            this.__toast('Queue engine is not ready on this page.', 'error');
            return { status: 'failed', reason: 'queue_unavailable' };
        }

        if (!window.globalMaxExtensionConfig) {
            window.globalMaxExtensionConfig = {};
        }
        window.globalMaxExtensionConfig.enableQueueMode = true;
        if (typeof queue.syncQueueModeUiFromConfig === 'function') {
            queue.syncQueueModeUiFromConfig();
        }
        if (typeof queue.saveCurrentProfileConfig === 'function') {
            queue.saveCurrentProfileConfig();
        }

        const container = event?.target?.closest?.('[id$="-custom-buttons-container"]');
        if (container && typeof queue.ensureInlineQueueControls === 'function') {
            queue.ensureInlineQueueControls(container);
        }

        const queuedItem = queue.addToQueue({
            icon: event?.target?.innerHTML || '⏳',
            text,
            autoSend: true,
            source: 'editor-queue-button'
        });
        if (!queuedItem) {
            this.__toast('Queue is full or unavailable. Editor text was not cleared.', 'error');
            return { status: 'failed', reason: 'queue_add_failed' };
        }

        queue.lastQueuedEditorText = text;
        queue.queuedEditorTextCache = Array.isArray(queue.queuedEditorTextCache)
            ? queue.queuedEditorTextCache
            : [];
        queue.queuedEditorTextCache.push({
            text,
            timestamp: Date.now()
        });

        const cleared = this.__clearEditor(editor);
        if (!cleared) {
            this.__toast('Queued, but could not clear the editor.', 'warning');
        }

        queue.startQueue({ waitBeforeFirstSend: true });
        const count = Array.isArray(queue.promptQueue) ? queue.promptQueue.length : 0;
        this.__toast(`Queued. ${count} item${count === 1 ? '' : 's'} waiting.`, 'success');
        return { status: 'queued', count };
    },

    /**
     * Creates a normal custom prompt button from the current editor text.
     * The editor is intentionally left unchanged.
     * @param {Event} event
     * @returns {Promise<Object>}
     */
    createButtonFromEditorText: async function (event) {
        if (event && typeof event.preventDefault === 'function') {
            event.preventDefault();
        }
        if (event && typeof event.stopPropagation === 'function') {
            event.stopPropagation();
        }

        const editor = this.__findActiveEditor();
        if (!editor) {
            this.__toast('Could not find the chat editor.', 'error');
            logConCgp('[buttons][create] Editor not found.');
            return { status: 'failed', reason: 'editor_not_found' };
        }

        const text = this.__readEditorText(editor).trim();
        if (!text) {
            this.__toast('Nothing to turn into a button. Type text in the editor first.', 'warning');
            return { status: 'failed', reason: 'empty_editor' };
        }

        try {
            const response = await chrome.runtime.sendMessage({
                type: 'createCustomButtonFromEditorText',
                text,
                autoSend: true
            });

            if (!response?.success) {
                const reason = response?.reason || response?.error || 'unknown';
                this.__toast('Could not create button from editor text.', 'error');
                logConCgp('[buttons][create] Create button request failed:', reason);
                return { status: 'failed', reason };
            }

            this.__toast('Button created from editor text.', 'success');
            this.__showCreatedButtonFlyout(event, response);
            return { status: 'created', ...response };
        } catch (error) {
            this.__toast('Could not create button from editor text.', 'error');
            logConCgp('[buttons][create] Create button request error:', error?.message || error);
            return { status: 'failed', reason: 'message_error' };
        }
    },

    __showCreatedButtonFlyout: function (event, created) {
        const existing = document.getElementById('ocp-create-button-flyout');
        if (existing) {
            if (typeof existing.__ocp_cleanup === 'function') {
                existing.__ocp_cleanup();
            }
            existing.remove();
        }

        const flyout = document.createElement('div');
        flyout.id = 'ocp-create-button-flyout';
        flyout.style.cssText = `
            position: fixed;
            z-index: 2147483647;
            width: 260px;
            padding: 12px;
            display: grid;
            gap: 10px;
            border: 1px solid rgba(255, 255, 255, 0.16);
            border-radius: 12px;
            background: rgba(25, 25, 25, 0.82);
            backdrop-filter: blur(12px) saturate(180%);
            -webkit-backdrop-filter: blur(12px) saturate(180%);
            box-shadow: 0 10px 34px rgba(0, 0, 0, 0.34);
            color: #ffffff;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            font-size: 13px;
            pointer-events: auto;
            opacity: 0;
            transform: scale(0.96);
            transition: opacity 150ms ease, transform 150ms ease;
        `;

        const header = document.createElement('div');
        header.style.cssText = 'display: flex; align-items: center; justify-content: space-between; gap: 8px; font-weight: 700;';

        const title = document.createElement('span');
        title.textContent = '+ Button created';

        const closeButton = document.createElement('button');
        closeButton.type = 'button';
        closeButton.textContent = '×';
        closeButton.setAttribute('aria-label', 'Close');
        closeButton.style.cssText = `
            width: 26px;
            height: 26px;
            border: 0;
            border-radius: 6px;
            background: rgba(255, 255, 255, 0.1);
            color: #fff;
            cursor: pointer;
            font-size: 18px;
            line-height: 1;
        `;

        header.append(title, closeButton);

        const preview = document.createElement('div');
        preview.textContent = created?.button?.text || '';
        preview.style.cssText = `
            max-height: 72px;
            overflow: hidden;
            padding: 8px;
            border-radius: 8px;
            background: rgba(255, 255, 255, 0.08);
            color: rgba(255, 255, 255, 0.84);
            line-height: 1.3;
        `;

        const iconLabel = document.createElement('label');
        iconLabel.style.cssText = 'display: flex; align-items: center; justify-content: space-between; gap: 10px;';

        const iconText = document.createElement('span');
        iconText.textContent = 'Icon';

        const iconInput = document.createElement('input');
        iconInput.type = 'text';
        iconInput.value = created?.button?.icon || '+';
        iconInput.setAttribute('aria-label', 'New button icon');
        iconInput.style.cssText = `
            width: 72px;
            min-height: 28px;
            border: 1px solid rgba(255, 255, 255, 0.18);
            border-radius: 8px;
            background: rgba(255, 255, 255, 0.1);
            color: #fff;
            font-size: 18px;
            text-align: center;
            outline: none;
        `;

        iconLabel.append(iconText, iconInput);

        const toggleLabel = document.createElement('label');
        toggleLabel.style.cssText = 'display: flex; align-items: center; justify-content: space-between; gap: 10px;';

        const toggleText = document.createElement('span');
        toggleText.textContent = 'Auto-send';

        const toggle = document.createElement('input');
        toggle.type = 'checkbox';
        toggle.checked = created?.button?.autoSend !== false;
        toggle.style.cssText = 'width: 18px; height: 18px; accent-color: #10a37f;';

        toggleLabel.append(toggleText, toggle);
        flyout.append(header, preview, iconLabel, toggleLabel);
        document.body.appendChild(flyout);

        const rect = event?.target?.getBoundingClientRect?.();
        let x = rect ? rect.left : (event?.clientX || 24);
        let y = rect ? rect.bottom + 8 : (event?.clientY || 24);
        x = Math.max(10, Math.min(window.innerWidth - 280, x));
        y = Math.max(10, Math.min(window.innerHeight - 170, y));
        flyout.style.left = `${Math.round(x)}px`;
        flyout.style.top = `${Math.round(y)}px`;

        const closeFlyout = () => {
            flyout.style.opacity = '0';
            flyout.style.transform = 'scale(0.96)';
            setTimeout(() => flyout.remove(), 150);
            document.removeEventListener('keydown', onKeyDown, true);
        };

        flyout.__ocp_cleanup = () => {
            document.removeEventListener('keydown', onKeyDown, true);
        };

        const onKeyDown = (keyEvent) => {
            if (keyEvent.key === 'Escape') {
                closeFlyout();
            }
        };

        let iconSaveTimer = null;
        const saveCreatedButtonOptions = async (options = {}) => {
            const response = await chrome.runtime.sendMessage({
                type: 'updateCustomButtonFromEditorOptions',
                profileName: created.profileName,
                buttonIndex: created.buttonIndex,
                text: created?.button?.text || '',
                autoSend: toggle.checked,
                icon: iconInput.value,
                ...options
            });
            if (!response?.success) {
                throw new Error(response?.reason || response?.error || 'update_failed');
            }
            created.button = response.button || {
                ...created.button,
                autoSend: toggle.checked,
                icon: iconInput.value.trim() || '+'
            };
            created.buttonIndex = response.buttonIndex ?? created.buttonIndex;
            if (iconInput.value !== created.button.icon) {
                iconInput.value = created.button.icon;
            }
            return response;
        };

        iconInput.addEventListener('input', () => {
            clearTimeout(iconSaveTimer);
            iconSaveTimer = setTimeout(async () => {
                try {
                    await saveCreatedButtonOptions();
                } catch (error) {
                    this.__toast('Could not update icon for the new button.', 'error');
                    logConCgp('[buttons][create] Icon update failed:', error?.message || error);
                }
            }, 250);
        });

        iconInput.addEventListener('change', async () => {
            clearTimeout(iconSaveTimer);
            try {
                await saveCreatedButtonOptions();
            } catch (error) {
                this.__toast('Could not update icon for the new button.', 'error');
                logConCgp('[buttons][create] Icon update failed:', error?.message || error);
            }
        });

        toggle.addEventListener('change', async () => {
            try {
                await saveCreatedButtonOptions({ autoSend: toggle.checked });
                this.__toast(toggle.checked ? 'New button will auto-send.' : 'New button will not auto-send.', 'success');
            } catch (error) {
                toggle.checked = !toggle.checked;
                this.__toast('Could not update Auto-send for the new button.', 'error');
                logConCgp('[buttons][create] Auto-send update failed:', error?.message || error);
            }
        });

        closeButton.addEventListener('click', closeFlyout);
        document.addEventListener('keydown', onKeyDown, true);

        requestAnimationFrame(() => {
            flyout.style.opacity = '1';
            flyout.style.transform = 'scale(1)';
        });
    },

    __showDelayFlyout: function (event) {
        // Remove any existing flyout
        const existing = document.getElementById('ocp-queue-delay-flyout');
        if (existing) {
            existing.remove();
        }

        const flyout = document.createElement('div');
        flyout.id = 'ocp-queue-delay-flyout';
        
        // Premium glassmorphism styles
        flyout.style.cssText = `
            position: fixed;
            z-index: 2147483647;
            background: rgba(25, 25, 25, 0.75);
            backdrop-filter: blur(12px) saturate(180%);
            -webkit-backdrop-filter: blur(12px) saturate(180%);
            border: 1px solid rgba(255, 255, 255, 0.12);
            border-radius: 12px;
            box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.37);
            padding: 14px;
            color: #ffffff;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            font-size: 13px;
            width: 240px;
            display: flex;
            flex-direction: column;
            gap: 10px;
            pointer-events: auto;
            user-select: none;
            transition: opacity 150ms ease, transform 150ms ease;
            opacity: 0;
            transform: scale(0.95);
        `;

        const currentDelay = window.globalMaxExtensionConfig?.queueDelaySeconds !== undefined
            ? window.globalMaxExtensionConfig.queueDelaySeconds
            : 60; // Fallback to 60 as default for the whole app

        flyout.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; font-weight: 600; margin-bottom: 2px;">
                <span>Queue Delay</span>
                <span id="ocp-flyout-close" style="cursor: pointer; opacity: 0.6; font-size: 16px; padding: 2px 6px; transition: opacity 120ms;">&times;</span>
            </div>
            <div style="display: flex; flex-direction: column; gap: 4px;">
                <div style="display: flex; justify-content: space-between; color: rgba(255,255,255,0.7); font-size: 11px;">
                    <span>Adjust (sec):</span>
                    <span id="ocp-flyout-val" style="font-weight: bold; color: #10a37f;">${currentDelay}s</span>
                </div>
                <input type="range" id="ocp-flyout-slider" min="10" max="600" value="${Math.min(600, Math.max(10, currentDelay))}" style="
                    width: 100%;
                    accent-color: #10a37f;
                    cursor: pointer;
                    height: 5px;
                    border-radius: 5px;
                    background: rgba(255,255,255,0.2);
                    outline: none;
                    margin: 4px 0;
                ">
            </div>
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
                <span>Exact seconds:</span>
                <input type="number" id="ocp-flyout-input" min="1" max="64000" value="${currentDelay}" style="
                    width: 75px;
                    background: rgba(255, 255, 255, 0.1);
                    border: 1px solid rgba(255,255,255,0.2);
                    border-radius: 6px;
                    color: #fff;
                    padding: 4px 6px;
                    text-align: right;
                    font-size: 13px;
                    outline: none;
                ">
            </div>
        `;

        document.body.appendChild(flyout);

        // Position over cursor or fallback to button
        let x = event.clientX - 120;
        let y = event.clientY - 130;
        
        // Keep in viewport
        x = Math.max(10, Math.min(window.innerWidth - 260, x));
        y = Math.max(10, Math.min(window.innerHeight - 180, y));

        flyout.style.left = `${x}px`;
        flyout.style.top = `${y}px`;

        requestAnimationFrame(() => {
            flyout.style.opacity = '1';
            flyout.style.transform = 'scale(1)';
        });

        const slider = flyout.querySelector('#ocp-flyout-slider');
        const input = flyout.querySelector('#ocp-flyout-input');
        const valLabel = flyout.querySelector('#ocp-flyout-val');
        const closeBtn = flyout.querySelector('#ocp-flyout-close');

        const updateDelay = (val) => {
            const parsed = parseInt(val, 10);
            if (!Number.isFinite(parsed)) return;
            const clamped = Math.max(1, Math.min(64000, parsed));
            
            // Save state
            if (!window.globalMaxExtensionConfig) {
                window.globalMaxExtensionConfig = {};
            }
            window.globalMaxExtensionConfig.queueDelaySeconds = clamped;
            window.globalMaxExtensionConfig.queueDelayUnit = 'sec';

            // Recalculate
            const queue = window.MaxExtensionFloatingPanel;
            if (queue && typeof queue.recalculateRunningTimer === 'function') {
                queue.recalculateRunningTimer();
            }
            if (queue && typeof queue.syncQueueModeUiFromConfig === 'function') {
                queue.syncQueueModeUiFromConfig();
            }
            if (queue && typeof queue.saveCurrentProfileConfig === 'function') {
                queue.saveCurrentProfileConfig();
            }

            // Sync visual labels
            valLabel.textContent = `${clamped}s`;
            if (slider.value !== String(clamped) && clamped <= 600 && clamped >= 10) {
                slider.value = String(clamped);
            }
            if (input.value !== String(clamped)) {
                input.value = String(clamped);
            }
        };

        slider.addEventListener('input', (e) => {
            updateDelay(e.target.value);
        });

        input.addEventListener('input', (e) => {
            updateDelay(e.target.value);
        });

        input.addEventListener('change', (e) => {
            const val = parseInt(e.target.value, 10);
            const clamped = Number.isFinite(val) ? Math.max(1, Math.min(64000, val)) : 60;
            updateDelay(clamped);
        });

        const closeFlyout = () => {
            flyout.style.opacity = '0';
            flyout.style.transform = 'scale(0.95)';
            setTimeout(() => {
                flyout.remove();
            }, 150);
            document.removeEventListener('mousedown', onOutsideClick, true);
            document.removeEventListener('keydown', onKeyDown, true);
        };

        const onOutsideClick = (e) => {
            if (!flyout.contains(e.target)) {
                closeFlyout();
            }
        };

        const onKeyDown = (e) => {
            if (e.key === 'Escape') {
                closeFlyout();
            }
        };

        closeBtn.addEventListener('click', closeFlyout);
        closeBtn.addEventListener('mouseenter', () => { closeBtn.style.opacity = '1'; });
        closeBtn.addEventListener('mouseleave', () => { closeBtn.style.opacity = '0.6'; });

        // Wait slightly to hook click-outside listener to avoid immediate triggers
        setTimeout(() => {
            document.addEventListener('mousedown', onOutsideClick, true);
            document.addEventListener('keydown', onKeyDown, true);
        }, 50);
    },

    __findActiveEditor: function () {
        const editorSelectors = window?.InjectionTargetsOnWebsite?.selectors?.editors;
        return (Array.isArray(editorSelectors) ? editorSelectors : [])
            .map((selector) => {
                try {
                    return document.querySelector(selector);
                } catch (_) {
                    return null;
                }
            })
            .find((el) => el);
    },

    __readEditorText: function (editor) {
        if (!editor) return '';
        if ('value' in editor) return editor.value || '';
        return editor.innerText || editor.textContent || '';
    },

    __clearEditor: function (editor) {
        try {
            editor.focus();
            if ('value' in editor) {
                editor.value = '';
                editor.dispatchEvent(new Event('input', { bubbles: true }));
                editor.dispatchEvent(new Event('change', { bubbles: true }));
                return true;
            }

            if (editor.isContentEditable || editor.getAttribute('contenteditable') === 'true') {
                const selection = window.getSelection();
                const range = document.createRange();
                range.selectNodeContents(editor);
                selection.removeAllRanges();
                selection.addRange(range);

                let deleted = false;
                try {
                    deleted = document.execCommand('delete', false);
                } catch (_) {
                    deleted = false;
                }

                if (!deleted) {
                    editor.innerHTML = '<p><br></p>';
                }

                editor.dispatchEvent(new Event('input', { bubbles: true }));
                editor.dispatchEvent(new Event('change', { bubbles: true }));
                selection.removeAllRanges();
                return true;
            }

            editor.textContent = '';
            editor.dispatchEvent(new Event('input', { bubbles: true }));
            return true;
        } catch (error) {
            logConCgp('[buttons][queue] Editor clear failed:', error?.message || error);
            return false;
        }
    },

    __findLastChatGPTAssistantMessage: function () {
        const roleNodes = Array.from(document.querySelectorAll('[data-message-author-role="assistant"]'))
            .filter((node) => this.__isUsableChatGPTNode(node));

        if (roleNodes.length > 0) {
            return this.__getChatGPTMessageRoot(roleNodes[roleNodes.length - 1]);
        }

        const turnNodes = Array.from(document.querySelectorAll('article, [data-testid^="conversation-turn"], [data-testid*="conversation-turn"]'))
            .filter((node) => this.__isUsableChatGPTNode(node))
            .filter((node) => {
                const text = [
                    node.getAttribute('data-message-author-role'),
                    node.getAttribute('data-testid'),
                    node.getAttribute('aria-label')
                ].join(' ').toLowerCase();
                return text.includes('assistant') || !!node.querySelector('.markdown');
            });

        return turnNodes.length > 0 ? turnNodes[turnNodes.length - 1] : null;
    },

    __getChatGPTMessageRoot: function (node) {
        return node.closest('article, [data-testid^="conversation-turn"], [data-testid*="conversation-turn"]') || node;
    },

    __findChatGPTResponseCopyButton: function (messageRoot) {
        const copyButtons = Array.from(messageRoot.querySelectorAll('button'))
            .filter((button) => this.__isUsableChatGPTNode(button))
            .filter((button) => !button.disabled)
            .filter((button) => !button.closest('pre, code'))
            .filter((button) => {
                const label = [
                    button.getAttribute('aria-label'),
                    button.getAttribute('title'),
                    button.getAttribute('data-testid'),
                    button.textContent
                ].join(' ').toLowerCase();

                if (!label.includes('copy')) return false;
                return !label.includes('copy code');
            });

        return copyButtons.length > 0 ? copyButtons[copyButtons.length - 1] : null;
    },

    __extractChatGPTResponseText: function (messageRoot) {
        const contentNode =
            messageRoot.querySelector('[data-message-author-role="assistant"] .markdown')
            || messageRoot.querySelector('.markdown')
            || messageRoot.querySelector('[data-message-author-role="assistant"]')
            || messageRoot;

        const clone = contentNode.cloneNode(true);
        clone.querySelectorAll('button, input, textarea, select, svg, [role="toolbar"], [data-testid*="copy" i], .sr-only')
            .forEach((node) => node.remove());

        return (clone.innerText || clone.textContent || '').trim();
    },

    __writeTextToClipboard: async function (text) {
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function' && window.isSecureContext) {
            await navigator.clipboard.writeText(text);
            return;
        }

        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', '');
        textarea.style.cssText = 'position: fixed; top: -1000px; left: -1000px; opacity: 0;';
        document.body.appendChild(textarea);
        textarea.select();

        try {
            const copied = document.execCommand('copy');
            if (!copied) {
                throw new Error('document.execCommand("copy") returned false');
            }
        } finally {
            textarea.remove();
        }
    },

    __isUsableChatGPTNode: function (node) {
        if (!node || !(node instanceof Element)) return false;
        if (node.closest('#toastContainer, #max-extension-floating-panel, [id$="-custom-buttons-container"]')) return false;
        const rect = node.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    },

    __toast: function (message, type = 'info') {
        if (typeof window.showToast === 'function') {
            window.showToast(message, type);
        }
    },

    /**
     * Determines the appropriate shortcut key for a button based on its index, skipping separator buttons.
     * @param {number} offset - A number to offset the calculated shortcut index.
     * @param {number} buttonIndex - The index of the button in the custom buttons array.
     * @returns {number|null} - The assigned shortcut key (1-10) or null if no shortcut is assigned.
     */
    determineShortcutKeyForButtonIndex: function (buttonIndex, offset = 0) {
        let shortcutAssignmentCount = 0;
        for (let i = 0; i < globalMaxExtensionConfig.customButtons.length; i++) {
            if (!globalMaxExtensionConfig.customButtons[i].separator) {
                shortcutAssignmentCount++;
                if (i === buttonIndex) {
                    const finalShortcutIndex = offset + shortcutAssignmentCount;
                    if (finalShortcutIndex <= 10) {
                        return finalShortcutIndex;
                    }
                }
            }
        }
        return null;
    }
};

// #region clickingbuttons - entry

/**
 * Handles click events on custom send buttons across different supported sites.
 * Orchestrates different text insertion and send strategies based on the active site.
 * This is it, from there the functions are called that are located in different sites:
 * buttons-claude.js, buttons-copilot.js, buttons-chatgpt.js
 * @param {Event|Object} event - The click event object. May be a synthetic object with { __fromQueue: true }.
 * @param {string} customText - The custom text to be inserted
 * @param {boolean} autoSend - Flag indicating whether to automatically send the message
 */
async function processCustomSendButtonClick(event, customText, autoSend) {
    // Detect if this invocation originates from the queue engine.
    const invokedByQueue = !!(event && event.__fromQueue);

    // Check if we are in queue mode in the floating panel.
    // IMPORTANT: When invoked by the queue itself, do NOT re-enqueue.
    if (!invokedByQueue &&
        window.MaxExtensionFloatingPanel &&
        window.MaxExtensionFloatingPanel.isPanelVisible &&
        globalMaxExtensionConfig.enableQueueMode) {

        const buttonConfig = {
            icon: (event && event.target) ? event.target.innerHTML : '',
            text: customText,
            autoSend: autoSend
        };
        // Add to queue and stop further processing. The engine handles the rest.
        window.MaxExtensionFloatingPanel.addToQueue(buttonConfig);
        return;
    }

    if (event && typeof event.preventDefault === 'function') {
        event.preventDefault();
    }
    logConCgp('[buttons] Custom send button clicked');

    // Invert autoSend if Shift key is pressed during a real click (not for queued dispatches)
    if (!invokedByQueue && event && event.shiftKey) {
        autoSend = !autoSend;
        logConCgp('[buttons] Shift key detected. autoSend inverted to:', autoSend);
    }

    // Get the active site from the injection targets
    const activeSite = window.InjectionTargetsOnWebsite.activeSite;
    logConCgp('[buttons] Active site:', activeSite);

    // Route to site-specific handlers (unchanged)
    // Route to site-specific handlers (unchanged)
    switch (activeSite) {
        case 'ChatGPT':
            return await processChatGPTCustomSendButtonClick(event, customText, autoSend);
        case 'Claude':
            return await processClaudeCustomSendButtonClick(event, customText, autoSend);
        case 'Copilot':
            return await processCopilotCustomSendButtonClick(event, customText, autoSend);
        case 'DeepSeek':
            return await processDeepSeekCustomSendButtonClick(event, customText, autoSend);
        case 'AIStudio':
            return await processAIStudioCustomSendButtonClick(event, customText, autoSend);
        case 'Grok':
            return await processGrokCustomSendButtonClick(event, customText, autoSend);
        case 'Gemini': // Added Gemini case
            return await processGeminiCustomSendButtonClick(event, customText, autoSend);
        case 'Perplexity':
            return await processPerplexityCustomSendButtonClick(event, customText, autoSend);
        default:
            logConCgp('[buttons] Unsupported site:', activeSite);
            return { status: 'failed', reason: 'unsupported_site' };
    }
}

// #endregion
