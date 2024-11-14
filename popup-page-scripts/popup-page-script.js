// popup-page-script.js
// Version: 1.6.1
// Main script for Max Extension configuration interface

'use strict';

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

const toastContainer = document.getElementById('toastContainer');

// -------------------------
// 1. Minimal Default Config
// -------------------------

// Minimal Default configuration object for empty profiles
const minimalDefaultConfig = {
    PROFILE_NAME: "Empty Profile",
    ENABLE_SHORTCUTS_DEFAULT: true,
    globalAutoSendEnabled: true,
    enableShortcuts: true,
    firstModificationDone: false,
    customButtons: [] // No buttons or separators
};

// -------------------------
// 2. Profile Management Functions
// -------------------------

// Load all profiles and set the current profile
async function loadProfiles() {
    try {
        const response = await chrome.runtime.sendMessage({ type: 'listProfiles' });
        profileSelect.innerHTML = ''; // Clear existing options

        response.profiles.forEach(profile => {
            const option = document.createElement('option');
            option.value = profile;
            option.textContent = profile;
            profileSelect.appendChild(option);
        });

        // Load current profile
        const configResponse = await chrome.runtime.sendMessage({ type: 'getConfig' });
        currentProfile = configResponse.config;
        profileSelect.value = currentProfile.PROFILE_NAME;

        updateInterface();
        logToConsole(`Loaded profile: ${currentProfile.PROFILE_NAME}`);
    } catch (error) {
        logToConsole(`Error loading profiles: ${error.message}`);
    }
}

// Switch to a different profile
async function switchProfile(profileName) {
    try {
        const response = await chrome.runtime.sendMessage({
            type: 'switchProfile',
            profileName: profileName
        });

        currentProfile = response.config;
        updateInterface();
        logToConsole(`Switched to profile: ${profileName}`);
        updateSaveStatus();
    } catch (error) {
        logToConsole(`Error switching profile: ${error.message}`);
    }
}

// -------------------------
// 3. Add New Empty Profile
// -------------------------

// Function to create a new empty profile using minimalDefaultConfig
async function addNewEmptyProfile(profileName) {
    // Trim whitespace and validate profile name
    const trimmedProfileName = profileName.trim();
    if (trimmedProfileName === "") {
        showToast('Profile name cannot be empty.', 'error');
        logToConsole('Profile creation failed: Empty name provided.');
        return;
    }

    // Check if profile name already exists
    const existingProfiles = Array.from(profileSelect.options).map(option => option.value);
    if (existingProfiles.includes(trimmedProfileName)) {
        showToast('A profile with this name already exists.', 'error');
        logToConsole(`Profile creation failed: "${trimmedProfileName}" already exists.`);
        return;
    }

    try {
        // Initialize new profile with minimal settings
        const newConfig = { ...minimalDefaultConfig, PROFILE_NAME: trimmedProfileName };
        await chrome.runtime.sendMessage({
            type: 'saveConfig',
            profileName: trimmedProfileName,
            config: newConfig
        });

        await loadProfiles();
        profileSelect.value = trimmedProfileName;
        await switchProfile(trimmedProfileName);
        showToast(`Profile "${trimmedProfileName}" added successfully.`, 'success');
        logToConsole(`Created new empty profile: ${trimmedProfileName}`);
    } catch (error) {
        showToast(`Error creating profile: ${error.message}`, 'error');
        logToConsole(`Error creating profile: ${error.message}`);
    }
}

// -------------------------
// 4. Copy Current Profile
// -------------------------

async function copyCurrentProfile(newProfileName) {
    // Trim whitespace and validate profile name
    const trimmedProfileName = newProfileName.trim();
    if (trimmedProfileName === "") {
        showToast('Profile name cannot be empty.', 'error');
        logToConsole('Profile copy failed: Empty name provided.');
        return;
    }

    // Check if profile name already exists
    const existingProfiles = Array.from(profileSelect.options).map(option => option.value);
    if (existingProfiles.includes(trimmedProfileName)) {
        showToast('A profile with this name already exists.', 'error');
        logToConsole(`Profile copy failed: "${trimmedProfileName}" already exists.`);
        return;
    }

    try {
        // Deep copy current profile settings
        const newConfig = JSON.parse(JSON.stringify(currentProfile));
        newConfig.PROFILE_NAME = trimmedProfileName;

        await chrome.runtime.sendMessage({
            type: 'saveConfig',
            profileName: trimmedProfileName,
            config: newConfig
        });

        await loadProfiles();
        profileSelect.value = trimmedProfileName;
        await switchProfile(trimmedProfileName);
        showToast(`Profile duplicated as "${trimmedProfileName}" successfully.`, 'success');
        logToConsole(`Copied profile to new profile: ${trimmedProfileName}`);
    } catch (error) {
        showToast(`Error copying profile: ${error.message}`, 'error');
        logToConsole(`Error copying profile: ${error.message}`);
    }
}

