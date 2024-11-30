// popup-page-script.js
// Version: 1.6.3
// Main script for Max Extension configuration interface

'use strict';

// -------------------------
// Global Variables and State
// -------------------------

// State management
let currentProfile = null;
let isDragging = false;
let draggedItem = null;

// DOM Elements
const profileSelect = document.getElementById('profileSelect');
const buttonList = document.getElementById('buttonList');
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
const cancelAddProfileButton = document.getElementById('cancelAddProfile'); // Cancel button for adding profile
const cancelCopyProfileButton = document.getElementById('cancelCopyProfile'); // Cancel button for duplicating profile

// -------------------------
// 7. Settings Management
// -------------------------

/**
 * Updates global settings based on user input.
 * 
 * Dependencies:
 * - /popup-page-scripts/popup-page-profiles.js: Uses saveCurrentProfile() to persist changes.
 * - /popup-page-scripts/popup-page-visuals.js: Uses logToConsole() to log updates.
 * 
 * Why:
 * This function updates the global settings of the current profile based on user interactions,
 * saves the updated profile, and logs the changes for debugging purposes.
 */
async function updateGlobalSettings() {
    currentProfile.globalAutoSendEnabled = document.getElementById('autoSendToggle').checked;
    currentProfile.enableShortcuts = document.getElementById('shortcutsToggle').checked;
    await saveCurrentProfile();
    logToConsole('Updated global settings');
}

/**
 * Reverts the current profile to default settings.
 * 
 * Dependencies:
 * - /popup-page-scripts/popup-page-profiles.js: Uses chrome.runtime.sendMessage to create default profile and save it.
 * - /popup-page-scripts/popup-page-visuals.js: Uses showToast() to notify the user.
 * - /popup-page-scripts/popup-page-script.js: Uses updateInterface() to refresh the UI.
 * - /popup-page-scripts/popup-page-profiles.js: Uses saveCurrentProfile() to persist the reverted profile.
 * 
 * Why:
 * Allows users to revert their current profile settings to the default configuration, ensuring they can
 * easily undo unwanted changes.
 */
async function revertToDefault() {
    if (!confirm('Revert current profile to default settings?')) return;

    try {
        const response = await chrome.runtime.sendMessage({ type: 'createDefaultProfile' });
        currentProfile = response.config;
        await saveCurrentProfile();
        updateInterface();
        showToast('Reverted to default settings successfully.', 'success');
        logToConsole('Reverted to default settings');
    } catch (error) {
        showToast(`Error reverting to default: ${error.message}`, 'error');
        logToConsole(`Error reverting to default: ${error.message}`);
    }
}

// -------------------------
// 8. Save and Update Functions
// -------------------------

/**
 * Saves the current profile configuration.
 * 
 * Dependencies:
 * - /popup-page-scripts/popup-page-profiles.js: Uses chrome.runtime.sendMessage to save the profile.
 * - /popup-page-scripts/popup-page-script.js: Uses updateSaveStatus() to update the UI.
 * 
 * Why:
 * Persists the current profile's configuration to ensure that user changes are saved and can be retrieved later.
 * 
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
        logToConsole(`Error saving profile: ${error.message}`);
        return false;
    }
}

/**
 * Updates the save status display with the current timestamp.
 * 
 * Dependencies:
 * - None directly, but interacts with the DOM to reflect the latest save time.
 * 
 * Why:
 * Provides visual feedback to the user indicating when the profile was last saved, enhancing user awareness.
 */
function updateSaveStatus() {
    const timestamp = new Date().toLocaleTimeString();
    saveStatus.textContent = `Last saved: ${timestamp}`;
}

/**
 * Updates the entire interface based on the current profile.
 * 
 * Dependencies:
 * - /popup-page-scripts/popup-page-customButtons.js: Uses updateButtonList() to refresh the button list.
 * - /popup-page-script.js: Interacts with DOM elements to reflect current profile settings.
 * 
 * Why:
 * Ensures that the UI accurately reflects the current profile's settings and custom buttons, providing a consistent user experience.
 */
