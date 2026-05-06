(() => {
	'use strict';

	const CC = (globalThis.ClaudeCounter = globalThis.ClaudeCounter || {});

	CC.DOM = Object.freeze({
		CHAT_MENU_TRIGGER: '[data-testid="chat-menu-trigger"], button[aria-label*="settings" i], button[aria-label*="menu" i]',
		MODEL_SELECTOR_DROPDOWN: '[data-testid="model-selector-dropdown"], button[aria-haspopup="listbox"]:has(svg), button[aria-haspopup="menu"]:has(svg)',
		CHAT_PROJECT_WRAPPER: '.chat-project-wrapper',
		BRIDGE_SCRIPT_ID: 'cc-bridge-script'
	});

	CC.CONST = Object.freeze({
		CACHE_WINDOW_MS: 5 * 60 * 1000,
		DEFAULT_CONTEXT_LIMIT: 200000,
		MODEL_CONTEXT_MAP: {
			'Sonnet 4.6': 200000,
			'Claude 3.5 Sonnet': 200000,
			'Sonnet 3.5': 200000,
			'Claude 3.5 Haiku': 200000,
			'Claude 3 Opus': 200000,
			'Claude 3 Sonnet': 200000,
			'Claude 3 Haiku': 200000,
			'Claude 2.1': 200000,
			'Claude 2.0': 100000
		}
	});

	CC.COLORS = Object.freeze({
		PROGRESS_FILL_DARK: 'linear-gradient(90deg, #3b82f6 0%, #2563eb 100%)',
		PROGRESS_FILL_LIGHT: 'linear-gradient(90deg, #60a5fa 0%, #3b82f6 100%)',
		PROGRESS_OUTLINE_DARK: 'rgba(255,255,255,0.15)',
		PROGRESS_OUTLINE_LIGHT: 'rgba(0,0,0,0.1)',
		PROGRESS_MARKER_DARK: '#fff',
		PROGRESS_MARKER_LIGHT: '#000',
		RED_WARNING: 'linear-gradient(90deg, #ef4444 0%, #dc2626 100%)',
		BOLD_LIGHT: '#141413',
		BOLD_DARK: '#faf9f5'
	});
})();
