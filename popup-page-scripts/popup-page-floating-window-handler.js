// Version: 2.0
// Handler script for the expandable floating window settings section.

'use strict';

// Function to populate the list of websites with saved floating window settings.
async function populateFloatingWindowSitesList() {
    const sitesListDiv = document.getElementById('floatingWindowSitesList');
    const emptyMessage = sitesListDiv.querySelector('.empty-message');
    if (!sitesListDiv || !emptyMessage) return;

    // Clear previous list but keep the empty message template
    const siteItems = sitesListDiv.querySelectorAll('.floating-site-item');
    siteItems.forEach(item => item.remove());


    try {
        const response = await chrome.runtime.sendMessage({ type: 'getFloatingPanelHostnames' });
        if (response && response.success) {
            const hostnames = response.hostnames;
            if (hostnames.length > 0) {
                emptyMessage.style.display = 'none';
                hostnames.forEach(hostname => {
                    const siteItem = document.createElement('div');
                    siteItem.className = 'floating-site-item';
                    siteItem.innerHTML = `
                        <span>${hostname}</span>
                        <button class="danger small" data-hostname="${hostname}">Reset</button>
                    `;
                    sitesListDiv.appendChild(siteItem);
                });
            } else {
                emptyMessage.style.display = 'block';
            }
        } else {
            window.showToast('Failed to load website list for floating windows.', 'error');
            emptyMessage.style.display = 'block';
        }
    } catch (error) {
        window.logToGUIConsole(`Error populating floating window sites: ${error.message}`);
        window.showToast(`Error: ${error.message}`, 'error');
    }
}

// Function to reset settings for a single hostname.
async function resetSingleFloatingWindowSetting(hostname) {
    if (!confirm(`Are you sure you want to reset floating window settings for "${hostname}"?`)) {
        return;
    }
    try {
        const response = await chrome.runtime.sendMessage({
            type: 'resetFloatingPanelSettingsForHostname',
            hostname: hostname
        });

        if (response && response.success) {
            window.logToGUIConsole(`Successfully reset floating panel settings for ${hostname}`);
            window.showToast(`Settings for ${hostname} have been reset.`, 'success');
            // Repopulate the list to reflect the change
            await populateFloatingWindowSitesList();
        } else {
            const errorMsg = response && response.error ? response.error : 'Unknown error';
            window.logToGUIConsole(`Error resetting floating window settings for ${hostname}: ${errorMsg}`);
            window.showToast(`Failed to reset settings for ${hostname}: ${errorMsg}`, 'error');
        }
    } catch (error) {
        window.logToGUIConsole(`Error resetting floating window settings: ${error.message}`);
        window.showToast(`Failed to reset settings: ${error.message}`, 'error');
    }
}


// Function to reset all floating panel settings across all websites.
async function resetAllFloatingWindowSettings() {
    if (!confirm('Are you sure you want to reset floating window settings for ALL websites?')) {
        return;
    }

    try {
        const response = await chrome.runtime.sendMessage({ type: 'resetFloatingPanelSettings' });

        if (response && response.success) {
            const count = response.count || 0;
            if (count > 0) {
                window.logToGUIConsole(`Successfully reset ${count} floating panel settings`);
                window.showToast('All floating window settings have been reset.', 'success');
            } else {
                window.logToGUIConsole('No floating panel settings found to reset');
                window.showToast('No floating panel settings found to reset.', 'info');
            }
            // Repopulate the list, which will now be empty
            await populateFloatingWindowSitesList();
        } else {
            const errorMsg = response && response.error ? response.error : 'Unknown error';
            window.logToGUIConsole(`Error resetting all floating window settings: ${errorMsg}`);
            window.showToast(`Failed to reset all settings: ${errorMsg}`, 'error');
        }
    } catch (error) {
        window.logToGUIConsole(`Error resetting all floating window settings: ${error.message}`);
        window.showToast(`Failed to reset all settings: ${error.message}`, 'error');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const floatingWindowSection = document.getElementById('floatingWindowSettingsSection');
    const sitesListDiv = document.getElementById('floatingWindowSitesList');
    const resetButtonAll = document.getElementById('resetAllFloatingWindowSettings');

    if (!floatingWindowSection || !sitesListDiv || !resetButtonAll) {
        console.error('Floating window settings elements not found.');
        return;
    }

    // Set up collapsible functionality
    const header = floatingWindowSection.querySelector('.section-header');
    const toggleIcon = floatingWindowSection.querySelector('.toggle-icon');

    header.addEventListener('click', () => {
        const isExpanded = floatingWindowSection.classList.toggle('expanded');
        toggleIcon.style.transform = isExpanded ? 'rotate(90deg)' : 'rotate(0deg)';

        // Populate the list only when the section is expanded
        if (isExpanded) {
            populateFloatingWindowSitesList();
        }
    });

    // Event delegation for individual reset buttons
    sitesListDiv.addEventListener('click', (e) => {
        if (e.target.matches('button.small.danger')) {
            const hostname = e.target.dataset.hostname;
            if (hostname) {
                resetSingleFloatingWindowSetting(hostname);
            }
        }
    });

    // Event listener for the global reset button
    resetButtonAll.addEventListener('click', resetAllFloatingWindowSettings);
});