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

        const action = targetElement.getAttribute('data-ocp-action') || 'insert';
        if (action === 'clear') {
            const readText = () => targetElement.innerText || targetElement.textContent || '';
            const lexicalEditor = targetElement.__lexicalEditor;
            if (!lexicalEditor || typeof lexicalEditor.getEditorState !== 'function') {
                throw new Error('Perplexity Lexical editor instance is unavailable.');
            }

            const currentEditorState = lexicalEditor.getEditorState();
            const currentRoot = currentEditorState?._nodeMap?.get?.('root');
            const canClearRoot = typeof lexicalEditor.update === 'function'
                && typeof currentRoot?.clear === 'function';
            const canReplaceState = typeof lexicalEditor.parseEditorState === 'function'
                && typeof lexicalEditor.setEditorState === 'function'
                && typeof currentEditorState?.toJSON === 'function';

            const replaceEditorState = () => {
                const serializedState = lexicalEditor.getEditorState().toJSON();
                const emptyEditorState = lexicalEditor.parseEditorState({
                    ...serializedState,
                    root: {
                        ...serializedState.root,
                        children: []
                    }
                });
                lexicalEditor.setEditorState(emptyEditorState);
            };

            if (canClearRoot) {
                try {
                    lexicalEditor.update(() => {
                        const root = lexicalEditor.getEditorState()?._nodeMap?.get?.('root');
                        if (!root || typeof root.clear !== 'function') {
                            throw new Error('Perplexity Lexical root is unavailable during update.');
                        }
                        root.clear();
                    });
                } catch (error) {
                    if (!canReplaceState) throw error;
                    replaceEditorState();
                }
            } else if (canReplaceState) {
                replaceEditorState();
            } else {
                throw new Error('Perplexity Lexical editor does not expose a supported clear API.');
            }

            const finishClear = () => {
                const committedState = lexicalEditor.getEditorState();
                const committedRoot = typeof committedState?.toJSON === 'function'
                    ? committedState.toJSON().root
                    : null;
                const lexicalStateIsEmpty = committedRoot
                    ? Array.isArray(committedRoot.children) && committedRoot.children.length === 0
                    : typeof targetElement.__lexicalTextContent === 'string'
                        && targetElement.__lexicalTextContent.trim().length === 0;
                const cleared = lexicalStateIsEmpty
                    && readText().trim().length === 0;
                targetElement.setAttribute('data-ocp-clear-result', String(cleared));
                targetElement.removeAttribute('data-ocp-text');
                targetElement.removeAttribute('data-ocp-action');
                targetElement.removeAttribute('data-ocp-target');
                if (cleared) targetElement.removeAttribute('data-ocp-clear-pending');
                targetElement.dispatchEvent(new CustomEvent('ocp-perplexity-editor-cleared', {
                    detail: { cleared }
                }));
            };

            setTimeout(finishClear, 1100);
            return;
        }

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
        targetElement.removeAttribute('data-ocp-action');

        // Notify content script of success (optional, but good for debugging)
        // console.log('[OneClickPrompts] Main world insertion completed.');

    } catch (e) {
        console.error('[OneClickPrompts] Main world insertion failed:', e);
    }
})();