function updateInterface() {
    // Update buttons, settings, etc. based on currentProfile
    updateButtonList();
    document.getElementById('autoSendToggle').checked = currentProfile.globalAutoSendEnabled;
    document.getElementById('shortcutsToggle').checked = currentProfile.enableShortcuts;
    // Clear input fields
    document.getElementById('buttonIcon').value = '';
    document.getElementById('buttonText').value = '';
    document.getElementById('buttonAutoSendToggle').checked = true; // Reset to default checked

    // **New Addition: Set the profileSelect dropdown to the current profile**
    profileSelect.value = currentProfile.PROFILE_NAME;
}

// -------------------------
// 9. Event Listeners
// -------------------------

/**
 * Initializes event listeners and loads profiles on DOMContentLoaded.
 * 
 * Dependencies:
 * - /popup-page-scripts/popup-page-profiles.js: Uses loadProfiles(), switchProfile(), addNewEmptyProfile(), copyCurrentProfile(), deleteCurrentProfile().
 * - /popup-page-scripts/popup-page-customButtons.js: Uses addButton(), addSeparator(), deleteButton().
 * - /popup-page-scripts/popup-page-visuals.js: Uses showToast().
 * - /popup-page-scripts/popup-page-script.js: Uses various utility functions like logToConsole(), textareaSaverAndResizerFunc(), etc.
 * 
 * Why:
 * Sets up the interactive elements of the UI, ensuring that user actions trigger the appropriate functions to manage profiles and buttons.
 */
document.addEventListener('DOMContentLoaded', () => {
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
    });

    // Copy Profile Button Click
    copyProfileButton.addEventListener('click', () => {
        copyProfileContainer.style.display = 'flex';
        copyProfileButton.style.display = 'none';
        addProfileButton.style.display = 'none';
        addProfileContainer.style.display = 'none';
        deleteProfileButton.style.display = 'none'; // Hide delete button during copy
        profileSelect.disabled = true; // Lock profile selector
    });

    // Save Add Profile Button Click
    saveAddProfileButton.addEventListener('click', () => {
        const profileName = addProfileInput.value;
        if (profileName.trim() === "") {
            addProfileInput.classList.add('input-error');
            addProfileInput.placeholder = "Enter profile name here";
            addProfileInput.style.borderColor = 'var(--danger-color)';
            showToast('Profile name cannot be empty.', 'error');
            logToConsole('Save Add Profile failed: Empty input.');
            return;
        }
        addProfileInput.classList.remove('input-error');
        addNewEmptyProfile(profileName);
        // Reset and hide input
        addProfileInput.value = '';
        addProfileInput.style.borderColor = '';
        addProfileContainer.style.display = 'none';
        // Show both "Add Profile" and "Duplicate Profile" buttons
        addProfileButton.style.display = 'inline-block';
        copyProfileButton.style.display = 'inline-block';
        deleteProfileButton.style.display = 'inline-block'; // Show delete button after add
        profileSelect.disabled = false; // Unlock profile selector
    });

    // Save Copy Profile Button Click
    saveCopyProfileButton.addEventListener('click', () => {
        const newProfileName = copyProfileInput.value;
        if (newProfileName.trim() === "") {
            copyProfileInput.classList.add('input-error');
            copyProfileInput.placeholder = "Enter new profile name here";
            copyProfileInput.style.borderColor = 'var(--danger-color)';
            showToast('Profile name cannot be empty.', 'error');
            logToConsole('Save Copy Profile failed: Empty input.');
            return;
        }
        copyProfileInput.classList.remove('input-error');
        copyCurrentProfile(newProfileName);
        // Reset and hide input
        copyProfileInput.value = '';
        copyProfileInput.style.borderColor = '';
        copyProfileContainer.style.display = 'none';
        // Show both "Add Profile" and "Duplicate Profile" buttons
        copyProfileButton.style.display = 'inline-block';
        addProfileButton.style.display = 'inline-block';
        deleteProfileButton.style.display = 'inline-block'; // Show delete button after copy
        profileSelect.disabled = false; // Unlock profile selector
    });

    // Delete Profile Button Click
    deleteProfileButton.addEventListener('click', deleteCurrentProfile);

    // Cancel Add Profile Button Click
    cancelAddProfileButton.addEventListener('click', () => {
        addProfileContainer.style.display = 'none';
        addProfileButton.style.display = 'inline-block';
        copyProfileButton.style.display = 'inline-block';
        deleteProfileButton.style.display = 'inline-block'; // Show delete button
        profileSelect.disabled = false; // Unlock profile selector
    });

    // Cancel Copy Profile Button Click
    cancelCopyProfileButton.addEventListener('click', () => {
        copyProfileContainer.style.display = 'none';
        addProfileButton.style.display = 'inline-block';
        copyProfileButton.style.display = 'inline-block';
        deleteProfileButton.style.display = 'inline-block'; // Show delete button
        profileSelect.disabled = false; // Unlock profile selector
    });

    // Button management
    document.getElementById('addButton').addEventListener('click', addButton);
    document.getElementById('addSeparator').addEventListener('click', addSeparator);

    // Settings
    document.getElementById('autoSendToggle').addEventListener('change', updateGlobalSettings);
    document.getElementById('shortcutsToggle').addEventListener('change', updateGlobalSettings);
    document.getElementById('revertDefault').addEventListener('click', revertToDefault);

    // Drag and drop
    buttonList.addEventListener('dragstart', handleDragStart);
    buttonList.addEventListener('dragover', handleDragOver);
    buttonList.addEventListener('drop', handleDrop);
    buttonList.addEventListener('dragend', handleDragEnd);

    // Button list event delegation for delete buttons
    buttonList.addEventListener('click', async (e) => {
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

    // Initialize event listeners
    textareaSaverAndResizerFunc();
    attachEmojiInputListeners();
    attachAutoSendToggleListeners();

    // -------------------------
    // 10. Open Links in New Tabs - This is the way to open external links in extensions, otherwise clicking does nothing
    // -------------------------

    /**
     * Opens external links in new tabs using the Chrome Tabs API.
     * @param {Event} e - The click event.
     */
    function handleExternalLinkClick(e) {
        e.preventDefault(); // Prevent the default link behavior
        const url = e.currentTarget.href;
        chrome.tabs.create({ url });
    }

    // Select the Help Section
    const helpSection = document.getElementById('helpSection');
    if (helpSection) {
        // Select all anchor tags within the Help Section that have href starting with http or https
        const helpLinks = helpSection.querySelectorAll('a[href^="http"]');

        helpLinks.forEach(link => {
            link.addEventListener('click', handleExternalLinkClick);
        });
    }
});

