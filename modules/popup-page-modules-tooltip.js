// modules/popup-page-modules-tooltip.js
// Instructions for AI: do not remove comments! MUST NOT REMOVE COMMENTS.
// Handles UI load/save for the Tooltip module settings in the popup.

'use strict';

(() => {
    // Default values
    const DEFAULTS = Object.freeze({
        enabled: true,
        showDelayMs: 400,
        fontColor: null,
        themeOverride: false,
        forcedTheme: 'dark'
    });

    // Logging
    function log(...args) {
        if (typeof logConCgp === 'function') {
            logConCgp('[tooltip-popup]', ...args);
        } else {
            console.log('[tooltip-popup]', ...args);
        }
    }

    // Elements
    const elEnable = document.getElementById('tooltipEnableToggle');
    const elShowDelay = document.getElementById('tooltipShowDelay');
    const elShowDelayReset = document.getElementById('tooltipShowDelayReset');
    const elFontColor = document.getElementById('tooltipFontColor');
    const elFontColorReset = document.getElementById('tooltipFontColorReset');
    const elSettingsContainer = document.getElementById('tooltipSettingsContainer');
    const elThemeOverride = document.getElementById('tooltipThemeOverride');
    const elThemeRadioContainer = document.getElementById('tooltipThemeRadioContainer');

    // Normalize settings to ensure valid shape
    function normalize(settings) {
        const s = settings && typeof settings === 'object' ? settings : {};
        return {
            enabled: s.enabled !== false, // defaults to true
            showDelayMs: Number.isFinite(s.showDelayMs) && s.showDelayMs >= 0 ? Number(s.showDelayMs) : DEFAULTS.showDelayMs,
            fontColor: typeof s.fontColor === 'string' && s.fontColor ? s.fontColor : null,
            themeOverride: !!s.themeOverride,
            forcedTheme: s.forcedTheme === 'light' ? 'light' : 'dark'
        };
    }

    // Set UI from settings
    function setUiFromSettings(settings) {
        const s = normalize(settings);

        if (elEnable) {
            elEnable.checked = s.enabled;
        }
        if (elShowDelay) {
            elShowDelay.value = s.showDelayMs;
        }
        if (elFontColor) {
            // Color input needs a valid hex color; use white as default display
            elFontColor.value = s.fontColor || '#ffffff';
        }
        if (elThemeOverride) {
            elThemeOverride.checked = s.themeOverride;
        }
        // Set radio button
        const radioToCheck = document.querySelector(`input[name="tooltipThemeChoice"][value="${s.forcedTheme}"]`);
        if (radioToCheck) {
            radioToCheck.checked = true;
        }

        // Show/hide settings container based on enabled state
        if (elSettingsContainer) {
            elSettingsContainer.classList.toggle('is-hidden', !s.enabled);
        }
        // Show/hide theme radio container based on themeOverride state
        if (elThemeRadioContainer) {
            elThemeRadioContainer.classList.toggle('is-hidden', !s.themeOverride);
        }
    }

    // Collect settings from UI
    function collectSettingsFromUi() {
        const enabled = elEnable ? elEnable.checked : DEFAULTS.enabled;
        const showDelayMs = elShowDelay ? parseInt(elShowDelay.value, 10) || DEFAULTS.showDelayMs : DEFAULTS.showDelayMs;

        // Only use fontColor if it's different from the default white
        const colorValue = elFontColor ? elFontColor.value : null;
        // null means "use default theme-aware color"
        const fontColor = colorValue && colorValue !== '#ffffff' ? colorValue : null;

        // Theme override
        const themeOverride = elThemeOverride ? elThemeOverride.checked : DEFAULTS.themeOverride;
        const selectedRadio = document.querySelector('input[name="tooltipThemeChoice"]:checked');
        const forcedTheme = selectedRadio ? selectedRadio.value : DEFAULTS.forcedTheme;

        return normalize({
            enabled,
            showDelayMs,
            fontColor,
            themeOverride,
            forcedTheme
        });
    }

    // Save settings to storage
    async function save(settings, { silent = false } = {}) {
        try {
            const normalized = normalize(settings);
            await new Promise((resolve, reject) => {
                chrome.runtime.sendMessage(
                    { type: 'saveTooltipSettings', settings: normalized },
                    (response) => {
                        if (chrome.runtime.lastError) {
                            reject(chrome.runtime.lastError);
                        } else if (response?.error) {
                            reject(new Error(response.error));
                        } else {
                            resolve(response);
                        }
                    }
                );
            });
            if (!silent) {
            }
            log('Saved tooltip settings:', normalized);
        } catch (error) {
            log('Failed to save tooltip settings:', error);
        }
    }

    // Load settings from storage
    async function load() {
        try {
            const response = await new Promise((resolve, reject) => {
                chrome.runtime.sendMessage({ type: 'getTooltipSettings' }, (response) => {
                    if (chrome.runtime.lastError) {
                        reject(chrome.runtime.lastError);
                    } else if (response?.error) {
                        reject(new Error(response.error));
                    } else {
                        resolve(response);
                    }
                });
            });
            const settings = normalize(response?.settings);
            setUiFromSettings(settings);
            log('Loaded tooltip settings:', settings);
        } catch (error) {
            log('Failed to load tooltip settings:', error);
            setUiFromSettings(DEFAULTS);
        }
    }

    // Wire UI events
    function attachEvents() {
        // Enable toggle
        if (elEnable) {
            elEnable.addEventListener('change', () => {
                const settings = collectSettingsFromUi();
                settings.enabled = elEnable.checked;
                setUiFromSettings(settings);
                save(settings);
            });
        }

        // Show delay input
        if (elShowDelay) {
            let debounceTimer = null;
            elShowDelay.addEventListener('input', () => {
                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(() => {
                    save(collectSettingsFromUi(), { silent: true });
                }, 500);
            });
            elShowDelay.addEventListener('change', () => {
                clearTimeout(debounceTimer);
                save(collectSettingsFromUi());
            });
        }

        // Show delay reset button
        if (elShowDelayReset) {
            elShowDelayReset.addEventListener('click', () => {
                if (elShowDelay) {
                    elShowDelay.value = DEFAULTS.showDelayMs;
                    save(collectSettingsFromUi());
                }
            });
        }

        // Font color input
        if (elFontColor) {
            elFontColor.addEventListener('input', () => {
                save(collectSettingsFromUi(), { silent: true });
            });
            elFontColor.addEventListener('change', () => {
                save(collectSettingsFromUi());
            });
        }

        // Font color reset button
        if (elFontColorReset) {
            elFontColorReset.addEventListener('click', () => {
                if (elFontColor) {
                    elFontColor.value = '#ffffff';
                    const settings = collectSettingsFromUi();
                    settings.fontColor = null; // Reset to default (theme-aware)
                    save(settings);
                }
            });
        }

        // Theme override toggle
        if (elThemeOverride) {
            elThemeOverride.addEventListener('change', () => {
                const settings = collectSettingsFromUi();
                settings.themeOverride = elThemeOverride.checked;
                setUiFromSettings(settings);
                save(settings);
            });
        }

        // Theme choice radio buttons
        const themeRadios = document.querySelectorAll('input[name="tooltipThemeChoice"]');
        themeRadios.forEach(radio => {
            radio.addEventListener('change', () => {
                save(collectSettingsFromUi());
            });
        });
    }

    // Listen to external changes (keep UI in sync if settings update elsewhere)
    try {
        chrome.runtime.onMessage.addListener((msg) => {
            if (msg && msg.type === 'tooltipSettingsChanged' && msg.settings) {
                setUiFromSettings(msg.settings);
            }
        });
    } catch { /* noop */ }

    // Initialize
    document.addEventListener('DOMContentLoaded', () => {
        attachEvents();
        load();
    });

    // In case the script loads after DOMContentLoaded (popup is small), guard-init:
    if (document.readyState === 'interactive' || document.readyState === 'complete') {
        attachEvents();
        load();
    }
})();
