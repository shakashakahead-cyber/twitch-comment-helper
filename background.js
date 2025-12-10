chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === "TCH_OPEN_OPTIONS") {
    if (chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    }
  }
});