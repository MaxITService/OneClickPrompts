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
        const escapedText = text.replace(/</g, '<').replace(/>/g, '>');

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
        this.initializeSelectors();
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
        else if (currentHostname.includes('grok.com')) {
            return 'Grok';
        }
        else if (currentHostname.includes('gemini.google.com')) { // Added Gemini detection
            return 'Gemini';
        }
        // Add additional website detections here
        else {
            return 'Unknown';
        }
    }

    /**
     * Initialize selectors by trying to load custom ones first, then falling back to defaults
     */
    async initializeSelectors() {
        try {
            // Try to get custom selectors first
            const customSelectors = await this.getCustomSelectors(this.activeSite);
            if (customSelectors) {
                this.selectors = customSelectors;
                logConCgp(`[utils] Using custom selectors for ${this.activeSite}`);
            } else {
                // Fall back to defaults
                this.selectors = this.getDefaultSelectors(this.activeSite);
                logConCgp(`[utils] Using default selectors for ${this.activeSite}`);
            }
        } catch (error) {
            console.error('Error loading selectors:', error);
            // Fall back to defaults on error
            this.selectors = this.getDefaultSelectors(this.activeSite);
        }
    }

    /**
     * Attempts to retrieve custom selectors from storage
     * @param {string} site - The name of the website
     * @returns {Promise<Object|null>} - Custom selectors or null if not found
     */
    async getCustomSelectors(site) {
        return new Promise((resolve) => {
            chrome.runtime.sendMessage({
                type: 'getCustomSelectors',
                site: site
            }, (response) => {
                if (response && response.selectors) {
                    resolve(response.selectors);
                } else {
                    resolve(null);
                }
            });
        });
    }

    /**
     * Retrieves the default selectors for the specified website.
     * @param {string} site - The name of the website.
     * @returns {Object} - An object containing the selectors for the site.
     */
    getDefaultSelectors(site) {
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
                    // Primary selectors (ARIA-based)
                    'section.chunk-editor-main',
                    'footer',
                    'ms-chunk-editor-menu',
                    // Fallback selectors (DOM path)
                    'body > app-root > div > div > div.layout-wrapper > div > span > ms-prompt-switcher > ms-chunk-editor > section > footer'
                ],
                sendButtons: [
                    // Primary selectors (ARIA-based)
                    'button.run-button[type="submit"]',
                    'button[aria-label="Run"]',
                    'run-button button[type="submit"]',
                    // Fallback selectors (DOM path)
                    'footer > div.input-wrapper > div:nth-child(3) > run-button > button'
                ],
                editors: [
                    // Primary selectors (ARIA-based)
                    'ms-autosize-textarea textarea[aria-label="User text input"]',
                    'textarea.textarea.gmat-body-medium[aria-label="Type something"]',
                    // Fallback selectors (DOM path)
                    'footer > div.input-wrapper > div.text-wrapper > ms-chunk-input > section > ms-text-chunk > ms-autosize-textarea'
                ],
                buttonsContainerId: 'aistudio-custom-buttons-container'
            },
            Grok: {
                // Updated Grok selectors: injecting custom buttons into the chat form to avoid conflicts.
                // Use the form element as container.
                containers: [
                    'form.bottom-0.w-full.text-base.flex.flex-col.gap-2.items-center.justify-center.relative.z-10'
                ],
                // Use a more specific selector for the send button (submit button within that form).
                sendButtons: [
                    'form.bottom-0.w-full.text-base.flex.flex-col.gap-2.items-center.justify-center.relative.z-10 button[type="submit"].group'
                ],
                // Editors remain as before.
                editors: [
                    'textarea.w-full.bg-transparent.focus\\:outline-none.text-primary',
                    'textarea.w-full.px-2.\\@\\[480px\\]\\/input\\:px-3.pt-5.mb-5.bg-transparent.focus\\:outline-none.text-primary.align-bottom'
                ],
                buttonsContainerId: 'grok-custom-buttons-container'
            },
            Gemini: { 
                 containers: [
                    'input-container', // The main container holding input and disclaimer
                    'main' // Fallback if input-container structure changes significantly
                 ],
                 sendButtons: [
                     'button.send-button[aria-label="Send message"]', // Primary send button
                     'button[aria-label="Send message"][aria-disabled="false"]' // Explicitly enabled state
                 ],
                 editors: [
                     'div.ql-editor[contenteditable="true"]', // Quill editor div
                     'rich-textarea div.ql-editor' // More specific path
                 ],
                 buttonsContainerId: 'gemini-custom-buttons-container' // Unique ID
             }
            // TODO: Add selectors for other supported websites
        };
        return selectors[site] || {};
    }
}

// Instantiate and expose the InjectionTargetsOnWebsite globally
window.InjectionTargetsOnWebsite = new InjectionTargetsOnWebsite();