// utils.js
// Version: 1.1
// Both backend and popup are using this file

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
                sendButtons: [
                    'button.bg-accent-main-000.text-oncolor-100', // most specific: key classes (language-independent)
                    'button[type="button"].bg-accent-main-000', // fallback: type and main class
                    'button[type="button"]', // generic fallback
                    'button[type="button"][aria-label="Send message"].bg-accent-main-000.text-oncolor-100', // fallback: type, aria-label, and key classes (language-dependent)
                    'button[type="button"][aria-label="Send message"]', // fallback: type and aria-label (language-dependent)
                ],
                editors: ['div.ProseMirror[contenteditable="true"]'],
                buttonsContainerId: 'claude-custom-buttons-container'
            },
            Copilot: {
                // Updated Copilot selectors (April 2025)
                // Container: new Copilot chat composer container
                containers: [
                    'div.w-expanded-composer.max-w-chat.bg-gradient-to-b', // main composer container
                    'div.relative.max-h-full.w-expanded-composer', // fallback: outermost
                    'div.flex.grow.flex-col.overflow-hidden', // fallback: inner flex container
                    'div.shadow-composer-input' // legacy fallback
                ],
                // Editor: textarea for user input
                editors: [
                    'textarea#userInput.block.min-h-user-input.w-full', // most specific
                    'textarea#userInput', // fallback by id
                    'textarea.block.min-h-user-input', // fallback by class
                    'textarea[placeholder="Message Copilot"]', // fallback by placeholder
                    'textarea' // generic fallback
                ],
                // Send button: Copilot's submit button (non-ARIA, non-language-dependent)
                sendButtons: [
                    'button[type="button"][data-testid="submit-button"]', // primary: matches Copilot's new submit button
                    'button[type="button"].rounded-submitButton[title="Submit message"]', // matches class and title
                    'button[type="button"][title="Submit message"]', // fallback by type and title
                    'button.rounded-submitButton', // fallback by class only
                    'button[type="submit"]', // legacy fallback
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
                // Updated selectors for new Grok UI (April 2025)
                // Container: the chat form (unique structure)
                containers: [
                    'form.bottom-0.w-full.text-base.flex.flex-col.gap-2.items-center.justify-center.relative.z-10',
                    'form.w-full.flex-col.items-center.justify-center', // fallback if classes change
                    'form[method][class*="gap-2"][class*="flex-col"]' // fallback for structure
                ],
                // Send button: submit button at the bottom of the chat form
                sendButtons: [
                    'form.bottom-0.w-full.text-base.flex.flex-col.gap-2.items-center.justify-center.relative.z-10 button[type="submit"]',
                    'form button[type="submit"].group', // fallback if .group class remains
                    'form button[type="submit"]' // fallback: any submit button in form
                ],
                // Editor: textarea inside the chat form, with new class structure
                editors: [
                    'form.bottom-0.w-full.text-base.flex.flex-col.gap-2.items-center.justify-center.relative.z-10 textarea[aria-label="Ask Grok anything"]',
                    'textarea[aria-label="Ask Grok anything"]',
                    'textarea.w-full.px-2', // fallback for px-2 class
                    'textarea' // fallback: any textarea
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