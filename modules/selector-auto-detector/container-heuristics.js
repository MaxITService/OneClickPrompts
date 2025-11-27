// modules/selector-auto-detector/container-heuristics.js
/**
 * File: modules/selector-auto-detector/container-heuristics.js
 * Version: 1.0
 *
 * Description:
 * Heuristics for finding a suitable button container when the saved or default selector fails.
 * It attempts to look for "likely alternatives" nearby in the DOM or using standard fallbacks.
 */

'use strict';

window.OneClickPromptsContainerHeuristics = {
    /**
     * Attempts to find an alternative container.
     * @param {string[]} failedSelectors - The list of selectors that failed.
     * @returns {HTMLElement|null} - A likely candidate or null.
     */
    findAlternativeContainer: function (failedSelectors) {
        logConCgp('[ContainerHeuristics] Starting search for alternative container.');

        // 1. Try Default Selectors (if we were using custom ones)
        // If the user had a custom selector that failed, maybe the site reverted to default structure?
        const site = window.InjectionTargetsOnWebsite?.activeSite;
        if (site && site !== 'Unknown') {
            const defaults = window.InjectionTargetsOnWebsite.getDefaultSelectors(site);
            if (defaults && Array.isArray(defaults.containers)) {
                // Filter out any that are in the failed list to avoid redundancy
                const freshCandidates = defaults.containers.filter(s => !failedSelectors.includes(s));
                if (freshCandidates.length > 0) {
                    const found = window.MaxExtensionUtils.pickUsableContainer(freshCandidates);
                    if (found) {
                        logConCgp('[ContainerHeuristics] Found container using default fallback selectors.', found);
                        return found;
                    }
                }
            }
        }

        // 2. Structural Heuristics (Siblings/Parents)
        // If we have a failed selector that is path-based (contains '>'), we can try to look at the parent.
        // We only try this for the *first* failed selector as a best-effort guess.
        const primarySelector = failedSelectors[0];
        if (primarySelector && primarySelector.includes('>')) {
            // Try to find the parent of the expected element
            // e.g. "div.main > div.content > div.target" -> try "div.main > div.content"
            const parts = primarySelector.split('>');
            if (parts.length > 1) {
                parts.pop(); // Remove the last part (the missing target)
                const parentSelector = parts.join('>').trim();
                try {
                    const parent = document.querySelector(parentSelector);
                    if (parent) {
                        logConCgp('[ContainerHeuristics] Found parent of missing container:', parent);
                        // Look at children of this parent
                        const children = Array.from(parent.children);
                        for (const child of children) {
                            if (this.isValidContainer(child)) {
                                // Simple heuristic: pick the last valid child that isn't the one we missed (obviously)
                                // and looks "container-ish" (e.g. div, footer, header)
                                logConCgp('[ContainerHeuristics] Suggesting sibling as alternative:', child);
                                return child;
                            }
                        }
                        // If no children are good, maybe the parent itself?
                        if (this.isValidContainer(parent)) {
                            return parent;
                        }
                    }
                } catch (e) {
                    logConCgp('[ContainerHeuristics] Error parsing parent selector:', e);
                }
            }
        }

        // 3. Generic "Best Guess" Scan
        // If we still haven't found anything, we could try to find a "footer-like" or "input-area-like" element.
        // This is risky, so we'll be conservative.
        // Look for elements near the bottom of the viewport or with specific keywords in class/id.
        const keywords = ['footer', 'input', 'chat-controls', 'composer', 'bottom'];
        // Limit search to body's direct descendants or 1-level deep to avoid scanning 1000s of nodes.
        // Actually, let's just skip this for now to avoid bad suggestions. 
        // The user can always use "Manual Move".

        logConCgp('[ContainerHeuristics] No alternative found.');
        return null;
    },

    /**
     * Validates if an element is suitable as a container.
     * @param {HTMLElement} element
     * @returns {boolean}
     */
    isValidContainer: function (element) {
        if (!element || !element.tagName) return false;

        // Use MaxExtensionUtils validation if available
        if (window.MaxExtensionUtils && typeof window.MaxExtensionUtils.isElementUsableForInjection === 'function') {
            if (!window.MaxExtensionUtils.isElementUsableForInjection(element)) {
                return false;
            }
        }

        // Valid container tags
        const validTags = ['DIV', 'SECTION', 'FOOTER', 'HEADER', 'MAIN', 'FORM', 'ARTICLE'];
        if (!validTags.includes(element.tagName)) {
            return false;
        }

        return true;
    }
};
