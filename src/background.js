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
