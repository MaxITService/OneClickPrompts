// buttons-clicking-deepseek.js
// Version: 2.0 - Robust implementation
// Handles DeepSeek input and sending with multiple fallbacks

'use strict';

/**
 * Processes DeepSeek custom button clicks with robust input handling
 * @param {Event} event - Click event object
 * @param {string} customText - Text to insert
 * @param {boolean} autoSend - Auto-send enabled
 */
function processDeepSeekCustomSendButtonClick(event, customText, autoSend) {
    event.preventDefault();
    logConCgp('[DeepSeek] Starting processing with text:', customText);

    // 1. Find all potential editors
    const editors = Array.from(document.querySelectorAll(
        window.InjectionTargetsOnWebsite.selectors.editors.join(', ')
    )).filter(el => {
        // Filter visible editors
        const style = window.getComputedStyle(el);
        return style.display !== 'none' && style.visibility === 'visible';
    });

    if (editors.length === 0) {
        logConCgp('[DeepSeek] No active editors found');
        return;
    }

    // 2. Input handling system
    function handleEditorInput(editor, text) {
        try {
            logConCgp('[DeepSeek] Handling editor:', editor.tagName);
            
            // For textareas
            if (editor.tagName === 'TEXTAREA') {
                editor.value += text;
                editor.dispatchEvent(new Event('input', { bubbles: true }));
                editor.dispatchEvent(new Event('change', { bubbles: true }));
                return;
            }

            // For contenteditable divs
            if (editor.hasAttribute('contenteditable')) {
                const range = document.createRange();
                const selection = window.getSelection();
                range.selectNodeContents(editor);
                range.collapse(false);
                selection.removeAllRanges();
                selection.addRange(range);
                document.execCommand('insertText', false, text);
                editor.dispatchEvent(new Event('input', { bubbles: true }));
                return;
            }

            // Fallback for React-controlled divs
            editor.textContent += text;
            const reactEvent = new Event('input', { bubbles: true });
            Object.defineProperty(reactEvent, 'target', { value: editor });
            editor.dispatchEvent(reactEvent);
        } catch (error) {
            logConCgp('[DeepSeek] Input error:', error);
        }
    }

    // 3. Send button locator with fallbacks
    function findSendButton() {
        // Try primary selectors first
        const buttons = window.InjectionTargetsOnWebsite.selectors.sendButtons
            .flatMap(selector => Array.from(document.querySelectorAll(selector)))
            .filter(btn => {
                if (!btn.offsetParent) return false; // Visible check
                const disabled = btn.disabled || 
                              btn.getAttribute('aria-disabled') === 'true' ||
                              btn.classList.contains('disabled');
                return !disabled;
            });

        // Priority 1: Button with send icon
        const iconButton = buttons.find(btn => 
            btn.querySelector('svg')?.innerHTML.includes('send')
        );

        // Priority 2: Last button in container
        return iconButton || buttons[buttons.length - 1];
    }

    // 4. Robust auto-send system
    function startAutoSend() {
        const MAX_ATTEMPTS = 15; // 4.5 seconds max
        let attempts = 0;
        let interval;

        const attemptSend = () => {
            if (attempts++ > MAX_ATTEMPTS) {
                clearInterval(interval);
                return;
            }

            const sendButton = findSendButton();
            if (sendButton) {
                logConCgp('[DeepSeek] Found active send button');
                sendButton.click();
                clearInterval(interval);
            }
        };

        interval = setInterval(attemptSend, 300);
        attemptSend(); // Immediate first attempt
    }

    // Execute input on all relevant editors
    editors.forEach(editor => handleEditorInput(editor, customText));

    // Initiate auto-send if enabled
    if (autoSend && globalMaxExtensionConfig.globalAutoSendEnabled) {
        logConCgp('[DeepSeek] Starting auto-send sequence');
        startAutoSend();
    }
}

// Initialization and exports remain the same
function initializeDeepSeekButtonInjection() {
    window.MaxExtensionUtils.waitForElements(
        window.InjectionTargetsOnWebsite.selectors.containers,
        container => {
            window.MaxExtensionButtonsInit.createAndInsertCustomElements(container);
        }
    );
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeDeepSeekButtonInjection);
} else {
    initializeDeepSeekButtonInjection();
}

window.processDeepSeekCustomSendButtonClick = processDeepSeekCustomSendButtonClick;