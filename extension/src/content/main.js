(() => {
	'use strict';

	const CC = (globalThis.ClaudeCounter = globalThis.ClaudeCounter || {});
	console.log('[Claude Counter] Content script loading...');
	if (CC.__started) return;
	CC.__started = true;

	function getConversationId() {
		const match = window.location.pathname.match(/\/chat\/([^/?]+)/);
		return match ? match[1] : null;
	}

	function isChatOrNewPage() {
		const path = window.location.pathname;
		// Bug #15 fix: was path.includes('/chat') which matches any URL containing 'chat'.
		// Use strict regex: must be /chat/<id> or exactly /new.
		return /^\/new$|^\/new\/|^\/chat\//.test(path);
	}

	function getOrgIdFromUrl() {
		const pathMatch = window.location.pathname.match(/\/organizations\/([^/]+)/);
		if (pathMatch) return pathMatch[1];
		
		// Fallback: Check for stored orgId (bridge finds it in state)
		return globalThis.CC_LAST_ORG_ID || null;
	}

	function getOrgIdFromCookie() {
		try {
			return document.cookie
				.split('; ')
				.find((row) => row.startsWith('lastActiveOrg='))
				?.split('=')[1] || null;
		} catch {
			return null;
		}
	}

	/**
	 * Wait for an element to appear in the DOM using MutationObserver.
	 * More efficient than polling - reacts immediately when element appears.
	 * @param {string} selector - CSS selector
	 * @param {number} [timeoutMs] - Optional timeout in ms. Returns null if timeout expires.
	 */
	function waitForElement(selector, timeoutMs) {
		return new Promise((resolve) => {
			const existing = document.querySelector(selector);
			if (existing) {
				resolve(existing);
				return;
			}

			let timeoutId;
			let settled = false;
			let bodyWatcher = null;

			const cleanup = () => {
				if (timeoutId) clearTimeout(timeoutId);
				observer.disconnect();
				if (bodyWatcher) {
					bodyWatcher.disconnect();
					bodyWatcher = null;
				}
			};

			const finish = (value) => {
				if (settled) return;
				settled = true;
				cleanup();
				resolve(value);
			};

			const observer = new MutationObserver(() => {
				const el = document.querySelector(selector);
				if (el) {
					finish(el);
				}
			});

			// Guard against document_start: body may not exist yet.
			// Observe documentElement (always present) until body exists, then re-observe body.
			if (!document.body) {
				bodyWatcher = new MutationObserver(() => {
					if (document.body) {
						bodyWatcher.disconnect();
						bodyWatcher = null;
						observer.observe(document.body, { childList: true, subtree: true });
					}
				});
				bodyWatcher.observe(document.documentElement, { childList: true });
			} else {
				observer.observe(document.body, { childList: true, subtree: true });
			}

			if (timeoutMs) {
				timeoutId = setTimeout(() => {
					finish(null);
				}, timeoutMs);
			}
		});
	}

	CC.waitForElement = waitForElement;

	function observeUrlChanges(callback) {
		let lastPath = window.location.pathname;

		const fireIfChanged = () => {
			const current = window.location.pathname;
			if (current !== lastPath) {
				lastPath = current;
				callback();
			}
		};

		// Listen for custom event from bridge (history methods wrapped early)
		window.addEventListener('cc:urlchange', fireIfChanged);
		// Also popstate for back/forward buttons
		window.addEventListener('popstate', fireIfChanged);
		
		// Named handler so it can be removed on cleanup
		function onOrgReady(e) {
			if (e.detail?.orgId && e.detail.orgId !== currentOrgId) {
				console.log('[Claude Counter] OrgId ready event received:', e.detail.orgId);
				updateOrgIdIfNeeded(e.detail.orgId);
				refreshUsage();
			}
		}
		window.addEventListener('cc:org_ready', onOrgReady);

		return () => {
			window.removeEventListener('cc:urlchange', fireIfChanged);
			window.removeEventListener('popstate', fireIfChanged);
			window.removeEventListener('cc:org_ready', onOrgReady);
		};
	}

	function parseUsageFromUsageEndpoint(raw) {
		if (!raw || typeof raw !== 'object') return null;

		const normalizeWindow = (w, hours) => {
			if (!w || typeof w !== 'object') return null;
			if (typeof w.utilization !== 'number' || !Number.isFinite(w.utilization)) return null;
			const utilization = Math.max(0, Math.min(100, w.utilization));
			const resets_at = typeof w.resets_at === 'string' ? w.resets_at : null;
			return { utilization, resets_at, window_hours: hours };
		};

		const fiveHour = normalizeWindow(raw.five_hour, 5);
		const sevenDay = normalizeWindow(raw.seven_day, 24 * 7);

		if (!fiveHour && !sevenDay) return null;
		return { five_hour: fiveHour, seven_day: sevenDay };
	}

	function parseUsageFromMessageLimit(raw) {
		if (!raw?.windows || typeof raw.windows !== 'object') return null;

		const normalizeWindow = (w, hours) => {
			if (!w || typeof w !== 'object') return null;
			if (typeof w.utilization !== 'number' || !Number.isFinite(w.utilization)) return null;
			const utilization = Math.max(0, Math.min(100, w.utilization * 100));
			const resets_at = typeof w.resets_at === 'number' && Number.isFinite(w.resets_at)
				? new Date(w.resets_at * 1000).toISOString()
				: null;
			return { utilization, resets_at, window_hours: hours };
		};

		const fiveHour = normalizeWindow(raw.windows['5h'], 5);
		const sevenDay = normalizeWindow(raw.windows['7d'], 24 * 7);

		if (!fiveHour && !sevenDay) return null;
		return { five_hour: fiveHour, seven_day: sevenDay };
	}

	let currentConversationId = null;
	let currentOrgId = null;

	let usageState = null; // last snapshot
	let usageResetMs = { five_hour: null, seven_day: null }; // cached parsed timestamps
	let lastUsageSseMs = 0;
	let usageFetchInFlight = false;
	let lastUsageUpdateMs = 0;
	let lastUsageAttemptMs = 0;
	const rolloverHandledForResetMs = { five_hour: null, seven_day: null };
	let lastTokenUpdateMs = 0;
	let lastTokenAttemptMs = 0;
	let tickIntervalId = null;

	// Settings state
	let settings = {
		thresholds: [80, 95],
		colors: {},
		showBreakdown: true,
		showLatency: true,
		showBadges: true,
		userHidden: false
	};

	chrome.runtime.onMessage.addListener((message) => {
		if (message.type === 'cc:toggle_visibility') {
			settings.userHidden = !settings.userHidden;
			chrome.storage.local.set({ settings });
			ui.applySettings(settings);
		}
	});

	const ui = new CC.ui.CounterUI({
		onUsageRefresh: async () => {
			await refreshUsage();
		},
		onSettingsChange: async (newSettings) => {
			settings = { ...settings, ...newSettings };
			await chrome.storage.local.set({ settings });
			ui.applySettings(settings);
		},
		onHistoryRequest: async () => {
			const res = await chrome.storage.local.get(['usageHistory']);
			return res.usageHistory || [];
		},
		onDataRequest: async () => {
			const res = await chrome.storage.local.get(['settings', 'usageHistory', 'errorLog']);
			return {
				settings: res.settings || {},
				usageHistory: res.usageHistory || [],
				errorLog: res.errorLog || []
			};
		},
		onImportData: async (payload) => {
			const next = {};
			if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
				throw new Error('Import payload must be a JSON object');
			}
			if (payload && typeof payload.settings === 'object' && !Array.isArray(payload.settings)) {
				next.settings = { ...settings, ...payload.settings };
				settings = next.settings;
			}
			if (payload.settings !== undefined && (typeof payload.settings !== 'object' || Array.isArray(payload.settings))) {
				throw new Error('Invalid settings in import payload');
			}
			if (payload.usageHistory !== undefined && !Array.isArray(payload.usageHistory)) {
				throw new Error('Invalid usageHistory in import payload');
			}
			if (payload.errorLog !== undefined && !Array.isArray(payload.errorLog)) {
				throw new Error('Invalid errorLog in import payload');
			}
			if (Array.isArray(payload?.usageHistory)) next.usageHistory = payload.usageHistory.slice(-3000);
			if (Array.isArray(payload?.errorLog)) next.errorLog = payload.errorLog.slice(-200);
			await chrome.storage.local.set(next);
			ui.applySettings(settings);
			ui.setStatus('usage', usageState ? 'connected' : 'stale', 'Data imported');
		},
		onErrorLogRequest: async () => {
			const res = await chrome.storage.local.get(['errorLog']);
			return res.errorLog || [];
		},
		onClearErrorLog: async () => {
			await chrome.storage.local.set({ errorLog: [] });
		}
	});

	async function loadSettings() {
		const res = await chrome.storage.local.get(['settings']);
		if (res.settings) {
			settings = { ...settings, ...res.settings };
		}
		ui.applySettings(settings);
		ui.showOnboardingIfNeeded(settings);
	}

	ui.initialize();
	loadSettings();

	// Bridge must be ready before we can make requests
	const bridgeReady = CC.injectBridgeOnce();

	async function logLocalError(scope, error, extra = {}) {
		try {
			const entry = {
				ts: Date.now(),
				scope,
				message: error?.message || String(error),
				extra
			};
			const res = await chrome.storage.local.get(['errorLog']);
			const errorLog = Array.isArray(res.errorLog) ? res.errorLog : [];
			errorLog.push(entry);
			await chrome.storage.local.set({ errorLog: errorLog.slice(-200) });
			ui.setStatus(scope === 'tokens' ? 'tokens' : 'usage', 'failed', entry.message);
		} catch {
			// Local diagnostics must never break Claude.
		}
	}



	// Bug #12 fix: serialise history writes to prevent read-modify-write race when
	// two SSE events arrive before the first async write completes.
	let _historyWriteChain = Promise.resolve();

	async function recordUsageHistory(normalized) {
		if (!normalized) return;
		_historyWriteChain = _historyWriteChain
			.catch((error) => {
				console.debug('[Claude Counter] Previous usage history write failed:', error);
			})
			.then(async () => {
				const res = await chrome.storage.local.get(['usageHistory']);
				const history = res.usageHistory || [];
				history.push({
					ts: Date.now(),
					session: normalized.five_hour?.utilization,
					weekly: normalized.seven_day?.utilization
				});
				// Keep last 30 days (roughly 1 snapshot per 15 min * 4 * 24 * 30 = 2880 entries)
				if (history.length > 3000) history.shift();
				await chrome.storage.local.set({ usageHistory: history });
			})
			.catch((error) => {
				console.debug('[Claude Counter] Usage history write failed:', error);
			});
	}

	function applyUsageUpdate(normalized, source) {
		console.debug('[Claude Counter] Usage data received:', normalized, 'from:', source); // Bug #16
		if (!normalized) return;
		const now = Date.now();
		usageState = normalized;
		lastUsageUpdateMs = now;
		if (source === 'sse') lastUsageSseMs = now;
		// Cache parsed timestamps to avoid Date.parse() every tick
		usageResetMs.five_hour = normalized.five_hour?.resets_at ? Date.parse(normalized.five_hour.resets_at) : null;
		usageResetMs.seven_day = normalized.seven_day?.resets_at ? Date.parse(normalized.seven_day.resets_at) : null;
		ui.setUsage(normalized);
		
		recordUsageHistory(normalized);

	}

	function updateOrgIdIfNeeded(newOrgId) {
		if (newOrgId && typeof newOrgId === 'string' && newOrgId !== currentOrgId) {
			currentOrgId = newOrgId;
		}
	}

	async function refreshUsage() {
		await bridgeReady;
		lastUsageAttemptMs = Date.now();
		const orgId = getOrgIdFromUrl() || currentOrgId || getOrgIdFromCookie();
		if (!orgId) {
			ui.setStatus('usage', 'stale', 'Waiting for organization');
			return;
		}
		updateOrgIdIfNeeded(orgId);

		if (usageFetchInFlight) return;
		usageFetchInFlight = true;
		ui.setStatus('usage', 'stale', 'Refreshing usage');
		let raw;
		try {
			raw = await CC.bridge.requestUsage(orgId);
		} catch (error) {
			await logLocalError('usage', error, { orgId });
			return;
		} finally {
			usageFetchInFlight = false;
		}

		const parsed = parseUsageFromUsageEndpoint(raw);
		if (!parsed) ui.setStatus('usage', 'failed', 'Usage response was not recognized');
		applyUsageUpdate(parsed, 'usage');
	}

	async function refreshConversation() {
		await bridgeReady;
		lastTokenAttemptMs = Date.now();
		if (!currentConversationId) {
			ui.setConversationMetrics();
			return;
		}

		const orgId = getOrgIdFromUrl() || currentOrgId || getOrgIdFromCookie();
		if (!orgId) {
			ui.setStatus('tokens', 'stale', 'Waiting for organization');
			return;
		}
		updateOrgIdIfNeeded(orgId);

		try {
			ui.setStatus('tokens', 'stale', 'Refreshing conversation');
			await CC.bridge.requestConversation(orgId, currentConversationId);
		} catch (error) {
			await logLocalError('tokens', error, { orgId, conversationId: currentConversationId });
		}
	}

	let streamTokens = 0;
	let streamStartTime = 0;

	function handleChunk({ text }) {
		if (!streamStartTime) streamStartTime = Date.now();
		const count = CC.tokens.countTokens(text);
		streamTokens += count;
		const elapsed = (Date.now() - streamStartTime) / 1000;
		if (elapsed > 0.2) {
			const tps = streamTokens / elapsed;
			ui.setLatency({ tps });
		}
	}

	function handleGenerationStart({ startTime }) {
		if (!currentConversationId) return;
		streamTokens = 0;
		streamStartTime = 0;
		ui.setPendingCache(true);
		ui.setLatency({ startTime });
	}

	function handleTtft({ ttft }) {
		ui.setLatency({ ttft });
	}

	function handleGenerationEnd({ duration }) {
		ui.setLatency({ duration });
		streamTokens = 0;
		streamStartTime = 0;
	}

	async function handleConversationPayload({ orgId, conversationId, data }) {
		if (!conversationId || conversationId !== currentConversationId) return;
		updateOrgIdIfNeeded(orgId);
		if (!data) return;

		try {
			const metrics = await CC.tokens.computeConversationMetrics(data);
			lastTokenUpdateMs = Date.now();
			ui.setConversationMetrics(metrics);
			ui.setStatus('tokens', 'connected', `${metrics.totalTokens.toLocaleString()} estimated tokens`);
		} catch (error) {
			await logLocalError('tokens', error, { conversationId });
		}
	}

	function handleMessageLimit(messageLimit) {
		const parsed = parseUsageFromMessageLimit(messageLimit);
		applyUsageUpdate(parsed, 'sse');
	}

	CC.bridge.on('cc:generation_start', handleGenerationStart);
	CC.bridge.on('cc:generation_end', handleGenerationEnd);
	CC.bridge.on('cc:ttft', handleTtft);
	CC.bridge.on('cc:chunk', handleChunk);
	CC.bridge.on('cc:conversation', handleConversationPayload);
	CC.bridge.on('cc:message_limit', handleMessageLimit);

	async function handleUrlChange() {
		currentConversationId = getConversationId();

		if (!isChatOrNewPage()) {
			ui.setConversationMetrics();
			// Hide the usage row — it should not be visible outside chat/new pages
			ui.hideUsageLine();
			return;
		}

		// Bug #6 fix: reset stream state on every navigation so stale counters
		// from a previous conversation don't pollute t/s readings on the next one.
		streamTokens = 0;
		streamStartTime = 0;

		// Snapshot whether we are on a chat page NOW so stale async callbacks
		// don't attach the UI after the user has already navigated away (Bug fix: stale attach).
		const navigationPath = window.location.pathname;

		// Attach usage line and header independently
		waitForElement(CC.DOM.MODEL_SELECTOR_DROPDOWN, 60000).then((el) => {
			if (window.location.pathname !== navigationPath) return; // navigated away
			if (el) {
				console.log('[Claude Counter] Found model selector, attaching usage line');
				ui.attachUsageLine();
			} else {
				console.log('[Claude Counter] Model selector not found after 60s (expected on non-chat pages)');
			}
		});
		waitForElement(CC.DOM.CHAT_MENU_TRIGGER, 60000).then((el) => {
			if (window.location.pathname !== navigationPath) return; // navigated away
			if (el) {
				console.log('[Claude Counter] Found chat menu, attaching header');
				ui.attachHeader();
			} else {
				console.log('[Claude Counter] Chat menu not found after 60s (expected on non-chat pages)');
			}
		});

		if (!currentConversationId) {
			ui.setConversationMetrics();
			// On homepage, still try to fetch usage for the org
			if (!usageState) refreshUsage();
			return;
		}

		// Best-effort orgId from cookie/url.
		updateOrgIdIfNeeded(getOrgIdFromUrl() || getOrgIdFromCookie());

		await refreshConversation();

		// Usage is org-level, not conversation-level.
		if (!usageState) await refreshUsage();
	}

	const unobserveUrl = observeUrlChanges(handleUrlChange);
	let pageActive = true;
	window.addEventListener('beforeunload', unobserveUrl);
	window.addEventListener('pagehide', () => {
		pageActive = false;
		unobserveUrl();
		if (tickIntervalId) {
			clearInterval(tickIntervalId);
			tickIntervalId = null;
		}
	});
	window.addEventListener('pageshow', () => {
		if (pageActive) return;
		pageActive = true;
		if (!tickIntervalId) tickIntervalId = setInterval(tick, 1000);
		handleUrlChange();
	});

	// Refresh on branch navigation
	let branchObserver = null;
	document.addEventListener('click', (e) => {
		if (!currentConversationId) return;
		const btn = e.target.closest('button[aria-label="Previous"], button[aria-label="Next"]');
		if (!btn) return;

		const container = btn.closest('.inline-flex');
		const spans = container?.querySelectorAll('span') || [];
		const indicator = Array.from(spans).find((s) => /^\d+\s*\/\s*\d+$/.test(s.textContent.trim()));
		if (!indicator) return;

		const originalText = indicator.textContent;
		if (branchObserver) branchObserver.disconnect();

		branchObserver = new MutationObserver(() => {
			if (indicator.textContent !== originalText) {
				branchObserver.disconnect();
				branchObserver = null;
				refreshConversation();
			}
		});

		branchObserver.observe(indicator, { childList: true, characterData: true, subtree: true });

		setTimeout(() => {
			if (branchObserver) {
				branchObserver.disconnect();
				branchObserver = null;
			}
		}, 60000);
	});

	// Initial attach + fetches
	handleUrlChange();

	function tick() {
		ui.tick();

		const now = Date.now();
		// Bug #5 fix: don't fire background API calls when the tab is hidden
		if (!document.hidden) {
			if (usageResetMs.five_hour && now >= usageResetMs.five_hour && rolloverHandledForResetMs.five_hour !== usageResetMs.five_hour) {
				rolloverHandledForResetMs.five_hour = usageResetMs.five_hour;
				refreshUsage();
			}
			if (usageResetMs.seven_day && now >= usageResetMs.seven_day && rolloverHandledForResetMs.seven_day !== usageResetMs.seven_day) {
				rolloverHandledForResetMs.seven_day = usageResetMs.seven_day;
				refreshUsage();
			}
		}

		const ONE_HOUR_MS = 60 * 60 * 1000;
		const sseAge = now - lastUsageSseMs;
		const anyAge = now - lastUsageUpdateMs;
		if (!document.hidden && sseAge > ONE_HOUR_MS && anyAge > ONE_HOUR_MS) {
			refreshUsage();
		}

		if (usageState && now - lastUsageUpdateMs > 10 * 60 * 1000) {
			ui.setStatus('usage', 'stale', 'Usage data is older than 10 minutes');
		}
		if (currentConversationId && lastTokenUpdateMs && now - lastTokenUpdateMs > 10 * 60 * 1000) {
			ui.setStatus('tokens', 'stale', 'Token data is older than 10 minutes');
		}
		if (lastUsageAttemptMs && !lastUsageUpdateMs && now - lastUsageAttemptMs > 60 * 1000) {
			ui.setStatus('usage', 'stale', 'Usage connection pending');
		}
		if (lastTokenAttemptMs && !lastTokenUpdateMs && now - lastTokenAttemptMs > 60 * 1000) {
			ui.setStatus('tokens', 'stale', 'Token connection pending');
		}
	}

	tickIntervalId = setInterval(tick, 1000);
})();
