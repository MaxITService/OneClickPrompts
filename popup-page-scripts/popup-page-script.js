// popup-page-script.js
// Version: 1.6.4
// Main script for Max Extension configuration interface

'use strict';

// -------------------------
// Global Variables and State
// -------------------------

// State management
let currentProfile = null;

// Global variable for debounced save timeout
let saveTimeoutId = null;

// DOM Elements
const profileSelect = document.getElementById('profileSelect');
const currentProfileLabel = document.getElementById('currentProfileLabel');
const buttonCardsList = document.getElementById('buttonCardsList');
const consoleOutput = document.getElementById('console');
const saveStatus = document.getElementById('saveStatus');

// New DOM Elements for Profile Actions
const addProfileButton = document.getElementById('addProfile');
const copyProfileButton = document.getElementById('copyProfile');
const deleteProfileButton = document.getElementById('deleteProfile');

const addProfileContainer = document.getElementById('addProfileContainer');
const copyProfileContainer = document.getElementById('copyProfileContainer');

const saveAddProfileButton = document.getElementById('saveAddProfile');
const saveCopyProfileButton = document.getElementById('saveCopyProfile');

const addProfileInput = document.getElementById('addProfileInput');
const copyProfileInput = document.getElementById('copyProfileInput');

// New DOM Elements for Cancel Actions
const cancelAddProfileButton = document.getElementById('cancelAddProfile');
const cancelCopyProfileButton = document.getElementById('cancelCopyProfile');

// Open in Tab Button
const openInTabButton = document.getElementById('open-in-tab-button');
const toggleWidthButton = document.getElementById('toggle-width-button');

// -------------------------
// Debounced Save Function
// -------------------------

/**
 * Debounced save function.
 * Clears any pending save and schedules a new one 500ms in the future.
 * This function is used on rapid-fire events (e.g., textarea input) so that
 * saving happens only after 500ms of inactivity.
 */
function debouncedSaveCurrentProfile() {
    if (saveTimeoutId !== null) {
        clearTimeout(saveTimeoutId);
    }
    saveTimeoutId = setTimeout(async () => {
        try {
            await saveCurrentProfile(); // Calls the existing save function
            updateSaveStatus();
        } catch (error) {
            logToGUIConsole(`Error saving profile: ${error.message}`);
        }
        saveTimeoutId = null;
    }, 150);
}


// -------------------------
// 7. Settings Management
// -------------------------

/**
 * Updates global settings based on user input.
 */
async function updateGlobalSettings() {
    currentProfile.globalAutoSendEnabled = document.getElementById('autoSendToggle').checked;
    currentProfile.enableShortcuts = document.getElementById('shortcutsToggle').checked;
    await saveCurrentProfile();
    logToGUIConsole('Updated global settings');
    showToast('Global settings updated', 'success');
}

/**
 * Reverts the current profile to default settings.
 */
async function revertToDefault() {
    if (!confirm('Revert current profile to default settings?')) return;

    try {
        const response = await chrome.runtime.sendMessage({ type: 'createDefaultProfile' });
        currentProfile = response.config;
        await saveCurrentProfile();
        updateInterface();
        showToast('Reverted to default settings successfully.', 'success');
        logToGUIConsole('Reverted to default settings');
    } catch (error) {
        showToast(`Error reverting to default: ${error.message}`, 'error');
        logToGUIConsole(`Error reverting to default: ${error.message}`);
    }
}

// -------------------------
// 8. Save and Update Functions
// -------------------------

/**
 * Saves the current profile configuration.
 * @returns {Promise<boolean>} - Returns true if save is successful, else false.
 */
async function saveCurrentProfile() {
    try {
        await chrome.runtime.sendMessage({
            type: 'saveConfig',
            profileName: currentProfile.PROFILE_NAME,
            config: currentProfile
        });
        updateSaveStatus();
        return true;
    } catch (error) {
        logToGUIConsole(`Error saving profile: ${error.message}`);
        return false;
    }
}

/**
 * Updates the save status display with the current timestamp.
 */
function updateSaveStatus() {
    const timestamp = new Date().toLocaleTimeString();
    saveStatus.textContent = `Last saved: ${timestamp}`;
}

/**
 * Updates the entire interface based on the current profile.
 */
