chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'progress') {
    chrome.runtime.sendMessage(msg).catch(() => {});
  }
});
