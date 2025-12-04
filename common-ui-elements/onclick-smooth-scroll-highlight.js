/**
 * onclick-smooth-scroll-highlight.js
 * Handles smooth scrolling and highlighting for anchor links.
 * 
 * Usage:
 * - Normal link: <a href="#targetId">Link</a> - scrolls and highlights
 * - Scroll-only: <a href="#targetId" data-scroll-only>Link</a> - scrolls without highlighting
 */

document.addEventListener('DOMContentLoaded', () => {
    document.addEventListener('click', (e) => {
        const link = e.target.closest('a');
        if (!link) return;

        const href = link.getAttribute('href');
        if (!href || !href.startsWith('#') || href === '#') return;

        const targetId = href.substring(1);
        const targetElement = document.getElementById(targetId);

        if (targetElement) {
            e.preventDefault();

            // Check if link has data-scroll-only attribute
            const scrollOnly = link.hasAttribute('data-scroll-only');

            // Custom smooth scroll with easing
            const targetPosition = targetElement.getBoundingClientRect().top + window.pageYOffset;
            const startPosition = window.pageYOffset;
            const viewportHeight = window.innerHeight;
            const elementHeight = targetElement.offsetHeight;

            // Calculate position to center element, with some offset for better visibility
            const offset = (viewportHeight - elementHeight) / 2;
            const targetWithOffset = targetPosition - Math.max(offset, 100); // At least 100px from top

            const distance = targetWithOffset - startPosition;
            const duration = 800; // milliseconds
            let startTime = null;

            // Easing function: easeInOutCubic for smooth acceleration and deceleration
            function easeInOutCubic(t) {
                return t < 0.5
                    ? 4 * t * t * t
                    : 1 - Math.pow(-2 * t + 2, 3) / 2;
            }

            function animation(currentTime) {
                if (startTime === null) startTime = currentTime;
                const timeElapsed = currentTime - startTime;
                const progress = Math.min(timeElapsed / duration, 1);
                const ease = easeInOutCubic(progress);

                window.scrollTo(0, startPosition + distance * ease);

                if (timeElapsed < duration) {
                    requestAnimationFrame(animation);
                } else {
                    // Highlight after scroll completes (only if not scroll-only)
                    if (!scrollOnly) {
                        targetElement.classList.remove('highlight-target');
                        void targetElement.offsetWidth;
                        targetElement.classList.add('highlight-target');

                        setTimeout(() => {
                            targetElement.classList.remove('highlight-target');
                        }, 2000);
                    }
                }
            }

            requestAnimationFrame(animation);
        }
    });
});