// -------------------------
// 11. Drag and Drop Handlers
// -------------------------

/**
 * Handles the start of a drag event.
 * 
 * Dependencies:
 * - None directly, but interacts with DOM elements to manage drag state.
 * 
 * Why:
 * Enables drag-and-drop functionality for reordering custom buttons within the UI.
 * 
 * @param {DragEvent} e - The drag event.
 */
function handleDragStart(e) {
    if (e.target.classList.contains('drag-handle') || e.target.classList.contains('separator-item')) {
        isDragging = true;
        draggedItem = e.target.closest('.button-item');
        draggedItem.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';

        // Set a transparent image as drag image to avoid default ghost
        const img = new Image();
        img.src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=';
        e.dataTransfer.setDragImage(img, 0, 0);
    } else {
        e.preventDefault();
    }
}

/**
 * Handles the drag over event.
 * 
 * Dependencies:
 * - None directly, but interacts with DOM elements to determine drop position.
 * 
 * Why:
 * Manages the visual feedback and placement of the dragged item during a drag-and-drop operation.
 * 
 * @param {DragEvent} e - The drag event.
 */
function handleDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    const target = e.target.closest('.button-item');
    if (!target || target === draggedItem) return;

    const bounding = target.getBoundingClientRect();
    const offset = bounding.y + (bounding.height / 2);
    const parent = target.parentNode;

    if (e.clientY - bounding.y < bounding.height / 2) {
        parent.insertBefore(draggedItem, target);
    } else {
        parent.insertBefore(draggedItem, target.nextSibling);
    }
}

/**
 * Handles the drop event.
 * 
 * Dependencies:
 * - /popup-page-scripts/popup-page-profiles.js: Uses saveCurrentProfile() to persist the new order.
 * - /popup-page-scripts/popup-page-visuals.js: Uses logToConsole() to log the reordering action.
 * 
 * Why:
 * Finalizes the new order of custom buttons after a drag-and-drop operation and saves the updated configuration.
 * 
 * @param {DragEvent} e - The drag event.
 */
function handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();

    isDragging = false;
    if (draggedItem) {
        draggedItem.classList.remove('dragging');
        draggedItem = null;
    }

    // Update the order in the profile
    const newOrder = Array.from(buttonList.children).map(child => parseInt(child.dataset.index));
    currentProfile.customButtons = newOrder.map(index => currentProfile.customButtons[index]);

    saveCurrentProfile();
    updateButtonList();
    logToConsole('Reordered buttons');
}

/**
 * Handles the end of a drag event.
 * 
 * Dependencies:
 * - None directly, but manages the drag state and UI classes.
 * 
 * Why:
 * Cleans up the drag state and visual indicators after a drag-and-drop operation completes.
 * 
 * @param {DragEvent} e - The drag event.
 */
function handleDragEnd(e) {
    isDragging = false;
    if (draggedItem) {
        draggedItem.classList.remove('dragging');
        draggedItem = null;
    }
}

// -------------------------
// 12. Utility Functions
// -------------------------

/**
 * This is not browser console!
 * Logs a message to the user-visible console with a timestamp.
 * 
 * Dependencies:
 * - None directly, but interacts with the DOM to display log messages.
 * 
 * Why:
 * Provides users with real-time feedback and logs of actions performed within the extension for debugging and informational purposes.
 * 
 * @param {string} message - The message to log.
 */
function logToConsole(message) {
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = document.createElement('div');
    logEntry.textContent = `${timestamp}: ${message}`;
    consoleOutput.appendChild(logEntry);
    consoleOutput.scrollTop = consoleOutput.scrollHeight;
}

/**
 * Automatically resizes textareas based on their content and attaches input listeners.
 * 
 * Dependencies:
 * - /popup-page-scripts/popup-page-customButtons.js: Uses saveCurrentProfile() to save text changes.
 * 
 * Why:
 * Enhances user experience by ensuring textareas expand to fit their content and updates the profile configuration as users type.
 */
function textareaSaverAndResizerFunc() {
    const textareas = buttonList.querySelectorAll('textarea.text-input');
    textareas.forEach(textarea => {
        textarea.style.height = 'auto';
        textarea.style.height = `${textarea.scrollHeight}px`;

        textarea.addEventListener('input', () => {
            textarea.style.height = 'auto';
            textarea.style.height = `${textarea.scrollHeight}px`;
            // Update the corresponding button text
            const buttonItem = textarea.closest('.button-item');
            const index = parseInt(buttonItem.dataset.index);
            currentProfile.customButtons[index].text = textarea.value;
            saveCurrentProfile();
        });
    });
}

/**
 * Attaches input listeners to emoji input fields to update button icons.
 * 
 * Dependencies:
 * - /popup-page-scripts/popup-page-customButtons.js: Uses saveCurrentProfile() to save icon changes.
 * 
 * Why:
 * Allows users to dynamically change the icons of their custom buttons and ensures these changes are saved.
 */
function attachEmojiInputListeners() {
    const emojiInputs = buttonList.querySelectorAll('input.emoji-input');
    emojiInputs.forEach(input => {
        input.addEventListener('input', () => {
            const buttonItem = input.closest('.button-item');
            const index = parseInt(buttonItem.dataset.index);
            currentProfile.customButtons[index].icon = input.value;
            saveCurrentProfile();
        });
    });
}

/**
 * Attaches listeners to auto-send toggle inputs to update button settings.
 * 
 * Dependencies:
 * - /popup-page-scripts/popup-page-customButtons.js: Uses saveCurrentProfile() to save auto-send preferences.
 * - /popup-page-scripts/popup-page-profiles.js: Uses logToConsole() to log changes.
 * 
 * Why:
 * Enables users to toggle the auto-send feature for individual buttons and ensures these preferences are persisted.
 */
function attachAutoSendToggleListeners() {
    const autoSendToggles = buttonList.querySelectorAll('input.autosend-toggle');
    autoSendToggles.forEach(toggle => {
        toggle.addEventListener('change', () => {
            const buttonItem = toggle.closest('.button-item');
            const index = parseInt(buttonItem.dataset.index);
            currentProfile.customButtons[index].autoSend = toggle.checked;
            saveCurrentProfile();
            logToConsole(`Updated auto-send for button at index ${index} to ${toggle.checked}`);
        });
    });
}