// Delete the current profile
async function deleteCurrentProfile() {
    if (currentProfile.PROFILE_NAME === 'Default') {
        alert('Cannot delete Default profile');
        return;
    }

    if (!confirm(`Delete profile "${currentProfile.PROFILE_NAME}"?`)) return;

    try {
        await chrome.runtime.sendMessage({
            type: 'deleteProfile',
            profileName: currentProfile.PROFILE_NAME
        });

        await loadProfiles();
        logToConsole(`Deleted profile: ${currentProfile.PROFILE_NAME}`);
        showToast(`Profile "${currentProfile.PROFILE_NAME}" deleted successfully.`, 'success');
    } catch (error) {
        showToast(`Error deleting profile: ${error.message}`, 'error');
        logToConsole(`Error deleting profile: ${error.message}`);
    }
}

// -------------------------
// 5. Button Management Functions
// -------------------------

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

async function addSeparator() {
    currentProfile.customButtons.push({ separator: true });
    await saveCurrentProfile();
    updateButtonList();
    logToConsole('Added separator');
}

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

async function updateGlobalSettings() {
    currentProfile.globalAutoSendEnabled = document.getElementById('autoSendToggle').checked;
    currentProfile.enableShortcuts = document.getElementById('shortcutsToggle').checked;
    await saveCurrentProfile();
    logToConsole('Updated global settings');
}

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

function updateSaveStatus() {
    const timestamp = new Date().toLocaleTimeString();
    saveStatus.textContent = `Last saved: ${timestamp}`;
}

// -------------------------
// 9. Interface Update Functions
// -------------------------

function updateInterface() {
    // Update buttons, settings, etc. based on currentProfile
    updateButtonList();
    document.getElementById('autoSendToggle').checked = currentProfile.globalAutoSendEnabled;
    document.getElementById('shortcutsToggle').checked = currentProfile.enableShortcuts;
    // Add more interface updates as needed
}

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
        copyProfileContainer.style.display = 'none';
    });

    // Copy Profile Button Click
    copyProfileButton.addEventListener('click', () => {
        copyProfileContainer.style.display = 'flex';
        copyProfileButton.style.display = 'none';
        addProfileContainer.style.display = 'none';
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
        addProfileButton.style.display = 'inline-block';
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
        copyProfileButton.style.display = 'inline-block';
        
        // **Fix:** Ensure "Add Profile" button is visible after duplication
        addProfileButton.style.display = 'inline-block';
    });

    // Delete Profile Button Click
    deleteProfileButton.addEventListener('click', deleteCurrentProfile);

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

function handleDragStart(e) {
    if (!e.target.classList.contains('button-item')) return;
    isDragging = true;
    draggedItem = e.target;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/html', e.target.outerHTML);
    e.target.classList.add('dragging');
}

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

function logToConsole(message) {
    const logEntry = document.createElement('div');
    logEntry.textContent = message;
    consoleOutput.appendChild(logEntry);
    consoleOutput.scrollTop = consoleOutput.scrollHeight;
}

function attachTextareaAutoResize() {
    const textareas = document.querySelectorAll('textarea');
    textareas.forEach(textarea => {
        textarea.addEventListener('input', () => {
            textarea.style.height = 'auto';
            textarea.style.height = textarea.scrollHeight + 'px';
        });
    });
}

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

function attachAutoSendToggleListeners() {
    const autoSendToggles = document.querySelectorAll('#buttonAutoSendToggle');
    autoSendToggles.forEach(toggle => {
        toggle.addEventListener('change', () => {
            // Handle auto-send toggle changes if needed
        });
    });
}
