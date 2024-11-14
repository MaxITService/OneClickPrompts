// popup-page-visuals.js
// Version: 1.0
// Visual functions for Max Extension configuration interface

'use strict';

// -------------------------
// Console Logging Function
// -------------------------

// Console logging (this is user visible console, not debug one)
function logToConsole(message) {
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = document.createElement('div');
    logEntry.textContent = `${timestamp}: ${message}`;
    consoleOutput.appendChild(logEntry);
    consoleOutput.scrollTop = consoleOutput.scrollHeight;
}

// -------------------------
// Create Button Element Function
// -------------------------

function createButtonElement(button, index) {
    const buttonItem = document.createElement('div');
    buttonItem.className = 'button-item';
    buttonItem.dataset.index = index;
    buttonItem.draggable = true; // Ensure the item is draggable

    if (button.separator) {
        buttonItem.classList.add('separator-item');
        // Updated separator with labeled text
        buttonItem.innerHTML = `
            <div class="separator-line"></div>
            <span class="separator-text">Separator</span>
            <div class="separator-line"></div>
            <button class="delete-button">Delete</button>
        `;
    } else {
        buttonItem.innerHTML = `
            <div class="drag-handle" draggable="true">&#9776;</div>
            <input type="text" class="emoji-input" value="${button.icon}">
            <textarea class="text-input" rows="1">${button.text}</textarea>
            <label>
                <input type="checkbox" class="autosend-toggle" ${button.autoSend ? 'checked' : ''}>
                Auto-send
            </label>
            <button class="delete-button">Delete</button>
        `;
    }

    return buttonItem;
}

// -------------------------
// Update Button List Function
// -------------------------

function updateButtonList() {
    buttonList.innerHTML = '';
    if (currentProfile.customButtons && currentProfile.customButtons.length > 0) {
        currentProfile.customButtons.forEach((button, index) => {
            const buttonElement = createButtonElement(button, index);
            buttonList.appendChild(buttonElement);
        });
    } else {
        const emptyMessage = document.createElement('div');
        emptyMessage.textContent = 'No custom buttons. Add buttons using the buttons above.';
        emptyMessage.className = 'empty-message';
        buttonList.appendChild(emptyMessage);
    }

    // After updating the list, attach event listeners
    attachTextareaAutoResize();
    attachEmojiInputListeners();
    attachAutoSendToggleListeners();
}

// -------------------------
// Update Interface Function
// -------------------------

function updateInterface() {
    // Update button list
    updateButtonList();

    // Update settings
    document.getElementById('autoSendToggle').checked = currentProfile.globalAutoSendEnabled;
    document.getElementById('shortcutsToggle').checked = currentProfile.enableShortcuts;

    // Clear input fields
    document.getElementById('buttonIcon').value = '';
    document.getElementById('buttonText').value = '';
    document.getElementById('buttonAutoSendToggle').checked = true; // Reset to default checked
}

// -------------------------
// Event Listeners Attachment Functions
// -------------------------

// Function to auto-resize textareas and handle input changes
function attachTextareaAutoResize() {
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

// Function to handle emoji input changes
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

// Function to handle auto-send toggle changes
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

// -------------------------
// Drag and Drop Handling
// -------------------------

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

function handleDragEnd(e) {
    isDragging = false;
    if (draggedItem) {
        draggedItem.classList.remove('dragging');
        draggedItem = null;
    }
}
