// popup-page-script.js
// Version: 1.6.4
// Main script for Max Extension configuration interface

'use strict';

// -------------------------
// Global Variables and State
// -------------------------

// State management
let currentProfile = null;

// Global variable for debounced save timeout
let saveTimeoutId = null;

// DOM Elements
const profileSelect = document.getElementById('profileSelect');
const currentProfileLabel = document.getElementById('currentProfileLabel');
const buttonCardsList = document.getElementById('buttonCardsList');
const consoleOutput = document.getElementById('console');

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



// Advanced queue settings elements
const queueHideActivationToggleEl = document.getElementById('queueHideActivationToggle');
const queueRandomizeEnabledEl = document.getElementById('queueRandomizeEnabled');
const queueRandomizePercentInput = document.getElementById('queueRandomizePercent');
const queueRandomizePercentRow = document.getElementById('queueRandomizePercentRow');
const hideOnPageAutoSendToggleEl = document.getElementById('hideOnPageAutoSendToggle');
const hideOnPageHotkeysToggleEl = document.getElementById('hideOnPageHotkeysToggle');
const hideOnPageFloatingPanelToggleEl = document.getElementById('hideOnPageFloatingPanelToggle');
const disableBrowserConsoleLogsToggleEl = document.getElementById('disableBrowserConsoleLogsToggle');
const uiScaleSliderEl = document.getElementById('uiScaleSlider');
const uiScaleValueEl = document.getElementById('uiScaleValue');
const uiScalePreviewEl = document.getElementById('uiScalePreview');
const tooltipScaleSliderEl = document.getElementById('tooltipScaleSlider');
const tooltipScaleValueEl = document.getElementById('tooltipScaleValue');
const uiScaleLockBtnEl = document.getElementById('uiScaleLockBtn');

// -------------------------
// Debounced Save Function
// -------------------------

/**
 * Debounced save function.
 * Clears any pending save and schedules a new one 500ms in the future.
 * This function is used on rapid-fire events (e.g., textarea input) so that
 * saving happens only after 500ms of inactivity.
 */
function debouncedSaveCurrentProfile() {
    if (saveTimeoutId !== null) {
        clearTimeout(saveTimeoutId);
    }
    saveTimeoutId = setTimeout(async () => {
        try {
            await saveCurrentProfile(); // Calls the existing save function
        } catch (error) {
            logToGUIConsole(`Error saving profile: ${error.message}`);
        }
        saveTimeoutId = null;
    }, 150);
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
    currentProfile.hideOnPageAutoSendToggle = !!hideOnPageAutoSendToggleEl?.checked;
    currentProfile.hideOnPageHotkeysToggle = !!hideOnPageHotkeysToggleEl?.checked;
    currentProfile.hideOnPageFloatingPanelToggle = !!hideOnPageFloatingPanelToggleEl?.checked;
    currentProfile.disableBrowserConsoleLogs = !!disableBrowserConsoleLogsToggleEl?.checked;
    currentProfile.uiScale = getUiScaleFromSlider();
    syncBrowserConsoleLogPreference();
    if (!(await saveCurrentProfile())) return;
    refreshOnPageControlVisibilityTooltips();
    await refreshFloatingToggleVisibilityWarningTooltip();
    logToGUIConsole('Updated global settings');
    showToast('Global settings updated', 'success');
}

function syncBrowserConsoleLogPreference() {
    window.globalMaxExtensionConfig = {
        ...(window.globalMaxExtensionConfig || {}),
        disableBrowserConsoleLogs: !!currentProfile?.disableBrowserConsoleLogs
    };
}

function normalizeUiScale(value) {
    if (window.MaxExtensionUiScale && typeof window.MaxExtensionUiScale.normalize === 'function') {
        return window.MaxExtensionUiScale.normalize(value, 1);
    }
    const numeric = Number(value);
    const base = Number.isFinite(numeric) ? numeric : 1;
    const stepped = Math.round(base / 0.05) * 0.05;
    return Math.min(2, Math.max(0.7, Number(stepped.toFixed(2))));
}

function getUiScaleFromSlider() {
    if (!uiScaleSliderEl) return normalizeUiScale(currentProfile?.uiScale);
    return normalizeUiScale(Number(uiScaleSliderEl.value) / 100);
}

function getTooltipScaleFromSlider() {
    if (!tooltipScaleSliderEl) return normalizeUiScale(currentProfile?.tooltipScale ?? currentProfile?.uiScale);
    return normalizeUiScale(Number(tooltipScaleSliderEl.value) / 100);
}