function updateInterface() {
    // --- Added guard to check if currentProfile is valid ---
    if (!currentProfile || !currentProfile.customButtons) {
        logToGUIConsole('No valid current profile found. Attempting to retrieve default profile...');
        chrome.runtime.sendMessage({ type: 'getConfig' }, (response) => {
            if (response && response.config) {
                currentProfile = response.config;
                updateInterface(); // Call updateInterface again after retrieving default
            } else {
                logToGUIConsole('Failed to retrieve default profile in updateInterface.');
            }
        });
        return;
    }
    // Update buttons, settings, etc. based on currentProfile
    updatebuttonCardsList();
    document.getElementById('autoSendToggle').checked = currentProfile.globalAutoSendEnabled;
    document.getElementById('shortcutsToggle').checked = currentProfile.enableShortcuts;
    // Clear input fields
    document.getElementById('buttonIcon').value = '';
    document.getElementById('buttonText').value = '';
    document.getElementById('buttonAutoSendToggle').checked = true; // Reset to default checked

    // Set the profileSelect dropdown to the current profile
    profileSelect.value = currentProfile.PROFILE_NAME;
}

/**
 * Resets and hides the profile action UIs (add/copy) and restores the default view.
 */
function resetProfileActionsUI() {
    // Hide input containers and clear values/errors
    addProfileInput.value = '';
    addProfileInput.style.borderColor = '';
    addProfileInput.classList.remove('input-error');
    addProfileContainer.style.display = 'none';

    copyProfileInput.value = '';
    copyProfileInput.style.borderColor = '';
    copyProfileInput.classList.remove('input-error');
    copyProfileContainer.style.display = 'none';

    // Show the main action buttons
    addProfileButton.style.display = 'inline-block';
    copyProfileButton.style.display = 'inline-block';
    deleteProfileButton.style.display = 'inline-block';

    // Unlock the profile selector
    profileSelect.disabled = false;
    currentProfileLabel.style.display = 'none';
}
// -------------------------
// 9. Event Listeners
// -------------------------

