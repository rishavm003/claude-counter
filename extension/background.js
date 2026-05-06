chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
	if (message.type === 'cc:notify') {
		chrome.notifications.create({
			type: 'basic',
			iconUrl: 'icons/icon128.png',
			title: message.title,
			message: message.message,
			priority: 2
		});
	}
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
