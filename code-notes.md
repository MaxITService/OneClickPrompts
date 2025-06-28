// code-notes.md

# OneClickPrompts Chrome Extension - Codebase Overview

This document provides a high-level overview of the OneClickPrompts Chrome Extension codebase. It describes the purpose of each file and its role within the extension. Extension was previously called "ChatGPT Quick Buttons for your text".

## Core Functionality

The OneClickPrompts extension enhances AI chat platforms like ChatGPT, Claude, Copilot, DeepSeek, AI Studio, Gemini, and Grok by adding customizable buttons that inject pre-defined prompts into the chat input area. It also includes features for managing profiles, enabling keyboard shortcuts, and customizing the user interface.

## File Descriptions

### `manifest.json`

- **Purpose:** Defines the extension's metadata, permissions, background service worker, and content scripts.
- **Role:** This is the central configuration file that tells Chrome how to load and run the extension. It specifies which JavaScript and CSS files to inject into which websites and makes resources like HTML templates (`floating-panel.html`) accessible to the content scripts.

### `config.js`

- **Purpose:** Service worker script that manages extension configuration and settings.
- **Role:** Handles message passing between content scripts, popup pages, and storage. Key responsibilities:
  - Acts as a central hub for configuration management
  - Stores and retrieves button configurations in Chrome storage
  - Manages profiles (saving, loading, deleting)
  - Handles custom selector configurations
  - Manages floating panel settings across different websites
  - Provides unified storage for all extension settings
  - Implements reset functionality for various setting types
- **Message Handlers:**
  - Processes messages from content scripts and popup pages
  - Handles floating panel settings with message types:
    - 'getFloatingPanelSettings': Retrieves settings for a specific website
    - 'saveFloatingPanelSettings': Saves settings for a specific website
    - 'resetFloatingPanelSettings': Removes all floating panel settings
  - Stores floating panel settings with the prefix 'floating*panel*' followed by the website hostname

### `default-config.json`

- **Purpose:** Defines the default configuration settings for new profiles.
- **Role:** Provides the initial set of custom buttons and settings when a user first installs the extension or creates a new profile.

### `log.js`

- **Purpose:** Provides a consistent logging utility for the extension.
- **Role:** Centralizes logging through the `logConCgp` function, ensuring a consistent format and easy control over logging behavior.

### `event-handlers.js`

- **Purpose:** For future use, file is empty
- **Role:** For future use

### `floating-panel.js`

- **Purpose:** Implements the entry point for the OneClickPrompts floating panel.
- **Role:** Defines the `window.MaxExtensionFloatingPanel` namespace, which acts as a global object containing all shared properties and functions for the floating panel. This includes references to the panel element, its visibility state, current settings, and profile information.

### `floating-panel.html`

- **Purpose:** Provides the static HTML structure for the floating panel.
- **Role:** This file defines the panel's complete DOM structure, including the header, content area, queue section, and footer. It is fetched asynchronously by `floating-panel-ui-creation.js` and injected into the page, cleanly separating the panel's structure from its behavior.

### `floating-panel.css`

- **Purpose:** Provides all the styling for the floating panel.
- **Role:** This file contains all CSS rules that define the visual appearance of the floating panel, including its layout, colors, fonts, and opacity. It is injected directly into the web page by the extension's manifest.

### `floating-panel-ui-creation.js`

- **Purpose:** Handles fetching the panel's HTML template, injecting it into the DOM, and setting up its core interactive behaviors.
- **Role:** This script is responsible for loading the visual structure of the panel from `floating-panel.html`. Key functions:
  - `createFloatingPanel()`: Fetches `floating-panel.html` asynchronously, appends it to the document body, and attaches initial event listeners (e.g., for the close button). It then calls `initializeQueueSection` to wire up the queue controls.
  - `createProfileSwitcher()`: Builds the profile dropdown in the panel footer.
  - `makeDraggable()`: Enables drag functionality on the panel's header and footer.
  - `positionPanelAtCursor()`: Positions the panel relative to the mouse cursor.
  - `createPanelToggleButton()`: Creates the toggle button used to summon the floating panel.
