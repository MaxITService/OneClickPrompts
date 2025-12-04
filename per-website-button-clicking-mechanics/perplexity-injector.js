// per-website-button-clicking-mechanics/perplexity-injector.js
// This script runs in the Main World (page context) to bypass isolated world limitations.

(function () {
    try {
        // We communicate via a custom event or by looking for the target element with data attribute
        // Since we can't easily pass arguments to a src-injected script, we'll look for the element 
        // that has the pending text stored in a dataset attribute.

        // Find the element that initiated this request
        const targetElement = document.querySelector('[data-ocp-target]');
        if (!targetElement) return;

        const text = targetElement.getAttribute('data-ocp-text');
        if (!text) return; // Nothing to insert

        // Clean up immediately
        targetElement.removeAttribute('data-ocp-text');
        // We keep the ID for a moment if needed, but the previous code removed it. 
        // Let's remove the ID after we are done.

        targetElement.focus();

        // Attempt 1: Use execCommand (Best for undo history and framework listeners)
        // We first move cursor to the end to APPEND as requested
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(targetElement);
        range.collapse(false); // Collapse to end
        selection.removeAllRanges();
        selection.addRange(range);

        const success = document.execCommand('insertText', false, text);

        // Attempt 2: Direct DOM manipulation (Fallback)
        if (!success) {
            // Append text manually
            const currentVal = targetElement.textContent;
            targetElement.textContent = currentVal + text;

            // Dispatch events to notify framework
            targetElement.dispatchEvent(new InputEvent('input', {
                bubbles: true,
                inputType: 'insertText',
                data: text
            }));
            targetElement.dispatchEvent(new Event('change', { bubbles: true }));
        }

        // Cleanup ID
        targetElement.removeAttribute('data-ocp-target');

        // Notify content script of success (optional, but good for debugging)
        // console.log('[OneClickPrompts] Main world insertion completed.');

    } catch (e) {
        console.error('[OneClickPrompts] Main world insertion failed:', e);
    }
})();
