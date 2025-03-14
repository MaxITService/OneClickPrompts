/**
 * popup-page-advanced.js
 * Handles the advanced selector configuration UI in the popup
 */

document.addEventListener('DOMContentLoaded', () => {
    const websiteSelect = document.getElementById('selectorWebsiteSelect');
    const selectorConfig = document.getElementById('selectorConfig');
    const saveButton = document.getElementById('saveSelectors');
    const resetButton = document.getElementById('resetSelectors');

    // Load selectors for the selected website
    async function loadSelectors() {
        const site = websiteSelect.value;
        try {
            // First try to get custom selectors
            const response = await new Promise(resolve => {
                chrome.runtime.sendMessage({
                    type: 'getCustomSelectors',
                    site: site
                }, resolve);
            });
            
            if (response && response.selectors) {
                // Use custom selectors if available
                selectorConfig.value = JSON.stringify(response.selectors, null, 2);
                console.log(`Loaded custom selectors for ${site}`);
            } else {
                // Fall back to default selectors
                // Create a temporary instance to access the default selectors
                const defaultSelectors = getDefaultSelectorsForSite(site);
                selectorConfig.value = JSON.stringify(defaultSelectors, null, 2);
                console.log(`Loaded default selectors for ${site}`);
            }
        } catch (error) {
            console.error('Error loading selectors:', error);
            showToast('Error loading selectors', 'error');
        }
    }

    // Helper function to get default selectors for a site
    function getDefaultSelectorsForSite(site) {
        // This replicates the default selector structure from utils.js
        const defaultSelectors = {
            ChatGPT: {
                containers: ['div.flex.w-full.flex-col:has(textarea)'],
                sendButtons: [
                    'button[data-testid="send-button"]',
                    'button.send-button-class',
                    'button[type="submit"]'
                ],
                editors: ['div.ProseMirror#prompt-textarea', 'div.ProseMirror'],
                buttonsContainerId: 'chatgpt-custom-buttons-container'
            },
            Claude: {
                containers: [
                    'div.flex.flex-col.bg-bg-000.rounded-2xl',
                    'div.flex.flex-col.bg-bg-000.gap-1\\.5'
                ],
                sendButtons: ['button[aria-label="Send Message"]'],
                editors: ['div.ProseMirror[contenteditable="true"]'],
                buttonsContainerId: 'claude-custom-buttons-container'
            },
            Copilot: {
                containers: ['div.shadow-composer-input'],
                sendButtons: [
                    'button.rounded-submitButton[title="Submit message"]',
                    'button[type="button"][title="Submit message"]'
                ],
                editors: [
                    'div.shadow-composer-input textarea#userInput',
                    'textarea#userInput[placeholder="Message Copilot"]'
                ],
                buttonsContainerId: 'copilot-custom-buttons-container'
            },
            DeepSeek: {
                containers: [
                    'div.dd442025',
                    '[class*="editorContainer"]'
                ],
                sendButtons: [
                    'div.bf38813a [role="button"]',
                    'button:has(svg)',
                    '[aria-label*="Send"]',
                    '[data-testid="send-button"]'
                ],
                editors: [
                    'textarea#chat-input',
                    'div.b13855df',
                    '[contenteditable="true"]'
                ],
                buttonsContainerId: 'deepseek-custom-buttons-container'
            },
            AIStudio: {
                containers: [
                    'section.chunk-editor-main',
                    'footer',
                    'ms-chunk-editor-menu',
                    'body > app-root > div > div > div.layout-wrapper > div > span > ms-prompt-switcher > ms-chunk-editor > section > footer'
                ],
                sendButtons: [
                    'button.run-button[type="submit"]',
                    'button[aria-label="Run"]',
                    'run-button button[type="submit"]',
                    'footer > div.input-wrapper > div:nth-child(3) > run-button > button'
                ],
                editors: [
                    'ms-autosize-textarea textarea[aria-label="User text input"]',
                    'textarea.textarea.gmat-body-medium[aria-label="Type something"]',
                    'footer > div.input-wrapper > div.text-wrapper > ms-chunk-input > section > ms-text-chunk > ms-autosize-textarea'
                ],
                buttonsContainerId: 'aistudio-custom-buttons-container'
            },
            Grok: {
                containers: [
                    'form.bottom-0.w-full.text-base.flex.flex-col.gap-2.items-center.justify-center.relative.z-10'
                ],
                sendButtons: [
                    'form.bottom-0.w-full.text-base.flex.flex-col.gap-2.items-center.justify-center.relative.z-10 button[type="submit"].group'
                ],
                editors: [
                    'textarea.w-full.bg-transparent.focus\\:outline-none.text-primary',
                    'textarea.w-full.px-2.\\@\\[480px\\]\\/input\\:px-3.pt-5.mb-5.bg-transparent.focus\\:outline-none.text-primary.align-bottom'
                ],
                buttonsContainerId: 'grok-custom-buttons-container'
            }
        };
        
        return defaultSelectors[site] || {
            containers: [],
            sendButtons: [],
            editors: [],
            buttonsContainerId: site.toLowerCase() + '-custom-buttons-container'
        };
    }

    // Save the current selector configuration
    async function saveSelectors() {
        try {
            // Parse the JSON to validate it
            const config = JSON.parse(selectorConfig.value);
            
            // Validate the structure
            if (!validateSelectors(config)) {
                throw new Error('Invalid selector structure');
            }
            
            // Save to storage
            const response = await new Promise(resolve => {
                chrome.runtime.sendMessage({
                    type: 'saveCustomSelectors',
                    site: websiteSelect.value,
                    selectors: config
                }, resolve);
            });
            
            if (response && response.success) {
                showToast('Selectors saved successfully', 'success');
            } else {
                throw new Error('Failed to save selectors');
            }
        } catch (error) {
            console.error('Error saving selectors:', error);
            showToast(`Error saving: ${error.message}`, 'error');
        }
    }

    // Reset selectors to defaults
    async function resetSelectors() {
        try {
            // Remove custom selectors
            const response = await new Promise(resolve => {
                chrome.runtime.sendMessage({
                    type: 'saveCustomSelectors',
                    site: websiteSelect.value,
                    selectors: null // null means remove
                }, resolve);
            });
            
            if (response && response.success) {
                // Load the defaults
                const defaultSelectors = getDefaultSelectorsForSite(websiteSelect.value);
                selectorConfig.value = JSON.stringify(defaultSelectors, null, 2);
                showToast('Selectors reset to defaults', 'info');
            } else {
                throw new Error('Failed to reset selectors');
            }
        } catch (error) {
            console.error('Error resetting selectors:', error);
            showToast(`Error resetting: ${error.message}`, 'error');
        }
    }

    // Validate the selector structure
    function validateSelectors(selectors) {
        return selectors && 
               selectors.containers && Array.isArray(selectors.containers) &&
               selectors.sendButtons && Array.isArray(selectors.sendButtons) &&
               selectors.editors && Array.isArray(selectors.editors) &&
               typeof selectors.buttonsContainerId === 'string';
    }

    // Event listeners
    websiteSelect.addEventListener('change', loadSelectors);
    saveButton.addEventListener('click', saveSelectors);
    resetButton.addEventListener('click', resetSelectors);

    // Initial load
    loadSelectors();
});
