# OneClickPrompts Chrome Extension - Codebase Overview

This document provides a high-level overview of the OneClickPrompts Chrome Extension codebase. It describes the purpose of each file and its role within the extension. Extension was previously called "ChatGPT Quick Buttons for your text".

## Core Functionality

The OneClickPrompts extension enhances AI chat platforms like ChatGPT, Claude, Copilot, DeepSeek, AI Studio, Gemini, and Grok by adding customizable buttons that inject pre-defined prompts into the chat input area. It also includes features for managing profiles, enabling keyboard shortcuts, and customizing the user interface.

## Core Reliability Pattern: Crash-Only / Self-Healing DOM Injection

A foundational architectural decision in this extension is the use of a **"Crash-only"** (or **"Self-healing"**) reliability pattern for managing the UI in the dynamic, and often hostile, DOM of the target Single-Page Applications (SPAs).

- **The Problem:** The DOM on sites like ChatGPT is unpredictable. Elements are frequently destroyed and re-created, making simple, "surgical" DOM manipulations fragile. An attempt to insert a button can fail if the target container disappears at the wrong millisecond.
- **The Solution:** Instead of writing complex recovery code for every possible failure, the extension embraces a "let-it-crash" philosophy. Any time the UI's integrity is in question (e.g., after an SPA navigation or when closing the floating panel), the extension triggers a full, **idempotent re-initialization** of its UI components.
- **Why It Works:** This approach delegates UI creation to the robust resiliency engine in `buttons-injection.js`, which is designed to patiently wait for injection targets and handle dynamic changes. This trades a small amount of computational efficiency for a massive gain in reliability, ensuring the extension's UI is always present and functional. This pattern is analogous to forcing a re-mount in frameworks like React by changing a component's `key`.

This "Crash-only" principle informs the design of `init.js`, `buttons-injection.js`, and `floating-panel-ui-interaction.js`.

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
- **Role:** Handles toggling panel visibility and updating the panel appearance from settings. The old "hide and clone" mechanism has been completely replaced.
- **Key functions:**
  - `togglePanel()`: An `async` function that toggles the floating panel's visibility. When closed, it intentionally triggers the extension's main `publicStaticVoidMain()` initializer, delegating the button re-creation to the robust **"Crash-only"** resiliency engine.
  - `updatePanelFromSettings()`: Updates the panel’s dynamic styles (like position, size, and opacity).

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
  - `initialize()`: The main entry point for the floating panel system. It is called by the "Director" (`init.js`) after the initial UI has been rendered. It loads settings and profiles for the (now-existing) panel.
  - `loadPanelSettings()`: Retrieves settings from the service worker for the current hostname.
  - `savePanelSettings()`: Sends updated settings to the service worker for storage.
  - `debouncedSavePanelSettings()`: Waits 150ms before saving to reduce storage operations.
  - `loadAvailableProfiles()`: Gets a list of profiles from the service worker.
  - `switchToProfile()`: Changes the current profile and triggers a global refresh of the buttons.
- **Dependencies:** `floating-panel-ui-creation.js`, `floating-panel-ui-interaction.js`, `config.js`.

### Code File Dependencies for Floating Panel:

- **Initialization Flow (New "Decide First, Then Create" Architecture):**

  1.  `init.js` (The Director) starts the `async` initialization process.
  2.  `init.js` asynchronously checks the saved visibility state for the floating panel for the current website.
  3.  **If the panel should be visible:**
      - `init.js` calls `MaxExtensionFloatingPanel.createFloatingPanel()` to build the panel structure.
      - `init.js` then calls `MaxExtensionButtonsInit.createAndInsertCustomElements()` to populate the panel's content area directly.
      - The panel is made visible. There is no "inline" button creation step, preventing UI flicker.
  4.  **If the panel should be hidden:**
      - `init.js` proceeds with the traditional `buttonBoxCheckingAndInjection` flow to inject the buttons directly into their inline location on the page.
  5.  Finally, `init.js` calls `MaxExtensionFloatingPanel.initialize()`. This function loads all settings, populates the profile switcher, and attaches all necessary event listeners to the panel system, which is now in a known state.

