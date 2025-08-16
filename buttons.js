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

        const icons = { copy: '📋', paste: '📥' };
        const baseTooltips = { copy: 'Copy prompt from input area', paste: 'Paste stored prompt' };

        buttonElement.innerHTML = icons[type];

        // Style the button
        buttonElement.style.cssText = `
            background-color: transparent;
            border: none;
            cursor: pointer;
            padding: 1px;
            font-size: 20px;
            margin-right: 5px;
            margin-bottom: 5px;
        `;

        // --- Tooltip & Shortcut ---
        // Determine auto-send status from global config to add to tooltip
        const autoSendEnabled = (type === 'copy')
            ? window.globalCrossChatConfig?.autosendCopy
            : window.globalCrossChatConfig?.autosendPaste;
        const autoSendDescription = autoSendEnabled ? ' (Auto-sends)' : '';

        let shortcutDescription = '';
        if (shortcutKey) {
            buttonElement.dataset.shortcutKey = shortcutKey.toString();
            const displayKey = shortcutKey === 10 ? 0 : shortcutKey;
            shortcutDescription = ` (Shortcut: Alt+${displayKey})`;
        }

        const updateTooltip = (text) => {
            // Combine base text, auto-send status, and shortcut info
            buttonElement.setAttribute('title', text + autoSendDescription + shortcutDescription);
        };

        updateTooltip(baseTooltips[type]);

        // --- Event Listeners ---
        buttonElement.addEventListener('click', (event) => {
            event.preventDefault();
            if (type === 'copy') {
                const editor = window.InjectionTargetsOnWebsite.selectors.editors
                    .map(s => document.querySelector(s))
                    .find(el => el);

                if (!editor) {
                    logConCgp('[buttons-cross-chat] Editor area not found for copy.');
                    return;
                }
                const text = editor.value || editor.innerText || '';

                chrome.runtime.sendMessage({ type: 'saveStoredPrompt', promptText: text }, () => {
                    logConCgp('[buttons-cross-chat] Prompt saved.');
                    // Visually indicate success by briefly changing the tooltip
                    updateTooltip('Copied!');
                    setTimeout(() => updateTooltip(baseTooltips.copy), 1500);
                });

                // The `autosend` value passed here will be inverted by `processCustomSendButtonClick` if shift is held.
                // This ensures that shift+click correctly toggles the send behavior.
                const autoSend = window.globalCrossChatConfig?.autosendCopy;
                // Calling processCustomSendButtonClick with an empty string for the text
                // will prevent appending the text again, but will still trigger the auto-send
                // mechanism with the existing text.
                processCustomSendButtonClick(event, '', autoSend);

            } else if (type === 'paste') {
                chrome.runtime.sendMessage({ type: 'getStoredPrompt' }, (response) => {
                    if (response?.promptText) {
                        // The `autosend` value is taken directly from config.
                        // `processCustomSendButtonClick` will handle shift+click to invert it.
                        // This fixes a bug where shift+click was double-inverting the behavior.
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
                }, 300); // 300ms debounce
            });

            buttonElement.addEventListener('mouseout', () => {
                clearTimeout(tooltipFetchTimeout);
                updateTooltip(baseTooltips.paste); // Reset to default tooltip
            });
        }

        return buttonElement;
    },
    /**
     * Creates a custom send button based on the provided configuration.
     * @param {Object} buttonConfig - The configuration object for the custom button.
     * @param {number} buttonIndex - The index of the button in the custom buttons array.
     * @param {Function} onClickHandler - The function to handle the button's click event.
     * @param {number|null} [overrideShortcutKey=null] - An optional shortcut key to override the default calculation.
     * @returns {HTMLButtonElement} - The newly created custom send button element.
     */
    createCustomSendButton: function (buttonConfig, buttonIndex, onClickHandler, overrideShortcutKey = null) {
        const customButtonElement = document.createElement('button');
        customButtonElement.type = 'button'; // Prevent form being defaut type, that is "submit".
        customButtonElement.innerHTML = buttonConfig.icon;
        customButtonElement.setAttribute('data-testid', `custom-send-button-${buttonIndex}`);

        // Assign keyboard shortcuts to the first 10 non-separator buttons if shortcuts are enabled
        let assignedShortcutKey = overrideShortcutKey;
        if (assignedShortcutKey === null && globalMaxExtensionConfig.enableShortcuts) {
            assignedShortcutKey = this.determineShortcutKeyForButtonIndex(buttonIndex, 0); // Pass 0 as offset for old logic
        }

        if (assignedShortcutKey !== null) {
            customButtonElement.dataset.shortcutKey = assignedShortcutKey.toString();
        }

        // Prepare tooltip parts: append (Auto-sends) if autoSend behavior is enabled
        const autoSendDescription = buttonConfig.autoSend ? ' (Auto-sends)' : '';
        const shortcutDescription = assignedShortcutKey !== null ? ` (Shortcut: Alt+${assignedShortcutKey === 10 ? 0 : assignedShortcutKey})` : '';

        // Set the tooltip (title attribute) combining the button text with auto-send and shortcut info
        customButtonElement.setAttribute('title', `${buttonConfig.text}${autoSendDescription}${shortcutDescription}`);

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
function processCustomSendButtonClick(event, customText, autoSend) {
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
    switch (activeSite) {
        case 'ChatGPT':
            processChatGPTCustomSendButtonClick(event, customText, autoSend);
            break;
        case 'Claude':
            processClaudeCustomSendButtonClick(event, customText, autoSend);
            break;
        case 'Copilot':
            processCopilotCustomSendButtonClick(event, customText, autoSend);
            break;
        case 'DeepSeek':
            processDeepSeekCustomSendButtonClick(event, customText, autoSend);
            break;
        case 'AIStudio':
            processAIStudioCustomSendButtonClick(event, customText, autoSend);
            break;
        case 'Grok':
            processGrokCustomSendButtonClick(event, customText, autoSend);
            break;
        case 'Gemini': // Added Gemini case
            processGeminiCustomSendButtonClick(event, customText, autoSend);
            break;
        default:
            logConCgp('[buttons] Unsupported site:', activeSite);
    }
}

// #endregion
