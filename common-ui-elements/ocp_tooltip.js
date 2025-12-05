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
    maxWidth: 320,

    /** Truncate long tooltips after this many lines (0 = no truncation) */
    maxLines: 8,

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

    // Detect context (popup vs content script)
    const detectContext = () => {
        try {
            _isPopupContext = document.querySelector('.container') !== null &&
                document.querySelector('.menu-nav') !== null;
        } catch (e) {
            _isPopupContext = false;
        }
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
                <span class="ocp-tooltip__text"></span>
            </div>
            <div class="ocp-tooltip__arrow"></div>
        `;

        document.body.appendChild(_tooltipEl);

        return _tooltipEl;
    };

    /**
     * Calculates optimal position for the tooltip
     */
    const calculatePosition = (triggerRect) => {
        const tooltip = createTooltipElement();
        const tooltipRect = tooltip.getBoundingClientRect();
        const viewportHeight = window.innerHeight;
        const viewportWidth = window.innerWidth;
        const scrollY = window.scrollY || document.documentElement.scrollTop;
        const scrollX = window.scrollX || document.documentElement.scrollLeft;

        let top, left;
        let position = 'top';

        // Vertical positioning
        const spaceAbove = triggerRect.top;
        const spaceBelow = viewportHeight - triggerRect.bottom;
        const tooltipHeight = tooltipRect.height + OCP_TOOLTIP_SETTINGS.offsetPx;

        if (OCP_TOOLTIP_SETTINGS.preferTop && spaceAbove >= tooltipHeight) {
            // Position above
            top = triggerRect.top + scrollY - tooltipRect.height - OCP_TOOLTIP_SETTINGS.offsetPx;
            position = 'top';
        } else if (spaceBelow >= tooltipHeight) {
            // Position below
            top = triggerRect.bottom + scrollY + OCP_TOOLTIP_SETTINGS.offsetPx;
            position = 'bottom';
        } else if (spaceAbove > spaceBelow) {
            // Force above even if tight
            top = triggerRect.top + scrollY - tooltipRect.height - OCP_TOOLTIP_SETTINGS.offsetPx;
            position = 'top';
        } else {
            // Force below
            top = triggerRect.bottom + scrollY + OCP_TOOLTIP_SETTINGS.offsetPx;
            position = 'bottom';
        }

        // Horizontal positioning (center on trigger, but keep within viewport)
        const triggerCenterX = triggerRect.left + triggerRect.width / 2;
        left = triggerCenterX + scrollX - tooltipRect.width / 2;

        // Clamp to viewport bounds with padding
        const viewportPadding = 8;
        left = Math.max(viewportPadding + scrollX, Math.min(left, viewportWidth - tooltipRect.width - viewportPadding + scrollX));

        // Ensure top doesn't go negative
        top = Math.max(viewportPadding + scrollY, top);

        return { top, left, position };
    };



    /**
     * Shows the tooltip for a given trigger element
     */
    const show = (trigger, text) => {
        if (!OCP_TOOLTIP_SETTINGS.enabled || !text) return;

        clearTimeout(_hideTimeout);

        // If same trigger already showing, just update text
        if (_currentTrigger === trigger && _tooltipEl?.classList.contains('ocp-tooltip--visible')) {
            const textEl = _tooltipEl.querySelector('.ocp-tooltip__text');
            if (textEl) textEl.innerHTML = text;
            return;
        }

        // Create tooltip if needed
        const tooltip = createTooltipElement();

        // Update content with formatting
        const textEl = tooltip.querySelector('.ocp-tooltip__text');
        if (textEl) textEl.innerHTML = text;

        // Apply truncation class if needed
        tooltip.classList.toggle('ocp-tooltip--truncate', OCP_TOOLTIP_SETTINGS.maxLines > 0);

        // Determine theme: override → page theme → OS preference
        let useLightTheme = false;
        if (OCP_TOOLTIP_SETTINGS.themeOverride) {
            // User explicitly chose a theme
            useLightTheme = OCP_TOOLTIP_SETTINGS.forcedTheme === 'light';
        } else {
            // Auto detection: check page theme first, then OS preference
            const hasPageDarkTheme = document.body.classList.contains('dark-theme');
            const hasPageLightTheme = document.body.classList.contains('light-theme');

            if (hasPageDarkTheme) {
                useLightTheme = false; // Dark page = dark tooltip
            } else if (hasPageLightTheme) {
                useLightTheme = true; // Light page = light tooltip
            } else {
                // No page theme detected, fall back to OS preference
                const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
                useLightTheme = !prefersDark;
            }
        }
        tooltip.classList.toggle('ocp-tooltip--light', useLightTheme);

        // Apply custom font color if set
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

        // Make visible for measurement (but still hidden via opacity)
        tooltip.style.visibility = 'hidden';
        tooltip.style.display = 'block';

        // Calculate and apply position
        const triggerRect = trigger.getBoundingClientRect();
        const { top, left, position } = calculatePosition(triggerRect);

        tooltip.style.top = `${top}px`;
        tooltip.style.left = `${left}px`;

        // Set direction class
        tooltip.classList.remove('ocp-tooltip--top', 'ocp-tooltip--bottom');
        tooltip.classList.add(`ocp-tooltip--${position}`);

        // Show with animation
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

        if (!text) return;

        // Remove native title to prevent double tooltips
        if (trigger.hasAttribute('title')) {
            trigger.setAttribute('data-ocp-tooltip', text);
            trigger.removeAttribute('title');
        }

        clearTimeout(_hideTimeout);
        clearTimeout(_showTimeout);

        _showTimeout = setTimeout(() => {
            show(trigger, text);
        }, OCP_TOOLTIP_SETTINGS.showDelayMs);
    };

    /**
     * Handler for mouseleave events
     */
    const handleMouseLeave = () => {
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
            const textEl = _tooltipEl.querySelector('.ocp-tooltip__text');
            if (textEl) textEl.innerHTML = text;
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

        // Auto-attach to ALL elements with title attribute or data-ocp-tooltip
        // This replaces native browser tooltips with frosted glass tooltips
        const autoAttachSelector = '[data-ocp-tooltip], [title]';

        const attachAllElements = () => {
            document.querySelectorAll(autoAttachSelector).forEach(el => {
                attach(el);
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
            mutations.forEach((mutation) => {
                // Handle new nodes
                if (mutation.type === 'childList') {
                    mutation.addedNodes.forEach((node) => {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            if (node.matches && node.matches(autoAttachSelector)) {
                                attach(node);
                            }
                            // Check children
                            if (node.querySelectorAll) {
                                node.querySelectorAll(autoAttachSelector).forEach(el => {
                                    attach(el);
                                });
                            }
                        }
                    });
                }
                // Handle attribute changes (title being added)
                if (mutation.type === 'attributes' && mutation.attributeName === 'title') {
                    const el = mutation.target;
                    if (el.nodeType === Node.ELEMENT_NODE && el.hasAttribute('title')) {
                        attach(el);
                    }
                }
            });
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