document.addEventListener('DOMContentLoaded', () => {
    // Check if the page is opened in a tab and apply appropriate styling
    const urlParams = new URLSearchParams(window.location.search);
    const isTab = urlParams.get('isTab') === 'true';

    if (isTab) {
        // When in a tab, hide the 'open in tab' button and show the 'toggle width' button
        if (openInTabButton) {
            openInTabButton.style.display = 'none';
        }
        if (toggleWidthButton) {
            toggleWidthButton.style.display = 'inline-block';
        }
        document.body.classList.add('tab-mode');
    }

    loadProfiles();

    // Profile management
    profileSelect.addEventListener('change', (e) => switchProfile(e.target.value));

    // Add Profile Button Click
    addProfileButton.addEventListener('click', () => {
        addProfileContainer.style.display = 'flex';
        addProfileButton.style.display = 'none';
        copyProfileButton.style.display = 'none';
        copyProfileContainer.style.display = 'none';
        deleteProfileButton.style.display = 'none'; // Hide delete button during add
        profileSelect.disabled = true; // Lock profile selector
        currentProfileLabel.style.display = 'inline-block';
    });

    // Copy Profile Button Click
    copyProfileButton.addEventListener('click', () => {
        copyProfileContainer.style.display = 'flex';
        copyProfileButton.style.display = 'none';
        addProfileButton.style.display = 'none';
        addProfileContainer.style.display = 'none';
        deleteProfileButton.style.display = 'none'; // Hide delete button during copy
        profileSelect.disabled = true; // Lock profile selector
        currentProfileLabel.style.display = 'inline-block';
    });

    // Save Add Profile Button Click
    saveAddProfileButton.addEventListener('click', async () => {
        const profileName = addProfileInput.value;
        if (profileName.trim() === "") {
            addProfileInput.classList.add('input-error');
            addProfileInput.placeholder = "Enter profile name here";
            addProfileInput.style.borderColor = 'var(--danger-color)';
            showToast('Profile name cannot be empty.', 'error');
            logToGUIConsole('Save Add Profile failed: Empty input.');
            return;
        }
        addProfileInput.classList.remove('input-error');
        const success = await addNewEmptyProfile(profileName);

        if (success) {
            resetProfileActionsUI();
        } else {
            // On failure (e.g., duplicate name), keep UI open for correction
            addProfileInput.classList.add('input-error');
            addProfileInput.style.borderColor = 'var(--danger-color)';
        }
    });

    // Save Copy Profile Button Click
    saveCopyProfileButton.addEventListener('click', async () => {
        const newProfileName = copyProfileInput.value;
        if (newProfileName.trim() === "") {
            copyProfileInput.classList.add('input-error');
            copyProfileInput.placeholder = "Enter new profile name here";
            copyProfileInput.style.borderColor = 'var(--danger-color)';
            showToast('Profile name cannot be empty.', 'error');
            logToGUIConsole('Save Copy Profile failed: Empty input.');
            return;
        }
        copyProfileInput.classList.remove('input-error');
        const success = await copyCurrentProfile(newProfileName);

        if (success) {
            resetProfileActionsUI();
        } else {
            // On failure (e.g., duplicate name), keep UI open for correction
            copyProfileInput.classList.add('input-error');
            copyProfileInput.style.borderColor = 'var(--danger-color)';
        }
    });

    // Delete Profile Button Click
    deleteProfileButton.addEventListener('click', deleteCurrentProfile);

    // Cancel Add Profile Button Click
    cancelAddProfileButton.addEventListener('click', () => {
        resetProfileActionsUI();
    });

    // Cancel Copy Profile Button Click
    cancelCopyProfileButton.addEventListener('click', () => {
        resetProfileActionsUI();
    });

    // Button management
    document.getElementById('addButton').addEventListener('click', e => addButton(e));
    document.getElementById('clearText').addEventListener('click', clearText);
    document.getElementById('addSeparator').addEventListener('click', addSeparator);
    const addSettingsBtnEl = document.getElementById('addSettingsButton');
    if (addSettingsBtnEl) {
        addSettingsBtnEl.addEventListener('click', (e) => addSettingsButton(e));
    }

    // Settings
    document.getElementById('autoSendToggle').addEventListener('change', updateGlobalSettings);
    document.getElementById('shortcutsToggle').addEventListener('change', updateGlobalSettings);
    document.getElementById('revertDefault').addEventListener('click', revertToDefault);

    // Drag and drop events - implementation in popup-page-customButtons.js
    // We use a two-phase check to allow dragging the whole card while preventing
    // drags from starting on interactive child elements.
    buttonCardsList.addEventListener('pointerdown', handlePointerDown, true); // Phase 1: Capture the initial target.
    buttonCardsList.addEventListener('dragstart', handleDragStart, true);     // Phase 2: Decide whether to start the drag.
    buttonCardsList.addEventListener('dragover', handleDragOver);
    buttonCardsList.addEventListener('drop', handleDrop);
    document.addEventListener('dragend', handleDragEnd); // dragend doesn't bubble, must be on document/window.

    // Button list event delegation for delete buttons
    buttonCardsList.addEventListener('click', async (e) => {
        if (e.target.classList.contains('delete-button')) {
            const buttonItem = e.target.closest('.button-item');
            const index = parseInt(buttonItem.dataset.index);
            await deleteButton(index);
        }
    });

    // Input Field Placeholder Behavior
    addProfileInput.addEventListener('input', () => {
        if (addProfileInput.value.trim() !== "") {
            addProfileInput.style.borderColor = '';
            addProfileInput.classList.remove('input-error');
        }
    });

    copyProfileInput.addEventListener('input', () => {
        if (copyProfileInput.value.trim() !== "") {
            copyProfileInput.style.borderColor = '';
            copyProfileInput.classList.remove('input-error');
        }
    });

    // Open in New Tab Button Click
    if (openInTabButton) {
        openInTabButton.addEventListener('click', () => {
            // Open popup.html in a new tab with isTab parameter
            chrome.tabs.create({
                url: chrome.runtime.getURL('popup.html?isTab=true')
            });
            // Close the popup window
            window.close();
        });
    }

    // Toggle Width Button Click (for tab view)
    if (toggleWidthButton) {
        toggleWidthButton.addEventListener('click', () => {
            const container = document.querySelector('.container');
            if (!container) return;

            const isExpanded = container.classList.toggle('expanded');

            if (isExpanded) {
                toggleWidthButton.innerHTML = '🤏 Make page narrower';
                toggleWidthButton.title = 'Revert to default width.';
            } else {
                toggleWidthButton.innerHTML = '↔️ Make page wider';
                toggleWidthButton.title = 'Expand page width to 90% of the viewport.';
            }
        });
    }

    // Initialize event listeners for dynamic elements
    textareaSaverAndResizerFunc();
    attachEmojiInputListeners();
    attachAutoSendToggleListeners();
    // Call the function for your specific textarea by ID
    textareaInputAreaResizerFun('buttonText');

    // -------------------------
    // Open external links in new tabs
    // -------------------------
    function handleExternalLinkClick(e) {
        e.preventDefault();
        const url = e.currentTarget.href;
        chrome.tabs.create({ url });
    }

    const helpSection = document.getElementById('helpSection');
    if (helpSection) {
        const helpLinks = helpSection.querySelectorAll('a[href^="http"]');
        helpLinks.forEach(link => {
            link.addEventListener('click', handleExternalLinkClick);
        });
    }
});

// -------------------------
// 12. Utility Functions
// -------------------------

/**
 * This is not browser console!
 * Logs a message to the user-visible console with a timestamp.
 * @param {string} message - The message to log.
 */
function logToGUIConsole(message) {
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = document.createElement('div');
    logEntry.textContent = `${timestamp}: ${message}`;
    consoleOutput.appendChild(logEntry);
    consoleOutput.scrollTop = consoleOutput.scrollHeight;
}

document.getElementById('openWelcomePage').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({
        url: chrome.runtime.getURL('welcome.html')
    });
});