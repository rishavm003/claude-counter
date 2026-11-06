(() => {
	'use strict';

	const CC = (globalThis.ClaudeCounter = globalThis.ClaudeCounter || {});
	if (CC.__started) return;
	CC.__started = true;

	function getConversationId() {
		const match = window.location.pathname.match(/\/chat\/([^/?]+)/);
		return match ? match[1] : null;
	}

	function isChatOrNewPage() {
		const path = window.location.pathname;
		return /^\/$|^\/new$|^\/new\/|^\/chat\/|^\/project\//.test(path);
	}

	function getOrgIdFromUrl() {
		const pathMatch = window.location.pathname.match(/\/organizations\/([^/]+)/);
		if (pathMatch) return pathMatch[1];
		
		return null;
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
				bodyWatcher.observe(document, { childList: true, subtree: true });
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
		
		const offOrgReady = CC.bridge.on('cc:org_ready', (payload) => {
			if (payload?.orgId && payload.orgId !== currentOrgId) {
				updateOrgIdIfNeeded(payload.orgId);
				refreshUsage();
			}
		});

		return () => {
			window.removeEventListener('cc:urlchange', fireIfChanged);
			window.removeEventListener('popstate', fireIfChanged);
			offOrgReady();
		};
	}

	/**
	 * Parse claude.ai's /api/organizations/{org}/usage response.
	 * NOTE: `utilization` / `percent` there are already 0–100 percentages (e.g. 1 means 1%).
	 * The old code multiplied any value <= 1 by 100, which displayed 1% usage as 100%.
	 */
	function parseUsage(raw) {
		if (!raw || typeof raw !== 'object') return null;

		const toIso = (rawReset) => {
			if (typeof rawReset === 'string') return rawReset;
			if (typeof rawReset === 'number' && Number.isFinite(rawReset)) {
				return new Date(rawReset < 1e11 ? rawReset * 1000 : rawReset).toISOString();
			}
			return null;
		};
		const clampPct = (v) => Math.max(0, Math.min(100, v));

		const extractWindow = (w, hours) => {
			if (!w || typeof w !== 'object') return null;
			let util = w.utilization ?? w.percent ?? w.used_percentage ?? w.percentage;
			if (util == null && typeof w.used === 'number' && typeof w.limit === 'number' && w.limit > 0) {
				util = (w.used / w.limit) * 100;
			}
			if (util == null && typeof w.remaining === 'number' && typeof w.limit === 'number' && w.limit > 0) {
				util = ((w.limit - w.remaining) / w.limit) * 100;
			}
			if (typeof util !== 'number' || !Number.isFinite(util)) return null;
			return {
				utilization: clampPct(util),
				resets_at: toIso(w.resets_at ?? w.reset_at ?? w.resetsAt ?? w.resetAt ?? null),
				window_hours: hours,
				severity: w.severity || null
			};
		};

		// Newer responses carry a normalized `limits` array — prefer it when present.
		const limits = Array.isArray(raw.limits) ? raw.limits : [];
		const findLimit = (pred) => limits.find((l) => l && pred(l));
		let fiveHour = extractWindow(findLimit((l) => l.kind === 'session' || l.group === 'session'), 5);
		let sevenDay = extractWindow(findLimit((l) => l.kind === 'weekly_all'), 24 * 7);

		const windowsObj = raw.windows || raw;
		if (!fiveHour) {
			fiveHour = extractWindow(
				raw.five_hour || raw.five_hour_window || windowsObj['5h'] || windowsObj['5-hour'] || raw.session,
				5
			);
		}
		if (!sevenDay) {
			sevenDay = extractWindow(
				raw.seven_day || raw.seven_day_window || windowsObj['7d'] || windowsObj['7-day'] || raw.weekly,
				24 * 7
			);
		}

		// Extra weekly caps (Max plans: per-model weekly limits). Pro usually has none.
		const extraWeekly = [];
		const seen = new Set();
		for (const l of limits) {
			if (!l || l.group !== 'weekly' || l.kind === 'weekly_all') continue;
			const w = extractWindow(l, 24 * 7);
			if (!w) continue;
			const label = String(l.kind || 'weekly').replace(/^weekly_/, '').replace(/_/g, ' ');
			seen.add(label.toLowerCase());
			extraWeekly.push({ label, ...w });
		}
		for (const [key, label] of [['seven_day_opus', 'opus'], ['seven_day_sonnet', 'sonnet']]) {
			if (seen.has(label)) continue;
			const w = extractWindow(raw[key], 24 * 7);
			if (w) extraWeekly.push({ label, ...w });
		}

		// Paid "extra usage" credits (Pro/Max), only when the user enabled it.
		let extraUsage = null;
		const eu = raw.extra_usage;
		if (eu && eu.is_enabled) {
			const dp = Number.isFinite(eu.decimal_places) ? eu.decimal_places : 2;
			const scale = Math.pow(10, dp);
			extraUsage = {
				used: typeof eu.used_credits === 'number' ? eu.used_credits / scale : null,
				limit: typeof eu.monthly_limit === 'number' ? eu.monthly_limit / scale : null,
				utilization: typeof eu.utilization === 'number' ? clampPct(eu.utilization) : null,
				currency: eu.currency || 'USD',
				spendLimitReached: !!eu.spend_limit_reached
			};
		}

		// Which product used this week's quota (Chats / Claude Code / Cowork ...).
		const breakdownRows = Array.isArray(raw.seven_day_breakdown?.rows)
			? raw.seven_day_breakdown.rows
				.filter((r) => typeof r?.percent === 'number')
				.map((r) => ({ name: r.display_name || r.key, percent: r.percent }))
			: [];

		if (!fiveHour && !sevenDay) return null;
		return {
			five_hour: fiveHour,
			seven_day: sevenDay,
			extra_weekly: extraWeekly,
			extra_usage: extraUsage,
			weekly_breakdown: breakdownRows,
			plan: raw._plan || null
		};
	}

	function detectUsageFromDomBanner() {
		try {
			const bodyText = document.body?.innerText || '';
			const match = bodyText.match(/(?:out of (?:free )?messages|out of usage|limit reached|reached your (?:\w+ )?limit)[^\n]{0,40}?(?:until|resets?(?: at)?)\s*([0-9]{1,2}(?::[0-9]{2})?\s*(?:AM|PM)?)/i);
			if (match) {
				const timeStr = match[1].trim();
				let resetMs = null;
				const parts = timeStr.match(/^([0-9]{1,2})(?::([0-9]{2}))?\s*(AM|PM)?$/i);
				if (parts) {
					let hrs = parseInt(parts[1], 10);
					const mins = parts[2] ? parseInt(parts[2], 10) : 0;
					const ampm = parts[3]?.toUpperCase();
					if (ampm === 'PM' && hrs < 12) hrs += 12;
					if (ampm === 'AM' && hrs === 12) hrs = 0;
					const d = new Date();
					d.setHours(hrs, mins, 0, 0);
					if (d.getTime() <= Date.now()) {
						d.setDate(d.getDate() + 1);
					}
					resetMs = d.getTime();
				}
				return {
					five_hour: {
						utilization: 100.0,
						resets_at: resetMs ? new Date(resetMs).toISOString() : null,
						window_hours: 5
					},
					seven_day: null
				};
			}
		} catch {
			// ignore
		}
		return null;
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

	// Settings live in storage.sync so they follow the browser account to every PC
	// (falls back to local storage when sync is unavailable or turned off).
	async function readSettings() {
		try {
			const synced = await chrome.storage.sync.get(['settings']);
			if (synced?.settings) return synced.settings;
		} catch {
			// sync unavailable
		}
		const local = await chrome.storage.local.get(['settings']);
		if (local.settings) {
			try {
				await chrome.storage.sync.set({ settings: local.settings }); // one-time move to sync
			} catch {
				// keep local copy
			}
		}
		return local.settings;
	}

	async function writeSettings(value) {
		try {
			await chrome.storage.sync.set({ settings: value });
		} catch {
			await chrome.storage.local.set({ settings: value });
		}
	}

	// A change made in another tab, or on another PC through sync, applies here immediately.
	chrome.storage.onChanged?.addListener((changes) => {
		const next = changes.settings?.newValue;
		if (!next || typeof next !== 'object') return;
		settings = { ...settings, ...next };
		ui.applySettings(settings);
	});

	chrome.runtime.onMessage.addListener((message) => {
		if (message.type === 'cc:toggle_visibility') {
			settings.userHidden = !settings.userHidden;
			writeSettings(settings);
			ui.applySettings(settings);
		}
	});

	const ui = new CC.ui.CounterUI({
		onUsageRefresh: async () => {
			await Promise.allSettled([
				refreshUsage(),
				refreshConversation()
			]);
		},
		onSettingsChange: async (newSettings) => {
			settings = { ...settings, ...newSettings };
			await writeSettings(settings);
			ui.applySettings(settings);
		},
		onHistoryRequest: async () => {
			const res = await chrome.storage.local.get(['usageHistory']);
			return res.usageHistory || [];
		},
		onDataRequest: async () => {
			const res = await chrome.storage.local.get(['usageHistory', 'errorLog']);
			return {
				settings: (await readSettings()) || {},
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
			if (next.settings) {
				await writeSettings(next.settings);
				delete next.settings;
			}
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
		const saved = await readSettings();
		if (saved) {
			settings = { ...settings, ...saved };
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



	// serialise history writes to prevent read-modify-write race when
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
		if (!normalized) return;
		const now = Date.now();
		usageState = normalized;
		lastUsageUpdateMs = now;
		if (source === 'sse') lastUsageSseMs = now;
		// Cache parsed timestamps to avoid Date.parse() every tick
		usageResetMs.five_hour = normalized.five_hour?.resets_at ? Date.parse(normalized.five_hour.resets_at) : null;
		usageResetMs.seven_day = normalized.seven_day?.resets_at ? Date.parse(normalized.seven_day.resets_at) : null;
		ui.setUsage(normalized);
		ui.setStatus('usage', 'connected', 'Usage updated');
		
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
		// Cookie (lastActiveOrg) is the org claude.ai is actually using — prefer it.
		const orgId = getOrgIdFromUrl() || getOrgIdFromCookie() || currentOrgId;

		if (usageFetchInFlight) return;
		usageFetchInFlight = true;
		ui.setStatus('usage', 'stale', 'Refreshing usage');
		let raw;
		try {
			raw = await CC.bridge.requestUsage(orgId);
		} catch (error) {
			ui.setStatus('usage', 'failed', error?.message || 'Usage request failed');
			await logLocalError('usage', error, { orgId });
			return;
		} finally {
			usageFetchInFlight = false;
		}

		if (raw && raw._orgId) {
			updateOrgIdIfNeeded(raw._orgId);
		}
		if (raw && raw._plan) {
			ui.setPlan(raw._plan);
		}

		let parsed = parseUsage(raw);
		if (!parsed) {
			parsed = detectUsageFromDomBanner();
		}

		if (!parsed) {
			ui.setStatus('usage', 'failed', 'Usage response was not recognized');
			return;
		}
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
	let lastTpsPaintMs = 0;

	function handleChunk({ text }) {
		const now = Date.now();
		if (!streamStartTime) streamStartTime = now;
		streamTokens += CC.tokens.countTokens(text);
		const elapsed = (now - streamStartTime) / 1000;
		if (elapsed > 0.2 && now - lastTpsPaintMs >= 250) {
			lastTpsPaintMs = now;
			ui.setLatency({ tps: streamTokens / elapsed });
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
		handleMessageLimit();
		// keep the token count current after a reply, without a second download if the page refreshed it
		refreshConversationIfUnseen(1500);
		streamTokens = 0;
		streamStartTime = 0;
	}

	let lastConversationSeen = { id: null, ms: 0 };

	/**
	 * claude.ai fetches the conversation itself and the bridge already captures that copy,
	 * so wait briefly and only download it ourselves if the page didn't.
	 */
	async function refreshConversationIfUnseen(delayMs) {
		const since = Date.now();
		const id = currentConversationId;
		await new Promise((r) => setTimeout(r, delayMs));
		if (!id || id !== currentConversationId) return;
		if (lastConversationSeen.id === id && lastConversationSeen.ms >= since) return;
		await refreshConversation();
	}

	async function handleConversationPayload({ orgId, conversationId, data }) {
		if (!conversationId || conversationId !== currentConversationId) return;
		lastConversationSeen = { id: conversationId, ms: Date.now() };
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

	let sseRefreshTimer = null;
	function handleMessageLimit() {
		lastUsageSseMs = Date.now();
		if (sseRefreshTimer) clearTimeout(sseRefreshTimer);
		sseRefreshTimer = setTimeout(() => {
			sseRefreshTimer = null;
			refreshUsage();
		}, 1500);
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

		// reset stream state on every navigation so stale counters
		// from a previous conversation don't pollute t/s readings on the next one.
		streamTokens = 0;
		streamStartTime = 0;

		// Snapshot whether we are on a chat page NOW so stale async callbacks
		// don't attach the UI after the user has already navigated away (stale attach).
		const navigationPath = window.location.pathname;

		// Attach usage line and header independently
		waitForElement(CC.DOM.MODEL_SELECTOR_DROPDOWN, 60000).then((el) => {
			if (window.location.pathname !== navigationPath) return; // navigated away
			if (el) {
				ui.attachUsageLine();
			}
		});
		waitForElement(CC.DOM.CHAT_MENU_TRIGGER, 60000).then((el) => {
			if (window.location.pathname !== navigationPath) return; // navigated away
			if (el) {
				ui.attachHeader();
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

		await refreshConversationIfUnseen(1200);

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
		if (document.hidden) return; // background tab: nothing to paint, no requests
		ui.tick();

		const now = Date.now();
		// don't fire background API calls when the tab is hidden
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
