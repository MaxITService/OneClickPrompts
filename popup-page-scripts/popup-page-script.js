// popup-page-script.js
// Version: 1.6.2
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

const toastContainer = document.getElementById('toastContainer');


// -------------------------
// 5. Button Management Functions
// -------------------------

/**
 * Adds a new custom button to the current profile.
 */
async function addButton() {
    const icon = document.getElementById('buttonIcon').value || '✨';
    const text = document.getElementById('buttonText').value || 'New Button';
    const autoSend = document.getElementById('buttonAutoSendToggle').checked;

    currentProfile.customButtons.push({
        icon: icon,
        text: text,
        autoSend: autoSend
    });

    await saveCurrentProfile();
    updateButtonList();
    logToConsole('Added new button');
}

/**
 * Adds a separator to the current profile.
 */
async function addSeparator() {
    currentProfile.customButtons.push({ separator: true });
    await saveCurrentProfile();
    updateButtonList();
    logToConsole('Added separator');
}

/**
 * Deletes a button at a specified index.
 * @param {number} index - The index of the button to delete.
 */
async function deleteButton(index) {
    currentProfile.customButtons.splice(index, 1);
    await saveCurrentProfile();
    updateButtonList();
    logToConsole('Deleted button');
}

// -------------------------
// 6. Toast Notification Function
// -------------------------

/**
 * Displays a toast notification.
 *
 * @param {string} message - The message to display in the toast.
 * @param {string} type - The type of toast ('success', 'error', 'info').
 * @param {number} duration - Duration in milliseconds before the toast disappears. Defaults to 3000ms.
 */
function showToast(message, type = 'info', duration = 3000) {
    const toast = document.createElement('div');
    toast.classList.add('toast', type);
    toast.textContent = message;

    toastContainer.appendChild(toast);

    // Trigger reflow to enable CSS transition
    void toast.offsetWidth;

    toast.classList.add('show');

    // Remove toast after specified duration
    setTimeout(() => {
        toast.classList.remove('show');
        // Remove the toast from DOM after transition
        toast.addEventListener('transitionend', () => {
            toast.remove();
        });
    }, duration);
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
    logToConsole('Updated global settings');
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

// -------------------------
// 9. Interface Update Functions
// -------------------------

/**
 * Updates the entire interface based on the current profile.
 */
function updateInterface() {
    // Update buttons, settings, etc. based on currentProfile
    updateButtonList();
    document.getElementById('autoSendToggle').checked = currentProfile.globalAutoSendEnabled;
    document.getElementById('shortcutsToggle').checked = currentProfile.enableShortcuts;
    // Add more interface updates as needed
}

/**
 * Updates the list of custom buttons in the interface.
 */
function updateButtonList() {
    buttonList.innerHTML = '';
    currentProfile.customButtons.forEach((btn, index) => {
        if (btn.separator) {
            const separator = document.createElement('div');
            separator.classList.add('button-item', 'separator-item');
            separator.innerHTML = `
                <div class="separator-line"></div>
                <div class="separator-text">Separator</div>
                <div class="separator-line"></div>
                <button class="delete-button danger">Delete</button>
            `;
            separator.setAttribute('data-index', index);
            buttonList.appendChild(separator);
        } else {
            const buttonItem = document.createElement('div');
            buttonItem.classList.add('button-item');
            buttonItem.setAttribute('draggable', 'true');
            buttonItem.setAttribute('data-index', index);
            buttonItem.innerHTML = `
                <span class="drag-handle">☰</span>
                <span class="button-icon">${btn.icon}</span>
                <span class="button-text">${btn.text}</span>
                <button class="delete-button danger">Delete</button>
            `;
            buttonList.appendChild(buttonItem);
        }
    });
}

// -------------------------
// 10. Event Listeners
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
    attachTextareaAutoResize();
    attachEmojiInputListeners();
    attachAutoSendToggleListeners();
});

// -------------------------
// 11. Drag and Drop Handlers
// -------------------------

/**
 * Handles the start of a drag event.
 * @param {DragEvent} e - The drag event.
 */
function handleDragStart(e) {
    if (!e.target.classList.contains('button-item')) return;
    isDragging = true;
    draggedItem = e.target;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/html', e.target.outerHTML);
    e.target.classList.add('dragging');
}

/**
 * Handles the drag over event.
 * @param {DragEvent} e - The drag event.
 */
function handleDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const target = e.target.closest('.button-item');
    if (target && target !== draggedItem) {
        const rect = target.getBoundingClientRect();
        const next = (e.clientY - rect.top) / rect.height > 0.5;
        buttonList.insertBefore(draggedItem, next && target.nextSibling || target);
    }
}

/**
 * Handles the drop event.
 * @param {DragEvent} e - The drag event.
 */
function handleDrop(e) {
    e.preventDefault();
    if (draggedItem) {
        draggedItem.classList.remove('dragging');
        isDragging = false;
        draggedItem = null;
        // Update the customButtons array based on new order
        const newOrder = Array.from(buttonList.children).map(child => parseInt(child.dataset.index));
        currentProfile.customButtons = newOrder.map(index => currentProfile.customButtons[index]);
        saveCurrentProfile();
        updateButtonList();
        logToConsole('Reordered buttons');
    }
}

/**
 * Handles the end of a drag event.
 * @param {DragEvent} e - The drag event.
 */
function handleDragEnd(e) {
    if (draggedItem) {
        draggedItem.classList.remove('dragging');
    }
    isDragging = false;
    draggedItem = null;
}

// -------------------------
// 12. Utility Functions
// -------------------------

/**
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
 * Automatically resizes all textareas based on their content.
 */
function attachTextareaAutoResize() {
    const textareas = document.querySelectorAll('textarea');
    textareas.forEach(textarea => {
        textarea.addEventListener('input', () => {
            textarea.style.height = 'auto';
            textarea.style.height = textarea.scrollHeight + 'px';
        });
    });
}

/**
 * Attaches input listeners to emoji input fields to limit input length.
 */
function attachEmojiInputListeners() {
    const emojiInputs = document.querySelectorAll('.emoji-input');
    emojiInputs.forEach(input => {
        input.addEventListener('input', () => {
            if (input.value.length > 2) {
                input.value = input.value.slice(0, 2);
            }
        });
    });
}

/**
 * Attaches listeners to auto-send toggle inputs if needed.
 */
function attachAutoSendToggleListeners() {
    const autoSendToggles = document.querySelectorAll('#buttonAutoSendToggle');
    autoSendToggles.forEach(toggle => {
        toggle.addEventListener('change', () => {
            // Handle auto-send toggle changes if needed
        });
    });
}
