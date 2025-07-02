chrome.runtime.onInstalled.addListener(() => {
  // Create a context menu item for the extension icon.
  chrome.contextMenus.create({
    id: "open-welcome-page",
    title: "Welcome Page", // The text that appears in the menu
    contexts: ["action"], // Show only when right-clicking the extension's icon
  });
});

// Listen for a click on the context menu item.
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "open-welcome-page") {
    // Open your options page (Welcome.html) in a new tab.
    chrome.tabs.create({ url: "Welcome.html" });
  }
});
