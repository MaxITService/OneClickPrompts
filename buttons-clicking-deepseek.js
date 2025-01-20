'use strict';

function processDeepSeekCustomSendButtonClick(event, customText, autoSend) {
    const button = event.target.closest('.custom-send-button');
    if (!button) return;

    const injectionTargets = window.InjectionTargetsOnWebsite.selectors;
    const editor = document.querySelector(injectionTargets.editors[0]);
    
    if (!editor) {
        console.error('[DeepSeek] Could not find editor element');
        return;
    }

    // Insert custom text into textarea
    editor.value = customText;
    
    // Trigger input event for any listeners
    const inputEvent = new Event('input', { bubbles: true });
    editor.dispatchEvent(inputEvent);

    if (autoSend) {
        const sendButton = document.querySelector(injectionTargets.sendButtons[0]);
        if (sendButton) {
            sendButton.click();
        }
    }

    console.log('[DeepSeek] Button clicked with text:', customText);
}

function initializeDeepSeekButtonInjection() {
    const injectionTargets = window.InjectionTargetsOnWebsite.selectors;
    
    // Wait for container and editor to be available
    window.MaxExtensionUtils.waitForElements(
        injectionTargets.containers,
        (container) => {
            const buttonsContainer = document.createElement('div');
            buttonsContainer.id = injectionTargets.buttonsContainerId;
            buttonsContainer.style.display = 'flex';
            buttonsContainer.style.gap = '8px';
            buttonsContainer.style.marginTop = '12px';

            // Add your custom buttons here
            const customButton = document.createElement('button');
            customButton.className = 'custom-send-button';
            customButton.textContent = 'Custom Send';
            customButton.addEventListener('click', (e) => 
                processDeepSeekCustomSendButtonClick(e, 'Custom text example', true));
            
            buttonsContainer.appendChild(customButton);
            
            // Insert buttons container after the editor
            const editorWrapper = container.querySelector(injectionTargets.editors[0])
                ?.parentElement;
            if (editorWrapper) {
                editorWrapper.parentNode.insertBefore(
                    buttonsContainer, 
                    editorWrapper.nextSibling
                );
            }
        }
    );
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeDeepSeekButtonInjection);
} else {
    initializeDeepSeekButtonInjection();
}
