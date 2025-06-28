// floating-panel-ui-queue.js
// Version: 1.0
//
// Documentation:
// This file contains the UI creation logic for the prompt queue section
// within the floating panel. It creates the controls (toggle, delay input,
// play/reset buttons) and the display area for queued items.
// This function extends the window.MaxExtensionFloatingPanel namespace.
//
// Methods included:
// - createQueueSection(): Creates the DOM structure for the queue UI.
//
// Dependencies:
// - floating-panel.js: Provides the namespace and shared properties.
// - interface.js: Provides UI creation helpers like createToggle.
// - config.js: Provides configuration values like enableQueueMode.

'use strict';

/**
 * Creates the queue section UI inside the floating panel.
 */
window.MaxExtensionFloatingPanel.createQueueSection = function () {
    const queueSection = document.createElement('div');
    queueSection.id = 'max-extension-queue-section';
    queueSection.style.cssText = `
        padding: 8px 12px;
        background-color: rgba(60, 60, 60, ${this.currentPanelSettings.opacity + 0.1});
        border-top: 1px solid rgba(100, 100, 100, 0.3);
        display: flex;
        flex-direction: column;
        gap: 8px;
    `;

    // Prevent dragging when interacting with the queue section
    queueSection.addEventListener('mousedown', (event) => {
        event.stopPropagation();
    });

    // --- Controls ---
    const controlsContainer = document.createElement('div');
    controlsContainer.style.cssText = 'display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;';

    // 1. Queue Mode Toggle
    this.queueModeToggle = MaxExtensionInterface.createToggle(
        'enableQueueMode', // ID must match localStorage key
        'Enable Queue Mode',
        globalMaxExtensionConfig.enableQueueMode || false,
        (state) => {
            globalMaxExtensionConfig.enableQueueMode = state;
            // Logic to show/hide queue UI elements based on state can be added here
        }
    );
    this.queueModeToggle.style.margin = '0'; // Override default margins from createToggle
    this.queueModeToggle.title = 'When enabled, clicking buttons adds them to a queue instead of sending immediately.';

    // 2. Delay Input
    const delayContainer = document.createElement('div');
    delayContainer.style.cssText = 'display: flex; align-items: center; gap: 4px;';

    const delayLabel = document.createElement('label');
    delayLabel.htmlFor = 'max-extension-queue-delay-input';
    delayLabel.textContent = 'Delay (s):';
    delayLabel.style.fontSize = '12px';

    this.delayInputElement = document.createElement('input');
    this.delayInputElement.id = 'max-extension-queue-delay-input';
    this.delayInputElement.type = 'number';
    this.delayInputElement.value = globalMaxExtensionConfig.queueDelaySeconds || 15;
    this.delayInputElement.min = "0";
    this.delayInputElement.title = "Delay in seconds between sending each queued prompt.";
    this.delayInputElement.style.cssText = `
        width: 50px;
        background-color: rgba(80, 80, 80, 1);
        color: white;
        border: 1px solid #666;
        border-radius: 4px;
        padding: 2px 4px;
        font-size: 12px;
    `;
    this.delayInputElement.addEventListener('change', (event) => {
        const delay = parseInt(event.target.value, 10);
        if (!isNaN(delay) && delay >= 0) {
            globalMaxExtensionConfig.queueDelaySeconds = delay;
            // The config will be saved on the next profile save action
        }
    });

    delayContainer.appendChild(delayLabel);
    delayContainer.appendChild(this.delayInputElement);

    // 3. Play and Reset buttons
    const actionButtonsContainer = document.createElement('div');
    actionButtonsContainer.style.cssText = 'display: flex; gap: 8px;';

    this.playQueueButton = document.createElement('button');
    this.playQueueButton.innerHTML = '▶️';
    this.playQueueButton.title = 'Start sending the queued prompts.';
    this.playQueueButton.style.cssText = 'background: none; border: none; font-size: 18px; cursor: pointer; display: none; padding: 0; color: white;';

    this.resetQueueButton = document.createElement('button');
    this.resetQueueButton.innerHTML = '🔄';
    this.resetQueueButton.title = 'Clear all prompts from the queue.';
    this.resetQueueButton.style.cssText = 'background: none; border: none; font-size: 18px; cursor: pointer; display: none; padding: 0; color: white;';

    actionButtonsContainer.appendChild(this.playQueueButton);
    actionButtonsContainer.appendChild(this.resetQueueButton);

    controlsContainer.appendChild(this.queueModeToggle);
    controlsContainer.appendChild(delayContainer);
    controlsContainer.appendChild(actionButtonsContainer);

    // --- Queue Display Area ---
    this.queueDisplayArea = document.createElement('div');
    this.queueDisplayArea.id = 'max-extension-queue-display';
    this.queueDisplayArea.style.cssText = `min-height: 30px; background-color: rgba(40, 40, 40, 0.5); border-radius: 4px; padding: 6px; display: flex; flex-wrap: wrap; gap: 6px; align-items: center;`;
    queueSection.appendChild(controlsContainer);
    queueSection.appendChild(this.queueDisplayArea);
    this.queueSectionElement = queueSection;
    return queueSection;
};

