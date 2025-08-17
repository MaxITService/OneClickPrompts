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
// version: 1.1

// -------------------------
// Special constants
// -------------------------
const SETTINGS_BUTTON_MAGIC_TEXT = '%OCP_APP_SETTINGS_SYSTEM_BUTTON%';

/**
 * Gets the Cross-Chat module settings.
 * @returns {Promise<Object>} - The Cross-Chat module settings.
 */
async function getCrossChatSettings() {
    try {
        const response = await chrome.runtime.sendMessage({ type: 'getCrossChatModuleSettings' });
        return response && response.settings ? response.settings : { enabled: false, placement: 'after' };
    } catch (error) {
        console.error('Error fetching Cross-Chat settings:', error);
        return { enabled: false, placement: 'after' }; // Default fallback
    }
}

// -------------------------
// Create Button Element - this is start of everything, there can be zero to infinite buttons
// -------------------------

/**
 * Creates a button element for the button list.
 * @param {Object} button - The button data from the profile.
 * @param {number} index - The index of the button in the customButtons array.
 * @returns {HTMLElement} - The button item element.
 */
function createButtonCardElement(button, index, crossChatSettings = null) {
    const buttonItem = document.createElement('div');
    buttonItem.className = 'button-item';
    buttonItem.dataset.index = index;
    buttonItem.draggable = true; // The entire card is the draggable target.

    if (button.separator) {
        buttonItem.classList.add('separator-item');
        buttonItem.innerHTML = `
            <div class="separator-line"></div>
            <span class="separator-text">Separator</span>
            <div class="separator-line"></div>
            <button class="delete-button danger">Delete</button>
        `;
    } else {
        const isSettingsButton = (button.text === SETTINGS_BUTTON_MAGIC_TEXT);

        const textElementHTML = isSettingsButton
            ? `<div class="text-input" title="This button opens the extension settings - this exact page you are seeing right now - in a new tab. You can move it or remove it.">${'Open app settings'}</div>`
            : `<textarea class="text-input" rows="1">${button.text}</textarea>`;

        const autoSendHTML = !isSettingsButton
            ? `<div class="autosend-line"><label class="checkbox-row"><input type="checkbox" class="autosend-toggle" ${button.autoSend ? 'checked' : ''}><span>Auto-send</span></label></div>`
            : '';

        // Calculate hotkey with consideration for CrossChat buttons and separators
        let hotkeyHintHTML = '';
        if (!button.separator) {
            // Calculate how many non-separator buttons are before this one
            let nonSeparatorButtonsCount = 0;
            for (let i = 0; i < index; i++) {
                if (!currentProfile.customButtons[i].separator) {
                    nonSeparatorButtonsCount++;
                }
            }
            
            // Apply the shift if CrossChat buttons are placed before
            const shift = (crossChatSettings && crossChatSettings.enabled && crossChatSettings.placement === 'before') ? 2 : 0;
            const hotkeyIndex = nonSeparatorButtonsCount + shift;
            
            // Only show hotkey if it's within the 1-0 range (Alt+1 to Alt+0)
            if (hotkeyIndex < 10) {
                const displayKey = hotkeyIndex === 9 ? 0 : hotkeyIndex + 1;
                hotkeyHintHTML = `<div class="shortcut-line"><span class="shortcut-indicator">[Alt+${displayKey}]</span></div>`;
            }
        }

        buttonItem.innerHTML = `
            <div class="drag-handle">&#9776;</div>
            <textarea class="emoji-input" rows="1">${button.icon}</textarea>
            ${textElementHTML}
            <div class="meta-block">
                ${autoSendHTML}
                ${hotkeyHintHTML}
            </div>
            <button class="delete-button danger">Delete</button>
        `;

        if (isSettingsButton) {
            buttonItem.setAttribute('data-system', 'settings');
            buttonItem.classList.add('settings-button-card');
        }
    }

    return buttonItem;
}


/**
 * Updates the list of custom button cards in the buttonCardsList.
 */
