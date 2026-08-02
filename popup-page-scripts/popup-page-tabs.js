'use strict';

document.addEventListener('DOMContentLoaded', () => {
    const tabButtons = Array.from(document.querySelectorAll('.menu-tab-btn[data-tab-target]'));
    const tabPanels = Array.from(document.querySelectorAll('.tab-panel'));

    if (tabButtons.length === 0 || tabPanels.length === 0) {
        return;
    }

    const buttonByPanelId = new Map(
        tabButtons.map((button) => [button.dataset.tabTarget, button])
    );

    function setButtonState(button, isActive) {
        button.classList.toggle('is-active', isActive);
        button.setAttribute('aria-selected', String(isActive));
        button.tabIndex = isActive ? 0 : -1;
    }

    function setPanelState(panel, isActive) {
        panel.hidden = !isActive;
        panel.classList.toggle('is-active', isActive);
    }

    function resolvePanelIdForElement(element) {
        return element?.closest('.tab-panel')?.id || null;
    }

    function updateLocationHash(panelId) {
        const url = new URL(window.location.href);
        url.hash = panelId;
        history.replaceState(null, '', url);
    }

    function activateTab(panelId, options = {}) {
        const {
            focusButton = false,
            updateHash = true,
            resetScroll = true,
        } = options;

        const activeButton = buttonByPanelId.get(panelId);
        const activePanel = document.getElementById(panelId);
        if (!activeButton || !activePanel) {
            return;
        }

        tabButtons.forEach((button) => {
            setButtonState(button, button === activeButton);
        });

        tabPanels.forEach((panel) => {
            setPanelState(panel, panel === activePanel);
        });

        if (resetScroll) {
            window.scrollTo({ top: 0, left: 0 });
        }

        if (updateHash) {
            updateLocationHash(panelId);
        }

        if (focusButton) {
            activeButton.focus();
        }

        document.dispatchEvent(new CustomEvent('ocp:tab-changed', {
            detail: { panelId },
        }));
    }

    function activateTabForHash(hashValue, options = {}) {
        const normalizedHash = hashValue.startsWith('#') ? hashValue.slice(1) : hashValue;
        if (!normalizedHash) {
            return false;
        }

        const directButton = buttonByPanelId.get(normalizedHash);
        if (directButton) {
            activateTab(normalizedHash, { ...options, updateHash: false });
            return true;
        }

        const targetElement = document.getElementById(normalizedHash);
        const panelId = resolvePanelIdForElement(targetElement);
        if (!panelId) {
            return false;
        }

        activateTab(panelId, { ...options, updateHash: false });
        return true;
    }

    tabButtons.forEach((button, index) => {
        button.addEventListener('click', () => {
            activateTab(button.dataset.tabTarget);
        });

        button.addEventListener('keydown', (event) => {
            const { key } = event;
            if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(key)) {
                return;
            }

            event.preventDefault();

            let nextIndex = index;
            if (key === 'Home') {
                nextIndex = 0;
            } else if (key === 'End') {
                nextIndex = tabButtons.length - 1;
            } else {
                const direction = key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 1;
                nextIndex = (index + direction + tabButtons.length) % tabButtons.length;
            }

            const nextButton = tabButtons[nextIndex];
            activateTab(nextButton.dataset.tabTarget, {
                focusButton: true,
            });
        });
    });

    document.addEventListener('click', (event) => {
        const link = event.target.closest('a[href^="#"]');
        if (!link) {
            return;
        }

        const href = link.getAttribute('href');
        if (!href || href === '#') {
            return;
        }

        activateTabForHash(href, {
            resetScroll: false,
        });
    }, true);

    window.addEventListener('hashchange', () => {
        activateTabForHash(window.location.hash, {
            resetScroll: false,
        });
    });

    const initialTabId = activateTabForHash(window.location.hash, {
        resetScroll: false,
    })
        ? null
        : tabButtons[0]?.dataset.tabTarget;

    if (initialTabId) {
        activateTab(initialTabId, {
            updateHash: false,
            resetScroll: false,
        });
    }
});
