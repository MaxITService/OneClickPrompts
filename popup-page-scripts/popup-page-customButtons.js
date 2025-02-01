// popup-page-customButtons.js
// instructions for the AI: do not remove comments! MUST NOT REMOVE COMMENTS.
// This file creates elements that represent custom buttons adn separators for the extension.
// This file contains only dependencies.
// -------------------------
// Create Button Element Function
// -------------------------

/**
 * Creates a button element for the button list.
 * @param {Object} button - The button data from the profile.
 * @param {number} index - The index of the button in the customButtons array.
 * @returns {HTMLElement} - The button item element.
 */
function createButtonElement(button, index) {
    const buttonItem = document.createElement('div');
    buttonItem.className = 'button-item';
    buttonItem.dataset.index = index;
    buttonItem.draggable = true; // Ensure the item is draggable

    if (button.separator) {
        buttonItem.classList.add('separator-item');
        buttonItem.innerHTML = `
            <div class="separator-line"></div>
            <span class="separator-text">Separator</span>
            <div class="separator-line"></div>
            <button class="delete-button danger">Delete</button>
        `;
    } else {
        buttonItem.innerHTML = `
            <div class="drag-handle" draggable="true">&#9776;</div>
            <input type="text" class="emoji-input" value="${button.icon}">
            <textarea class="text-input" rows="1">${button.text}</textarea>
            <label class="checkbox-row">
                <input type="checkbox" class="autosend-toggle" ${button.autoSend ? 'checked' : ''}>
                <span>Auto-send</span>
                ${ index < 10 
                    ? `<span class="shortcut-indicator">[Ctrl+${index === 9 ? 0 : index + 1}]</span>` 
                    : '' 
                }
            </label>
            <button class="delete-button danger">Delete</button>
        `;
    }

    return buttonItem;
}



/**
 * Updates the list of custom buttons in the interface.
 */
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
    textareaSaverAndResizerFunc();
    attachEmojiInputListeners();
    attachAutoSendToggleListeners();
}

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
