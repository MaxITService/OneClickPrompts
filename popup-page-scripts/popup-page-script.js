// popup-page-script.js
// Version: 1.6.4
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
const cancelAddProfileButton = document.getElementById('cancelAddProfile');
const cancelCopyProfileButton = document.getElementById('cancelCopyProfile');

// Scroll interval data
let scrollInterval = null;
let lastDragPosition = { x: 0, y: 0 };

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
    logToConsole('Updated global settings');
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
        logToConsole('No valid current profile found. Attempting to retrieve default profile...');
        chrome.runtime.sendMessage({ type: 'getConfig' }, (response) => {
            if (response && response.config) {
                currentProfile = response.config;
                updateInterface(); // Call updateInterface again after retrieving default
            } else {
                logToConsole('Failed to retrieve default profile in updateInterface.');
            }
        });
        return;
    }
    // Update buttons, settings, etc. based on currentProfile
    updateButtonList();
    document.getElementById('autoSendToggle').checked = currentProfile.globalAutoSendEnabled;
    document.getElementById('shortcutsToggle').checked = currentProfile.enableShortcuts;
    // Clear input fields
    document.getElementById('buttonIcon').value = '';
    document.getElementById('buttonText').value = '';
    document.getElementById('buttonAutoSendToggle').checked = true; // Reset to default checked

    // Set the profileSelect dropdown to the current profile
    profileSelect.value = currentProfile.PROFILE_NAME;
}

// -------------------------
// 9. Event Listeners
// -------------------------

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
    document.getElementById('clearText').addEventListener('click', clearText);
    document.getElementById('addSeparator').addEventListener('click', addSeparator);

    // Settings
    document.getElementById('autoSendToggle').addEventListener('change', updateGlobalSettings);
    document.getElementById('shortcutsToggle').addEventListener('change', updateGlobalSettings);
    document.getElementById('revertDefault').addEventListener('click', revertToDefault);

    // Drag and drop events
    buttonList.addEventListener('dragstart', handleDragStart);
    buttonList.addEventListener('dragover', handleDragOver);
    buttonList.addEventListener('drop', handleDrop);
    // Listen to dragend on the entire document as well, in case user drops outside the buttonList
    document.addEventListener('dragend', handleDragEnd);

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
// 11. Drag and Drop Handlers
// -------------------------

function handleDragStart(e) {
    // Only allow dragging via drag-handle or the entire separator
    if (e.target.classList.contains('drag-handle') || e.target.classList.contains('separator-item')) {
        isDragging = true;
        draggedItem = e.target.closest('.button-item');
        draggedItem.classList.add('dragging');

        // **Added Functionality: Add 'dragging' class to body to disable hover effects**
        document.body.classList.add('dragging');

        e.dataTransfer.effectAllowed = 'move';

        // A transparent image for drag image
        const img = new Image();
        img.src =
            'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=';
        e.dataTransfer.setDragImage(img, 0, 0);
    } else {
        e.preventDefault();
    }
}

function handleDragOver(e) {
    e.preventDefault();
    if (!isDragging) return;

    e.dataTransfer.dropEffect = 'move';
    lastDragPosition = { x: e.clientX, y: e.clientY };

    // Identify potential target
    const target = e.target.closest('.button-item');
    if (!target || target === draggedItem) return;

    const bounding = target.getBoundingClientRect();
    const parent = target.parentNode;
    const offsetY = e.clientY - bounding.top;
    const isBefore = offsetY < bounding.height / 2;

    // Re-insert draggedItem before or after 'target'
    if (isBefore) {
        parent.insertBefore(draggedItem, target);
    } else {
        parent.insertBefore(draggedItem, target.nextSibling);
    }

    // Auto-scroll if near top/bottom
    handleAutoScroll();
}

function handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();

    if (!isDragging || !draggedItem) return;

    // Finalize position, save the new order
    finalizeDrag();
    logToConsole('Reordered buttons');
}

function handleDragEnd(e) {
    if (!isDragging || !draggedItem) return;

    // If user drops outside the buttonList, finalize
    finalizeDrag();
}

/**
 * Stop any scrolling and finalize the new button order
 */
function finalizeDrag() {
    isDragging = false;
    if (draggedItem) {
        draggedItem.classList.remove('dragging');
        draggedItem = null;
    }

    // **Added Functionality: Remove 'dragging' class from body to re-enable hover effects**
    document.body.classList.remove('dragging');

    clearInterval(scrollInterval);
    scrollInterval = null;

    // Rebuild the customButtons array in new order
    const newOrder = Array.from(buttonList.children).map(child => parseInt(child.dataset.index));
    currentProfile.customButtons = newOrder.map(index => currentProfile.customButtons[index]);

    // Save changes and rebuild UI
    saveCurrentProfile();
    updateButtonList();
}

// -------------------------
// 12. Utility Functions
// -------------------------

/**
 * This is not browser console!
 * Logs a message to the user-visible console with a timestamp.
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
 * Adds an input listener to a textarea (by its ID) so that its height
 * dynamically adjusts to fit its content.
 *
 * @param {string} textareaId - The ID of the textarea element.
 */
function textareaInputAreaResizerFun(textareaId) {
    const textarea = document.getElementById(textareaId);
    if (!textarea) {
        console.error(`Textarea with id "${textareaId}" not found.`);
        return;
    }

    // Ensure the textarea doesn't show scrollbars or allow manual resizing
    textarea.style.overflow = 'hidden';
    textarea.style.resize = 'none';

    // Function to resize the textarea to fit its content
    const resizeTextarea = () => {
        // Reset the height to allow shrinking if content is removed
        textarea.style.height = 'auto';
        // Set the height to match the content's scrollHeight
        textarea.style.height = textarea.scrollHeight + 'px';
    };

    // Adjust the textarea size on input events
    textarea.addEventListener('input', resizeTextarea);

    // Initial resize in case there is preset content
    resizeTextarea();
}

/**
 * Attaches input listeners to emoji input fields to update button icons.
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

/**
 * Clears the text in the button text input field.
 */
function clearText() {
    // Clear the text input field for button template text
    document.getElementById('buttonText').value = '';
    logToConsole('Cleared button text input.');
    document.getElementById('buttonIcon').value = '';
    showToast('Button text cleared', 'info');
    
}