function updateUiScalePreview() {
    if (!currentProfile) return;

    const uiScale = normalizeUiScale(currentProfile.uiScale);
    const tooltipScale = normalizeUiScale(currentProfile.tooltipScale ?? currentProfile.uiScale);
    const locked = currentProfile.lockSliders !== false;

    // 1. Interface scale
    const uiPercent = Math.round(uiScale * 100);
    if (uiScaleValueEl) {
        uiScaleValueEl.textContent = `${uiPercent}%`;
    }
    if (uiScaleSliderEl && String(uiScaleSliderEl.value) !== String(uiPercent)) {
        uiScaleSliderEl.value = String(uiPercent);
    }

    // 2. Tooltip scale
    const ttPercent = Math.round(tooltipScale * 100);
    if (tooltipScaleValueEl) {
        tooltipScaleValueEl.textContent = `${ttPercent}%`;
    }
    if (tooltipScaleSliderEl && String(tooltipScaleSliderEl.value) !== String(ttPercent)) {
        tooltipScaleSliderEl.value = String(ttPercent);
    }

    // 3. Lock button UI state
    if (uiScaleLockBtnEl) {
        uiScaleLockBtnEl.classList.toggle('is-unlocked', !locked);
        const lockIcon = uiScaleLockBtnEl.querySelector('.lock-icon');
        const lockText = uiScaleLockBtnEl.querySelector('.lock-text');
        if (lockIcon) {
            lockIcon.textContent = locked ? '🔗' : '🔓';
        }
        if (lockText) {
            lockText.textContent = locked ? 'Sliders linked' : 'Sliders independent';
        }
    }

    // 4. Live preview panel scale
    if (uiScalePreviewEl) {
        uiScalePreviewEl.style.setProperty('--ocp-preview-scale', String(uiScale));
    }
}

function updateUiScaleSettingsUIFromProfile() {
    if (currentProfile) {
        currentProfile.uiScale = normalizeUiScale(currentProfile.uiScale);
        currentProfile.tooltipScale = normalizeUiScale(currentProfile.tooltipScale ?? currentProfile.uiScale);
    }
    updateUiScalePreview();
}

function handleUiScaleSliderInput() {
    if (!currentProfile) return;
    const val = getUiScaleFromSlider();
    currentProfile.uiScale = val;
    if (currentProfile.lockSliders !== false) {
        currentProfile.tooltipScale = val;
    }
    updateUiScalePreview();
    debouncedSaveCurrentProfile();
}

async function handleUiScaleSliderChange() {
    if (!currentProfile) return;
    const val = getUiScaleFromSlider();
    currentProfile.uiScale = val;
    if (currentProfile.lockSliders !== false) {
        currentProfile.tooltipScale = val;
    }
    updateUiScalePreview();
    if (saveTimeoutId !== null) {
        clearTimeout(saveTimeoutId);
        saveTimeoutId = null;
    }
    await saveCurrentProfile();
}

function handleTooltipScaleSliderInput() {
    if (!currentProfile) return;
    const val = getTooltipScaleFromSlider();
    currentProfile.tooltipScale = val;
    if (currentProfile.lockSliders !== false) {
        currentProfile.uiScale = val;
    }
    updateUiScalePreview();
    debouncedSaveCurrentProfile();
}

async function handleTooltipScaleSliderChange() {
    if (!currentProfile) return;
    const val = getTooltipScaleFromSlider();
    currentProfile.tooltipScale = val;
    if (currentProfile.lockSliders !== false) {
        currentProfile.uiScale = val;
    }
    updateUiScalePreview();
    if (saveTimeoutId !== null) {
        clearTimeout(saveTimeoutId);
        saveTimeoutId = null;
    }
    await saveCurrentProfile();
}

function handleUiScaleLockToggle() {
    if (!currentProfile) return;
    const nextLocked = !(currentProfile.lockSliders !== false);
    currentProfile.lockSliders = nextLocked;

    if (nextLocked) {
        currentProfile.tooltipScale = currentProfile.uiScale;
    }

    updateUiScalePreview();
    debouncedSaveCurrentProfile();
}

function setTooltipForElement(element, text) {
    if (!element) return;
    if (window.OCPTooltip) {
        if (typeof window.OCPTooltip.attach === 'function') {
            window.OCPTooltip.attach(element, text);
        }
        if (typeof window.OCPTooltip.updateText === 'function') {
            window.OCPTooltip.updateText(element, text);
        }
        return;
    }
    element.setAttribute('title', text);
    element.setAttribute('data-ocp-tooltip', text);
}

function setTooltipForCheckboxControl(checkboxId, text) {
    const checkbox = document.getElementById(checkboxId);
    if (!checkbox) return;
    const label = document.querySelector(`label[for="${checkboxId}"]`);
    setTooltipForElement(label, text);
    // Optional focus target for keyboard users.
    setTooltipForElement(checkbox, text);
}

function buildOnPageControlTooltip(controlName, isHidden) {
    if (isHidden) {
        return `Want cleaner UI? If yes, enable this. The on-page "${controlName}" control (small checkbox near the injected OneClickPrompts button row, next to your emoji buttons) will be hidden for Aesthetics.`;
    }
    return `"Need quick on-page control?" Keep this OFF. The "${controlName}" control (small checkbox near the injected OneClickPrompts button row, next to your emoji buttons) stays visible so you can toggle it directly in chat.`;
}