- **Dependencies:** `floating-panel.html`, `floating-panel-ui-queue.js`.

### `floating-panel-ui-interaction.js`

- **Purpose:** Contains UI interaction and state management methods for the floating panel.
- **Role:** Handles toggling panel visibility, moving buttons between containers, updating the panel appearance from settings, restoring state, and refreshing buttons. Key functions:
  - `togglePanel()`: An `async` function that toggles the floating panel's visibility. It handles the initial asynchronous creation of the panel via `createFloatingPanel` on the first click.
  - `moveButtonsToPanel()`: Moves buttons from the original container to the panel.
  - `updatePanelFromSettings()`: Updates the panel’s dynamic styles (like position, size, and opacity).
  - `restorePanelState()`: Restores the panel visibility based on saved settings.
  - `refreshButtonsInPanel()`: Refreshes the buttons displayed in the panel after a profile switch.
- **Dependencies:** `floating-panel.js`, `floating-panel-ui-creation.js`.

### `floating-panel-ui-queue.js`

- **Purpose:** Initializes the interactive elements within the floating panel's queue section and handles rendering the queue's visual state.
- **Role:** This script finds the pre-existing queue elements loaded from `floating-panel.html` and attaches the necessary JavaScript logic and event handlers. It is responsible for all direct DOM manipulation of the queue UI. Key functions:
  - `initializeQueueSection()`: Finds the queue toggle, delay input, and control buttons in the DOM and wires up their functionality.
  - `renderQueueDisplay()`: Clears and redraws the list of queued prompt icons.
  - `updateQueueControlsState()`: Manages the enabled/disabled state and icons of the play/pause and reset buttons.
- **Dependencies:** `floating-panel.html`, `interface.js`, `floating-panel-queue-engine.js`.

### `floating-panel-ui-engine.js`

- **Purpose:** Contains the core state management and execution logic for the prompt queue.
- **Role:** This script is UI-agnostic and manages the `promptQueue` array, the sending process, timers, and state flags (`isQueueRunning`). It provides the backend functionality for the queue feature. Key functions:
  - `addToQueue()`, `removeFromQueue()`, `startQueue()`, `pauseQueue()`, `resetQueue()`: Manage the queue's lifecycle.
  - `processNextQueueItem()`: The core loop that sends a prompt and sets a timer for the next.
- **Dependencies:** `floating-panel.js`, `floating-panel-ui-queue.js` (calls UI update functions).

### `floating-panel-settings.js`

- **Purpose:** Handles settings persistence and profile management for the floating panel.
- **Role:** Includes methods for loading/saving panel settings, debouncing saves, and profile switching. Key functions:
  - `initialize()`: The main entry point for the floating panel system. It asynchronously calls `createFloatingPanel` and then loads settings and profiles once the panel is in the DOM.
  - `loadPanelSettings()`: Retrieves settings from the service worker for the current hostname.
  - `savePanelSettings()`: Sends updated settings to the service worker for storage.
  - `debouncedSavePanelSettings()`: Waits 150ms before saving to reduce storage operations.
  - `loadAvailableProfiles()`: Gets a list of profiles from the service worker.
  - `switchToProfile()`: Changes the current profile and refreshes floating panel content.
- **Dependencies:** `floating-panel-ui-creation.js`, `floating-panel-ui-interaction.js`, `config.js`.

### Code File Dependencies for Floating Panel:

- **Initialization Flow:**

  1.  `buttons-init.js`: Calls `MaxExtensionFloatingPanel.initialize()` and creates the toggle button (🔼).
  2.  `initialize()` in `floating-panel-settings.js` starts the process by calling the `async` function `createFloatingPanel()`.
  3.  `createFloatingPanel()` in `floating-panel-ui-creation.js` fetches `floating-panel.html`, injects it into the page, attaches core event listeners, and then calls `initializeQueueSection()`.
  4.  `initializeQueueSection()` in `floating-panel-ui-queue.js` finds the queue elements within the injected HTML and attaches their specific logic.
  5.  Once `createFloatingPanel()` completes, the `.then()` block in `initialize()` executes, which calls `loadPanelSettings()` and `loadAvailableProfiles()` to populate the now-existing panel with data and restore its state.