- **Panel Toggling Process (User-driven):**

  1.  The user clicks the toggle button (🔼), which calls the `async` function `togglePanel(event)`.
  2.  `togglePanel` now implements a **"destroy and re-create"** logic. If turning the panel ON, it finds and destroys the inline buttons, then creates a new set of buttons inside the panel. If turning OFF, it does the reverse. This is more reliable than the old "hide and clone" method.

- **Implementation Notes:**
  - The architecture now separates the initial rendering decision from subsequent user interactions, leading to better performance and reliability.
  - The UI flicker is eliminated because buttons are only ever created once in their correct, final location during initial page load.

### `init.js`

- **Purpose:** Main initialization script for the content script. It acts as the **Director** of the initial UI setup and embodies the **Crash-only** philosophy.
- **Role:** Implements a **"decide first, then create"** architecture to prevent UI flicker. It asynchronously checks if the floating panel should be visible for the current site _before_ rendering any buttons. Based on this setting, it either injects the buttons into the traditional inline location (via `buttons-injection.js`) or directly into the floating panel. Its main initialization function (`publicStaticVoidMain`) is designed to be **idempotent** and is called on page load, SPA navigation, and panel closing to ensure a consistent and reliable UI state.

### `interface.js`

- **Purpose:** Provides utility functions for creating UI elements like toggle switches.
- **Role:** Simplifies the creation of common UI elements with consistent styling and functionality.

### `buttons.js`

- **Purpose:** Manages the creation and functionality of custom send buttons.
- **Role:** Creates button elements based on configuration, assigns keyboard shortcuts, and handles click events across different supported sites. It decides which site-specific functions are called. It also contains the logic to divert clicks to the prompt queue when Queue Mode is active in the floating panel.

### `buttons-init.js`

- **Purpose:** Acts as a **UI Factory**. It contains the logic to generate a complete set of buttons and toggles.
- **Role:** It is called by the "Director" (`init.js`) to populate a specified container, which can be either the inline injection point or the floating panel's content area. It is no longer responsible for making decisions about panel visibility.

### `buttons-injection.js`

- **Purpose:** Handles the injection of custom buttons into the webpage for the **inline mode** and provides the core resiliency mechanism.
- **Role:** This script is now primarily used when `init.js` decides that the floating panel should be hidden on initial load. It finds the correct injection point on the page and implements a **self-healing** resiliency mechanism (using `MutationObserver` and timeouts) to re-inject the elements if they disappear due to dynamic page updates.

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
3.  When the user visits a supported website, the content scripts are injected. The main initializer (`init.js`) then decides whether to create the UI inline or in the floating panel, based on saved settings, preventing any visual flicker.
4.  If the UI disappears due to SPA updates, the **self-healing** resiliency engine in `buttons-injection.js` detects the change and triggers a full, idempotent re-initialization.
5.  When the user closes the floating panel, this also triggers the same idempotent re-initialization, reliably moving the buttons back to their inline location.
6.  When the user clicks a custom button:
    - If the floating panel is active and Queue Mode is on, the prompt is added to a queue. The queue sends prompts sequentially with a configurable delay.
    - Otherwise, the appropriate site-specific function is called to insert the text and trigger the send button.

## Additional Notes

- The extension uses a resilient injection mechanism to ensure that the custom buttons remain active even when the target website dynamically updates its content.
- The `InjectionTargetsOnWebsite` class in `utils.js` centralizes the CSS selectors for different websites, making it easier to support new platforms.
- The floating panel provides an alternative UI that can be positioned anywhere on the screen, offering flexibility for different workflows.
- Button configurations are consistently applied between the inline injection and floating panel modes.
- The extension uses debounced saving to prevent excessive storage writes when the user is dragging or resizing the floating panel.
