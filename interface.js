// interface.js
// Version: 1.0
// Instructions for AI: do not remove comments! MUST NOT REMOVE COMMENTS.

'use strict';

window.MaxExtensionInterface = {
    // Function to create a toggle checkbox
    createToggle: function (id, labelText, initialState, onChangeCallback) {
        const toggleContainer = document.createElement('div');
        toggleContainer.style.cssText = `
            display: flex;
            align-items: center;
            margin-top: 8px;
            padding-left: 8px;
        `;

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = id;
        checkbox.checked = initialState;
        checkbox.style.marginRight = '8px';

        const label = document.createElement('label');
        label.htmlFor = id;
        label.textContent = labelText;

        toggleContainer.appendChild(checkbox);
        toggleContainer.appendChild(label);

        checkbox.addEventListener('change', (event) => {
            onChangeCallback(event.target.checked);
            localStorage.setItem(id, event.target.checked);
            logConCgp(`${labelText} ${event.target.checked ? 'enabled' : 'disabled'}`);
        });

        return toggleContainer;
    },

    // Function to initialize toggle states from localStorage
    loadToggleStates: function () {
        const savedAutoSendState = localStorage.getItem('globalAutoSendEnabled');
        if (savedAutoSendState !== null) {
            globalMaxExtensionConfig.globalAutoSendEnabled = savedAutoSendState === 'true';
        }

        const savedHotkeysState = localStorage.getItem('enableShortcuts');
        if (savedHotkeysState !== null) {
            globalMaxExtensionConfig.enableShortcuts = savedHotkeysState === 'true';
        }

        // Load queue mode state from localStorage
        const savedQueueModeState = localStorage.getItem('enableQueueMode');
        if (savedQueueModeState !== null) {
            globalMaxExtensionConfig.enableQueueMode = savedQueueModeState === 'true';
        }
    }
};

