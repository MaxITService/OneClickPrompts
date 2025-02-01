// popup-page-theme.js
// Version: 1.0
// Instructions for AI: do not remove comments! MUST NOT REMOVE COMMENTS.
// This file handles the dark theme toggle functionality in the popup interface.

'use strict';

// Function to apply the theme by adding or removing the "dark-theme" class on the body
function applyTheme(theme) {
    if (theme === 'dark') {
        document.body.classList.add('dark-theme');
    } else {
        document.body.classList.remove('dark-theme');
    }
}

// Wait for DOM content to be loaded before attaching event listeners
document.addEventListener('DOMContentLoaded', () => {
    const darkThemeToggle = document.getElementById('darkThemeToggle');
    if (!darkThemeToggle) {
        console.error('Dark theme toggle element not found.');
        return;
    }

    // Retrieve the current theme preference from the service worker storage
    chrome.runtime.sendMessage({ type: 'getTheme' }, (response) => {
        let theme = 'light';
        if (response && response.darkTheme) {
            theme = response.darkTheme;
        }
        // Apply the retrieved theme
        applyTheme(theme);
        // Set the toggle checkbox state based on the theme
        darkThemeToggle.checked = (theme === 'dark');
    });

    // Listen for changes on the dark theme toggle checkbox
    darkThemeToggle.addEventListener('change', () => {
        const newTheme = darkThemeToggle.checked ? 'dark' : 'light';
        applyTheme(newTheme);
        // Save the new theme preference using the service worker
        chrome.runtime.sendMessage({ type: 'setTheme', darkTheme: newTheme }, (response) => {
            if (response && response.success) {
                console.log('Theme preference saved successfully.');
            } else if (response && response.error) {
                console.error('Error saving theme preference:', response.error);
            }
        });
    });
});