- **Panel Summoning Process:**

  1.  The toggle button calls the `async` function `togglePanel(event)`.
  2.  On the first call, `togglePanel` awaits the completion of `createFloatingPanel` to ensure the panel is fully built and initialized.
  3.  The panel is then positioned, displayed, and buttons are moved into it.

- **Implementation Notes:**
  - The floating panel's UI has been refactored to use an HTML template (`floating-panel.html`) and an external stylesheet (`floating-panel.css`).
  - This approach separates concerns: structure (HTML), presentation (CSS), and behavior (JavaScript), leading to more maintainable code.
  - JavaScript files that previously created DOM elements now fetch the template or find elements within it and attach functionality.
  - The initialization process is now asynchronous to handle the fetching of the HTML file.

### `init.js`

- **Purpose:** Main initialization script for the content script.
- **Role:** Retrieves configuration from the service worker (`config.js`), detects the active website, injects the UI (`buttons-injection.js`), and manages keyboard shortcuts. Also handles Single Page Application (SPA) navigation to ensure the UI remains active.

### `interface.js`

- **Purpose:** Provides utility functions for creating UI elements like toggle switches.
- **Role:** Simplifies the creation of common UI elements with consistent styling and functionality.

### `buttons.js`

- **Purpose:** Manages the creation and functionality of custom send buttons.
- **Role:** Creates button elements based on configuration, assigns keyboard shortcuts, and handles click events across different supported sites. It decides which site-specific functions are called. It also contains the logic to divert clicks to the prompt queue when Queue Mode is active in the floating panel.

### `buttons-init.js`

- **Purpose:** Handles the initial creation and insertion of custom buttons and toggles into the target container.
- **Role:** Prevents duplication and ensures that the custom UI elements are added to the page only once.

### `buttons-injection.js`

- **Purpose:** Handles the injection of custom buttons into the webpage.
- **Role:** Checks for existing modifications, injects the custom buttons, and implements a resiliency mechanism to re-inject the elements if they disappear due to dynamic page updates.

### `buttons-clicking-chatgpt.js`, `buttons-clicking-claude.js`, `buttons-clicking-copilot.js`, `buttons-clicking-deepseek.js`, `buttons-clicking-aistudio.js`, `buttons-clicking-grok.js`, `buttons-clicking-gemini.js`

- **Purpose:** Site-specific logic for handling custom send button clicks.
- **Role:** Each file contains the code necessary to insert text into the appropriate input area and trigger the send button on its respective website.

### `utils.js`

- **Purpose:** Provides utility functions used throughout the extension.
- **Role:** Includes functions for waiting for elements to load, simulating clicks, inserting text into editors, moving the cursor, and creating separators. Also defines the `InjectionTargetsOnWebsite` class, which centralizes the CSS selectors for different websites.

### `tests.js`

- **Purpose:** Contains test functions for verifying the `config.js` functionality.
- **Role:** Used for automated testing of profile creation, saving, and loading.

## Popup Page Scripts

These scripts are responsible for the user interface in the extension's popup window.

### `popup.html`

- **Purpose:** The main HTML file for the extension's popup.
- **Role:** Defines the structure and layout of the user interface, including the profile selection, button configuration, settings, console, and backup/restore sections.

### `popup-page-scripts/popup-page-script.js`

- **Purpose:** Main script for the popup page.
- **Role:** Handles loading profiles, switching profiles, managing button configuration, updating settings, and interacting with the service worker.

### `popup-page-scripts/popup-page-visuals.js`

- **Purpose:** Provides visual functions for the popup page, like showing toast notifications.
- **Role:** Centralizes visual elements for consistency.

### `popup-page-scripts/popup-page-profiles.js`

- **Purpose:** Provides helper functions for profile switching and creation
- **Role:** Manages profile related actions such as load profile, add profile, copy profile, and delete profile

### `popup-page-scripts/popup-page-backup-handler.js`