function refreshOnPageControlVisibilityTooltips() {
    const autoSendHidden = !!hideOnPageAutoSendToggleEl?.checked;
    const hotkeysHidden = !!hideOnPageHotkeysToggleEl?.checked;
    const autoTitle = buildOnPageControlTooltip('Auto-send', autoSendHidden);
    const hotkeysTitle = buildOnPageControlTooltip('Hotkeys', hotkeysHidden);

    setTooltipForCheckboxControl('hideOnPageAutoSendToggle', autoTitle);
    setTooltipForCheckboxControl('hideOnPageHotkeysToggle', hotkeysTitle);

    const autoDefaultTitle = 'This is the default Auto-send behavior for new sites. You can still override it from on-page controls (unless those controls are hidden).';
    const hotkeysDefaultTitle = 'This is the default Hotkeys behavior for new sites. You can still override it from on-page controls (unless those controls are hidden).';
    setTooltipForCheckboxControl('autoSendToggle', autoDefaultTitle);
    setTooltipForCheckboxControl('shortcutsToggle', hotkeysDefaultTitle);
}

function initSideDonateCreeper() {
    const creeper = document.getElementById('sideDonateCreeper');
    const trigger = document.getElementById('sideDonateButton');
    const tooltip = document.getElementById('sideDonateTooltip');
    const openButton = document.getElementById('sideDonateOpen');
    const donateUrl = 'https://buymeacoffee.com/netstaff';

    if (!creeper || !trigger || !tooltip) {
        return;
    }

    let dismissed = false;
    let exitTimerId = null;
    let lastInteractionEnd = 0;
    let entranceComplete = false;

    function setTooltipVisible(isVisible) {
        trigger.setAttribute('aria-expanded', String(isVisible));
        tooltip.setAttribute('aria-hidden', String(!isVisible));
    }

    function scheduleNextExit() {
        if (exitTimerId) {
            clearTimeout(exitTimerId);
        }
        const delay = Math.round(4000 + Math.random() * 21000);
        exitTimerId = setTimeout(triggerExitSequence, delay);
    }

    function triggerExitSequence() {
        if (dismissed) return;
        if (creeper.matches(':hover') || creeper.contains(document.activeElement)) {
            scheduleNextExit();
            return;
        }

        // 2-second grace period after last hover/focus interaction
        const elapsed = Date.now() - lastInteractionEnd;
        if (elapsed < 2000) {
            exitTimerId = setTimeout(scheduleNextExit, 2000 - elapsed);
            return;
        }

        creeper.classList.add('is-exiting');

        setTimeout(() => {
            if (dismissed) return;
            placeQuietlyOnSide();
            creeper.classList.remove('is-exiting');
            void creeper.offsetWidth;
            // Exit timer will start when the new entrance animation completes
        }, 9000);
    }

    function syncForActiveTab(panelId) {
        const shouldShow = !dismissed;
        creeper.classList.toggle('is-hidden', !shouldShow);
        if (!shouldShow) {
            setTooltipVisible(false);
            if (exitTimerId) {
                clearTimeout(exitTimerId);
                exitTimerId = null;
            }
        } else {
            if (!exitTimerId && !creeper.classList.contains('is-exiting') && entranceComplete) {
                scheduleNextExit();
            }
        }
    }

    function placeQuietlyOnSide() {
        const side = Math.random() < 0.5 ? 'left' : 'right';
        const viewportHeight = Math.max(window.innerHeight || 0, 420);
        const safeTop = 88;
        const safeBottom = 118;
        const buttonHeight = 68;
        const minY = safeTop;
        const maxY = Math.max(minY + 80, viewportHeight - safeBottom - buttonHeight);
        const startY = Math.round(minY + Math.random() * Math.max(1, maxY - minY));
        const crawlRoom = Math.max(70, Math.min(170, maxY - minY));
        const endY = Math.max(minY, Math.min(maxY, startY + (Math.random() < 0.5 ? -crawlRoom : crawlRoom)));

        creeper.classList.toggle('side-donate-creeper--left', side === 'left');
        creeper.classList.toggle('side-donate-creeper--right', side === 'right');
        creeper.style.setProperty('--side-donate-y-start', `${startY}px`);
        creeper.style.setProperty('--side-donate-y-end', `${endY}px`);

        // Reset hover-arrive state so the next entrance animation can play
        creeper.classList.remove('is-hover-arriving');
        creeper.style.removeProperty('transform');
        creeper.style.removeProperty('opacity');
        entranceComplete = false;
    }

    placeQuietlyOnSide();
    syncForActiveTab(document.querySelector('.tab-panel.is-active')?.id);

    // Squash-and-stretch on entrance landing
    creeper.addEventListener('animationend', (event) => {
        if (event.target !== creeper) return;
        if (event.animationName === 'sideDonateCreepInLeft' || event.animationName === 'sideDonateCreepInRight') {
            entranceComplete = true;
            scheduleNextExit();
            trigger.classList.add('is-squishing');
            trigger.addEventListener('animationend', () => {
                trigger.classList.remove('is-squishing');
            }, { once: true });
        }
    });

    trigger.addEventListener('click', (event) => {
        event.stopPropagation();
        trigger.classList.add('is-squishing');
        // Fallback in case animationend never fires
        const fallback = setTimeout(() => {
            chrome.tabs.create({ url: donateUrl });
        }, 10400);
        trigger.addEventListener('animationend', () => {
            clearTimeout(fallback);
            trigger.classList.remove('is-squishing');
            chrome.tabs.create({ url: donateUrl });
        }, { once: true });
    });

    if (openButton) {
        openButton.addEventListener('click', (event) => {
            event.stopPropagation();
            chrome.tabs.create({ url: donateUrl });
        });
    }

    creeper.addEventListener('mouseenter', () => {
        setTooltipVisible(true);

        // If the peek-a-boo entrance is still playing, smoothly
        // transition into the fully visible crawling state instead
        // of freezing mid-peek.
        if (!entranceComplete) {
            entranceComplete = true;
            scheduleNextExit();

            // Capture the current mid-peek position (animation is
            // paused by the :hover CSS rule so getComputedStyle is
            // stable).
            const cs = getComputedStyle(creeper);
            creeper.style.transform = cs.transform;
            creeper.style.opacity = cs.opacity;

            // Drop the entrance animation; keep only the vertical crawl.
            creeper.classList.add('is-hover-arriving');
            void creeper.offsetWidth; // force reflow

            // Transition to fully visible
            creeper.style.transform = 'translateX(0)';
            creeper.style.opacity = '1';

            // Clean up inline overrides once the transition lands.
            const onArrived = (e) => {
                if (e.target !== creeper || e.propertyName !== 'transform') return;
                creeper.style.removeProperty('transform');
                creeper.style.removeProperty('opacity');
                creeper.removeEventListener('transitionend', onArrived);
            };
            creeper.addEventListener('transitionend', onArrived);
        }
    });

    creeper.addEventListener('mouseleave', () => {
        lastInteractionEnd = Date.now();
        setTooltipVisible(false);
    });

    creeper.addEventListener('focusin', () => {
        setTooltipVisible(true);
    });

    creeper.addEventListener('focusout', (event) => {
        if (event.relatedTarget && creeper.contains(event.relatedTarget)) {
            return;
        }
        lastInteractionEnd = Date.now();
        setTooltipVisible(false);
    });

    document.addEventListener('ocp:tab-changed', (event) => {
        syncForActiveTab(event.detail?.panelId);
    });

    window.addEventListener('resize', () => {
        placeQuietlyOnSide();
    });
}

