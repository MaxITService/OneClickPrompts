/**
 * ocp_tooltip.js
 * Ultramodern Frosted Glass Tooltip System
 * 
 * A shared tooltip mechanism for OneClickPrompts that works across
 * both popup pages and page-injected content scripts.
 * 
 * Features:
 * - Clipped/notched rectangle frosted glass design
 * - Configurable show delay
 * - Enable/disable toggle
 * - Automatic positioning (above or below trigger)
 * - Viewport boundary detection
 * - Supports dynamic tooltip content updates
 * 
 * Usage:
 *   // Initialize (optional, auto-initializes on DOMContentLoaded)
 *   OCPTooltip.init();
 *   
 *   // Enable tooltips for elements with data-ocp-tooltip attribute
 *   <button data-ocp-tooltip="My tooltip text">Hover me</button>
 *   
 *   // Programmatic control
 *   OCPTooltip.attach(element, 'Tooltip text');
 *   OCPTooltip.detach(element);
 *   OCPTooltip.updateText(element, 'New text');
 */

'use strict';

// ═══════════════════════════════════════════════════════════════════════════════
// SETTINGS - Configurable at the top of file
// ═══════════════════════════════════════════════════════════════════════════════

const OCP_TOOLTIP_SETTINGS = {
    /** Whether the tooltip system is enabled */
    enabled: true,

    /** Delay in milliseconds before tooltip appears (0 = instant) */
    showDelayMs: 400,

    /** Delay in milliseconds before tooltip hides after mouse leaves */
    hideDelayMs: 100,

    /** Offset from the trigger element in pixels */
    offsetPx: 8,

    /** Whether to prefer positioning above the element (falls back to below if no space) */
    preferTop: true,

    /** Maximum width for tooltips in pixels */
    maxWidth: 800,

    /** Truncate long tooltips after this many lines (0 = no truncation) */
    maxLines: 30,

    /** Custom font color (CSS color string), null = use theme-aware default */
    fontColor: null,

    /** Whether to override auto theme detection (false = auto: page theme → OS fallback) */
    themeOverride: false,

    /** Forced theme when themeOverride is true ('dark' | 'light') */
    forcedTheme: 'dark'
};

// ═══════════════════════════════════════════════════════════════════════════════
// TOOLTIP CONTROLLER
// ═══════════════════════════════════════════════════════════════════════════════

