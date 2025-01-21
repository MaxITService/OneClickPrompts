// buttons-clicking-deepseek.js
// Version: 1.1
// Handles DeepSeek-specific button clicking and text insertion logic

'use strict';

/**
 * Processes DeepSeek custom button clicks with full ChatGPT-like functionality
 * @param {Event} event - Click event object
 * @param {string} customText - Text to insert into editor
 * @param {boolean} autoSend - Whether to automatically send message
 */
function processDeepSeekCustomSendButtonClick(event, customText, autoSend) {
    event.preventDefault();
    logConCgp('[DeepSeek] Custom button clicked with text:', customText);

    const injectionTargets = window.InjectionTargetsOnWebsite.selectors;
    let editorArea = null;

    // Find editor using configured selectors
    for (const selector of injectionTargets.editors) {
        editorArea = document.querySelector(selector);
        if (editorArea) {
            logConCgp('[DeepSeek] Editor found:', editorArea);
            break;
        }
    }

    if (!editorArea) {
        logConCgp('[DeepSeek] Editor element not found');
        return;
    }

    /**
     * Locates send buttons using configured selectors
     * @returns {HTMLElement[]} Array of found send buttons
     */
    function locateSendButtons() {
        const sendButtons = [];
        injectionTargets.sendButtons.forEach(selector => {
            document.querySelectorAll(selector).forEach(btn => {
                if (!sendButtons.includes(btn)) {
                    logConCgp('[DeepSeek] Found send button:', btn);
                    sendButtons.push(btn);
                }
            });
        });
        return sendButtons;
    }

    /**
     * Starts auto-send interval with ChatGPT-like behavior
     * @param {HTMLElement} editor - Editor element reference
     */
    // buttons-clicking-deepseek.js
    // Update the startAutoSend function:

    function startAutoSend(editor) {
        logConCgp('[DeepSeek] Starting auto-send process');

        if (window.deepseekAutoSendInterval) {
            logConCgp('[DeepSeek] Auto-send already running');
            return;
        }

        // Create a temporary attribute to mark the text we're sending
        const timestamp = Date.now();
        editor.setAttribute('data-autosend-text', timestamp);

        window.deepseekAutoSendInterval = setInterval(() => {
            // Check if the text is still present using both input methods
            const currentText = editor.value ? editor.value.trim() : '';
            const divText = document.querySelector('.b13855df')?.textContent?.trim() || '';

            // Verify this is our text using the timestamp marker
            const isOurText = editor.getAttribute('data-autosend-text') === String(timestamp);

            if ((currentText.length === 0 && divText.length === 0) || !isOurText) {
                logConCgp('[DeepSeek] Text cleared - stopping auto-send');
                clearInterval(window.deepseekAutoSendInterval);
                window.deepseekAutoSendInterval = null;
                editor.removeAttribute('data-autosend-text');
                return;
            }

            // Find the actual send button (not just submit buttons)
            const sendButtons = locateSendButtons().filter(btn => {
                const text = btn.querySelector('.ad0c98fd')?.textContent?.toLowerCase();
                return text === 'deepthink' || text === 'search';
            });

            if (sendButtons.length > 0) {
                logConCgp('[DeepSeek] Clicking verified send button:', sendButtons[0]);

                // Use direct click instead of simulation for DeepSeek's complex button structure
                sendButtons[0].click();

                // Clear the interval immediately after successful click
                clearInterval(window.deepseekAutoSendInterval);
                window.deepseekAutoSendInterval = null;
                editor.removeAttribute('data-autosend-text');

                logConCgp('[DeepSeek] Send button clicked successfully');
            }
        }, 300); // Reduced interval to 300ms for better responsiveness
    }

    /**
     * Handles text insertion with proper event simulation
     * @param {HTMLElement} editor - Editor element
     */
    function handleMessageInsertion(editor) {
        logConCgp('[DeepSeek] Inserting text:', customText);

        // Focus and clear existing text if needed
        editor.focus();
        editor.value = customText;

        // Dispatch full sequence of events
        const inputEvent = new Event('input', { bubbles: true });
        const changeEvent = new Event('change', { bubbles: true });

        editor.dispatchEvent(inputEvent);
        editor.dispatchEvent(changeEvent);

        logConCgp('[DeepSeek] Text inserted and events dispatched');

        // Handle auto-send if enabled
        if (autoSend && globalMaxExtensionConfig.globalAutoSendEnabled) {
            startAutoSend(editor);
        }
    }

    // Start the insertion process
    handleMessageInsertion(editorArea);
}

/**
 * Initializes DeepSeek button injection using centralized logic
 */
function initializeDeepSeekButtonInjection() {
    logConCgp('[DeepSeek] Initializing button injection');

    window.MaxExtensionUtils.waitForElements(
        window.InjectionTargetsOnWebsite.selectors.containers,
        (container) => {
            // Use centralized initialization from buttons-init
            window.MaxExtensionButtonsInit.createAndInsertCustomElements(container);
            logConCgp('[DeepSeek] Custom elements injected successfully');
        },
        50 // Max attempts
    );
}

// DOM ready initialization
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeDeepSeekButtonInjection);
} else {
    initializeDeepSeekButtonInjection();
}

// Expose function globally for unified click handling
window.processDeepSeekCustomSendButtonClick = processDeepSeekCustomSendButtonClick;