async function getActiveTabHostname() {
    try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const activeTab = Array.isArray(tabs) ? tabs[0] : null;
        const rawUrl = activeTab?.url;
        if (!rawUrl) return null;
        const parsed = new URL(rawUrl);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
        return parsed.hostname || null;
    } catch (error) {
        logToGUIConsole(`Could not resolve active tab hostname for floating toggle warning: ${error.message}`);
        return null;
    }
}

async function isFloatingPanelOffForActiveTab() {
    const hostname = await getActiveTabHostname();
    if (!hostname) {
        return false;
    }

    try {
        const response = await chrome.runtime.sendMessage({ type: 'getFloatingPanelSettings', hostname });
        return !response?.settings?.isVisible;
    } catch (error) {
        logToGUIConsole(`Could not load floating panel visibility for ${hostname}: ${error.message}`);
        return false;
    }
}

async function refreshFloatingToggleVisibilityWarningTooltip() {
    const label = document.getElementById('hideOnPageFloatingPanelToggleLabel');
    if (!label || !hideOnPageFloatingPanelToggleEl) {
        return;
    }

    const baseTitle = ' This hides the on-page floating panel launcher (the 🔼 button in the injected OneClickPrompts button row). YOU WILL NOT BE ABLE TO SUMMON PANEL WITH THIS TOGGLE ENABLED.';
    let nextTitle = baseTitle;

    if (hideOnPageFloatingPanelToggleEl.checked) {
        const isPanelOff = await isFloatingPanelOffForActiveTab();
        if (isPanelOff) {
            nextTitle = `${baseTitle} Warning: floating panel is currently OFF on this site. If you hide this now, you will not see the 🔼 on-page button to turn panel back on from chat page.`;
        }
    }

    setTooltipForCheckboxControl('hideOnPageFloatingPanelToggle', nextTitle);
}

function getCheckboxTooltipSourceText(label) {
    if (!label) return '';
    const ownText = label.getAttribute('data-ocp-tooltip') || label.getAttribute('title');
    if (ownText) {
        return ownText;
    }

    // Some checkbox rows put title on an ancestor row/div instead of the label itself.
    const titledAncestor = label.parentElement ? label.parentElement.closest('[title]') : null;
    if (titledAncestor && titledAncestor !== label) {
        return titledAncestor.getAttribute('title') || '';
    }

    return '';
}

function reinforceAllCheckboxTooltips() {
    const checkboxLabels = Array.from(document.querySelectorAll('label.checkbox-row'));
    checkboxLabels.forEach((label) => {
        const text = getCheckboxTooltipSourceText(label);
        if (!text) return;

        setTooltipForElement(label, text);

        // Also attach to the checkbox input itself for keyboard focus users.
        const checkbox = label.querySelector('input[type="checkbox"]');
        if (checkbox) {
            setTooltipForElement(checkbox, text);
        }
    });
}

let checkboxTooltipReinforceTimer = null;
function scheduleCheckboxTooltipReinforce() {
    if (checkboxTooltipReinforceTimer !== null) {
        clearTimeout(checkboxTooltipReinforceTimer);
    }
    checkboxTooltipReinforceTimer = setTimeout(() => {
        reinforceAllCheckboxTooltips();
        checkboxTooltipReinforceTimer = null;
    }, 0);
}