async function updatebuttonCardsList() {
    // Get Cross-Chat module settings
    const crossChatSettings = await getCrossChatSettings();
    
    buttonCardsList.innerHTML = ''; // This already removes old listeners
    if (currentProfile.customButtons && currentProfile.customButtons.length > 0) {
        currentProfile.customButtons.forEach((button, index) => {
            const buttonElement = createButtonCardElement(button, index, crossChatSettings);
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
 * @param {MouseEvent} [event] - The click event, used for visual feedback around the cursor.
 */
async function addButton(event) {
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

    // --- Visual Feedback ---
    showToast('Button added', 'success');
    if (event) {
        // This function is in popup-page-visuals.js
        showMouseEffect(event);
    }
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

/**
 * Adds the special Settings system button. It opens the extension settings in a new tab
 * (the click behavior is handled at injection time). The text is a reserved magic constant
 * and is not editable in the UI. Users may change the icon; autoSend is not applicable.
 * @param {MouseEvent} [event]
 */
async function addSettingsButton(event) {
    const icon = document.getElementById('buttonIcon').value || '⚙️';
    const text = SETTINGS_BUTTON_MAGIC_TEXT;
    const autoSend = false;

    // Prevent duplicates
    const exists = (currentProfile.customButtons || []).some(b => b && !b.separator && b.text === text);
    if (exists) {
        showToast('Settings Button already exists in this profile.', 'info');
        return;
    }

    currentProfile.customButtons.push({ icon, text, autoSend });
    await saveCurrentProfile();
    updatebuttonCardsList();
    logToGUIConsole('Added Settings system button');
    showToast('Settings Button added', 'success');
    if (event) showMouseEffect(event);
}


// -------------------------
// Drag and Drop Functionality
// -------------------------

let dragOrigin = null; // Stores the initial target of a mousedown/pointerdown event.
let isDragging = false;
let draggedItem = null;
let lastDragPosition = { x: 0, y: 0 };

/**
 * Captures the initial element clicked before a potential drag starts.
 * This is crucial for the veto logic in handleDragStart.
 * @param {PointerEvent} e
 */
function handlePointerDown(e) {
    dragOrigin = e.target;
}

function handleDragStart(e) {
    // --- Veto Logic ---
    // Check if the drag gesture originated inside an interactive element.
    // If so, prevent the drag from starting to allow normal interaction (e.g., text selection).
    if (dragOrigin?.closest('input, textarea, button, label')) {
        e.preventDefault();
        return;
    }

    // --- Drag Initialization ---
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

        // --- FLIP: Last, Invert, Play for DRAGGED item, it moves to new position smoothly --- 
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
    if (isDragging && draggedItem) {
        finalizeDrag();
    }
    // Always reset the drag origin on drag end.
    dragOrigin = null;
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
 * Resizes a textarea vertically to fit its content.
 * @param {HTMLTextAreaElement} textarea The textarea to resize.
 */
/**
 * Resizes a textarea vertically to fit its content while preserving the scroll position.
 * This prevents the page from scrolling when the textarea is resized.
 * @param {HTMLTextAreaElement} textarea The textarea to resize.
 */
function resizeVerticalTextarea(textarea) {
    if (!textarea) return;
    
    // Save current scroll position
    const scrollPos = {
        top: window.pageYOffset || document.documentElement.scrollTop,
        left: window.pageXOffset || document.documentElement.scrollLeft
    };
    
    // Perform resize
    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight}px`;
    
    // Restore scroll position
    window.scrollTo(scrollPos.left, scrollPos.top);
}

/**
 * Attaches input listeners to emoji textareas for horizontal resizing and data saving.
 * Crucially, it also triggers a vertical resize on the sibling main text area.
 */
function attachEmojiInputListeners() {
    // Select both: the "Add new button" single-line input (#buttonIcon) and per-item emoji textareas
    const allEmojiInputs = document.querySelectorAll('#buttonIcon, #buttonCardsList textarea.emoji-input');

    allEmojiInputs.forEach((inputElement) => {
        // Normalize styles for correct measuring and UX
        inputElement.style.overflowX = 'hidden';
        inputElement.style.whiteSpace = 'nowrap';

        const resizeSelf = () => {
            // Horizontal resize with small buffer and center-align until threshold
            inputElement.style.width = '1px';
            const bufferPx = 6;
            const desired = inputElement.scrollWidth + bufferPx;

            // Respect CSS max-width if present
            const computed = getComputedStyle(inputElement);
            const maxW = computed.maxWidth;
            let finalWidth = desired;
            if (maxW && maxW !== 'none') {
                const maxNum = parseFloat(maxW);
                if (!Number.isNaN(maxNum)) {
                    finalWidth = Math.min(desired, maxNum);
                }
            } else {
                // Provide a reasonable cap for plain inputs if no CSS max-width is set
                finalWidth = Math.min(desired, 200);
            }

            inputElement.style.width = `${finalWidth}px`;
            const centerUntilPx = 100;
            inputElement.style.textAlign = finalWidth <= centerUntilPx ? 'center' : 'left';

            // Optional vertical resize of neighbor textarea when inside a card
            const buttonItem = inputElement.closest('.button-item');
            if (buttonItem) {
                const mainTextarea = buttonItem.querySelector('.text-input');
                resizeVerticalTextarea(mainTextarea);
            }
        };

        // Manual autoscroll while selecting without showing scrollbars
        let selecting = false;
        let autoScrollRAF = null;
        let lastMouseX = 0;

        const autoScrollWhileSelecting = () => {
            if (!selecting) return;
            const rect = inputElement.getBoundingClientRect();
            const threshold = 12;
            const speed = 12;

            if (lastMouseX > rect.right - threshold) {
                inputElement.scrollLeft += speed;
            } else if (lastMouseX < rect.left + threshold) {
                inputElement.scrollLeft -= speed;
            }
            autoScrollRAF = requestAnimationFrame(autoScrollWhileSelecting);
        };

        inputElement.addEventListener('mousedown', (e) => {
            selecting = true;
            lastMouseX = e.clientX;
            if (autoScrollRAF) cancelAnimationFrame(autoScrollRAF);
            autoScrollRAF = requestAnimationFrame(autoScrollWhileSelecting);
        });
        inputElement.addEventListener('mousemove', (e) => {
            if (!selecting) return;
            lastMouseX = e.clientX;
        });
        const endSelection = () => {
            selecting = false;
            if (autoScrollRAF) {
                cancelAnimationFrame(autoScrollRAF);
                autoScrollRAF = null;
            }
        };
        inputElement.addEventListener('mouseup', endSelection);
        inputElement.addEventListener('mouseleave', endSelection);
        document.addEventListener('mouseup', endSelection, { once: true });

        inputElement.addEventListener('input', () => {
            // Persist only when editing within a card
            const buttonItem = inputElement.closest('.button-item');
            if (buttonItem) {
                const index = parseInt(buttonItem.dataset.index);
                currentProfile.customButtons[index].icon = inputElement.value;
                debouncedSaveCurrentProfile();
            }
            resizeSelf();
        });

        inputElement.addEventListener('blur', () => {
            inputElement.scrollLeft = 0;
        });

        inputElement.addEventListener('change', () => {
            inputElement.scrollLeft = 0;
        });

        // Initial sizing
        resizeSelf();
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
 * Automatically resizes textareas based on their content and attaches input listeners for saving.
 * Uses the resizeVerticalTextarea helper for resizing logic.
 */
function textareaSaverAndResizerFunc() {
    const textareas = buttonCardsList.querySelectorAll('textarea.text-input');
    textareas.forEach(textarea => {
        // Perform an initial resize to fit existing content.
        resizeVerticalTextarea(textarea);

        textarea.addEventListener('input', () => {
            // Resize the textarea vertically as the user types.
            resizeVerticalTextarea(textarea);

            // Update the corresponding button text in the data model.
            const buttonItem = textarea.closest('.button-item');
            const index = parseInt(buttonItem.dataset.index);
            currentProfile.customButtons[index].text = textarea.value;

            // Use debounced save to throttle saving.
            debouncedSaveCurrentProfile();
        });
    });
}