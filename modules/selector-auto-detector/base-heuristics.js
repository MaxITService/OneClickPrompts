/**
 * File: modules/selector-auto-detector/base-heuristics.js
 * Version: 1.0
 *
 * Description:
 * This module provides the base heuristics for detecting UI elements when standard selectors fail.
 * Currently a stub that logs attempts and returns null.
 * Future versions will implement real DOM analysis strategies.
 */

'use strict';

window.OneClickPromptsSelectorAutoDetectorBase = {
    /**
     * Attempts to find the chat editor using heuristics.
     * @returns {HTMLElement|null} The found editor element or null.
     */
    detectEditor: async function () {
        logConCgp('[SelectorAutoDetector] Running editor heuristics...');

        // 1. Find all potential candidates, including generic contenteditables and shadow roots.
        const collectEditables = (root) => [
            ...root.querySelectorAll('textarea, [contenteditable="true"]')
        ];

        const candidates = collectEditables(document);

        // Traverse shadow roots to catch editors nested in web components (e.g., Lexical hosts)
        const walkShadowRoots = (root) => {
            root.querySelectorAll('*').forEach(el => {
                if (el.shadowRoot) {
                    candidates.push(...collectEditables(el.shadowRoot));
                    walkShadowRoots(el.shadowRoot);
                }
            });
        };
        walkShadowRoots(document);

        logConCgp(`[SelectorAutoDetector] Found ${candidates.length} initial candidates.`);

        // 2. Filter for visibility and size
        const visibleCandidates = candidates.filter(el => {
            const rect = el.getBoundingClientRect();
            const style = window.getComputedStyle(el);

            const isVisible = style.display !== 'none' &&
                style.visibility !== 'hidden' &&
                style.opacity !== '0' &&
                rect.width > 10 &&
                rect.height > 10; // Arbitrary small size to filter out tiny hidden inputs

            return isVisible;
        });

        logConCgp(`[SelectorAutoDetector] ${visibleCandidates.length} candidates after visibility filter.`);

        if (visibleCandidates.length === 0) {
            return null;
        }

        // 3. Sort by vertical position (lowest on page first)
        // We use rect.top to determine vertical position. Higher value = lower on page.
        visibleCandidates.sort((a, b) => {
            const rectA = a.getBoundingClientRect();
            const rectB = b.getBoundingClientRect();
            return rectB.top - rectA.top;
        });

        const bestMatch = visibleCandidates[0];
        logConCgp('[SelectorAutoDetector] Best match found:', bestMatch);

        return bestMatch;
    },

    /**
     * Attempts to find the send button using heuristics.
     * @returns {HTMLElement|null} The found send button element or null.
     */

    detectSendButton: async function () {
        logConCgp('[SelectorAutoDetector] Running send button heuristics...');

        // 1. Find all potential candidates
        const candidates = [
            ...document.querySelectorAll('button'),
            ...document.querySelectorAll('[role="button"]'),
            ...document.querySelectorAll('div[onclick]'), // Sometimes used
            ...document.querySelectorAll('span[onclick]')
        ];

        logConCgp(`[SelectorAutoDetector] Found ${candidates.length} initial send button candidates.`);

        // 2. Filter for visibility and size
        const visibleCandidates = candidates.filter(el => {
            const rect = el.getBoundingClientRect();
            const style = window.getComputedStyle(el);

            const isVisible = style.display !== 'none' &&
                style.visibility !== 'hidden' &&
                style.opacity !== '0' &&
                rect.width > 10 &&
                rect.height > 10;

            return isVisible;
        });

        if (visibleCandidates.length === 0) {
            logConCgp('[SelectorAutoDetector] No visible send button candidates found.');
            return null;
        }

        // 3. Try to find the editor to use for proximity scoring
        let editor = null;
        try {
            // We use the guard here, but we need to be careful not to create infinite loops if guard calls us.
            // Ideally, we should use the base heuristic or a cached reference.
            // For now, let's try to find the editor using the base heuristic if we can't find it easily.
            editor = await this.detectEditor();
        } catch (e) {
            // Ignore error
        }

        const editorRect = editor ? editor.getBoundingClientRect() : null;

        // 4. Score candidates
        const scoredCandidates = visibleCandidates.map(el => {
            let score = 0;
            const text = (el.innerText || '').toLowerCase();
            const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
            const title = (el.getAttribute('title') || '').toLowerCase();
            const testId = (el.getAttribute('data-testid') || '').toLowerCase();

            // A. Text/Label Matches
            const keywords = ['send', 'submit', 'enter', 'chat'];
            const matchesKeyword = (str) => keywords.some(k => str.includes(k));

            if (matchesKeyword(ariaLabel)) score += 10;
            if (matchesKeyword(title)) score += 5;
            if (matchesKeyword(testId)) score += 8;
            if (text === 'send' || text === 'submit') score += 5; // Exact match

            // B. Iconography (SVG presence)
            // Modern chat apps almost always use an SVG icon for the send button
            if (el.querySelector('svg') || el.tagName.toLowerCase() === 'svg') {
                score += 5;
            }

            // C. Proximity to Editor (if editor found)
            // Send buttons are usually to the right or bottom-right of the editor
            if (editorRect) {
                const btnRect = el.getBoundingClientRect();

                // Check if it's inside the editor container or very close
                const verticalDist = Math.abs(btnRect.top - editorRect.top);
                const horizontalDist = btnRect.left - editorRect.right;

                // Inside or overlapping vertically
                if (btnRect.top >= editorRect.top && btnRect.bottom <= editorRect.bottom) {
                    score += 5;
                }

                // To the right
                if (btnRect.left >= editorRect.left) {
                    score += 3;
                }

                // Bottom right area is prime real estate for send buttons
                if (btnRect.top > editorRect.top && btnRect.left > editorRect.left) {
                    score += 2;
                }
            }

            // D. State (Disabled?)
            // If it's disabled, it might be the send button waiting for input
            if (el.disabled || el.getAttribute('aria-disabled') === 'true') {
                // Slight boost because it behaves like a send button
                score += 1;
            }

            // E. Negative Scoring (Penalize known non-send actions)
            const negativeKeywords = ['stop', 'group', 'cancel', 'attach', 'upload', 'file', 'image', 'voice', 'mic'];
            const matchesNegative = (str) => negativeKeywords.some(k => str.includes(k));

            if (matchesNegative(ariaLabel) || matchesNegative(title) || matchesNegative(testId)) {
                score -= 50; // Heavy penalty to ensure it's not picked
            }

            return { el, score };
        });

        // 5. Sort by score
        scoredCandidates.sort((a, b) => b.score - a.score);

        if (scoredCandidates.length > 0 && scoredCandidates[0].score > 0) {
            const best = scoredCandidates[0];
            logConCgp(`[SelectorAutoDetector] Best send button match:`, best);
            return best.el;
        }

        logConCgp('[SelectorAutoDetector] No high-scoring send button candidates found.');
        return null;
    }
};

// Registry enabling site-aware heuristics modules to plug in their own detectors.
window.OneClickPromptsSiteHeuristics = window.OneClickPromptsSiteHeuristics || {
    registry: {},
    /**
     * Register heuristics for a specific site name (e.g., "DeepSeek").
     * @param {string} site
     * @param {{detectEditor: function, detectSendButton: function}} impl
     */
    register(site, impl) {
        if (!site || !impl) return;
        this.registry[site] = impl;
    },
    /**
     * Resolve heuristics by site, falling back to the base heuristics.
     * @param {string} site
     * @returns {object}
     */
    resolve(site) {
        return this.registry[site] || window.OneClickPromptsSelectorAutoDetectorBase;
    }
};
