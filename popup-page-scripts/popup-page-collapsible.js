/**
 * @file
 * Centralized logic for handling all collapsible sections in the popup.
 *
 * This script's sole responsibility is to make UI sections expandable and
 * collapsible. It scans the DOM for any element with the `.collapsible` class
 * and attaches the necessary event listeners.
 *
 * This decouples the UI behavior from the feature-specific logic in other
 * scripts, making the application more robust and easier to maintain.
 * For example, if a module's content fails to load, the section will still
 * remain collapsible.
 */

'use strict';

document.addEventListener('DOMContentLoaded', () => {
  /**
   * Finds all elements with the `.collapsible` class and makes them interactive.
   */
  function initializeCollapsibleSections() {
    // Select all top-level collapsible containers.
    const collapsibleSections = document.querySelectorAll('.collapsible');

    collapsibleSections.forEach(section => {
      // Find the header element within the section. It can be a .section-header or .subsection-header.
      const header = section.querySelector('.section-header, .subsection-header');

      // Find the icon used to indicate the expanded/collapsed state.
      const toggleIcon = header ? header.querySelector('.toggle-icon') : null;

      // If a header is found, attach the click event listener.
      if (header) {
        header.addEventListener('click', () => {
          // Toggle the 'expanded' class on the main section container.
          // CSS handles all animations (icon rotation, content reveal, glow effects)
          section.classList.toggle('expanded');
        });
      }
    });
  }

  // Run the initialization function once the DOM is fully loaded.
  initializeCollapsibleSections();
});