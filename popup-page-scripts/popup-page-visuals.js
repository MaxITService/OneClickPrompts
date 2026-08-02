// popup-page-visuals.js
// Version: 1.1
// Visual functions for Max Extension configuration interface

'use strict';


/**
 * Creates a ripple effect at the mouse cursor's position.
 * This is used to provide visual feedback on actions like adding a button.
 *
 * @param {MouseEvent} event - The mouse event that triggered the effect.
 */
function showMouseEffect(event) {
    // Ensure event is provided
    if (!event) return;

    const effect = document.createElement('div');
    effect.className = 'mouse-effect';
    document.body.appendChild(effect);

    // Position at mouse coordinates. Use clientX/Y for viewport-relative position.
    effect.style.left = `${event.clientX}px`;
    effect.style.top = `${event.clientY}px`;

    // Remove the element after the animation finishes to keep the DOM clean.
    effect.addEventListener('animationend', () => {
        effect.remove();
    });
}
