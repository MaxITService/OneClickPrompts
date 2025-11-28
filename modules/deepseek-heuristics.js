// modules/deepseek-heuristics.js
// Heuristics for extracting thread text from Deepseek's dynamic DOM

(() => {
    'use strict';

    window.OCPDeepSeekHeuristics = {
        /**
         * Extracts the full text of the conversation thread.
         * @returns {string} The concatenated text of all messages.
         */
        getThreadText: function () {
            // Deepseek messages are usually wrapped in .ds-message
            // We'll try to find all of them and concatenate their text.
            const messageElements = document.querySelectorAll('.ds-message');
            if (!messageElements || messageElements.length === 0) {
                return '';
            }

            const parts = [];
            for (const el of messageElements) {
                // Use innerText to respect visibility (e.g. hidden thinking blocks if any)
                // or textContent if innerText is too expensive/unreliable? 
                // innerText is generally better for "what the user sees".
                const text = el.innerText || el.textContent || '';
                if (text.trim()) {
                    parts.push(text.trim());
                }
            }

            return parts.join('\n\n');
        }
    };
})();
