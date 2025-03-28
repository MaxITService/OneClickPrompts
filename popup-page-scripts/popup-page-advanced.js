/**
 * popup-page-advanced.js
 * Handles the advanced selector configuration UI in the popup
 */

document.addEventListener('DOMContentLoaded', () => {
    // Set up collapsible section functionality
    const advancedSection = document.getElementById('advancedSection');
    const toggleIcon = advancedSection.querySelector('.toggle-icon');

    function toggleSection(section, icon) {
        section.classList.toggle('expanded');
        icon.style.transform = section.classList.contains('expanded') 
            ? 'rotate(90deg)' 
            : 'rotate(0deg)';
    }

    // Toggle section visibility
    advancedSection.querySelector('.section-header').addEventListener('click', () => {
        toggleSection(advancedSection, toggleIcon);
        
        // If advanced section is collapsed, ensure help section is also collapsed
        if (!advancedSection.classList.contains('expanded')) {
            advancedHelpSection.classList.remove('expanded');
            helpToggleIcon.style.transform = 'rotate(0deg)';
        }
    });

    // Initialize in collapsed state
    advancedSection.classList.remove('expanded');
    toggleIcon.style.transform = 'rotate(0deg)';
    
    // Set up help section collapsible functionality
    const advancedHelpSection = document.getElementById('advancedHelpSection');
    const helpToggleIcon = advancedHelpSection.querySelector('.toggle-icon');

    // Toggle help section visibility
    advancedHelpSection.querySelector('.section-header').addEventListener('click', (event) => {
        // Prevent the click from bubbling up to the parent advanced section
        event.stopPropagation();
        toggleSection(advancedHelpSection, helpToggleIcon);
    });

    // Initialize help section in collapsed state
    advancedHelpSection.classList.remove('expanded');
    helpToggleIcon.style.transform = 'rotate(0deg)';

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
        // Use the getDefaultSelectors method from utils.js
        if (window.InjectionTargetsOnWebsite) {
            return window.InjectionTargetsOnWebsite.getDefaultSelectors(site);
        } else {
            // Fallback if InjectionTargetsOnWebsite is not available
            return {
                containers: [],
                sendButtons: [],
                editors: [],
                buttonsContainerId: site.toLowerCase() + '-custom-buttons-container'
            };
        }
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