/**
 * Ensures advanced queue controls reflect the current profile.
 */
function updateQueueSettingsUIFromProfile() {
    if (!currentProfile) {
        return;
    }

    const hideToggle = Boolean(currentProfile.queueHideActivationToggle);
    const randomizeEnabled = Boolean(currentProfile.queueRandomizeEnabled);
    const randomizePercent = Number.isFinite(currentProfile.queueRandomizePercent)
        ? currentProfile.queueRandomizePercent
        : 5;

    if (queueHideActivationToggleEl) {
        queueHideActivationToggleEl.checked = hideToggle;
    }
    const queueDisabledByHide = enforceQueueDisabledWhenHidden();
    if (queueDisabledByHide) {
        debouncedSaveCurrentProfile();
        logToGUIConsole('Queue disabled because activation toggle is hidden.');
    }
    if (queueRandomizeEnabledEl) {
        queueRandomizeEnabledEl.checked = randomizeEnabled;
    }
    if (queueRandomizePercentInput) {
        queueRandomizePercentInput.value = randomizePercent;
    }
    toggleQueueRandomizePercentRow(randomizeEnabled);
}

/**
 * Shows or hides the randomization percent row based on the toggle state.
 * @param {boolean} isVisible
 */
function toggleQueueRandomizePercentRow(isVisible) {
    if (!queueRandomizePercentRow) return;
    queueRandomizePercentRow.classList.toggle('is-hidden', !isVisible);
}

/**
 * Parses and clamps the randomization percentage between 1 and 100.
 * @param {number} value
 * @returns {number}
 */
function sanitizeQueueRandomizePercent(value) {
    if (!Number.isFinite(value)) {
        return 5;
    }
    const clamped = Math.round(value);
    return Math.min(100, Math.max(1, clamped));
}

/**
 * Disables queue mode whenever the activation toggle is hidden.
 * @returns {boolean} True when the queue state changed.
 */
function enforceQueueDisabledWhenHidden() {
    if (!currentProfile) {
        return false;
    }
    const hideToggleActive = Boolean(currentProfile.queueHideActivationToggle);
    const queueCurrentlyEnabled = Boolean(currentProfile.enableQueueMode);
    if (!hideToggleActive || !queueCurrentlyEnabled) {
        return false;
    }
    currentProfile.enableQueueMode = false;
    return true;
}

/**
 * Handles the hide queue activation toggle.
 */
function handleQueueHideActivationChange(event) {
    if (!currentProfile) return;
    const shouldHide = event.target.checked;
    currentProfile.queueHideActivationToggle = shouldHide;

    const queueDisabled = shouldHide ? enforceQueueDisabledWhenHidden() : false;

    debouncedSaveCurrentProfile();
    const consoleMessage = shouldHide
        ? queueDisabled
            ? 'Queue activation toggle hidden; queue disabled for new tabs.'
            : 'Queue activation toggle hidden.'
        : 'Queue activation toggle visible.';
    logToGUIConsole(consoleMessage);
    const toastMessage = shouldHide
        ? 'Queue activation toggle hidden; queue disabled for new tabs.'
        : 'Queue activation toggle restored.';
    showToast(toastMessage, 'info');
}

/**
 * Handles the randomization toggle.
 */
function handleQueueRandomizeToggleChange(event) {
    if (!currentProfile) return;
    const enabled = event.target.checked;
    currentProfile.queueRandomizeEnabled = enabled;

    if (enabled && !Number.isFinite(currentProfile.queueRandomizePercent)) {
        currentProfile.queueRandomizePercent = 5;
    }

    toggleQueueRandomizePercentRow(enabled);
    debouncedSaveCurrentProfile();
    logToGUIConsole(`Queue delay randomization ${enabled ? 'enabled' : 'disabled'}.`);
    showToast(enabled ? 'Random delay offset enabled.' : 'Random delay offset disabled.', 'success');
}

/**
 * Handles changes to the randomization percent input.
 */
function handleQueueRandomizePercentChange(event) {
    if (!currentProfile) return;
    const parsedValue = sanitizeQueueRandomizePercent(parseInt(event.target.value, 10));
    currentProfile.queueRandomizePercent = parsedValue;
    queueRandomizePercentInput.value = parsedValue;
    debouncedSaveCurrentProfile();
    logToGUIConsole(`Random delay offset set to ${parsedValue}% of base delay.`);
}

/**
 * Switches to the Default profile and resets that profile to the extension defaults.
 */
async function revertToDefault() {
    const confirmed = await window.OCPModal.confirm(
        'Switch to the Default profile and wipe its buttons and settings? The current custom profile will remain unchanged. This cannot be undone for the Default profile.',
        'Wipe Default Profile',
        'error'
    );

    if (!confirmed) return;

    try {
        const response = await chrome.runtime.sendMessage({ type: 'createDefaultProfile' });
        if (!response?.config) {
            throw new Error(response?.error || 'The Default profile could not be created.');
        }
        currentProfile = response.config;
        if (!(await saveCurrentProfile())) return;
        await updateInterface(); // Now awaiting the async function
        showToast('Changed to the Default profile and wiped it successfully.', 'success');
        logToGUIConsole('Changed to the Default profile and wiped it');
    } catch (error) {
        showToast(`Error changing to and wiping the Default profile: ${error.message}`, 'error');
        logToGUIConsole(`Error changing to and wiping the Default profile: ${error.message}`);
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
        if (!currentProfile?.PROFILE_NAME) {
            throw new Error('No active profile is available to save.');
        }
        const response = await chrome.runtime.sendMessage({
            type: 'saveConfig',
            profileName: currentProfile.PROFILE_NAME,
            config: currentProfile
        });
        if (response?.success !== true) {
            throw new Error(response?.error || 'The service worker rejected the profile save.');
        }
        return true;
    } catch (error) {
        logToGUIConsole(`Error saving profile: ${error.message}`);
        showToast(`Profile was not saved: ${error.message}`, 'error');
        return false;
    }
}

