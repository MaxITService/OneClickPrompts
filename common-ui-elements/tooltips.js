/**
 * OneClickPrompts Custom Tooltip System
 * Replaces native browser tooltips with styled, glassmorphic tooltips.
 * First tooltip: 2s delay. Subsequent tooltips: 500ms delay.
 */

class OCPTooltipManager {
    constructor() {
        this.tooltipElement = null;
        this.activeTarget = null;
        this.hoverTimeout = null;
        this.hasShownTooltip = false; // Track if any tooltip has been shown
        this.init();
    }

    init() {
        // Create the tooltip DOM element
        this.tooltipElement = document.createElement('div');
        this.tooltipElement.className = 'ocp-tooltip';
        this.tooltipElement.setAttribute('role', 'tooltip');
        document.body.appendChild(this.tooltipElement);

        // Event delegation for tooltip triggers
        document.addEventListener('mouseover', (e) => this.handleMouseOver(e));
        document.addEventListener('mouseout', (e) => this.handleMouseOut(e));

        // Optional: Update position on scroll to keep it attached (or hide it)
        window.addEventListener('scroll', () => this.hide(), { capture: true, passive: true });
    }

    handleMouseOver(e) {
        // Find closest element with title or data-tooltip
        const target = e.target.closest('[title], [data-tooltip]');
        if (!target) return;

        // Swap title to data-tooltip to suppress native tooltip
        if (target.hasAttribute('title')) {
            const title = target.getAttribute('title');
            if (title) {
                target.setAttribute('data-tooltip', title);
                target.removeAttribute('title');
                // For accessibility, we might want aria-label if not present
                if (!target.hasAttribute('aria-label')) {
                    target.setAttribute('aria-label', title);
                }
            }
        }

        const text = target.getAttribute('data-tooltip');
        if (!text) return;

        this.activeTarget = target;

        // Clear any existing timeout
        if (this.hoverTimeout) {
            clearTimeout(this.hoverTimeout);
        }

        // Adaptive delay: 2s for first tooltip, 500ms for subsequent ones
        const delay = this.hasShownTooltip ? 500 : 2000;

        // Set delay before showing
        this.hoverTimeout = setTimeout(() => {
            this.show(text, target);
        }, delay);
    }

    handleMouseOut(e) {
        // If moving to a child element, don't hide
        if (this.activeTarget && this.activeTarget.contains(e.relatedTarget)) {
            return;
        }

        // If leaving the active target
        if (this.activeTarget && (e.target === this.activeTarget || this.activeTarget.contains(e.target))) {
            if (this.hoverTimeout) {
                clearTimeout(this.hoverTimeout);
                this.hoverTimeout = null;
            }
            this.hide();
            this.activeTarget = null;
        }
    }

    show(text, target) {
        // Double check if target is still connected to DOM
        if (!target.isConnected) return;

        this.tooltipElement.textContent = text;
        this.tooltipElement.classList.add('is-visible');
        this.updatePosition(target);

        // Mark that we've shown at least one tooltip
        this.hasShownTooltip = true;
    }

    hide() {
        this.tooltipElement.classList.remove('is-visible');
    }

    updatePosition(target) {
        const rect = target.getBoundingClientRect();
        const tooltipRect = this.tooltipElement.getBoundingClientRect();

        // Default position: Top Center
        let top = rect.top - tooltipRect.height - 8; // 8px gap
        let left = rect.left + (rect.width / 2) - (tooltipRect.width / 2);

        // Check viewport boundaries

        // If overflowing top, flip to bottom
        if (top < 0) {
            top = rect.bottom + 8;
        }

        // If overflowing left, clamp to left edge
        if (left < 8) {
            left = 8;
        }

        // If overflowing right, clamp to right edge
        if (left + tooltipRect.width > window.innerWidth - 8) {
            left = window.innerWidth - tooltipRect.width - 8;
        }

        this.tooltipElement.style.top = `${top}px`;
        this.tooltipElement.style.left = `${left}px`;
    }
}

// Initialize on load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => new OCPTooltipManager());
} else {
    new OCPTooltipManager();
}