- **Purpose:** Handles the backup and restore functionality for profiles.
- **Role:** Implements the logic for exporting and importing profile configurations as JSON files.

### `popup-page-scripts/popup-page-customButtons.js`

- **Purpose:** Manages the custom buttons within the popup UI.
- **Role:** Creates, updates, deletes, and reorders custom buttons and separators, as well as manages their card-like representations in the UI.

### `popup-page-scripts/popup-page-theme.js`

- **Purpose:** Handles the dark theme toggle functionality in the popup interface.
- **Role:** Applies and saves the user's theme preference using the service worker.

### `popup-page-scripts/popup-page-advanced.js`

- **Purpose:** Handles the advanced selector configuration.
- **Role:** Enables users to customize CSS selectors for different AI chat platforms.
- **Implementation:**
  - Provides a user interface for viewing and editing selectors for each supported website
  - Retrieves default selectors directly from the `InjectionTargetsOnWebsite` class in `utils.js`
  - Maintains a single source of truth for selector definitions, eliminating duplication
  - Allows saving custom selectors which override the defaults on a per-site basis
- **Dependencies:**
  - **utils.js:** Uses the `getDefaultSelectors` method to retrieve the canonical selector definitions
  - **config.js (Service Worker):** Communicates with the service worker to save and load custom selectors

### `popup-page-scripts/popup-page-floating-window-handler.js`

- **Purpose:** Handles the resetting of floating panel settings across all websites.
- **Role:** Provides functionality for the "Reset Floating Window Settings" button in the Settings section of the popup interface. Features include:
  - Clearing all floating panel settings from Chrome's extension storage
  - Targeting only settings with the 'floating*panel*' prefix
  - Providing user feedback through console logs and toast notifications
  - Allowing panels to naturally reset to default positions and states on next page load
- **Dependencies:**
  - **config.js (Service Worker):** Directly communicates with the service worker using `chrome.runtime.sendMessage` to reset all floating panel settings by sending a message with type 'resetFloatingPanelSettings'. The service worker handles finding and removing all relevant settings from Chrome's storage.
  - **popup.js:** Integrated with the popup interface to provide user feedback via toast notifications and console logging.

### `popup-page-styles/*`

- **Purpose:** Contains CSS files for styling the popup page.
- **Role:** Defines the visual appearance of the popup, including layouts, colors, fonts, and responsive design.

## Additional Files

### `welcome.html` and `welcome-page-files/`

- **Purpose:** Onboarding page for new users with setup instructions and usage tips.
- **Role:** Displayed on first install and accessible from popup menu. Contains screenshots, styling, and theme toggle functionality.
- **Dependencies:** Triggered by `config.js` on install or manually via `popup-page-script.js`.

## Workflow

The extension operates as follows:

1.  The user configures the extension through the popup interface (`popup.html` and `popup-page-scripts/*`).
2.  The configuration is stored in Chrome's storage by the service worker (`config.js`).
3.  When the user visits a supported website, the content scripts (`init.js` and its dependencies) are injected into the page.
4.  The content scripts retrieve the configuration from the service worker and inject the custom buttons into the page.
5.  Users can toggle between inline injected buttons and the floating panel via the toggle button (🔼).
6.  The floating panel's position, size, and visibility state are saved per website and restored when revisiting.
7.  When the user clicks a custom button:
    - If the floating panel is active and Queue Mode is on, the prompt is added to a queue. The queue sends prompts sequentially with a configurable delay.
    - Otherwise, the appropriate site-specific function is called to insert the text and trigger the send button.

## Additional Notes

- The extension uses a resilient injection mechanism to ensure that the custom buttons remain active even when the target website dynamically updates its content.
- The `InjectionTargetsOnWebsite` class in `utils.js` centralizes the CSS selectors for different websites, making it easier to support new platforms.
- The floating panel provides an alternative UI that can be positioned anywhere on the screen, offering flexibility for different workflows.
- Button configurations are consistently applied between the inline injection and floating panel modes.
- The extension uses debounced saving to prevent excessive storage writes when the user is dragging or resizing the floating panel.