/**
 * Updates the entire interface based on the current profile.
 */
/**
 * Updates the entire interface based on the current profile.
 * @param {HTMLElement|null} anchorElement - Optional element to keep visually stable (prevent jumping).
 */
async function updateInterface(anchorElement = null) {
    // --- Added guard to check if currentProfile is valid ---
    if (!currentProfile || !currentProfile.customButtons) {
        logToGUIConsole('No valid current profile found. Attempting to retrieve default profile...');
        try {
            const response = await chrome.runtime.sendMessage({ type: 'getConfig' });
            if (response && response.config) {
                currentProfile = response.config;
                await updateInterface(anchorElement); // Call updateInterface again after retrieving default
            } else {
                logToGUIConsole('Failed to retrieve default profile in updateInterface.');
            }
        } catch (error) {
            logToGUIConsole(`Error retrieving default profile: ${error.message}`);
        }
        return;
    }

    // Capture anchor position relative to viewport BEFORE update
    let anchorOffset = 0;
    if (anchorElement) {
        anchorOffset = anchorElement.getBoundingClientRect().top;
    }

    // Update buttons, settings, etc. based on currentProfile
    // Pass !anchorElement as restoreScroll: if we are anchoring, don't restore old scroll.
    await updatebuttonCardsList(!anchorElement);

    document.getElementById('autoSendToggle').checked = currentProfile.globalAutoSendEnabled;
    document.getElementById('shortcutsToggle').checked = currentProfile.enableShortcuts;
    if (hideOnPageAutoSendToggleEl) {
        hideOnPageAutoSendToggleEl.checked = Boolean(currentProfile.hideOnPageAutoSendToggle);
    }
    if (hideOnPageHotkeysToggleEl) {
        hideOnPageHotkeysToggleEl.checked = Boolean(currentProfile.hideOnPageHotkeysToggle);
    }
    if (hideOnPageFloatingPanelToggleEl) {
        hideOnPageFloatingPanelToggleEl.checked = Boolean(currentProfile.hideOnPageFloatingPanelToggle);
    }
    if (disableBrowserConsoleLogsToggleEl) {
        disableBrowserConsoleLogsToggleEl.checked = Boolean(currentProfile.disableBrowserConsoleLogs);
    }
    syncBrowserConsoleLogPreference();
    updateUiScaleSettingsUIFromProfile();
    refreshOnPageControlVisibilityTooltips();
    await refreshFloatingToggleVisibilityWarningTooltip();
    reinforceAllCheckboxTooltips();

    // Clear input fields
    document.getElementById('buttonIcon').value = '';
    document.getElementById('buttonText').value = '';
    document.getElementById('buttonAutoSendToggle').checked = false; // Reset to default unchecked
    if (typeof refitButtonCreationInputs === 'function') {
        refitButtonCreationInputs();
    }

    // Set the profileSelect dropdown to the current profile
    const profileSelect = document.getElementById('profileSelect');
    if (profileSelect) {
        profileSelect.value = currentProfile.PROFILE_NAME;
    }

    // Update the "Current profile:" eyebrow label in the Button Configuration section
    const buttonConfigProfileName = document.getElementById('buttonConfigProfileName');
    if (buttonConfigProfileName) {
        buttonConfigProfileName.textContent = currentProfile.PROFILE_NAME;
    }

    updateQueueSettingsUIFromProfile();

    // Restore anchor position relative to viewport AFTER update
    if (anchorElement) {
        const newAnchorTop = anchorElement.getBoundingClientRect().top + window.scrollY;
        // Target: newAnchorTop - window.scrollY = anchorOffset
        // window.scrollY = newAnchorTop - anchorOffset
        window.scrollTo(0, newAnchorTop - anchorOffset);
    }
}

/**
 * Resets and hides the profile action UIs (add/copy) and restores the default view.
 */
