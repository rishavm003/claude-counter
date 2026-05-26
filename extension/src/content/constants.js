(() => {
	'use strict';

	const CC = (globalThis.ClaudeCounter = globalThis.ClaudeCounter || {});

	CC.DOM = Object.freeze({
		CHAT_MENU_TRIGGER: '[data-testid="chat-menu-trigger"], button[aria-label*="settings" i], button[aria-label*="menu" i]',
		// Avoid :has() selectors — not reliably supported in querySelector on Firefox < 121.
		// Use data-testid first; fall back to aria attributes without :has().
		MODEL_SELECTOR_DROPDOWN: '[data-testid="model-selector-dropdown"], button[aria-haspopup="listbox"], button[aria-haspopup="menu"]',
		CHAT_PROJECT_WRAPPER: '.chat-project-wrapper',
		BRIDGE_SCRIPT_ID: 'cc-bridge-script'
	});

	CC.CONST = Object.freeze({
		CACHE_WINDOW_MS: 5 * 60 * 1000,
		DEFAULT_CONTEXT_LIMIT: 200000,
		MODEL_CONTEXT_MAP: {
			'Sonnet 4.6': 200000,
			'Claude 3.5 Sonnet': 200000,
			'Claude 3.5 Haiku': 200000,
			'Claude 3 Opus': 200000,
			'Claude 3 Sonnet': 200000,
			'Claude 3 Haiku': 200000
		},
		MODEL_PRICE_MAP: {
			'Opus': { input: 15, output: 75 },
			'Sonnet': { input: 3, output: 15 },
			'Haiku': { input: 0.25, output: 1.25 },
			'Default': { input: 3, output: 15 }
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

	CC.THEMES = Object.freeze({
		default: {
			dark: 'linear-gradient(90deg, #3b82f6 0%, #2563eb 100%)',
			light: 'linear-gradient(90deg, #60a5fa 0%, #3b82f6 100%)'
		},
		sunset: {
			dark: 'linear-gradient(90deg, #f97316 0%, #ef4444 100%)',
			light: 'linear-gradient(90deg, #fb923c 0%, #f97316 100%)'
		},
		emerald: {
			dark: 'linear-gradient(90deg, #10b981 0%, #059669 100%)',
			light: 'linear-gradient(90deg, #34d399 0%, #10b981 100%)'
		},
		cyberpunk: {
			dark: 'linear-gradient(90deg, #a855f7 0%, #ec4899 100%)',
			light: 'linear-gradient(90deg, #c084fc 0%, #f472b6 100%)'
		}
	});
})();
