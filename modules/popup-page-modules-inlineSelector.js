'use strict';

// modules/popup-page-modules-inlineSelector.js
// Handles the Inline Profile Selector popup UI module (global settings)

document.addEventListener('DOMContentLoaded', () => {
  // --- Elements ---
  const moduleContainer = document.getElementById('inlineProfileSelectorModule');
  const enableToggle = document.getElementById('inlineProfileSelectorEnableToggle');
  const settingsContainer = document.getElementById('inlineProfileSelectorSettingsContainer');
  const placementRadios = document.getElementsByName('inlineProfileSelectorPlacement');
  // Also control the top switch row visibility with the collapsible
  const switchRow = moduleContainer.querySelector('.section-content .switch-container');

  if (!moduleContainer || !enableToggle || !settingsContainer) {
    // Popup might be opened on a version without the module block yet
    console.warn('[inlineSelector] Module elements not found; skipping initialization');
    return;
  }

  let currentSettings = { enabled: false, placement: 'before' };

  // --- State sync ---
  async function loadModuleState() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'getInlineProfileSelectorSettings' });
      if (response && response.settings) {
        currentSettings = normalizeSettings(response.settings);
      }
      updateUIFromState();
    } catch (error) {
      console.error('[inlineSelector] Failed to load settings:', error);
      updateUIFromState();
    }
    // Reflect current collapsible state after controls are updated
    updateSettingsVisibility();
  }

  async function saveModuleSettings() {
    try {
      await chrome.runtime.sendMessage({
        type: 'saveInlineProfileSelectorSettings',
        settings: currentSettings,
      });
    } catch (error) {
      console.error('[inlineSelector] Failed to save settings:', error);
    }
  }

  function normalizeSettings(s) {
    const placement = s?.placement === 'after' ? 'after' : 'before';
    return { enabled: !!s?.enabled, placement };
  }

  // --- UI update (controls only; visibility handled by collapsible state) ---
  function updateUIFromState() {
    enableToggle.checked = currentSettings.enabled;

    for (const radio of placementRadios) {
      radio.checked = radio.value === currentSettings.placement;
    }
  }

  // --- Settings visibility is driven solely by collapsible expanded state ---
  function updateSettingsVisibility() {
    const isModuleExpanded = moduleContainer.classList.contains('expanded');
    // Hide/show both the switch row and the settings block together
    if (switchRow) {
      // The switch container in HTML is in a flex row
      switchRow.style.display = isModuleExpanded ? 'flex' : 'none';
    }
    settingsContainer.style.display = isModuleExpanded ? 'block' : 'none';
  }

  // Observe expanded/collapsed state changes driven by centralized collapsible script
  const observer = new MutationObserver(() => {
    updateSettingsVisibility();
  });
  observer.observe(moduleContainer, { attributes: true, attributeFilter: ['class'] });

  // --- Events ---
  enableToggle.addEventListener('change', () => {
    currentSettings.enabled = enableToggle.checked;
    // Do not control settingsContainer visibility here; just persist
    saveModuleSettings();
  });

  for (const radio of placementRadios) {
    radio.addEventListener('change', () => {
      if (radio.checked) {
        currentSettings.placement = radio.value;
        saveModuleSettings();
      }
    });
  }

  // --- Init ---
  loadModuleState();
});