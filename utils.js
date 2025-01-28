// utils.js
// Version: 1.1
// Instructions for AI: do not remove comments! MUST NOT REMOVE COMMENTS.

'use strict';

window.MaxExtensionUtils = {
    // Utility function to wait for an element to be present in the DOM
    waitForElements: function (selectors, callback, maxAttempts = 50) {
        if (!Array.isArray(selectors)) {
            selectors = [selectors]; // Ensure selectors is an array
        }
        let attempts = 0;
        const observer = new MutationObserver((mutations, obs) => {
            for (const selector of selectors) {
                const element = document.querySelector(selector);
                if (element) {
                    obs.disconnect();
                    callback(element);
                    return;
                }
            }
            if (++attempts >= maxAttempts) {
                obs.disconnect();
                logConCgp(`[utils] Elements ${selectors.join(', ')} not found after ${maxAttempts} attempts.`);
            }
        });
        observer.observe(document, { childList: true, subtree: true });
    },
    // Function to simulate a comprehensive click event
    simulateClick: function (element) {
        const event = new MouseEvent('click', {
            view: window,
            bubbles: true,
            cancelable: true,
            buttons: 1
        });
        element.dispatchEvent(event);
        logConCgp('[utils] simulateClick: Click event dispatched.', element);
    },

    // Function to insert text into the editor by updating innerHTML and dispatching input event
    insertTextIntoEditor: function (editorDiv, text) {
        logConCgp('[utils] Attempting to insert text into the editor by updating innerHTML.');
        editorDiv.focus();

        // Escape HTML entities in the text
        const escapedText = text.replace(/</g, '&lt;').replace(/>/g, '&gt;');

        // Update the innerHTML directly
        editorDiv.innerHTML = `<p>${escapedText}</p>`;

        // Dispatch an input event to notify ProseMirror of the change
        const event = new Event('input', { bubbles: true });
        editorDiv.dispatchEvent(event);
        logConCgp('[utils] Editor content updated and input event dispatched.');
    },

    // Function to move cursor to the end of a contenteditable element
    moveCursorToEnd: function (contentEditableElement) {
        contentEditableElement.focus();
        if (typeof window.getSelection != "undefined" && typeof document.createRange != "undefined") {
            const range = document.createRange();
            range.selectNodeContents(contentEditableElement);
            range.collapse(false);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
            logConCgp('[utils] Cursor moved to the end of the contenteditable element.');
        } else if (typeof document.body.createTextRange != "undefined") {
            const textRange = document.body.createTextRange();
            textRange.moveToElementText(contentEditableElement);
            textRange.collapse(false);
            textRange.select();
            logConCgp('[utils] Cursor moved to the end using TextRange.');
        }
    },

    // Function to create a visual separator
    createSeparator: function () {
        const separator = document.createElement('div');
        separator.style.cssText = `
            width: 1px;
            height: 24px;
            background-color: #ccc;
            margin: 0 8px;
        `;
        return separator;
    }
};

/**
 * InjectionTargetsOnWebsite
 * 
 * Centralizes all selectors and identifiers for different websites.
 * Currently implemented for ChatGPT and other sites. Other websites can be added as needed.
 */
class InjectionTargetsOnWebsite {
    constructor() {
        this.activeSite = this.identifyActiveWebsite();
        this.selectors = this.getSelectorsForSite(this.activeSite);
    }

    /**
     * Identifies the active website based on the current hostname.
     * @returns {string} - The name of the active website (e.g., 'ChatGPT', 'Claude', 'Copilot', 'Unknown').
     */
    identifyActiveWebsite() {
        const currentHostname = window.location.hostname;

        if (currentHostname.includes('chat.openai.com') || currentHostname.includes('chatgpt.com')) {
            return 'ChatGPT';
        }
        else if (currentHostname.includes('claude.ai') || currentHostname.includes('another-claude-domain.com')) { // Update with actual hostname(s)
            return 'Claude';
        }
        else if (currentHostname.includes('github.com') || currentHostname.includes('copilot')) {
            return 'Copilot';
        }
        else if (currentHostname.includes('chat.deepseek.com')) {
            return 'DeepSeek';
        } else if (currentHostname.includes('aistudio.google.com')) {
            return 'AIStudio';
        }
        // Add additional website detections here
        else {
            return 'Unknown';
        }
    }

    /**
     * Retrieves the selectors for the specified website.
     * @param {string} site - The name of the website.
     * @returns {Object} - An object containing the selectors for the site.
     */
    getSelectorsForSite(site) {
        const selectors = {
            ChatGPT: {
                containers: ['div.flex.w-full.flex-col:has(textarea)'],
                sendButtons: [
                    'button[data-testid="send-button"]',
                    'button.send-button-class',
                    'button[type="submit"]'
                ],
                editors: ['div.ProseMirror#prompt-textarea', 'div.ProseMirror'],
                buttonsContainerId: 'chatgpt-custom-buttons-container'
            },
            Claude: {
                containers: [
                    'div.flex.flex-col.bg-bg-000.rounded-2xl',
                    'div.flex.flex-col.bg-bg-000.gap-1\\.5'
                ],
                sendButtons: ['button[aria-label="Send Message"]'],
                editors: ['div.ProseMirror[contenteditable="true"]'],
                buttonsContainerId: 'claude-custom-buttons-container'
            },
            Copilot: {
                containers: ['div.shadow-composer-input'],
                sendButtons: [
                    'button.rounded-submitButton[title="Submit message"]',
                    'button[type="button"][title="Submit message"]'
                ],
                editors: [
                    'div.shadow-composer-input textarea#userInput',
                    'textarea#userInput[placeholder="Message Copilot"]'
                ],
                buttonsContainerId: 'copilot-custom-buttons-container'
            },
            DeepSeek: {
                containers: [
                    'div.dd442025', // Primary container
                    '[class*="editorContainer"]' // Class name fallback
                ],
                sendButtons: [
                    'div.bf38813a [role="button"]', // Main send button
                    'button:has(svg)', // Any button with icon
                    '[aria-label*="Send"]', // ARIA fallback
                    '[data-testid="send-button"]' // Test ID fallback
                ],
                editors: [
                    'textarea#chat-input', // Textarea editor
                    'div.b13855df', // Div-based editor
                    '[contenteditable="true"]' // Generic contenteditable
                ],
                buttonsContainerId: 'deepseek-custom-buttons-container'
            },
            AIStudio: {
                containers: [
                    'section.chunk-editor-main',  // Parent section that contains the footer
                    'footer',  // Target the footer directly
                    'ms-chunk-editor-menu' // Fallback target
                ],
                sendButtons: [
                    'button.run-button',
                    'button[aria-label="Run"]',
                    'run-button button[type="submit"]'
                ],
                editors: [
                    'ms-autosize-textarea textarea[aria-label="User text input"]',
                    'textarea.textarea.gmat-body-medium[aria-label="Type something"]'
                ],
                buttonsContainerId: 'aistudio-custom-buttons-container'
            },
            // TODO: Add selectors for other supported websites
        };
        return selectors[site] || {};
    }
}

// Instantiate and expose the InjectionTargetsOnWebsite globally
window.InjectionTargetsOnWebsite = new InjectionTargetsOnWebsite();
