// Bug #17 fix: removed empty chrome.runtime.onMessage listener that consumed
// messages without responding, potentially blocking sendMessage callers in MV3.

chrome.commands.onCommand.addListener((command) => {
	if (command === 'toggle-overlay') {
		chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
			if (tabs[0]?.id) {
				chrome.tabs.sendMessage(tabs[0].id, { type: 'cc:toggle_visibility' });
			}
		});
	}
});
