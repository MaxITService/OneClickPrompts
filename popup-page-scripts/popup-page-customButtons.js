// popup-page-customButtons.js
// The extension adds custom buttons to webpage, and needs to manage them via the popup page.
// This file contains functions to create, update, delete custom buttons and separators, that will
// be used in the actual web page, but this popup manages their existance and position, by representing them
// as cards in  <div id="buttonCardsList" ...> </div>
// This file creates elements that represent custom buttons (card like elements)
// Button cards contain: emoji input, text input, auto-send toggle, delete button, that are
// used to create custom buttons for the extension. 
// and separators for mostly visual funciton (separatprs behave like button cards with less stuff)
// separator cards contain: visuals, delete button. 
// version: 1.0

// -------------------------
// Create Button Element - this is start of everything, there can be zero to infinite buttons
// -------------------------

/**
 * Creates a button element for the button list.
 * @param {Object} button - The button data from the profile.
 * @param {number} index - The index of the button in the customButtons array.
 * @returns {HTMLElement} - The button item element.
 */
function createButtonCardElement(button, index) {
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
 * Updates the list of custom button cards in the buttonCardsList.
 */
function updatebuttonCardsList() {
    buttonCardsList.innerHTML = ''; // This already removes old listeners
    if (currentProfile.customButtons && currentProfile.customButtons.length > 0) {
        currentProfile.customButtons.forEach((button, index) => {
            const buttonElement = createButtonCardElement(button, index);
            buttonCardsList.appendChild(buttonElement);
        });
    } else {
        const emptyMessage = document.createElement('div');
        emptyMessage.textContent = 'No custom buttons. Add buttons using the buttons above.';
        emptyMessage.className = 'empty-message';
        buttonCardsList.appendChild(emptyMessage);
    }

    // After updating the list, attach event listeners
    textareaSaverAndResizerFunc();
    attachEmojiInputListeners();
    attachAutoSendToggleListeners();
}

// -------------------------
// management section for buttons, where user can add button card with:
//  specific emoji, text, auto-send toggle or clear it and start over.

/**
 * Clears the text in the button text input field. Used only for adding new button.
 */
function clearText() {
    document.getElementById('buttonText').value = '';
    logToGUIConsole('Cleared button text input.');
    document.getElementById('buttonIcon').value = '';
    showToast('Button text cleared', 'info');
}

/**
 * Adds a new custom button and related card to the current profile.
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
    updatebuttonCardsList();
    logToGUIConsole('Added new button');
}


// Section for managing buttons and separators, where user can add, delete, move or update them.
/**
 * Adds a separator to the current profile.
 */
async function addSeparator() {
    currentProfile.customButtons.push({ separator: true });
    await saveCurrentProfile();
    updatebuttonCardsList();
    logToGUIConsole('Added separator');
}

/**
 * Deletes a button at a specified index.
 * @param {number} index - The index of the button to delete.
 */
async function deleteButton(index) {
    currentProfile.customButtons.splice(index, 1);
    await saveCurrentProfile();
    updatebuttonCardsList();
    logToGUIConsole('Deleted button');
}


// -------------------------
// Drag and Drop Functionality
// -------------------------

let isDragging = false;
let draggedItem = null;
let lastDragPosition = { x: 0, y: 0 };

function handleDragStart(e) {
    // Define interactive elements that should not initiate dragging.
    const interactiveTags = ['INPUT', 'TEXTAREA', 'BUTTON', 'SELECT'];
    if (interactiveTags.includes(e.target.tagName)) {
        // Do not initiate drag when interacting with these elements.
        return;
    }
    const buttonItem = e.target.closest('.button-item');
    if (buttonItem) {
        isDragging = true;
        draggedItem = buttonItem;
        buttonItem.classList.add('dragging');
        document.body.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';

        const img = new Image();
        img.src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=';
        e.dataTransfer.setDragImage(img, 0, 0);
    }
}

function autoScroll(e) {
    const scrollThreshold = 220;
    const maxScrollSpeed = 400;
    const { innerWidth, innerHeight } = window;
    let scrollX = 0, scrollY = 0;

    if (e.clientY < scrollThreshold) {
        scrollY = -maxScrollSpeed * ((scrollThreshold - e.clientY) / scrollThreshold);
    } else if (innerHeight - e.clientY < scrollThreshold) {
        scrollY = maxScrollSpeed * ((scrollThreshold - (innerHeight - e.clientY)) / scrollThreshold);
    }

    if (e.clientX < scrollThreshold) {
        scrollX = -maxScrollSpeed * ((scrollThreshold - e.clientX) / scrollThreshold);
    } else if (innerWidth - e.clientX < scrollThreshold) {
        scrollX = maxScrollSpeed * ((scrollThreshold - (innerWidth - e.clientX)) / scrollThreshold);
    }

    if (scrollX !== 0 || scrollY !== 0) {
        window.scrollBy({
            top: scrollY,
            left: scrollX,
            behavior: 'smooth'
        });
    }
}

function handleDragOver(e) {
    e.preventDefault();
    if (!isDragging || !draggedItem) return; // Added check for draggedItem

    e.dataTransfer.dropEffect = 'move';
    autoScroll(e);
    lastDragPosition = { x: e.clientX, y: e.clientY };

    const target = e.target.closest('.button-item');
    // --- Important: Do nothing if the target is the dragged item itself OR if there is no target ---
    if (!target || target === draggedItem) return;

    const parent = target.parentNode;
    // --- Get ALL child elements BEFORE the DOM change ---
    const children = Array.from(parent.children);

    // --- FLIP: First - Record the starting positions ---
    const firstPositions = new Map();
    let firstDraggedRect = null; // Store draggedItem's initial position

    children.forEach(child => {
        const rect = child.getBoundingClientRect();
        if (child === draggedItem) {
            firstDraggedRect = rect; // Record initial position of dragged item
        } else {
            firstPositions.set(child, rect); // Record for background items
        }
    });

    // --- Perform the DOM change (your existing code) ---
    const bounding = target.getBoundingClientRect();
    const offsetY = e.clientY - bounding.top;
    const isBefore = offsetY < bounding.height / 2;

    const currentNextSibling = draggedItem.nextSibling;
    const currentPreviousSibling = draggedItem.previousSibling;

    let domChanged = false; // Flag to track if DOM was actually modified
    if (isBefore) {
        if (target !== currentNextSibling) {
            parent.insertBefore(draggedItem, target);
            domChanged = true;
        }
    } else {
        if (target !== currentPreviousSibling) {
            parent.insertBefore(draggedItem, target.nextSibling);
            domChanged = true;
        }
    }
    // --- END of DOM change ---

    // --- Only proceed with animations if the DOM actually changed ---
    if (domChanged) {
        // --- FLIP: Last, Invert, Play for BACKGROUND items ---
        children.forEach(child => {
            if (child !== draggedItem && firstPositions.has(child)) {
                const firstRect = firstPositions.get(child);
                const lastRect = child.getBoundingClientRect(); // Last

                const deltaX = firstRect.left - lastRect.left;
                const deltaY = firstRect.top - lastRect.top;

                if (deltaX !== 0 || deltaY !== 0) {
                    child.style.transition = 'transform 0s'; // Invert (No transition)
                    child.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
                    child.offsetWidth; // Force reflow

                    child.style.transition = 'transform 200ms ease-in-out'; // Play
                    child.style.transform = '';

                    child.addEventListener('transitionend', () => {
                        child.style.transition = '';
                    }, { once: true });
                } else {
                    child.style.transition = '';
                    child.style.transform = '';
                }
            }
        });

        // --- FLIP: Last, Invert, Play for DRAGGED item ---
        if (firstDraggedRect) {
            const lastDraggedRect = draggedItem.getBoundingClientRect();

            // Calculate delta based on the TOP-LEFT corner
            const deltaDraggedX = firstDraggedRect.left - lastDraggedRect.left;
            const deltaDraggedY = firstDraggedRect.top - lastDraggedRect.top;

            // Define the transform states explicitly
            const invertTransform = `translate(${deltaDraggedX}px, ${deltaDraggedY}px) scale(0.8)`;
            const playTransform = 'scale(0.8)'; // Target state (scaled, at natural position)

            // Check if the element's calculated position actually needs to change
            if (deltaDraggedX !== 0 || deltaDraggedY !== 0) {
                // Invert: Apply transform immediately, ensuring NO transition happens
                draggedItem.style.transition = 'none'; // Explicitly disable transitions
                draggedItem.style.transform = invertTransform;

                // Force reflow is crucial here
                draggedItem.offsetWidth;

                // Play: Enable transition ONLY for the transform property,
                // and set the target transform state.
                draggedItem.style.transition = 'transform 150ms ease-out';
                draggedItem.style.transform = playTransform;

                // Cleanup will implicitly happen on the next dragover or dragend.

            } else {
                // If DOM position didn't change, ensure it still has the correct base dragging transform
                // and importantly, ensure no transition is active from a previous interrupted move.
                 draggedItem.style.transition = 'none'; // Remove any potentially active transition
                 draggedItem.style.transform = playTransform; // Ensure the scale(0.8) is applied
            }
        }

    } // end if(domChanged)
}

function handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();

    if (!isDragging || !draggedItem) return;
    finalizeDrag();
    logToGUIConsole('Reordered buttons');
}

