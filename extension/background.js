chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
	// Handlers for messages
});

chrome.commands.onCommand.addListener((command) => {
	if (command === 'toggle-overlay') {
		chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
			if (tabs[0]?.id) {
				chrome.tabs.sendMessage(tabs[0].id, { type: 'cc:toggle_visibility' });
			}
		});
	}
});
