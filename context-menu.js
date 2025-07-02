// This script creates a context menu item for the extension's toolbar icon.

// Create the context menu item when the extension is installed or updated.
// This listener can coexist with other onInstalled listeners.
chrome.runtime.onInstalled.addListener(() => {
    // Use 'chrome.contextMenus.create' to add an item.
    chrome.contextMenus.create({
        id: "open-welcome",
        title: "Open Welcome page",
        contexts: ["action"] // Show this item only when right-clicking the extension's toolbar icon.
    });
});

// Add a listener for when a context menu item is clicked.
chrome.contextMenus.onClicked.addListener((info, tab) => {
    // Check if the clicked menu item's ID is the one we created.
    if (info.menuItemId === "open-welcome") {
        // If it is, create a new tab with the welcome page.
        chrome.tabs.create({
            url: chrome.runtime.getURL('welcome.html')
        });
    }
});