function handleDragEnd(e) {
    if (!isDragging || !draggedItem) return;
    finalizeDrag();
}

function finalizeDrag() {
    isDragging = false;
    if (draggedItem) {
        draggedItem.classList.remove('dragging');
        draggedItem = null;
    }

    document.body.classList.remove('dragging');
    // Removed clearInterval call as scrollInterval is unused.

    const newOrder = Array.from(buttonCardsList.children).map(child => parseInt(child.dataset.index));
    currentProfile.customButtons = newOrder.map(index => currentProfile.customButtons[index]);

    saveCurrentProfile();
    updatebuttonCardsList();
}


// -------------------------
// Section that controls what happens inside cards of buttons and separators:
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

    textarea.style.overflow = 'hidden';
    textarea.style.resize = 'none';

    const resizeTextarea = () => {
        textarea.style.height = 'auto';
        textarea.style.height = textarea.scrollHeight + 'px';
    };

    textarea.addEventListener('input', resizeTextarea);
    resizeTextarea();
}

/**
 * Attaches input listeners to emoji input fields to update button icons.
 * Modified to use debouncedSaveCurrentProfile() for throttled saving.
 */
function attachEmojiInputListeners() {
    const emojiInputs = buttonCardsList.querySelectorAll('input.emoji-input');
    emojiInputs.forEach(input => {
        input.addEventListener('input', () => {
            const buttonItem = input.closest('.button-item');
            const index = parseInt(buttonItem.dataset.index);
            currentProfile.customButtons[index].icon = input.value;
            debouncedSaveCurrentProfile();
        });
    });
}

/**
 * Attaches listeners to auto-send toggle inputs to update button settings.
 * Modified to use debouncedSaveCurrentProfile() for throttled saving.
 */
function attachAutoSendToggleListeners() {
    const autoSendToggles = buttonCardsList.querySelectorAll('input.autosend-toggle');
    autoSendToggles.forEach(toggle => {
        toggle.addEventListener('change', () => {
            const buttonItem = toggle.closest('.button-item');
            const index = parseInt(buttonItem.dataset.index);
            currentProfile.customButtons[index].autoSend = toggle.checked;
            debouncedSaveCurrentProfile();
            logToGUIConsole(`Updated auto-send for button at index ${index} to ${toggle.checked}`);
        });
    });
}

/**
 * Automatically resizes textareas based on their content and attaches input listeners.
 * Modified to use debouncedSaveCurrentProfile() for throttled saving.
 */
function textareaSaverAndResizerFunc() {
    const textareas = buttonCardsList.querySelectorAll('textarea.text-input');
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
            
            // Use debounced save to throttle saving
            debouncedSaveCurrentProfile();
        });
    });
}