function resetProfileActionsUI() {
    // Hide input containers and clear values/errors
    addProfileInput.value = '';
    addProfileInput.style.borderColor = '';
    addProfileInput.classList.remove('input-error');
    addProfileContainer.classList.add('is-hidden');

    copyProfileInput.value = '';
    copyProfileInput.style.borderColor = '';
    copyProfileInput.classList.remove('input-error');
    copyProfileContainer.classList.add('is-hidden');

    // Show the main action buttons
    addProfileButton.classList.remove('is-hidden');
    copyProfileButton.classList.remove('is-hidden');
    deleteProfileButton.classList.remove('is-hidden');

    // Restore the profile selector dropdown, hide static name
    profileSelect.classList.remove('is-hidden');
    profileSelect.disabled = false;
    const currentProfileNameStatic = document.getElementById('currentProfileNameStatic');
    if (currentProfileNameStatic) currentProfileNameStatic.classList.add('is-hidden');
    currentProfileLabel.classList.add('is-hidden');
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
        addProfileContainer.classList.remove('is-hidden');
        addProfileButton.classList.add('is-hidden');
        copyProfileButton.classList.add('is-hidden');
        copyProfileContainer.classList.add('is-hidden');
        deleteProfileButton.classList.add('is-hidden'); // Hide delete button during add
        // Replace dropdown with plain text to avoid confusion
        profileSelect.classList.add('is-hidden');
        const currentProfileNameStatic = document.getElementById('currentProfileNameStatic');
        if (currentProfileNameStatic) {
            currentProfileNameStatic.textContent = currentProfile?.PROFILE_NAME ?? '';
            currentProfileNameStatic.classList.remove('is-hidden');
        }
        currentProfileLabel.classList.remove('is-hidden');
    });

    // Copy Profile Button Click
    copyProfileButton.addEventListener('click', () => {
        copyProfileContainer.classList.remove('is-hidden');
        copyProfileButton.classList.add('is-hidden');
        addProfileButton.classList.add('is-hidden');
        addProfileContainer.classList.add('is-hidden');
        deleteProfileButton.classList.add('is-hidden'); // Hide delete button during copy
        // Replace dropdown with plain text to avoid confusion
        profileSelect.classList.add('is-hidden');
        const currentProfileNameStatic = document.getElementById('currentProfileNameStatic');
        if (currentProfileNameStatic) {
            currentProfileNameStatic.textContent = currentProfile?.PROFILE_NAME ?? '';
            currentProfileNameStatic.classList.remove('is-hidden');
        }
        currentProfileLabel.classList.remove('is-hidden');
    });

    // Save Add Profile Button Click
    saveAddProfileButton.addEventListener('click', async () => {
        const profileName = addProfileInput.value;
        if (profileName.trim() === "") {
            addProfileInput.classList.add('input-error');
            addProfileInput.placeholder = "Enter profile name here";
            addProfileInput.style.borderColor = 'var(--danger-color)';
            showToast('Profile name cannot be empty.', 'error');
            logToGUIConsole('Save Add Profile failed: Empty input.');
            return;
        }
        addProfileInput.classList.remove('input-error');
        const success = await addNewEmptyProfile(profileName);

        if (success) {
            resetProfileActionsUI();
        } else {
            // On failure (e.g., duplicate name), keep UI open for correction
            addProfileInput.classList.add('input-error');
            addProfileInput.style.borderColor = 'var(--danger-color)';
        }
    });

    // Save Copy Profile Button Click
    saveCopyProfileButton.addEventListener('click', async () => {
        const newProfileName = copyProfileInput.value;
        if (newProfileName.trim() === "") {
            copyProfileInput.classList.add('input-error');
            copyProfileInput.placeholder = "Enter new profile name here";
            copyProfileInput.style.borderColor = 'var(--danger-color)';
            showToast('Profile name cannot be empty.', 'error');
            logToGUIConsole('Save Copy Profile failed: Empty input.');
            return;
        }
        copyProfileInput.classList.remove('input-error');
        const success = await copyCurrentProfile(newProfileName);

        if (success) {
            resetProfileActionsUI();
        } else {
            // On failure (e.g., duplicate name), keep UI open for correction
            copyProfileInput.classList.add('input-error');
            copyProfileInput.style.borderColor = 'var(--danger-color)';
        }
    });

    // Delete Profile Button Click
    deleteProfileButton.addEventListener('click', deleteCurrentProfile);

    // Cancel Add Profile Button Click
    cancelAddProfileButton.addEventListener('click', () => {
        resetProfileActionsUI();
    });

    // Cancel Copy Profile Button Click
    cancelCopyProfileButton.addEventListener('click', () => {
        resetProfileActionsUI();
    });

    // Button management
    document.getElementById('addButton').addEventListener('click', e => addButton(e));
    document.getElementById('clearText').addEventListener('click', clearText);
    document.getElementById('addSeparator').addEventListener('click', addSeparator);
    const addSettingsBtnEl = document.getElementById('addSettingsButton');
    if (addSettingsBtnEl) {
        addSettingsBtnEl.addEventListener('click', (e) => addSettingsButton(e));


    }
    const addCopyLastChatGPTResponseBtnEl = document.getElementById('addCopyLastChatGPTResponseButton');
    if (addCopyLastChatGPTResponseBtnEl) {
        addCopyLastChatGPTResponseBtnEl.addEventListener('click', (e) => addCopyLastChatGPTResponseButton(e));
    }
    const addQueueCurrentEditorBtnEl = document.getElementById('addQueueCurrentEditorButton');
    if (addQueueCurrentEditorBtnEl) {
        addQueueCurrentEditorBtnEl.addEventListener('click', (e) => addQueueCurrentEditorButton(e));
    }
    const addCreateButtonFromEditorBtnEl = document.getElementById('addCreateButtonFromEditorButton');
    if (addCreateButtonFromEditorBtnEl) {
        addCreateButtonFromEditorBtnEl.addEventListener('click', (e) => addCreateButtonFromEditorButton(e));
    }

    // Settings
    document.getElementById('autoSendToggle').addEventListener('change', updateGlobalSettings);
    document.getElementById('shortcutsToggle').addEventListener('change', updateGlobalSettings);
    if (hideOnPageAutoSendToggleEl) {
        hideOnPageAutoSendToggleEl.addEventListener('change', updateGlobalSettings);
    }
    if (hideOnPageHotkeysToggleEl) {
        hideOnPageHotkeysToggleEl.addEventListener('change', updateGlobalSettings);
    }
    if (hideOnPageFloatingPanelToggleEl) {
        hideOnPageFloatingPanelToggleEl.addEventListener('change', updateGlobalSettings);
    }
    if (disableBrowserConsoleLogsToggleEl) {
        disableBrowserConsoleLogsToggleEl.addEventListener('change', updateGlobalSettings);
    }
    if (uiScaleSliderEl) {
        uiScaleSliderEl.addEventListener('input', handleUiScaleSliderInput);
        uiScaleSliderEl.addEventListener('change', handleUiScaleSliderChange);
    }
    if (tooltipScaleSliderEl) {
        tooltipScaleSliderEl.addEventListener('input', handleTooltipScaleSliderInput);
        tooltipScaleSliderEl.addEventListener('change', handleTooltipScaleSliderChange);
    }
    if (uiScaleLockBtnEl) {
        uiScaleLockBtnEl.addEventListener('click', handleUiScaleLockToggle);
    }
    reinforceAllCheckboxTooltips();
    // Some modules create checkbox rows dynamically. Keep tooltip wiring resilient.
    const checkboxTooltipObserver = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            if (mutation.type !== 'childList') continue;
            const hasRelevantNodes = Array.from(mutation.addedNodes).some((node) => {
                if (!(node instanceof Element)) return false;
                if (node.matches('label.checkbox-row')) return true;
                return !!node.querySelector?.('label.checkbox-row');
            });
            if (hasRelevantNodes) {
                scheduleCheckboxTooltipReinforce();
                break;
            }
        }
    });
    checkboxTooltipObserver.observe(document.body, { childList: true, subtree: true });
    document.getElementById('revertDefault').addEventListener('click', revertToDefault);
    if (queueHideActivationToggleEl) {
        queueHideActivationToggleEl.addEventListener('change', handleQueueHideActivationChange);
    }
    if (queueRandomizeEnabledEl) {
        queueRandomizeEnabledEl.addEventListener('change', handleQueueRandomizeToggleChange);
    }
    if (queueRandomizePercentInput) {
        queueRandomizePercentInput.addEventListener('change', handleQueueRandomizePercentChange);
    }

    // Drag and drop events - implementation in popup-page-customButtons.js
    // We use a two-phase check to allow dragging the whole card while preventing
    // drags from starting on interactive child elements.
    buttonCardsList.addEventListener('pointerdown', handlePointerDown, true); // Phase 1: Capture the initial target.
    buttonCardsList.addEventListener('dragstart', handleDragStart, true);     // Phase 2: Decide whether to start the drag.
    document.addEventListener('dragover', handleDragOver);                    // Track even when cursor leaves the list.
    buttonCardsList.addEventListener('drop', handleDrop);
    document.addEventListener('dragend', handleDragEnd); // dragend doesn't bubble, must be on document/window.

    // Button list event delegation for delete buttons
    buttonCardsList.addEventListener('click', (e) => {
        if (e.target.classList.contains('delete-button')) {
            const buttonItem = e.target.closest('.button-item');
            startUndoableDeletion(buttonItem);
            return;
        }

        const shortcutButton = e.target.closest('.shortcut-picker-button');
        if (shortcutButton) {
            const buttonItem = shortcutButton.closest('.button-item');
            openHotkeyPicker(buttonItem);
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



    // Initialize event listeners for dynamic elements
    textareaSaverAndResizerFunc();
    attachEmojiInputListeners();
    attachAutoSendToggleListeners();
    // Call the function for your specific textarea by ID
    textareaInputAreaResizerFun('buttonText');
    initSideDonateCreeper();

    document.addEventListener('ocp:tab-changed', (event) => {
        if (event.detail?.panelId !== 'buttonConfigurationSection') {
            return;
        }

        requestAnimationFrame(() => {
            if (typeof refitButtonCreationInputs === 'function') {
                refitButtonCreationInputs();
            }
            if (typeof refitButtonCardLayouts === 'function') {
                refitButtonCardLayouts();
            }
        });
    });

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
// 12. Utility Functions
// -------------------------

/**
 * This is not browser console!
 * Logs a message to the user-visible console with a timestamp.
 * @param {string} message - The message to log.
 */
function logToGUIConsole(message) {
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = document.createElement('div');
    logEntry.textContent = `${timestamp}: ${message}`;
    consoleOutput.appendChild(logEntry);
    consoleOutput.scrollTop = consoleOutput.scrollHeight;
}

document.getElementById('openWelcomePage').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({
        url: chrome.runtime.getURL('welcome.html')
    });
});
