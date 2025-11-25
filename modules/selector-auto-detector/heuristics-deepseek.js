/**
 * DeepSeek-specific heuristics for editor and send button discovery.
 * Registered with the site heuristics registry so the Brain can pick it up when DeepSeek is active.
 */

'use strict';

(function () {
    const isVisible = (el) => {
        if (!el) return false;
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return rect.width > 10 &&
            rect.height > 10 &&
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            style.opacity !== '0';
    };

    const unique = (list) => {
        const seen = new Set();
        return list.filter((el) => {
            if (!el) return false;
            if (seen.has(el)) return false;
            seen.add(el);
            return true;
        });
    };

    const detectEditor = async () => {
        // Note: this selector list mirrors the defaults in utils.js so heuristics can still
        // guess an editor when the Guard's configured selectors fail (e.g., class churn).
        const selectors = [
            'textarea[placeholder="Message DeepSeek"]',
            'textarea[aria-label*="Message"]',
            'textarea[placeholder*="Message"]',
            '[class*="chat-input"] textarea',
            '[class*="chat-input"] [contenteditable="true"]',
            'textarea',
            'div[contenteditable="true"]',
            'textarea._27c9245',
            'textarea.ds-scroll-area'
        ];

        const candidates = unique(
            selectors.flatMap(sel => Array.from(document.querySelectorAll(sel)))
        ).filter(isVisible);

        if (candidates.length === 0) return null;

        const scored = candidates.map(el => {
            let score = 0;
            const placeholder = (el.getAttribute('placeholder') || '').toLowerCase();
            const aria = (el.getAttribute('aria-label') || '').toLowerCase();
            const cls = el.className || '';

            if (placeholder === 'message deepseek') score += 12;
            else if (placeholder.includes('message') || aria.includes('message')) score += 8;
            if (cls.includes('ds-scroll-area') || cls.includes('_27c9245')) score += 2;
            if (el.tagName === 'TEXTAREA') score += 3;

            const footer = el.closest('[class*="editor"], [class*="footer"], form');
            if (footer) score += 2;

            const rect = el.getBoundingClientRect();
            score += rect.top; // prefer lower on the page

            return { el, score };
        });

        scored.sort((a, b) => b.score - a.score);
        return scored[0]?.el || null;
    };

    const detectSendButton = async () => {
        const editor = await detectEditor().catch(() => null);
        const editorRect = editor ? editor.getBoundingClientRect() : null;

        const candidates = unique([
            ...document.querySelectorAll('.ds-icon-button'),
            ...document.querySelectorAll('button'),
            ...document.querySelectorAll('[role="button"]'),
            ...document.querySelectorAll('[data-testid]')
        ]).filter(el => {
            if (!isVisible(el)) return false;
            const testId = (el.getAttribute('data-testid') || '').toLowerCase();
            if (testId.startsWith('custom-send-button')) return false; // ignore our own buttons
            const ocpContainer = el.closest('[id*="custom-buttons-container"], [data-ocp-profile-selector]');
            if (ocpContainer) return false; // avoid OCP UI
            return true;
        });

        if (candidates.length === 0) return null;

        const scored = candidates.map(el => {
            let score = 0;
            const aria = (el.getAttribute('aria-label') || '').toLowerCase();
            const title = (el.getAttribute('title') || '').toLowerCase();
            const testId = (el.getAttribute('data-testid') || '').toLowerCase();
            const text = (el.innerText || '').toLowerCase();
            const cls = (el.className || '').toLowerCase();

            const matchesSend = (str) => str.includes('send');

            if (matchesSend(aria) || matchesSend(title) || matchesSend(testId) || matchesSend(text)) score += 10;
            if (cls.includes('ds-icon-button')) score += 5;
            if (el.querySelector('svg')) score += 4;

            const container = el.closest('[class*="button"], [class*="footer"], form');
            if (container) score += 3;

            if (editorRect) {
                const rect = el.getBoundingClientRect();
                const verticalProximity = Math.max(0, 200 - Math.abs(rect.top - editorRect.top));
                const horizontalProximity = Math.max(0, 300 - Math.abs(rect.left - editorRect.right));
                score += verticalProximity * 0.01;
                score += horizontalProximity * 0.01;
                if (rect.top >= editorRect.top) score += 2; // below or aligned with editor
            }

            if (el.disabled || el.getAttribute('aria-disabled') === 'true') {
                score -= 5; // avoid disabled matches that blocked recovery earlier
            }

            return { el, score };
        });

        scored.sort((a, b) => b.score - a.score);
        const best = scored[0];
        if (best && best.score > 0) {
            return best.el;
        }
        return null;
    };

    if (window.OneClickPromptsSiteHeuristics?.register) {
        window.OneClickPromptsSiteHeuristics.register('DeepSeek', {
            detectEditor,
            detectSendButton
        });
    }
})();
