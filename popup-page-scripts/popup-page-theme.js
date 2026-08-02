// popup-page-theme.js
// Version: 1.0
// Instructions for AI: do not remove comments! MUST NOT REMOVE COMMENTS.
// NOTE: On first run, initialize theme from OS preference and persist it.
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
        // Normalize response
        let theme = (response && (response.theme === 'dark' || response.theme === 'light'))
            ? response.theme
            : (response && typeof response.darkTheme === 'boolean')
                ? (response.darkTheme ? 'dark' : 'light')
                : (response && (response.darkTheme === 'dark' || response.darkTheme === 'light'))
                    ? response.darkTheme
                    : 'light';

        const initialized = !!(response && response.initialized === true);
        if (!initialized) {
            // First run: adopt OS preference and persist immediately
            const osDark = (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
            theme = osDark ? 'dark' : 'light';
            chrome.runtime.sendMessage({ type: 'setTheme', theme }, () => {});
        }

        applyTheme(theme);
        darkThemeToggle.checked = (theme === 'dark');
    });

    // Listen for changes on the dark theme toggle checkbox
    darkThemeToggle.addEventListener('change', () => {
        const newTheme = darkThemeToggle.checked ? 'dark' : 'light';
        applyTheme(newTheme);
        // Save the new theme preference using the service worker
        chrome.runtime.sendMessage({ type: 'setTheme', theme: newTheme }, (response) => {
            if (response && response.success) {
                console.log('Theme preference saved successfully.');
            } else if (response && response.error) {
                console.error('Error saving theme preference:', response.error);
            }
        });
    });
});
