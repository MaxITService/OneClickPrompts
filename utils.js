// utils.js
// Version: 1.0
// Instructions for AI: do not remove comments! MUST NOT REMOVE COMMENTS.

'use strict';

window.MaxExtensionUtils = {
    // Utility function to wait for an element to be present in the DOM
    waitForElement: function(selector, callback, maxAttempts = 50) {
        let attempts = 0;
        const observer = new MutationObserver((mutations, obs) => {
            const element = document.querySelector(selector);
            if (element) {
                obs.disconnect();
                callback(element);
            } else if (++attempts >= maxAttempts) {
                obs.disconnect();
                logConCgp(`[utils] Element ${selector} not found after ${maxAttempts} attempts.`);
            }
        });
        observer.observe(document, { childList: true, subtree: true });
    },

    // Function to simulate a comprehensive click event
    simulateClick: function(element) {
        const event = new MouseEvent('click', {
            view: window,
            bubbles: true,
            cancelable: true,
            buttons: 1
        });
        element.dispatchEvent(event);
    },

    // Function to insert text into the editor by updating innerHTML and dispatching input event
    insertTextIntoEditor: function(editorDiv, text) {
        logConCgp('[utils] Attempting to insert text into the editor by updating innerHTML.');
        editorDiv.focus();

        // Escape HTML entities in the text
        const escapedText = text.replace(/</g, '&lt;').replace(/>/g, '&gt;');

        // Update the innerHTML directly
        editorDiv.innerHTML = `<p>${escapedText}</p>`;

        // Dispatch an input event to notify React of the change
        const event = new Event('input', { bubbles: true });
        editorDiv.dispatchEvent(event);
        logConCgp('[utils] Editor content updated and input event dispatched.');
    },

    // Function to move cursor to the end of a contenteditable element
    moveCursorToEnd: function(contentEditableElement) {
        contentEditableElement.focus();
        if (typeof window.getSelection != "undefined" && typeof document.createRange != "undefined") {
            const range = document.createRange();
            range.selectNodeContents(contentEditableElement);
            range.collapse(false);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
        } else if (typeof document.body.createTextRange != "undefined") {
            const textRange = document.body.createTextRange();
            textRange.moveToElementText(contentEditableElement);
            textRange.collapse(false);
            textRange.select();
        }
    },

    // Function to create a visual separator
    createSeparator: function() {
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
 * This class centralizes all selectors and identifiers for different websites.
 * Currently implemented for ChatGPT. Other websites can be added as needed.
 */
class InjectionTargetsOnWebsite {
    constructor() {
        this.activeSite = this.identifyActiveWebsite();
        this.selectors = this.getSelectorsForSite(this.activeSite);
    }

    identifyActiveWebsite() {
        const currentHostname = window.location.hostname;

        if (currentHostname.includes('chat.openai.com') || currentHostname.includes('chatgpt.com')) {
            return 'ChatGPT';
        }
        // else if (currentHostname.includes('anotherwebsite.com')) {
        //     return 'AnotherWebsite';
        // }
        else {
            return 'Unknown';
        }
    }

    getSelectorsForSite(site) {
        const selectors = {
            ChatGPT: {
                container: 'div.flex.w-full.flex-col:has(textarea)',
                sendButton: 'button[data-testid="send-button"]',
                editor: '#prompt-textarea',
                buttonsContainerId: 'custom-buttons-container'
            },
            // TODO: Add selectors for other supported websites
            // Claude: {
            //     container: '...',
            //     sendButton: '...',
            //     editor: '...',
            //     buttonsContainerId: '...'
            // },
        };
        return selectors[site] || {};
    }
}

// Instantiate and expose the InjectionTargetsOnWebsite globally
window.InjectionTargetsOnWebsite = new InjectionTargetsOnWebsite();
