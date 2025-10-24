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
    },

    // Function to simulate pasting text into a contenteditable element
    simulatePaste: function (element, textToPaste) {
        element.focus();
        logConCgp('[utils] Attempting to simulate paste.');

        // Ensure cursor is at the end
        this.moveCursorToEnd(element);

        // Create a DataTransfer object
        const dataTransfer = new DataTransfer();
        dataTransfer.setData('text/plain', textToPaste);

        // Create and dispatch the paste event
        const pasteEvent = new ClipboardEvent('paste', {
            clipboardData: dataTransfer,
            bubbles: true,
            cancelable: true,
            composed: true
        });

        element.dispatchEvent(pasteEvent);
        logConCgp('[utils] Paste event dispatched with text:', textToPaste);

        // Small delay might be needed for the editor to process the paste
        setTimeout(() => {
            this.moveCursorToEnd(element); // Ensure cursor is at the end after paste
            logConCgp('[utils] Cursor moved to end after paste simulation.');
        }, 50); // 50ms delay
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
        else if (currentHostname.includes('perplexity.ai')) {
            return 'Perplexity';
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
        // Ensure we have a synchronous default ready before any async work
        const defaultSelectors = this.getDefaultSelectors(this.activeSite);
        this.selectors = defaultSelectors;
        try {
            // Try to get custom selectors first
            const customSelectors = await this.getCustomSelectors(this.activeSite);
            if (customSelectors) {
                this.selectors = customSelectors;
                logConCgp(`[utils] Using custom selectors for ${this.activeSite}`);
            } else {
                this.selectors = defaultSelectors;
                logConCgp(`[utils] Using default selectors for ${this.activeSite}`);
            }
        } catch (error) {
            logConCgp(`[utils] Error loading selectors for ${this.activeSite}: ${error?.message || error}`);
            this.selectors = defaultSelectors;
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
                containers: [
                    'form[data-type="unified-composer"] .\\[grid-area\\:footer\\]',
                    'form[data-type="unified-composer"] > div.rounded-\\[28px\\]',
                    'form[data-type="unified-composer"] > div:has(#prompt-textarea)',
                    'form[data-type="unified-composer"]',
                    'main.flex.flex-col.items-center'
                ],
                sendButtons: [
                    'button[aria-label="Send message"]', // new main send button
                    'button[data-testid="send-button"]', // legacy/testid fallback
                    'button[type="submit"]', // generic fallback
                    'button.send-button-class' // legacy fallback
                ],
                editors: [
                    'div.ProseMirror#prompt-textarea[contenteditable="true"]', // new main editor
                    'div.ProseMirror[contenteditable="true"]', // fallback
                    'div[contenteditable="true"].ProseMirror', // fallback
                    'div.ProseMirror', // legacy fallback
                    'textarea',
                ],
                threadRoot: '#thread',
                buttonsContainerId: 'chatgpt-custom-buttons-container'
            },
            Claude: {
                containers: [
                    'div.flex.flex-col.bg-bg-000.rounded-2xl',
                    'div.flex.flex-col.bg-bg-000.gap-1\\.5'
                ],
                sendButtons: [
                    'button.bg-accent-main-000.text-oncolor-100',
                    'button[type="button"].bg-accent-main-000',
                    'button[type="button"]',
                    'button[type="button"][aria-label="Send message"].bg-accent-main-000.text-oncolor-100',
                    'button[type="button"][aria-label="Send message"]',
                ],
                editors: ['div.ProseMirror[contenteditable="true"]'],
                threadRoot: 'div.flex-1.max-w-3xl.mx-auto:has([data-testid="user-message"])',
                buttonsContainerId: 'claude-custom-buttons-container'
            },
            Copilot: {
                containers: [
                    'div.w-expanded-composer.max-w-chat.bg-gradient-to-b',
                    'div.relative.max-h-full.w-expanded-composer',
                    'div.flex.grow.flex-col.overflow-hidden',
                    'div.shadow-composer-input'
                ],
                editors: [
                    'textarea#userInput.block.min-h-user-input.w-full',
                    'textarea#userInput',
                    'textarea.block.min-h-user-input',
                    'textarea[placeholder="Message Copilot"]',
                    'textarea'
                ],
                sendButtons: [
                    'button[type="button"][data-testid="submit-button"]',
                    'button[type="button"].rounded-submitButton[title="Submit message"]',
                    'button[type="button"][title="Submit message"]',
                    'button.rounded-submitButton',
                    'button[type="submit"]',
                ],
                threadRoot: 'div.max-w-chat[data-content="conversation"]',
                buttonsContainerId: 'copilot-custom-buttons-container'
            },
            DeepSeek: {
                "buttonsContainerId": "deepseek-custom-buttons-container",
                "containers": [
                    "div._020ab5b",
                    "div.ec4f5d61",
                    "[class*=\"button-container\"]",
                    "[class*=\"editor-footer\"]"
                ],
                "editors": [
                    "textarea._27c9245",
                    "textarea.ds-scroll-area",
                    "textarea[placeholder*=\"Message\"]",
                    "[class*=\"chat-input\"]"
                ],
                "sendButtons": [
                    "div.bf38813a .ds-icon-button[aria-disabled=\"true\"]",
                    "div.bf38813a .ds-icon-button:has(svg)",
                    "[data-testid*=\"send-button\"]",
                    "[aria-label*=\"send\" i]"
                ],
                "threadRoot": ".scrollable:has(textarea, [contenteditable=\"true\"])"
            },
            AIStudio: {
                containers: [
                    'div.prompt-input-wrapper',
                    'div.prompt-input-wrapper-container',
                    'section.text-and-attachments-wrapper',
                    'section.chunk-editor-main',
                    'footer',
                    'ms-chunk-editor-menu',
                    'body > app-root > div > div > div.layout-wrapper > div > span > ms-prompt-switcher > ms-chunk-editor > section > footer'
                ],
                sendButtons: [
                    'button.run-button[type="submit"]',
                    'button[aria-label="Run"]',
                    'run-button button[type="submit"]',
                    'button.run-button',
                    'footer > div.input-wrapper > div:nth-child(3) > run-button > button'
                ],
                editors: [
                    'textarea[aria-label="Type something or tab to choose an example prompt"]',
                    'textarea[aria-label*="Type something"]',
                    'ms-autosize-textarea textarea',
                    'ms-autosize-textarea textarea.v3-font-body'
                ],
                buttonsContainerId: 'aistudio-custom-buttons-container'
            },
            Grok: {
                containers: [
                    'form.bottom-0.w-full.text-base.flex.flex-col.gap-2.items-center.justify-center.relative.z-10',
                    'form.w-full.flex-col.items-center.justify-center',
                    'form[method][class*="gap-2"][class*="flex-col"]'
                ],
                sendButtons: [
                    'form.bottom-0.w-full.text-base.flex.flex-col.gap-2.items-center.justify-center.relative.z-10 button[type="submit"]',
                    'form button[type="submit"].group', 
                    'form button[type="submit"]' 
                ],
                
                editors: [
                    'textarea[aria-label="Ask Grok anything"]',
                    'textarea.w-full.text-fg-primary[aria-label="Ask Grok anything"]',
                    'textarea.w-full.text-fg-primary.px-2.leading-7',   
                    'textarea[dir="auto"][aria-label="Ask Grok anything"]',                    
                    'form.chat-form textarea[aria-label="Ask Grok anything"]',                    
                    'textarea.w-full.text-fg-primary.bg-transparent.focus\\:outline-none',                   
                    'textarea.w-full.text-fg-primary'
                ],
                threadRoot: '.w-full.h-full.overflow-y-auto.overflow-x-hidden.scrollbar-gutter-stable.flex.flex-col.items-center.px-gutter',
                buttonsContainerId: 'grok-custom-buttons-container'
            },
            Gemini: {
                containers: [
                    'chat-window input-container',
                    'input-container',
                    'main'
                ],
                sendButtons: [
                    'button.send-button[aria-label="Send message"]',
                    'button[aria-label="Send message"][aria-disabled="false"]'
                ],
                editors: [
                    'div.ql-editor[contenteditable="true"]',
                    'rich-textarea div.ql-editor'
                ],
                threadRoot: 'infinite-scroller[data-test-id="chat-history-container"]',
                buttonsContainerId: 'gemini-custom-buttons-container'
            },
            Perplexity: {
                containers: [
                    'div.bg-raised…grid grid-cols-3',
                    'div:has(#ask-input)[class*="grid"]',
                    'div:has(#ask-input)[class*="composer"]'
                ],
                sendButtons: [
                    'button[data-testid="submit-button"][aria-label="Submit"]',
                    'button[data-testid="submit-button"]',
                    'button[type="button"][aria-label="Submit"]',
                    'button[aria-label="Submit"]'
                ],
                editors: [
                    'div#ask-input[contenteditable="true"]',
                    'div[contenteditable="true"][data-lexical-editor="true"]',
                    'div[contenteditable="true"]'
                ],
                threadRoot: 'div.relative.border-subtlest.ring-subtlest.divide-subtlest.bg-base',
                buttonsContainerId: 'perplexity-custom-buttons-container'
            }
        };
        return selectors[site] || {};
    }
}

// Instantiate and expose the InjectionTargetsOnWebsite globally
window.InjectionTargetsOnWebsite = new InjectionTargetsOnWebsite();