const OCPTooltip = (() => {
    // Private state
    let _tooltipEl = null;
    let _currentTrigger = null;
    let _showTimeout = null;
    let _hideTimeout = null;
    let _initialized = false;
    let _isPopupContext = false;
    let _isExtensionDocument = false;

    // Detect context (popup vs content script)
    const detectContext = () => {
        try {
            _isPopupContext = document.querySelector('.container') !== null &&
                document.querySelector('.menu-nav') !== null;
            _isExtensionDocument = (typeof location !== 'undefined') &&
                (location.protocol === 'chrome-extension:' || location.protocol === 'moz-extension:');
        } catch (e) {
            _isPopupContext = false;
            _isExtensionDocument = false;
        }
    };

    /**
     * For injected webpages (https://...), we must never hijack the host page's tooltips.
     * Scope automatic [title] attachment to known OneClickPrompts UI containers only.
     * Explicit opt-in (data-ocp-tooltip / OCPTooltip.attach) still works anywhere.
     */
    const getInjectedUiRoots = () => {
        const roots = [];

        const buttonsContainerId = window?.InjectionTargetsOnWebsite?.selectors?.buttonsContainerId;
        if (typeof buttonsContainerId === 'string' && buttonsContainerId) {
            const buttonsContainer = document.getElementById(buttonsContainerId);
            if (buttonsContainer) roots.push(buttonsContainer);
        }

        // Floating panel (when enabled)
        const floatingPanel = document.getElementById('max-extension-floating-panel');
        if (floatingPanel) roots.push(floatingPanel);

        // Toasts (created by ocp_toast.js on injected pages)
        const toastContainer = document.getElementById('toastContainer');
        if (toastContainer) roots.push(toastContainer);

        return roots;
    };

    const isInInjectedUiRoots = (element, roots) => {
        if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;
        for (const root of roots) {
            if (root && root.contains(element)) return true;
        }
        return false;
    };

    /**
     * Applies settings object to runtime config (shared by loaders/listeners)
     */
    const applySettings = (s) => {
        if (!s || typeof s !== 'object') return;
        if (typeof s.enabled === 'boolean') {
            OCP_TOOLTIP_SETTINGS.enabled = s.enabled;
            if (!s.enabled) hide();
        }
        if (typeof s.showDelayMs === 'number' && s.showDelayMs >= 0) {
            OCP_TOOLTIP_SETTINGS.showDelayMs = s.showDelayMs;
        }
        if (typeof s.fontColor === 'string' && s.fontColor) {
            OCP_TOOLTIP_SETTINGS.fontColor = s.fontColor;
        } else if (s.fontColor === null) {
            OCP_TOOLTIP_SETTINGS.fontColor = null;
        }
        // Theme override settings
        OCP_TOOLTIP_SETTINGS.themeOverride = !!s.themeOverride;
        OCP_TOOLTIP_SETTINGS.forcedTheme = s.forcedTheme === 'light' ? 'light' : 'dark';
    };

    /**
     * Loads tooltip settings from storage (for content scripts and popup)
     */
    const loadSettingsFromStorage = async () => {
        // Only attempt to load if chrome.runtime is available
        if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
            return;
        }

        try {
            const response = await new Promise((resolve, reject) => {
                chrome.runtime.sendMessage({ type: 'getTooltipSettings' }, (response) => {
                    if (chrome.runtime.lastError) {
                        reject(chrome.runtime.lastError);
                    } else {
                        resolve(response);
                    }
                });
            });
            if (response && response.settings) {
                applySettings(response.settings);
            }
        } catch (e) {
            // Silent fail - settings will use defaults
        }
    };

    /**
     * Listens for settings changes from the background script
     */
    const listenForSettingsChanges = () => {
        if (typeof chrome === 'undefined') {
            return;
        }
        try {
            if (chrome.runtime && chrome.runtime.onMessage) {
                chrome.runtime.onMessage.addListener((message) => {
                    if (message && message.type === 'tooltipSettingsChanged' && message.settings) {
                        applySettings(message.settings);
                    }
                });
            }
        } catch (e) {
            // Silent fail
        }
    };

    /**
     * Creates the tooltip DOM element if it doesn't exist
     */
    const createTooltipElement = () => {
        if (_tooltipEl) return _tooltipEl;

        _tooltipEl = document.createElement('div');
        _tooltipEl.className = 'ocp-tooltip ocp-tooltip--top';
        _tooltipEl.setAttribute('role', 'tooltip');
        _tooltipEl.setAttribute('aria-hidden', 'true');

        _tooltipEl.innerHTML = `
            <div class="ocp-tooltip__panel">
                <div class="ocp-tooltip__content"></div>
                <div class="ocp-tooltip__footer"></div>
            </div>
            <div class="ocp-tooltip__arrow"></div>
        `;

        document.body.appendChild(_tooltipEl);

        return _tooltipEl;
    };

    /**
     * Calculates optimal position for the tooltip
     */
    const calculatePosition = (triggerRect, anchorClientX = null) => {
        const tooltip = createTooltipElement();
        const tooltipRect = tooltip.getBoundingClientRect();
        const viewportHeight = window.innerHeight;
        const viewportWidth = window.innerWidth;

        let top, left;
        let position = 'top';

        // Vertical positioning
        const spaceAbove = triggerRect.top;
        const spaceBelow = viewportHeight - triggerRect.bottom;
        const tooltipHeight = tooltipRect.height + OCP_TOOLTIP_SETTINGS.offsetPx;

        if (OCP_TOOLTIP_SETTINGS.preferTop && spaceAbove >= tooltipHeight) {
            // Position above
            top = triggerRect.top - tooltipRect.height - OCP_TOOLTIP_SETTINGS.offsetPx;
            position = 'top';
        } else if (spaceBelow >= tooltipHeight) {
            // Position below
            top = triggerRect.bottom + OCP_TOOLTIP_SETTINGS.offsetPx;
            position = 'bottom';
        } else if (spaceAbove > spaceBelow) {
            // Force above even if tight
            top = triggerRect.top - tooltipRect.height - OCP_TOOLTIP_SETTINGS.offsetPx;
            position = 'top';
        } else {
            // Force below
            top = triggerRect.bottom + OCP_TOOLTIP_SETTINGS.offsetPx;
            position = 'bottom';
        }

        // Horizontal anchor:
        // Prefer actual pointer X when available, otherwise center of trigger.
        const triggerCenterX = triggerRect.left + triggerRect.width / 2;
        const anchorX = Number.isFinite(anchorClientX) ? anchorClientX : triggerCenterX;
        left = anchorX - tooltipRect.width / 2;

        // Clamp to viewport bounds with padding
        const viewportPadding = 8;
        left = Math.max(viewportPadding, Math.min(left, viewportWidth - tooltipRect.width - viewportPadding));

        // Ensure top doesn't go negative
        top = Math.max(viewportPadding, top);

        // Arrow should point toward the actual anchor point even when tooltip is clamped.
        const arrowHalf = 6; // matches 12px arrow width in CSS
        const arrowInset = 8;
        const minArrowLeft = arrowInset + arrowHalf;
        const maxArrowLeft = Math.max(minArrowLeft, tooltipRect.width - arrowInset - arrowHalf);
        const arrowLeft = Math.max(minArrowLeft, Math.min(anchorX - left, maxArrowLeft));

        return { top, left, position, arrowLeft };
    };



    /**
     * Shows the tooltip for a given trigger element
     */
    const show = (trigger, text, anchorClientX = null) => {
        if (!OCP_TOOLTIP_SETTINGS.enabled || !text) return;

        clearTimeout(_hideTimeout);

        const viewportPadding = 8;

        const getLineHeightPx = (el) => {
            try {
                const cs = window.getComputedStyle(el);
                const lh = cs.lineHeight;
                if (lh && lh !== 'normal') {
                    const v = Number.parseFloat(lh);
                    if (Number.isFinite(v) && v > 0) return v;
                }
                const fs = Number.parseFloat(cs.fontSize || '12');
                if (Number.isFinite(fs) && fs > 0) return fs * 1.45;
            } catch (_) { /* ignore */ }
            return 18;
        };

        const applyViewportLineClamp = (tooltipEl) => {
            if (!tooltipEl?.classList?.contains('ocp-tooltip--truncate')) {
                tooltipEl?.style?.removeProperty('--ocp-tooltip-max-lines');
                return;
            }
            const maxLinesSetting = Number(OCP_TOOLTIP_SETTINGS.maxLines);
            if (!Number.isFinite(maxLinesSetting) || maxLinesSetting <= 0) {
                tooltipEl?.style?.removeProperty('--ocp-tooltip-max-lines');
                return;
            }

            const contentEl = tooltipEl.querySelector('.ocp-tooltip__content');
            if (!contentEl) return;

            const footerEl = tooltipEl.querySelector('.ocp-tooltip__footer');

            // Start with the configured max lines, then shrink to fit viewport (so footer stays visible).
            tooltipEl.style.setProperty('--ocp-tooltip-max-lines', String(maxLinesSetting));

            const tooltipRect = tooltipEl.getBoundingClientRect();
            const contentRect = contentEl.getBoundingClientRect();
            const availableHeight = Math.max(80, window.innerHeight - viewportPadding * 2);

            if (tooltipRect.height <= availableHeight) {
                return;
            }

            // Non-content height includes panel padding, footer, arrow, etc.
            const nonContentHeight = Math.max(0, tooltipRect.height - contentRect.height);

            // If even non-content doesn't fit, we can't guarantee footer visibility; do best-effort with 1 line.
            const lineHeight = getLineHeightPx(contentEl);
            const contentMaxHeight = Math.max(0, availableHeight - nonContentHeight);
            const maxLinesByViewport = Math.max(1, Math.floor(contentMaxHeight / lineHeight));

            const nextLines = Math.max(1, Math.min(maxLinesSetting, maxLinesByViewport));
            tooltipEl.style.setProperty('--ocp-tooltip-max-lines', String(nextLines));

            // If footer exists but was hidden, keep behavior consistent (display toggled by parse/apply).
            if (footerEl && footerEl.style.display === 'none' && footerEl.innerHTML) {
                footerEl.style.display = 'block';
            }
        };

        /**
         * Parses the raw tooltip text to separate the main content from system messages.
         * System messages (wrapped in .ocp-tooltip__system-msg) are moved to the footer.
         * 
         * @param {HTMLElement} el - The tooltip DOM element
         * @param {string} rawText - The raw HTML string to parsing
         * @returns {string} - The cleaned body content string
         */
        const parseAndApply = (el, rawText) => {
            const tempParser = document.createElement('div');
            tempParser.innerHTML = rawText;

            // Extract system messages to footer
            const systemMsgs = tempParser.querySelectorAll('.ocp-tooltip__system-msg');
            let footerHtml = '';
            systemMsgs.forEach(msg => {
                footerHtml += msg.outerHTML;
                msg.remove();
            });
            const bodyContent = tempParser.innerHTML;

            // DOM Updates
            const contentEl = el.querySelector('.ocp-tooltip__content');
            const footerEl = el.querySelector('.ocp-tooltip__footer');

            if (contentEl) contentEl.innerHTML = bodyContent;
            if (footerEl) {
                // If body content is sufficiently long (approx > 3000 chars), 
                // insert a visual indicator before the footer to signal truncation.
                if (bodyContent.length > 3000) {
                    footerHtml = '<div class="ocp-tooltip__truncation-notice">...(content truncated)</div>' + footerHtml;
                }

                footerEl.innerHTML = footerHtml;
                footerEl.style.display = footerHtml ? 'block' : 'none';
            }
            return bodyContent;
        };

        const applyAdaptiveWidthClass = (tooltipEl, rawText) => {
            tooltipEl.classList.remove('ocp-tooltip--width-md', 'ocp-tooltip--width-lg');

            const contentEl = tooltipEl.querySelector('.ocp-tooltip__content');
            const rawContent = contentEl ? contentEl.textContent : (rawText || '');
            const textLen = rawContent.length;

            if (textLen > 500) {
                tooltipEl.classList.add('ocp-tooltip--width-lg');
            } else if (textLen > 200) {
                tooltipEl.classList.add('ocp-tooltip--width-md');
            }
        };

        const finalizePosition = (tooltipEl) => {
            const triggerRect = trigger.getBoundingClientRect();
            const { top, left, position, arrowLeft } = calculatePosition(triggerRect, anchorClientX);

            tooltipEl.style.top = `${top}px`;
            tooltipEl.style.left = `${left}px`;
            tooltipEl.style.setProperty('--ocp-tooltip-arrow-left', `${arrowLeft}px`);

            tooltipEl.classList.remove('ocp-tooltip--top', 'ocp-tooltip--bottom');
            tooltipEl.classList.add(`ocp-tooltip--${position}`);
        };

        // Case 1: Trigger is already active and tooltip is visible -> Update existing instance
        if (_currentTrigger === trigger && _tooltipEl?.classList.contains('ocp-tooltip--visible')) {
            const tooltip = _tooltipEl;

            // Measure/layout without flicker while we recompute width/line clamp/position
            const prevVisibility = tooltip.style.visibility;
            tooltip.style.visibility = 'hidden';
            tooltip.style.display = 'block';

            parseAndApply(tooltip, text);
            tooltip.classList.toggle('ocp-tooltip--truncate', OCP_TOOLTIP_SETTINGS.maxLines > 0);

            applyAdaptiveWidthClass(tooltip, text);
            applyViewportLineClamp(tooltip);
            finalizePosition(tooltip);

            tooltip.style.visibility = prevVisibility || '';
            tooltip.style.display = '';
            return;
        }

        // Case 2: New tooltip needed -> Create and populate
        const tooltip = createTooltipElement();
        parseAndApply(tooltip, text);

        // Apply global settings
        tooltip.classList.toggle('ocp-tooltip--truncate', OCP_TOOLTIP_SETTINGS.maxLines > 0);

        // Determine theme logic (Override -> Page Class -> OS Preference)
        let useLightTheme = false;
        if (OCP_TOOLTIP_SETTINGS.themeOverride) {
            useLightTheme = OCP_TOOLTIP_SETTINGS.forcedTheme === 'light';
        } else {
            const hasPageDarkTheme = document.body.classList.contains('dark-theme');
            const hasPageLightTheme = document.body.classList.contains('light-theme');

            if (hasPageDarkTheme) useLightTheme = false;
            else if (hasPageLightTheme) useLightTheme = true;
            else useLightTheme = !(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
        }
        tooltip.classList.toggle('ocp-tooltip--light', useLightTheme);

        // Apply custom font color if configured
        const panel = tooltip.querySelector('.ocp-tooltip__panel');
        if (panel) {
            if (OCP_TOOLTIP_SETTINGS.fontColor) {
                panel.style.setProperty('--ocp-tooltip-custom-color', OCP_TOOLTIP_SETTINGS.fontColor);
                tooltip.classList.add('ocp-tooltip--custom-color');
            } else {
                panel.style.removeProperty('--ocp-tooltip-custom-color');
                tooltip.classList.remove('ocp-tooltip--custom-color');
            }
        }

        // Position Calculation (Hidden visibility for measurement)
        tooltip.style.visibility = 'hidden';
        tooltip.style.display = 'block';

        // Adaptive Width Strategy:
        // - Default: Compact (320px)
        // - Medium: > 200 chars (480px)
        // - Large: > 500 chars (800px)
        applyAdaptiveWidthClass(tooltip, text);

        // On small viewports, shrink line clamp so footer/system row remains visible.
        applyViewportLineClamp(tooltip);

        finalizePosition(tooltip);

        // Finalize Show
        tooltip.style.visibility = '';
        tooltip.style.display = '';
        tooltip.classList.add('ocp-tooltip--visible');
        tooltip.setAttribute('aria-hidden', 'false');

        _currentTrigger = trigger;
    };

    /**
     * Hides the tooltip
     */
    const hide = () => {
        clearTimeout(_showTimeout);

        if (!_tooltipEl) return;

        _tooltipEl.classList.remove('ocp-tooltip--visible');
        _tooltipEl.setAttribute('aria-hidden', 'true');
        _currentTrigger = null;
    };

    /**
     * Handler for mouseenter events
     */
    const handleMouseEnter = (event) => {
        const trigger = event.currentTarget;
        const text = trigger.getAttribute('data-ocp-tooltip') || trigger.getAttribute('title');
        const anchorClientX = Number.isFinite(event?.clientX) ? event.clientX : null;

        if (!text) return;

        // Remove native title to prevent double tooltips
        if (trigger.hasAttribute('title')) {
            trigger.setAttribute('data-ocp-tooltip', text);
            trigger.removeAttribute('title');
        }

        clearTimeout(_hideTimeout);
        clearTimeout(_showTimeout);

        _showTimeout = setTimeout(() => {
            show(trigger, text, anchorClientX);
        }, OCP_TOOLTIP_SETTINGS.showDelayMs);
    };

    /**
     * Handler for mouseleave events
     */
    const handleMouseLeave = (event) => {
        const from = event?.currentTarget;
        const to = event?.relatedTarget;
        if (from && to && from.contains && from.contains(to)) {
            return;
        }
        clearTimeout(_showTimeout);

        _hideTimeout = setTimeout(() => {
            hide();
        }, OCP_TOOLTIP_SETTINGS.hideDelayMs);
    };

    /**
     * Attaches tooltip behavior to an element
     */
    const attach = (element, text) => {
        if (!element) return;

        if (text) {
            element.setAttribute('data-ocp-tooltip', text);
        }

        // Remove native title if present
        if (element.hasAttribute('title')) {
            if (!element.hasAttribute('data-ocp-tooltip')) {
                element.setAttribute('data-ocp-tooltip', element.getAttribute('title'));
            }
            element.removeAttribute('title');
        }

        // Mark as having tooltip attached
        if (element.hasAttribute('data-ocp-tooltip-attached')) return;
        element.setAttribute('data-ocp-tooltip-attached', 'true');

        element.addEventListener('mouseenter', handleMouseEnter);
        element.addEventListener('mouseleave', handleMouseLeave);
        element.addEventListener('pointerenter', handleMouseEnter);
        element.addEventListener('pointerleave', handleMouseLeave);
        element.addEventListener('mouseover', handleMouseEnter);
        element.addEventListener('mouseout', handleMouseLeave);
        element.addEventListener('focus', handleMouseEnter);
        element.addEventListener('blur', handleMouseLeave);
    };

    /**
     * Detaches tooltip behavior from an element
     */
    const detach = (element) => {
        if (!element) return;

        element.removeAttribute('data-ocp-tooltip-attached');
        element.removeEventListener('mouseenter', handleMouseEnter);
        element.removeEventListener('mouseleave', handleMouseLeave);
        element.removeEventListener('pointerenter', handleMouseEnter);
        element.removeEventListener('pointerleave', handleMouseLeave);
        element.removeEventListener('mouseover', handleMouseEnter);
        element.removeEventListener('mouseout', handleMouseLeave);
        element.removeEventListener('focus', handleMouseEnter);
        element.removeEventListener('blur', handleMouseLeave);
    };

    /**
     * Updates tooltip text for an element (can be called while tooltip is visible)
     */
    const updateText = (element, text) => {
        if (!element) return;

        element.setAttribute('data-ocp-tooltip', text);

        // If this element's tooltip is currently showing, update the visible tooltip
        if (_currentTrigger === element && _tooltipEl) {
            const tempParser = document.createElement('div');
            tempParser.innerHTML = text;

            const systemMsgs = tempParser.querySelectorAll('.ocp-tooltip__system-msg');
            let footerHtml = '';
            systemMsgs.forEach(msg => {
                footerHtml += msg.outerHTML;
                msg.remove();
            });
            const bodyContent = tempParser.innerHTML;

            const contentEl = _tooltipEl.querySelector('.ocp-tooltip__content');
            const footerEl = _tooltipEl.querySelector('.ocp-tooltip__footer');

            if (contentEl) contentEl.innerHTML = bodyContent;
            if (footerEl) {
                footerEl.innerHTML = footerHtml;
                footerEl.style.display = footerHtml ? 'block' : 'none';
            }
        }
    };

    /**
     * Initializes the tooltip system
     */
    const init = () => {
        if (_initialized) return;
        _initialized = true;

        detectContext();

        // Load settings from storage (async, non-blocking)
        loadSettingsFromStorage();

        // Listen for settings changes from popup/background
        listenForSettingsChanges();

        const isGlobalTitleAutoAttachAllowed = _isPopupContext || _isExtensionDocument;

        const attachAllElements = () => {
            if (isGlobalTitleAutoAttachAllowed) {
                // Popup/extension pages: replace native tooltips everywhere (backward-compatible behavior).
                document.querySelectorAll('[data-ocp-tooltip], [title]').forEach(el => attach(el));
                return;
            }

            // Injected webpages: only attach [title] inside our UI. Never touch the host page's elements.
            document.querySelectorAll('[data-ocp-tooltip]').forEach(el => attach(el));
            const roots = getInjectedUiRoots();
            roots.forEach(root => {
                try {
                    root.querySelectorAll('[title]').forEach(el => attach(el));
                    root.querySelectorAll('[data-ocp-tooltip]').forEach(el => attach(el));
                } catch (_) { /* safe best-effort */ }
            });
        };

        // Initial attachment
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', attachAllElements);
        } else {
            attachAllElements();
        }

        // Watch for dynamically added elements AND attribute changes
        const observer = new MutationObserver((mutations) => {
            const roots = isGlobalTitleAutoAttachAllowed ? [] : getInjectedUiRoots();

            const maybeAttachElement = (el) => {
                if (!el || el.nodeType !== Node.ELEMENT_NODE) return;

                // Always allow explicit opt-in
                if (el.hasAttribute('data-ocp-tooltip')) {
                    attach(el);
                    return;
                }

                // Only allow [title] auto-attach globally on extension pages, or inside our injected UI roots.
                if (el.hasAttribute('title')) {
                    if (isGlobalTitleAutoAttachAllowed || isInInjectedUiRoots(el, roots)) {
                        attach(el);
                    }
                }
            };

            for (const mutation of mutations) {
                if (mutation.type === 'childList') {
                    mutation.addedNodes.forEach((node) => {
                        if (node.nodeType !== Node.ELEMENT_NODE) return;

                        maybeAttachElement(node);

                        if (!node.querySelectorAll) return;

                        // Explicit opt-in anywhere
                        node.querySelectorAll('[data-ocp-tooltip]').forEach(el => attach(el));

                        // Scoped title attachment for injected pages
                        if (isGlobalTitleAutoAttachAllowed || isInInjectedUiRoots(node, roots)) {
                            node.querySelectorAll('[title]').forEach(el => attach(el));
                        }
                    });
                }

                if (mutation.type === 'attributes') {
                    const el = mutation.target;
                    if (el.nodeType !== Node.ELEMENT_NODE) continue;

                    if (mutation.attributeName === 'data-ocp-tooltip' && el.hasAttribute('data-ocp-tooltip')) {
                        attach(el);
                        continue;
                    }

                    if (mutation.attributeName === 'title' && el.hasAttribute('title')) {
                        if (isGlobalTitleAutoAttachAllowed || isInInjectedUiRoots(el, roots)) {
                            attach(el);
                        }
                    }
                }
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['title', 'data-ocp-tooltip']
        });
    };

    /**
     * Updates settings at runtime
     */
    const configure = (newSettings) => {
        Object.assign(OCP_TOOLTIP_SETTINGS, newSettings);
    };

    /**
     * Enables or disables tooltips
     */
    const setEnabled = (enabled) => {
        OCP_TOOLTIP_SETTINGS.enabled = enabled;
        if (!enabled) {
            hide();
        }
    };

    /**
     * Sets the show delay
     */
    const setDelay = (delayMs) => {
        OCP_TOOLTIP_SETTINGS.showDelayMs = Math.max(0, delayMs);
    };

    // Public API
    return {
        init,
        attach,
        detach,
        updateText,
        show,
        hide,
        configure,
        setEnabled,
        setDelay,
        get settings() { return { ...OCP_TOOLTIP_SETTINGS }; }
    };
})();

// Auto-initialize if DOM is ready or on DOMContentLoaded
if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => OCPTooltip.init());
    } else {
        // Defer slightly to ensure CSS is loaded
        setTimeout(() => OCPTooltip.init(), 0);
    }
}

// Export for content scripts
if (typeof window !== 'undefined') {
    window.OCPTooltip = OCPTooltip;
}
