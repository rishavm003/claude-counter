// ==UserScript==
// @name         Claude Counter
// @namespace    https://github.com/rishavm003/claude-counter
// @version      0.1.4
// @description  Shows token count, cache timer, and usage bars on claude.ai
// @author       rishavm003
// @match        https://claude.ai/*
// @grant        none
// @run-at       document-start
// ==/UserScript==
(function() {
    'use strict';
    
    // Chrome Extension API shim for Userscript context
    if (typeof chrome === 'undefined' || !chrome.storage) {
        globalThis.chrome = globalThis.chrome || {};
        globalThis.chrome.storage = {
            local: {
                get: function(keys) {
                    return new Promise(function(resolve) {
                        var res = {};
                        var keyList = Array.isArray(keys) ? keys : [keys];
                        keyList.forEach(function(key) {
                            var val = localStorage.getItem('cc_' + key);
                            res[key] = val ? JSON.parse(val) : undefined;
                        });
                        resolve(res);
                    });
                },
                set: function(obj) {
                    return new Promise(function(resolve) {
                        for (var key in obj) {
                            if (obj.hasOwnProperty(key)) {
                                localStorage.setItem('cc_' + key, JSON.stringify(obj[key]));
                            }
                        }
                        resolve();
                    });
                }
            }
        };
        globalThis.chrome.runtime = {
            onMessage: { addListener: function() {} },
            sendMessage: function() {},
            // Return empty string â€” bridge is already inlined, never fetch a file.
            getURL: function(path) { return ''; }
        };
    }

    // In userscript mode, bridge.js is concatenated inline above, so it is
    // already running. Mark its sentinel element so injectBridgeOnce() detects
    // it as already loaded and skips the <script src="..."> injection.
    (function markBridgeInjected() {
        var id = (globalThis.ClaudeCounter && globalThis.ClaudeCounter.DOM && globalThis.ClaudeCounter.DOM.BRIDGE_SCRIPT_ID) || 'cc-bridge-script';
        if (!document.getElementById(id)) {
            var sentinel = document.createElement('meta');
            sentinel.id = id;
            (document.head || document.documentElement).appendChild(sentinel);
        }
    })();
    // Inject CSS
    (function() {
        var style = document.createElement('style');
        style.textContent = $CssContent;
        (document.head || document.documentElement).appendChild(style);
    })();(() => {
	'use strict';

	const CC = (globalThis.ClaudeCounter = globalThis.ClaudeCounter || {});

	CC.DOM = Object.freeze({
		CHAT_MENU_TRIGGER: '[data-testid="chat-menu-trigger"], button[aria-label*="settings" i], button[aria-label*="menu" i]',
		// Avoid :has() selectors â€” not reliably supported in querySelector on Firefox < 121.
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

(() => {
	'use strict';

	const CC_MARKER = 'ClaudeCounter';

	// Capture original fetch before anyone else can wrap it
	const originalFetch = window.fetch;

	// Wrap history methods early to detect SPA navigation (before frameworks cache them)
	const originalPushState = history.pushState.bind(history);
	const originalReplaceState = history.replaceState.bind(history);

	history.pushState = function (...args) {
		const result = originalPushState(...args);
		window.dispatchEvent(new CustomEvent('cc:urlchange'));
		return result;
	};

	history.replaceState = function (...args) {
		const result = originalReplaceState(...args);
		window.dispatchEvent(new CustomEvent('cc:urlchange'));
		return result;
	};

	let generationStartTime = 0;
	let ttftEmitted = false;

	window.fetch = async (...args) => {
		const url = toAbsoluteUrl(args[0]);
		const opts = args[1] || {};

		// Detect generation start (completion requests and message appends)
		const isCompletion = url.includes('/completion') || url.includes('/retry_completion') || url.includes('/append_message');
		if (url && opts.method === 'POST' && isCompletion) {
			generationStartTime = Date.now();
			ttftEmitted = false;
			post('cc:generation_start', { startTime: generationStartTime });
		}

		const response = await originalFetch.apply(window, args);

		const contentType = response.headers.get('content-type') || '';
		if (contentType.includes('event-stream')) {
			handleEventStream(response);
		}

		// Catch conversation tree fetches
		if (url && url.includes('/chat_conversations/') && url.includes('tree=')) {
			const meta = getConversationMeta(url);
			if (meta) {
				handleConversationResponse(meta, response);
			}
		}

		return response;
	};

	function post(type, payload) {
		window.postMessage({ cc: CC_MARKER, type, payload }, '*');
	}

	function postResponse(requestId, ok, payload, error) {
		window.postMessage(
			{
				cc: CC_MARKER,
				type: 'cc:response',
				requestId,
				ok,
				payload,
				error
			},
			'*'
		);
	}

	function toAbsoluteUrl(input) {
		if (typeof input === 'string') {
			if (input.startsWith('/')) return `https://claude.ai${input}`;
			return input;
		}
		if (input instanceof URL) return input.href;
		if (input instanceof Request) return input.url;
		return '';
	}

	function getConversationMeta(url) {
		// /api/organizations/{orgId}/chat_conversations/{conversationId}
		const match = url.match(/^https:\/\/claude\.ai\/api\/organizations\/([^/]+)\/chat_conversations\/([^/?]+)/);
		return match ? { orgId: match[1], conversationId: match[2] } : null;
	}

	async function handleConversationResponse({ orgId, conversationId }, response) {
		try {
			const cloned = response.clone();
			const data = await cloned.json();
			post('cc:conversation', { orgId, conversationId, data });
		} catch {
			// ignore parse failures
		}
	}

	async function handleEventStream(response) {
		try {
			const cloned = response.clone();
			const reader = cloned.body?.getReader?.();
			if (!reader) return;
			const decoder = new TextDecoder();
			let buffer = '';

			while (true) {
				const { done, value } = await reader.read();
				if (done) {
					if (generationStartTime) {
						post('cc:generation_end', { duration: Date.now() - generationStartTime });
						generationStartTime = 0;
					}
					break;
				}

				if (!ttftEmitted && generationStartTime) {
					const now = Date.now();
					post('cc:ttft', { ttft: now - generationStartTime });
					ttftEmitted = true;
				}

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split(/\r\n|\r|\n/);
				buffer = lines.pop() || '';
				for (const line of lines) {
					if (!line.startsWith('data:')) continue;
					const raw = line.slice(5).trim();
					if (!raw) continue;
					try {
						const json = JSON.parse(raw);
						if (json?.type === 'content_block_delta' && json.delta?.text) {
							post('cc:chunk', { text: json.delta.text });
						}
						if (json?.type === 'message_limit' && json.message_limit) {
							post('cc:message_limit', json.message_limit);
						}
					} catch {
						// ignore
					}
				}
			}
		} catch {
			// best-effort; don't break claude.ai
		}
	}

	console.log('[Claude Counter] Bridge script injected and running');
	// Try to find orgId immediately on load
	async function discoverOrgId() {
		try {
			// 1. Try __NEXT_DATA__
			const nextData = document.getElementById('__NEXT_DATA__');
			if (nextData) {
				const json = JSON.parse(nextData.textContent);
				const orgId = json?.props?.pageProps?.organizationId || 
							  json?.query?.orgId || 
							  json?.props?.pageProps?.account?.id;
				if (orgId) {
					window.CC_LAST_ORG_ID = orgId;
					console.log('[Claude Counter] Detected OrgId from state:', orgId);
					return orgId;
				}
			}

			// 2. Try API fallback
			console.log('[Claude Counter] OrgId not in state, fetching via API...');
			const res = await originalFetch('https://claude.ai/api/organizations', { credentials: 'include' });
			// Bug #7 fix: check HTTP status before parsing JSON
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const orgs = await res.json();
			if (Array.isArray(orgs) && orgs.length > 0) {
				const orgId = orgs[0].uuid || orgs[0].id;
				window.CC_LAST_ORG_ID = orgId;
				console.log('[Claude Counter] Found OrgId via API:', orgId);
				return orgId;
			}
		} catch (e) {
			console.log('[Claude Counter] OrgId discovery failed:', e);
		}
		return null;
	}

	discoverOrgId().then(id => {
		if (id) window.dispatchEvent(new CustomEvent('cc:org_ready', { detail: { orgId: id } }));
	});

	window.addEventListener('message', async (event) => {
		if (event.source !== window) return;
		const data = event.data;
		if (!data || data.cc !== CC_MARKER) return;
		if (data.type !== 'cc:request') return;

		const { requestId, kind, payload } = data;
		try {
			if (kind === 'hash') {
				const text = typeof payload?.text === 'string' ? payload.text : '';
				if (!text || !crypto?.subtle?.digest) {
					postResponse(requestId, false, null, 'Hash unavailable');
					return;
				}
				const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
				const bytes = new Uint8Array(buffer);
				const hash = Array.from(bytes.slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('');
				postResponse(requestId, true, { hash }, null);
				return;
			}

			if (kind === 'usage') {
				const orgId = payload?.orgId;
				if (!orgId) throw new Error('Missing orgId');
				const res = await originalFetch(`https://claude.ai/api/organizations/${orgId}/usage`, {
					method: 'GET',
					credentials: 'include'
				});
				// Bug #7 fix: check HTTP status before parsing JSON
				if (!res.ok) throw new Error(`HTTP ${res.status} fetching usage`);
				const json = await res.json();
				postResponse(requestId, true, json, null);
				return;
			}

			if (kind === 'conversation') {
				const orgId = payload?.orgId;
				const conversationId = payload?.conversationId;
				if (!orgId || !conversationId) throw new Error('Missing orgId/conversationId');

				const url = `https://claude.ai/api/organizations/${orgId}/chat_conversations/${conversationId}?tree=true&rendering_mode=messages&render_all_tools=true`;
				const res = await originalFetch(url, {
					method: 'GET',
					credentials: 'include'
				});
				// Bug #7 fix: check HTTP status before parsing JSON
				if (!res.ok) throw new Error(`HTTP ${res.status} fetching conversation`);
				const json = await res.json();
				post('cc:conversation', { orgId, conversationId, data: json });
				postResponse(requestId, true, json, null);
				return;
			}

			throw new Error(`Unknown request kind: ${kind}`);
		} catch (e) {
			postResponse(requestId, false, null, e?.message || String(e));
		}
	});
})();

(() => {
	'use strict';

	const CC = (globalThis.ClaudeCounter = globalThis.ClaudeCounter || {});

	function getRuntime() {
		return globalThis.browser?.runtime || globalThis.chrome?.runtime || null;
	}

	function makeRequestId() {
		return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
	}

	class BridgeClient {
		constructor() {
			this._pending = new Map();
			this._listeners = new Map();

			window.addEventListener('message', (event) => {
				if (event.source !== window) return;
				const data = event.data;
				if (!data || data.cc !== 'ClaudeCounter') return;

				if (data.type === 'cc:response') {
					const { requestId, ok, payload, error } = data;
					const pending = this._pending.get(requestId);
					if (!pending) return;
					this._pending.delete(requestId);
					clearTimeout(pending.timeoutId);
					if (ok) pending.resolve(payload);
					else pending.reject(new Error(error || 'Bridge request failed'));
					return;
				}

				// Events
				this._emit(data.type, data.payload);
			});
		}

		_emit(type, payload) {
			const listeners = this._listeners.get(type);
			if (!listeners) return;
			for (const fn of listeners) {
				fn(payload);
			}
		}

		on(type, fn) {
			if (!this._listeners.has(type)) this._listeners.set(type, new Set());
			this._listeners.get(type).add(fn);
			return () => this._listeners.get(type)?.delete(fn);
		}

		request(kind, payload, { timeoutMs = 10000 } = {}) {
			const requestId = makeRequestId();
			return new Promise((resolve, reject) => {
				const timeoutId = setTimeout(() => {
					this._pending.delete(requestId);
					reject(new Error(`Bridge request timed out (${kind})`));
				}, timeoutMs);

				this._pending.set(requestId, { resolve, reject, timeoutId });
				window.postMessage(
					{
						cc: 'ClaudeCounter',
						type: 'cc:request',
						requestId,
						kind,
						payload
					},
					'*'
				);
			});
		}

		async requestUsage(orgId) {
			return this.request('usage', { orgId }, { timeoutMs: 15000 });
		}

		async requestConversation(orgId, conversationId) {
			return this.request('conversation', { orgId, conversationId }, { timeoutMs: 20000 });
		}

		async requestHash(text) {
			return this.request('hash', { text }, { timeoutMs: 5000 });
		}
	}

	let bridgeReadyPromise = null;

	function injectBridgeOnce() {
		if (bridgeReadyPromise) return bridgeReadyPromise;

		const runtime = getRuntime();
		if (!runtime) return Promise.resolve(false);

		if (document.getElementById(CC.DOM.BRIDGE_SCRIPT_ID)) {
			return Promise.resolve(true);
		}

		bridgeReadyPromise = new Promise((resolve) => {
			const script = document.createElement('script');
			script.id = CC.DOM.BRIDGE_SCRIPT_ID;
			script.src = runtime.getURL('src/injected/bridge.js');
			script.onload = () => resolve(true);
			script.onerror = () => resolve(false);
			(document.head || document.documentElement).appendChild(script);
		});

		return bridgeReadyPromise;
	}

	CC.bridge = new BridgeClient();
	CC.injectBridgeOnce = injectBridgeOnce;
})();

(() => {
	'use strict';

	const CC = (globalThis.ClaudeCounter = globalThis.ClaudeCounter || {});

	const ROOT_MESSAGE_ID = '00000000-0000-4000-8000-000000000000';

	function stableStringify(value) {
		const seen = new WeakSet();

		const normalize = (v) => {
			if (v === null || typeof v !== 'object') return v;
			if (seen.has(v)) return '[Circular]';
			seen.add(v);

			if (Array.isArray(v)) return v.map(normalize);

			const out = {};
			for (const key of Object.keys(v).sort()) {
				out[key] = normalize(v[key]);
			}
			return out;
		};

		try {
			return JSON.stringify(normalize(value));
		} catch {
			return '';
		}
	}

	function countTokens(text) {
		if (!text) return 0;
		// Use a lightweight heuristic since the 2MB exact tokenizer was removed for size.
		// On average, 1 token is ~3.5 to 4 English characters.
		return Math.ceil(text.length / 3.5);
	}

	function buildTrunk(conversation) {
		const messages = Array.isArray(conversation?.chat_messages) ? conversation.chat_messages : [];
		const byId = new Map();
		for (const msg of messages) {
			if (msg?.uuid) byId.set(msg.uuid, msg);
		}

		const leaf = conversation?.current_leaf_message_uuid;
		if (!leaf) return [];

		const trunk = [];
		// Bug #13 fix: guard against cyclic parent references in malformed conversation data.
		const seen = new Set();
		let currentId = leaf;
		while (currentId && currentId !== ROOT_MESSAGE_ID) {
			if (seen.has(currentId)) break; // cycle detected
			seen.add(currentId);
			const msg = byId.get(currentId);
			if (!msg) break;
			trunk.push(msg);
			currentId = msg.parent_message_uuid;
		}

		trunk.reverse();
		return trunk;
	}

	function isCountableContentItem(item) {
		if (!item || typeof item !== 'object') return false;
		if (typeof item.type !== 'string') return false;
		if (item.type === 'thinking' || item.type === 'redacted_thinking') return false;
		if (item.type === 'image' || item.type === 'document') return false;
		return true;
	}

	function stringifyCountableContentItem(item) {
		if (!isCountableContentItem(item)) return '';

		// Common fast-path for text blocks.
		if (item.type === 'text' && typeof item.text === 'string') return item.text;

		// Tool blocks: include observable payloads deterministically, but exclude "thinking".
		if (item.type === 'tool_use') {
			const minimal = {
				id: item.id,
				name: item.name,
				input: item.input
			};
			return stableStringify(minimal);
		}

		if (item.type === 'tool_result') {
			const minimal = {
				tool_use_id: item.tool_use_id,
				is_error: item.is_error,
				content: item.content
			};
			return stableStringify(minimal);
		}

		// Fallback: keep only known-ish textual fields to avoid pulling in huge binary-ish blobs.
		const minimal = {};
		if (typeof item.text === 'string') minimal.text = item.text;
		if (typeof item.title === 'string') minimal.title = item.title;
		if (typeof item.url === 'string') minimal.url = item.url;
		if (typeof item.content === 'string') minimal.content = item.content;
		if (Array.isArray(item.content)) minimal.content = item.content;
		if (Object.keys(minimal).length === 0) return '';
		return stableStringify(minimal);
	}

	function stringifyMessageCountables(message) {
		const parts = [];

		// Message content blocks (primary source for tools, text, etc).
		const content = Array.isArray(message?.content) ? message.content : [];
		for (const item of content) {
			const s = stringifyCountableContentItem(item);
			if (s) parts.push(s);
		}

		// Attachment extracted content (observable, already text).
		const attachments = Array.isArray(message?.attachments) ? message.attachments : [];
		for (const a of attachments) {
			if (typeof a?.extracted_content === 'string' && a.extracted_content) {
				parts.push(a.extracted_content);
			}
		}

		return parts.join('\n');
	}

	async function hashString(str) {
		if (!CC.bridge?.requestHash) return null;
		try {
			const res = await CC.bridge.requestHash(str);
			if (res?.hash) return res.hash;
		} catch {
			// No local hashing fallback.
		}
		return null;
	}

	async function fingerprint(text) {
		if (!text) return null;
		const hash = await hashString(text);
		if (!hash) return null;
		return `${text.length}:${hash}`;
	}

	class TokenCache {
		constructor() {
			this._byMessageId = new Map(); // uuid -> { fp, tokens }
		}

		async getMessageTokens(messageId, messageText) {
			const fp = await fingerprint(messageText);
			if (!fp) return countTokens(messageText);
			const cached = this._byMessageId.get(messageId);
			if (cached && cached.fp === fp) return cached.tokens;

			const tokens = countTokens(messageText);
			this._byMessageId.set(messageId, { fp, tokens });
			return tokens;
		}

		pruneToMessageIds(keepIds) {
			const keep = new Set(keepIds);
			for (const id of this._byMessageId.keys()) {
				if (!keep.has(id)) this._byMessageId.delete(id);
			}
		}
	}

	const tokenCache = new TokenCache();

	async function computeConversationMetrics(conversation) {
		const trunk = buildTrunk(conversation);
		const trunkIds = trunk.map((m) => m.uuid).filter(Boolean);
		tokenCache.pruneToMessageIds(trunkIds);

		let totalTokens = 0;
		let textTokens = 0;
		let attachmentTokens = 0;
		let toolTokens = 0;
		const perMessageTokens = {};
		let lastAssistantMs = null;

		for (const msg of trunk) {
			if (msg?.sender === 'assistant' && msg?.created_at) {
				const msgMs = Date.parse(msg.created_at);
				if (!lastAssistantMs || msgMs > lastAssistantMs) {
					lastAssistantMs = msgMs;
				}
			}

			let msgTextTokens = 0;
			let msgToolTokens = 0;
			let msgAttachmentTokens = 0;

			// Content blocks
			const content = Array.isArray(msg?.content) ? msg.content : [];
			for (const item of content) {
				if (!isCountableContentItem(item)) continue;
				const s = stringifyCountableContentItem(item);
				const count = countTokens(s);
				if (item.type === 'tool_use' || item.type === 'tool_result') {
					msgToolTokens += count;
				} else {
					msgTextTokens += count;
				}
			}

			// Attachments
			const attachments = Array.isArray(msg?.attachments) ? msg.attachments : [];
			for (const a of attachments) {
				if (typeof a?.extracted_content === 'string' && a.extracted_content) {
					msgAttachmentTokens += countTokens(a.extracted_content);
				}
			}

			const msgTotal = msgTextTokens + msgToolTokens + msgAttachmentTokens;
			totalTokens += msgTotal;
			textTokens += msgTextTokens;
			toolTokens += msgToolTokens;
			attachmentTokens += msgAttachmentTokens;

			if (msg?.uuid) {
				perMessageTokens[msg.uuid] = msgTotal;
			}
		}

		const cachedUntil = lastAssistantMs ? lastAssistantMs + CC.CONST.CACHE_WINDOW_MS : null;

		return {
			trunkMessageCount: trunk.length,
			totalTokens,
			inputTokens: trunk.reduce((acc, m) => m.sender === 'user' ? acc + (perMessageTokens[m.uuid] || 0) : acc, 0),
			outputTokens: trunk.reduce((acc, m) => m.sender === 'assistant' ? acc + (perMessageTokens[m.uuid] || 0) : acc, 0),
			breakdown: {
				text: textTokens,
				attachments: attachmentTokens,
				tools: toolTokens
			},
			perMessageTokens,
			lastAssistantMs,
			cachedUntil
		};
	}

	CC.tokens = { computeConversationMetrics, countTokens };
})();

(() => {
	'use strict';

	const CC = (globalThis.ClaudeCounter = globalThis.ClaudeCounter || {});

	function formatSeconds(totalSeconds) {
		const minutes = Math.floor(totalSeconds / 60);
		const seconds = totalSeconds % 60;
		return `${minutes}:${String(seconds).padStart(2, '0')}`;
	}

	function formatResetCountdown(timestampMs) {
		const diffMs = timestampMs - Date.now();
		if (diffMs <= 0) return '0m';

		const totalMinutes = Math.round(diffMs / (1000 * 60));
		if (totalMinutes < 60) return `${totalMinutes}m`;

		const hours = Math.floor(totalMinutes / 60);
		const minutes = totalMinutes % 60;
		if (hours < 24) return `${hours}h ${minutes}m`;

		const days = Math.floor(hours / 24);
		const remHours = hours % 24;
		return `${days}d ${remHours}h`;
	}

	/** Returns true when the current page is a chat or /new page. */
	function isChatPage() {
		const path = window.location.pathname;
		return /^\/new$|\/chat\/|^\/new\//.test(path);
	}

	function downloadFile(content, filename, type) {
		const blob = new Blob([content], { type });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = filename;
		a.click();
		URL.revokeObjectURL(url);
	}

	class CounterUI {
		constructor({
			onUsageRefresh,
			onSettingsChange,
			onHistoryRequest,
			onDataRequest,
			onImportData,
			onErrorLogRequest,
			onClearErrorLog
		} = {}) {
			this.onUsageRefresh = onUsageRefresh || null;
			this.onSettingsChange = onSettingsChange || null;
			this.onHistoryRequest = onHistoryRequest || null;
			this.onDataRequest = onDataRequest || null;
			this.onImportData = onImportData || null;
			this.onErrorLogRequest = onErrorLogRequest || null;
			this.onClearErrorLog = onClearErrorLog || null;

			this.headerContainer = null;
			this.headerDisplay = null;
			this.lengthGroup = null;
			this.lengthDisplay = null;
			this.cachedDisplay = null;
			this.lengthBar = null;
			this.lengthTooltip = null;
			this.lastCachedUntilMs = null;
			this.pendingCache = false;

			this.usageLine = null;
			this.sessionUsageSpan = null;
			this.weeklyUsageSpan = null;
			this.sessionBar = null;
			this.sessionBarFill = null;
			this.weeklyBar = null;
			this.weeklyBarFill = null;
			this.sessionResetMs = null;
			this.weeklyResetMs = null;
			this.sessionMarker = null;
			this.weeklyMarker = null;
			this.sessionWindowStartMs = null;
			this.weeklyWindowStartMs = null;
			this.refreshingUsage = false;

			this.latencyGroup = null;
			this.latencyStartTime = 0;

			this.metrics = null;
			this.status = {
				usage: { state: 'stale', detail: 'Waiting for usage data', ts: 0 },
				tokens: { state: 'stale', detail: 'Waiting for token data', ts: 0 }
			};
			this.settings = {
				showBreakdown: true,
				showLatency: true,
				showBadges: true
			};

			this.breakdownCard = null;
			this.domObserver = null;
			this.badgeInjectTimer = null;
		}

		applySettings(settings) {
			this.settings = { ...this.settings, ...settings };
			document.documentElement.classList.toggle('cc-reduced-motion', !!this.settings.reducedMotion);
			this.setVisibility(!this.settings.userHidden);
			this._renderHeader();
			this.refreshProgressChrome();
			if (this.metrics) this.injectBadges(this.metrics.perMessageTokens);
		}

		setVisibility(isVisible) {
			if (this.headerContainer) this.headerContainer.classList.toggle('cc-user-hidden', !isVisible);
			if (this.usageLine) this.usageLine.classList.toggle('cc-user-hidden', !isVisible);
		}

		/** Hide the usage row when on non-chat pages (page-level, not user-toggled). */
		hideUsageLine() {
			if (this.usageLine) this.usageLine.classList.add('cc-hidden');
		}

		/** Restore the usage row when entering a chat/new page. */
		showUsageLine() {
			if (this.usageLine) this.usageLine.classList.remove('cc-hidden');
		}

		getProgressChrome() {
			const root = document.documentElement;
			const modeDark = root.dataset?.mode === 'dark';
			const modeLight = root.dataset?.mode === 'light';
			const isDark = modeDark && !modeLight;

			const themeName = this.settings.theme || 'default';
			const theme = CC.THEMES[themeName] || CC.THEMES.default;
			const fillColor = isDark ? theme.dark : theme.light;

			return {
				strokeColor: isDark ? CC.COLORS.PROGRESS_OUTLINE_DARK : CC.COLORS.PROGRESS_OUTLINE_LIGHT,
				fillColor: fillColor,
				markerColor: isDark ? CC.COLORS.PROGRESS_MARKER_DARK : CC.COLORS.PROGRESS_MARKER_LIGHT,
				boldColor: isDark ? CC.COLORS.BOLD_DARK : CC.COLORS.BOLD_LIGHT
			};
		}

		refreshProgressChrome() {
			const { strokeColor, fillColor, markerColor } = this.getProgressChrome();

			const applyBarChrome = (bar, { fillWarn } = {}) => {
				if (!bar) return;
				bar.style.setProperty('--cc-stroke', strokeColor);
				bar.style.setProperty('--cc-fill', fillColor);
				bar.style.setProperty('--cc-fill-warn', fillWarn ?? fillColor);
				bar.style.setProperty('--cc-marker', markerColor);
			};

			applyBarChrome(this.lengthBar, { fillWarn: fillColor });
			applyBarChrome(this.sessionBar, { fillWarn: CC.COLORS.RED_WARNING });
			applyBarChrome(this.weeklyBar, { fillWarn: CC.COLORS.RED_WARNING });
		}

		initialize() {
			this.headerContainer = document.createElement('div');
			this.headerContainer.className = 'text-text-500 text-xs !px-1 cc-header';

			this.headerDisplay = document.createElement('span');
			this.headerDisplay.className = 'cc-headerItem';

			this.lengthGroup = document.createElement('span');
			this.lengthGroup.style.cursor = 'pointer';
			this.lengthGroup.onclick = (e) => {
				e.stopPropagation();
				this.toggleBreakdown(e);
			};

			this.lengthDisplay = document.createElement('span');
			this.cachedDisplay = document.createElement('span');

			this.latencyGroup = document.createElement('span');
			this.latencyGroup.className = 'cc-latency-marker';

			this.lengthGroup.appendChild(this.lengthDisplay);
			this.headerDisplay.appendChild(this.lengthGroup);

			this._initUsageLine();
			this._observeDom();
			this._observeTheme();
			this.refreshProgressChrome();
		}

		_observeTheme() {
			const observer = new MutationObserver(() => this.refreshProgressChrome());
			observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-mode'] });
		}

		_observeDom() {
			let usageReattachPending = false;
			let headerReattachPending = false;

			this.domObserver = new MutationObserver(() => {
				const usageMissing = this.usageLine && !document.contains(this.usageLine);
				const headerMissing = !document.contains(this.headerContainer);

				if (usageMissing && !usageReattachPending) {
					usageReattachPending = true;
					// Snapshot path so a stale callback can't re-attach on a non-chat page (Bug #8)
					const snapPath = window.location.pathname;
					CC.waitForElement(CC.DOM.MODEL_SELECTOR_DROPDOWN, 60000).then((el) => {
						usageReattachPending = false;
						if (window.location.pathname !== snapPath) return;
						if (el) this.attachUsageLine();
					});
				}

				if (headerMissing && !headerReattachPending) {
					headerReattachPending = true;
					const snapPath = window.location.pathname;
					CC.waitForElement(CC.DOM.CHAT_MENU_TRIGGER, 60000).then((el) => {
						headerReattachPending = false;
						if (window.location.pathname !== snapPath) return;
						if (el) this.attachHeader();
					});
				}

				if (this.settings.showBadges && this.metrics?.perMessageTokens) {
					this.injectBadges(this.metrics.perMessageTokens);
				}
			});

			// Guard against document_start: body may not exist yet.
			if (document.body) {
				this.domObserver.observe(document.body, { childList: true, subtree: true });
			} else {
				const bodyWatcher = new MutationObserver(() => {
					if (document.body) {
						bodyWatcher.disconnect();
						this.domObserver.observe(document.body, { childList: true, subtree: true });
					}
				});
				bodyWatcher.observe(document.documentElement, { childList: true });
			}
		}

		_initUsageLine() {
			this.usageLine = document.createElement('div');
			this.usageLine.className = 'text-text-400 text-[11px] cc-usageRow cc-hidden w-full';

			const main = document.createElement('div');
			main.className = 'cc-usage-main';

			const sessionGroup = document.createElement('div');
			sessionGroup.className = 'cc-usageGroup';
			this.sessionUsageSpan = document.createElement('span');
			this.sessionUsageSpan.className = 'cc-usageText';
			this.sessionBar = document.createElement('div');
			this.sessionBar.className = 'cc-bar cc-bar--usage';
			this.sessionBarFill = document.createElement('div');
			this.sessionBarFill.className = 'cc-bar__fill';
			this.sessionMarker = document.createElement('div');
			this.sessionMarker.className = 'cc-bar__marker cc-hidden';
			this.sessionBar.appendChild(this.sessionBarFill);
			this.sessionBar.appendChild(this.sessionMarker);
			
			sessionGroup.appendChild(this.sessionUsageSpan);
			sessionGroup.appendChild(this.sessionBar);

			const weeklyGroup = document.createElement('div');
			weeklyGroup.className = 'cc-usageGroup cc-usageGroup--weekly';
			this.weeklyUsageSpan = document.createElement('span');
			this.weeklyUsageSpan.className = 'cc-usageText';
			this.weeklyBar = document.createElement('div');
			this.weeklyBar.className = 'cc-bar cc-bar--usage';
			this.weeklyBarFill = document.createElement('div');
			this.weeklyBarFill.className = 'cc-bar__fill';
			this.weeklyMarker = document.createElement('div');
			this.weeklyMarker.className = 'cc-bar__marker cc-hidden';
			this.weeklyBar.appendChild(this.weeklyBarFill);
			this.weeklyBar.appendChild(this.weeklyMarker);
			
			weeklyGroup.appendChild(this.weeklyUsageSpan);
			weeklyGroup.appendChild(this.weeklyBar);

			main.appendChild(sessionGroup);
			main.appendChild(weeklyGroup);

			const actions = document.createElement('div');
			actions.className = 'cc-usage-actions';

			const dashboardBtn = this._makeActionButton('Stats', 'Usage analytics', (e) => {
				e.stopPropagation();
				this.showDashboard();
			});

			const statusBtn = this._makeActionButton('Status', 'Reliability status', (e) => {
				e.stopPropagation();
				this.showStatusPanel();
			});

			const privacyBtn = this._makeActionButton('Privacy', 'Privacy details', (e) => {
				e.stopPropagation();
				this.showPrivacyPanel();
			});

			const settingsBtn = this._makeActionButton('Settings', 'Settings', (e) => {
				e.stopPropagation();
				this.showSettings();
			});

			const refreshBtn = this._makeActionButton('Refresh', 'Refresh usage', (e) => {
				e.stopPropagation();
				this._handleRefresh();
			});

			actions.appendChild(dashboardBtn);
			actions.appendChild(statusBtn);
			actions.appendChild(privacyBtn);
			actions.appendChild(settingsBtn);
			actions.appendChild(refreshBtn);

			this.usageLine.appendChild(main);
			this.usageLine.appendChild(actions);

			this.refreshProgressChrome();
		}

		_makeActionButton(text, label, onClick) {
			const btn = document.createElement('button');
			btn.type = 'button';
			btn.className = 'cc-action-btn';
			btn.textContent = text;
			btn.setAttribute('aria-label', label);
			btn.title = label;
			btn.onclick = onClick;
			return btn;
		}

		_makeModal(title, className = '') {
			const backdrop = document.createElement('div');
			backdrop.className = 'cc-overlay-backdrop';
			const overlay = document.createElement('div');
			overlay.className = `cc-settings-overlay ${className}`.trim();
			overlay.setAttribute('role', 'dialog');
			overlay.setAttribute('aria-modal', 'true');
			overlay.tabIndex = -1;
			overlay.innerHTML = `<h3>${title}</h3>`;
			const close = () => {
				if (document.body.contains(backdrop)) document.body.removeChild(backdrop);
				if (document.body.contains(overlay)) document.body.removeChild(overlay);
			};
			backdrop.onclick = close;
			overlay.addEventListener('keydown', (e) => {
				if (e.key === 'Escape') close();
			});
			document.body.appendChild(backdrop);
			document.body.appendChild(overlay);
			setTimeout(() => overlay.focus(), 0);
			return { backdrop, overlay, close };
		}

		setStatus(kind, state, detail) {
			if (!this.status[kind]) return;
			this.status[kind] = { state, detail, ts: Date.now() };
			this._renderHeader();
		}

		_statusSummary() {
			const values = Object.values(this.status);
			if (values.some((s) => s.state === 'failed')) return 'Failed';
			if (values.some((s) => s.state === 'stale')) return 'Stale';
			return 'Connected';
		}

		async _handleRefresh() {
			if (!this.onUsageRefresh || this.refreshingUsage) return;
			this.refreshingUsage = true;
			this.usageLine.style.opacity = '0.5';
			try {
				await this.onUsageRefresh();
			} finally {
				this.usageLine.style.opacity = '';
				this.refreshingUsage = false;
			}
		}

		attachHeader() {
			if (!this.headerContainer) return;
			// Move to a global fixed container if not already there
			if (this.headerContainer.parentElement !== document.body) {
				document.body.appendChild(this.headerContainer);
				console.log('[Claude Counter] Header attached as floating pill');
			}
			this._renderHeader();
			this.refreshProgressChrome();
		}

		attachUsageLine() {
			if (!this.usageLine) return;
			
			// Find chat input anchor without relying on :has() (limited Firefox 115 support)
			let anchor = document.querySelector('[class*="ChatInput"]') ||
						 document.querySelector('fieldset');

			// Fallback: find a div.flex that contains a contenteditable child
			if (!anchor) {
				const candidates = document.querySelectorAll('div.flex');
				for (const el of candidates) {
					if (el.querySelector('[contenteditable]')) {
						anchor = el;
						break;
					}
				}
			}

			// Last resort: use chat menu trigger parent
			if (!anchor) {
				anchor = document.querySelector('[data-testid="chat-menu-trigger"]')?.closest('div.flex-col');
			}
			
			if (!anchor) {
				console.log('[Claude Counter] No chat input anchor found');
				return;
			}
			
			// Restore visibility in case hideUsageLine() was called previously
			this.showUsageLine();

			// Attach at the very bottom of the input container
			if (anchor.lastElementChild !== this.usageLine) {
				anchor.appendChild(this.usageLine);
				console.log('[Claude Counter] Usage line appended to input area:', anchor);
			}
			this.refreshProgressChrome();
		}

		toggleBreakdown(e) {
			if (this.breakdownCard) {
				this.breakdownCard.remove();
				this.breakdownCard = null;
				return;
			}
			if (!this.metrics) return;

			const card = document.createElement('div');
			card.className = 'cc-breakdown-card';
			// Bug #1 fix: was `metrics` (undefined free var); must be `this.metrics`
			const { breakdown = { text: 0, attachments: 0, tools: 0 }, totalTokens } = this.metrics;
			card.innerHTML = `
				<h4>Context Info</h4>
				<div class="cc-details-item"><span>Text:</span><span>${breakdown.text.toLocaleString()}</span></div>
				<div class="cc-details-item"><span>Attachments:</span><span>${breakdown.attachments.toLocaleString()}</span></div>
				<div class="cc-details-item"><span>Tools:</span><span>${breakdown.tools.toLocaleString()}</span></div>
				<hr style="opacity:0.1; margin:4px 0">
				<div class="cc-details-item" style="font-weight:bold"><span>Total:</span><span>${(totalTokens ?? 0).toLocaleString()}</span></div>
				<div class="cc-details-item cc-cost-estimate" style="margin-top:4px; padding-top:4px; border-top:1px dashed rgba(255,255,255,0.1)">
					<span>Est. API Value:</span>
					<span style="color:#10b981">$${this._calculateCost(this.metrics).toFixed(4)}</span>
				</div>
			`;

			const rect = this.lengthGroup.getBoundingClientRect();
			card.style.top = `${rect.bottom + 8}px`;
			card.style.left = `${rect.left}px`;

			const close = (evt) => {
				if (!card.contains(evt.target) && evt.target !== this.lengthGroup) {
					card.remove();
					this.breakdownCard = null;
					window.removeEventListener('click', close);
				}
			};
			
			setTimeout(() => window.addEventListener('click', close), 0);
			document.body.appendChild(card);
			this.breakdownCard = card;
		}

		async showDashboard() {
			if (document.querySelector('.cc-dashboard-overlay')) return;
			const history = await this.onHistoryRequest();
			const { overlay, close } = this._makeModal('Usage Analytics', 'cc-dashboard-overlay');
			
			const { fillColor } = this.getProgressChrome();
			overlay.style.setProperty('--cc-fill', fillColor);
			
			// Process history for chart (last 7 days)
			const days = {};
			const now = Date.now();
			for (let i = 0; i < 7; i++) {
				const d = new Date(now - i * 24 * 60 * 60 * 1000).toDateString();
				days[d] = 0;
			}
			history.forEach(h => {
				const d = new Date(h.ts).toDateString();
				if (days[d] !== undefined) days[d] = Math.max(days[d], h.session || 0);
			});

			const chartHtml = Object.entries(days).reverse().map(([date, val]) => `
				<div class="cc-chart-column">
					<div class="cc-chart-bar-wrapper">
						<div class="cc-chart-bar" style="height:${Math.max(4, val)}%" title="${date}: ${val.toFixed(1)}%"></div>
					</div>
					<div class="cc-chart-label">${date.split(' ')[0]}</div>
				</div>
			`).join('');

			overlay.innerHTML = `
				<h3>Usage Analytics</h3>
				<p style="font-size:12px; opacity:0.7; margin-bottom:10px">Peak session utilization per day (last 7 days)</p>
				<div class="cc-chart-container">${chartHtml}</div>
				<div style="margin-top:20px; display:grid; grid-template-columns:1fr 1fr; gap:10px">
					<div style="padding:10px; background:rgba(255,255,255,0.05); border-radius:8px; text-align:center">
						<div style="font-size:20px; font-weight:bold">${history.length}</div>
						<div style="font-size:10px; opacity:0.6">Data Points</div>
					</div>
					<div style="padding:10px; background:rgba(255,255,255,0.05); border-radius:8px; text-align:center">
						<div style="font-size:20px; font-weight:bold">${Math.round(Math.max(0, ...Object.values(days)))}%</div>
						<div style="font-size:10px; opacity:0.6">Peak Session</div>
					</div>
				</div>
				<button id="cc-dash-close" style="width:100%; margin-top:20px; padding:10px; border-radius:8px; background:var(--cc-fill); color:white; border:none; cursor:pointer;">Close</button>
				<div style="display:flex; gap:10px; margin-top:10px">
					<button id="cc-export-json" style="flex:1; padding:6px; font-size:10px; background:rgba(255,255,255,0.1); color:white; border:none; border-radius:4px; cursor:pointer">Export JSON</button>
					<button id="cc-export-csv" style="flex:1; padding:6px; font-size:10px; background:rgba(255,255,255,0.1); color:white; border:none; border-radius:4px; cursor:pointer">Export CSV</button>
				</div>
			`;

			overlay.querySelector('#cc-export-json').onclick = () => {
				downloadFile(JSON.stringify(history, null, 2), `claude_usage_${Date.now()}.json`, 'application/json');
			};

			overlay.querySelector('#cc-export-csv').onclick = () => {
				const headers = ['timestamp', 'session_usage_pct', 'weekly_usage_pct'];
				const rows = history.map(h => [
					new Date(h.ts).toISOString(),
					h.session != null ? h.session.toFixed(2) : '0.00',
					h.weekly != null ? h.weekly.toFixed(2) : '0.00'
				]);
				const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
				downloadFile(csv, `claude_usage_${Date.now()}.csv`, 'text/csv');
			};

			overlay.querySelector('#cc-dash-close').onclick = close;
		}

		async showStatusPanel() {
			const { overlay, close } = this._makeModal('Reliability Status');
			const errors = this.onErrorLogRequest ? await this.onErrorLogRequest() : [];
			const row = (name, s) => `
				<div class="cc-details-item">
					<span>${name}</span>
					<span class="cc-statusText cc-statusText--${s.state}">${s.state} Â· ${s.detail}</span>
				</div>
			`;
			overlay.innerHTML = `
				<h3>Reliability Status</h3>
				${row('Usage data', this.status.usage)}
				${row('Token data', this.status.tokens)}
				<div class="cc-details-item"><span>Local errors</span><span>${errors.length}</span></div>
				<div class="cc-modal-actions">
					<button id="cc-export-errors">Export Errors</button>
					<button id="cc-clear-errors">Clear Errors</button>
					<button id="cc-status-close">Close</button>
				</div>
			`;
			overlay.querySelector('#cc-export-errors').onclick = () => {
				downloadFile(JSON.stringify(errors, null, 2), `claude_counter_errors_${Date.now()}.json`, 'application/json');
			};
			overlay.querySelector('#cc-clear-errors').onclick = async () => {
				if (this.onClearErrorLog) await this.onClearErrorLog();
				close();
			};
			overlay.querySelector('#cc-status-close').onclick = close;
		}

		showPrivacyPanel() {
			const { overlay, close } = this._makeModal('Privacy');
			overlay.innerHTML = `
				<h3>Privacy</h3>
				<p class="cc-muted">Claude Counter does not use remote servers, analytics, trackers, or external telemetry.</p>
				<div class="cc-details-item"><span>Stored locally</span><span>Settings, usage history, local error log</span></div>
				<div class="cc-details-item"><span>Claude endpoints</span><span>/api/organizations, /usage, /chat_conversations</span></div>
				<div class="cc-details-item"><span>Token counts</span><span>Estimated locally in the browser</span></div>
				<button id="cc-privacy-close" class="cc-full-btn">Close</button>
			`;
			overlay.querySelector('#cc-privacy-close').onclick = close;
		}

		showSettings() {
			if (document.querySelector('.cc-settings-overlay:not(.cc-dashboard-overlay)')) return;
			const themeName = this.settings.theme || 'default';
			const { overlay, close } = this._makeModal('Settings');
			overlay.innerHTML = `
				<h3>Settings</h3>
				<div class="cc-settings-field">
					<span>Show Message Badges</span>
					<input type="checkbox" id="cc-set-badges" ${this.settings.showBadges ? 'checked' : ''}>
				</div>
				<div class="cc-settings-field">
					<span>Show Latency/Speed</span>
					<input type="checkbox" id="cc-set-latency" ${this.settings.showLatency ? 'checked' : ''}>
				</div>
				<div class="cc-settings-field">
					<span>Context Limit (Tokens)</span>
					<input type="number" id="cc-set-limit" style="width:80px; background:rgba(255,255,255,0.05); color:white; border:1px solid var(--cc-stroke); border-radius:4px; padding:2px 4px; font-size:11px" value="${this.settings.manualLimit || this._detectContextLimit()}">
				</div>
				<div class="cc-settings-field">
					<span>Color Theme Preset</span>
					<select id="cc-set-theme" style="background:rgba(255,255,255,0.05); color:white; border:1px solid var(--cc-stroke); border-radius:4px; padding:2px 4px; font-size:11px; outline:none; cursor:pointer">
						<option value="default" style="background:#1a1d24; color:white" ${themeName === 'default' ? 'selected' : ''}>Default Blue</option>
						<option value="sunset" style="background:#1a1d24; color:white" ${themeName === 'sunset' ? 'selected' : ''}>Sunset Red</option>
						<option value="emerald" style="background:#1a1d24; color:white" ${themeName === 'emerald' ? 'selected' : ''}>Emerald Green</option>
						<option value="cyberpunk" style="background:#1a1d24; color:white" ${themeName === 'cyberpunk' ? 'selected' : ''}>Cyberpunk Purple</option>
					</select>
				</div>
				<div class="cc-settings-field">
					<span>Reduced Motion</span>
					<input type="checkbox" id="cc-set-reduced-motion" ${this.settings.reducedMotion ? 'checked' : ''}>
				</div>
				<button id="cc-set-close" style="width:100%; margin-top:15px; padding:8px; border-radius:6px; background:var(--cc-fill); color:white; border:none; cursor:pointer;">Close</button>
				<div style="display:flex; gap:10px; margin-top:10px">
					<button id="cc-export-all" style="flex:1; padding:6px; font-size:10px; background:rgba(255,255,255,0.1); color:white; border:none; border-radius:4px; cursor:pointer">Export Data</button>
					<button id="cc-import-all" style="flex:1; padding:6px; font-size:10px; background:rgba(255,255,255,0.1); color:white; border:none; border-radius:4px; cursor:pointer">Import Data</button>
				</div>
				<div style="margin-top:12px; font-size:10px; opacity:0.5; text-align:center">
					Tip: Toggle overlay via keyboard shortcut: <kbd style="background:rgba(255,255,255,0.1); padding:2px 4px; border-radius:3px">Alt+Shift+C</kbd>
				</div>
			`;

			overlay.querySelector('#cc-set-close').onclick = close;

			['badges', 'latency'].forEach(key => {
				overlay.querySelector(`#cc-set-${key}`).onchange = (e) => {
					this.onSettingsChange({ [`show${key.charAt(0).toUpperCase() + key.slice(1)}`]: e.target.checked });
				};
			});

			overlay.querySelector('#cc-set-limit').onchange = (e) => {
				this.onSettingsChange({ manualLimit: parseInt(e.target.value) || 0 });
			};

			overlay.querySelector('#cc-set-theme').onchange = (e) => {
				this.onSettingsChange({ theme: e.target.value });
			};

			overlay.querySelector('#cc-set-reduced-motion').onchange = (e) => {
				this.onSettingsChange({ reducedMotion: e.target.checked });
			};

			overlay.querySelector('#cc-export-all').onclick = async () => {
				if (!this.onDataRequest) return;
				const data = await this.onDataRequest();
				downloadFile(JSON.stringify(data, null, 2), `claude_counter_backup_${Date.now()}.json`, 'application/json');
			};

			overlay.querySelector('#cc-import-all').onclick = () => {
				const input = document.createElement('input');
				input.type = 'file';
				input.accept = 'application/json';
				input.onchange = async () => {
					const file = input.files?.[0];
					if (!file || !this.onImportData) return;
					const payload = JSON.parse(await file.text());
					await this.onImportData(payload);
					close();
				};
				input.click();
			};
		}

		async showOnboardingIfNeeded(settings = {}) {
			if (settings.onboardingSeen) return;
			const { overlay, close } = this._makeModal('Claude Counter');
			overlay.innerHTML = `
				<h3>Claude Counter</h3>
				<p class="cc-muted">Usage bars come from Claude account data when available. Token counts are local estimates optimized for a small extension package.</p>
				<p class="cc-muted">No remote servers are used. You can export settings, history, and local diagnostics from Settings.</p>
				<button id="cc-onboarding-close" class="cc-full-btn">Continue</button>
			`;
			overlay.querySelector('#cc-onboarding-close').onclick = async () => {
				if (this.onSettingsChange) await this.onSettingsChange({ onboardingSeen: true });
				close();
			};
		}

		injectBadges(perMessageTokens) {
			if (this.badgeInjectTimer) clearTimeout(this.badgeInjectTimer);
			this.badgeInjectTimer = setTimeout(() => this._injectBadgesNow(perMessageTokens), 120);
		}

		_injectBadgesNow(perMessageTokens) {
			if (!this.settings.showBadges) {
				document.querySelectorAll('.cc-message-badge').forEach(b => b.remove());
				return;
			}
			if (!perMessageTokens) return;
			for (const [uuid, tokens] of Object.entries(perMessageTokens)) {
				const bubble = document.querySelector(`[data-message-id="${uuid}"], [data-testid="message-wrapper-${uuid}"]`);
				if (bubble && !bubble.querySelector('.cc-message-badge')) {
					const badge = document.createElement('span');
					badge.className = 'cc-message-badge';
					badge.textContent = `${tokens} t`;
					badge.setAttribute('aria-label', `${tokens} estimated tokens`);
					bubble.appendChild(badge);
				}
			}
		}

		setPendingCache(pending) {
			this.pendingCache = pending;
			if (this.cacheTimeSpan) {
				this.cacheTimeSpan.style.color = pending ? '' : this.getProgressChrome().boldColor;
			}
		}

		setLatency({ startTime, ttft, duration, tps }) {
			if (!this.settings.showLatency) {
				this.latencyGroup.textContent = '';
				return;
			}
			if (startTime) {
				this.latencyStartTime = startTime;
				this.latencyGroup.textContent = '...';
			} else if (tps) {
				this.latencyGroup.textContent = `âš¡ ${Math.round(tps)} t/s`;
			} else if (ttft) {
				this.latencyGroup.textContent = `TTFT: ${ttft}ms`;
			} else if (duration) {
				this.latencyGroup.textContent = `Time: ${(duration / 1000).toFixed(1)}s`;
			}
		}

		setConversationMetrics(metrics = {}) {
			this.metrics = metrics;
			this.pendingCache = false;
			const {
				totalTokens,
				breakdown = { text: 0, attachments: 0, tools: 0 },
				perMessageTokens,
				cachedUntil
			} = metrics;

			if (typeof totalTokens !== 'number') {
				this.lengthDisplay.textContent = '';
				this.cachedDisplay.textContent = '';
				this._renderHeader();
				return;
			}

			const limit = this.settings.manualLimit || this._detectContextLimit();
			const pct = Math.max(0, Math.min(100, (totalTokens / limit) * 100));
			this.lengthDisplay.innerHTML = `~${totalTokens.toLocaleString()} tokens <span style="opacity:0.5; font-size:9px">â“˜</span>`;

			// Mini bar
			const isFull = pct >= 99.5;
			const isWarning = pct >= 90;
			
			if (isFull) {
				this.lengthDisplay.style.opacity = '0.5';
				this.lengthBar = null;
				this.lengthGroup.replaceChildren(this.lengthDisplay);
			} else {
				this.lengthDisplay.style.opacity = '';
				const bar = document.createElement('div');
				bar.className = `cc-bar cc-bar--mini ${isWarning ? 'cc-pulse-warn' : ''}`;
				this.lengthBar = bar;
				
				// Heatmap segments
				const textPct = (breakdown.text / limit) * 100;
				const attachPct = (breakdown.attachments / limit) * 100;
				const toolPct = (breakdown.tools / limit) * 100;

				const createSegment = (p, cls) => {
					if (p <= 0) return null;
					const s = document.createElement('div');
					s.className = `cc-bar__fill ${cls}`;
					s.style.width = `${p}%`;
					return s;
				};

				const segments = [
					createSegment(textPct, 'cc-fill-text'),
					createSegment(attachPct, 'cc-fill-attach'),
					createSegment(toolPct, 'cc-fill-tool')
				].filter(Boolean);
				
				bar.replaceChildren(...segments);
				this.refreshProgressChrome();
				const barWrapper = document.createElement('span');
				barWrapper.className = 'inline-flex items-center';
				barWrapper.appendChild(bar);
				this.headerDisplay.classList.toggle('cc-text-warn', isWarning);
				this.lengthGroup.replaceChildren(this.lengthDisplay, document.createTextNode('\u00A0\u00A0'), barWrapper);
			}

			// Cache timer
			const now = Date.now();
			if (typeof cachedUntil === 'number' && cachedUntil > now) {
				this.lastCachedUntilMs = cachedUntil;
				const secondsLeft = Math.max(0, Math.ceil((cachedUntil - now) / 1000));
				this.cacheTimeSpan = Object.assign(document.createElement('span'), {
					className: 'cc-cacheTime',
					textContent: formatSeconds(secondsLeft)
				});
				this.cacheTimeSpan.style.color = this.getProgressChrome().boldColor;
				this.cachedDisplay.replaceChildren(document.createTextNode('cached for\u00A0'), this.cacheTimeSpan);
			} else {
				this.lastCachedUntilMs = null;
				this.cachedDisplay.innerHTML = '';
			}

			if (this.settings.showBadges && perMessageTokens) this.injectBadges(perMessageTokens);
			this._renderHeader();
		}

		_renderHeader() {
			this.headerContainer.replaceChildren();
			// Bug #18: use a dedicated flag instead of relying on textContent across innerHTML children
			if (!this.lengthDisplay.textContent && !this.lengthDisplay.children.length) return;
			const gap = this.lengthBar ? '\u00A0\u00A0' : '\u00A0';
			this.headerDisplay.replaceChildren(this.lengthGroup, document.createTextNode(gap), this.cachedDisplay);
			if (this.settings.showLatency) this.headerDisplay.appendChild(this.latencyGroup);
			const status = document.createElement('span');
			const summary = this._statusSummary();
			status.className = `cc-status-pill cc-status-pill--${summary.toLowerCase()}`;
			status.textContent = summary;
			status.title = `Usage: ${this.status.usage.detail}; Tokens: ${this.status.tokens.detail}`;
			this.headerDisplay.appendChild(status);
			this.headerContainer.appendChild(this.headerDisplay);
		}

		setUsage(usage) {
			console.debug('[Claude Counter] Updating UI with usage:', usage); // Bug #16: was console.log
			this.refreshProgressChrome();
			const session = usage?.five_hour || null;
			const weekly = usage?.seven_day || null;
			if (this.usageLine) {
				// Bug #3 fix: SSE events fire from any page; only un-hide when actually on a chat page.
				if (isChatPage()) {
					this.usageLine.classList.remove('cc-hidden');
					this.usageLine.style.display = 'flex';
				}
			}

			if (session?.utilization != null) {
				const rawPct = session.utilization;
				this.sessionResetMs = session.resets_at ? Date.parse(session.resets_at) : null;
				this.sessionWindowStartMs = this.sessionResetMs ? this.sessionResetMs - 5 * 60 * 60 * 1000 : null;
				this.sessionUsageSpan.textContent = `Session: ${rawPct.toFixed(1)}%${this.sessionResetMs ? ` Â· ${formatResetCountdown(this.sessionResetMs)}` : ''}`;
				this.sessionBarFill.style.width = `${Math.min(100, rawPct)}%`;
				this.sessionBarFill.classList.toggle('cc-warn', rawPct >= 90);
			}

			if (weekly?.utilization != null) {
				const rawPct = weekly.utilization;
				this.weeklyResetMs = weekly.resets_at ? Date.parse(weekly.resets_at) : null;
				this.weeklyWindowStartMs = this.weeklyResetMs ? this.weeklyResetMs - 7 * 24 * 60 * 60 * 1000 : null;
				this.weeklyUsageSpan.textContent = `Weekly: ${rawPct.toFixed(1)}%${this.weeklyResetMs ? ` Â· ${formatResetCountdown(this.weeklyResetMs)}` : ''}`;
				this.weeklyBarFill.style.width = `${Math.min(100, rawPct)}%`;
				this.weeklyBarFill.classList.toggle('cc-warn', rawPct >= 90);
			}
			this._updateMarkers();
		}

		_detectContextLimit() {
			const modelBtn = document.querySelector(CC.DOM.MODEL_SELECTOR_DROPDOWN);
			const modelName = modelBtn?.textContent?.trim() || '';
			for (const [name, limit] of Object.entries(CC.CONST.MODEL_CONTEXT_MAP)) {
				if (modelName.includes(name)) return limit;
			}
			return CC.CONST.DEFAULT_CONTEXT_LIMIT;
		}

		_calculateCost(metrics) {
			const modelBtn = document.querySelector(CC.DOM.MODEL_SELECTOR_DROPDOWN);
			const modelName = modelBtn?.textContent?.trim() || '';
			let key = 'Default';
			if (modelName.includes('Opus')) key = 'Opus';
			else if (modelName.includes('Sonnet')) key = 'Sonnet';
			else if (modelName.includes('Haiku')) key = 'Haiku';
			
			const prices = CC.CONST.MODEL_PRICE_MAP[key];
			// Bug #2 fix: inputTokens / outputTokens can be undefined â†’ NaN cost display
			const inputCost = ((metrics.inputTokens ?? 0) / 1000000) * prices.input;
			const outputCost = ((metrics.outputTokens ?? 0) / 1000000) * prices.output;
			return inputCost + outputCost;
		}

		_updateMarkers() {
			const now = Date.now();
			const update = (marker, start, end) => {
				if (marker && start && end) {
					const pct = Math.max(0, Math.min(100, ((now - start) / (end - start)) * 100));
					marker.classList.remove('cc-hidden');
					marker.style.left = `${pct}%`;
				} else if (marker) marker.classList.add('cc-hidden');
			};
			update(this.sessionMarker, this.sessionWindowStartMs, this.sessionResetMs);
			update(this.weeklyMarker, this.weeklyWindowStartMs, this.weeklyResetMs);
		}

		tick() {
			const now = Date.now();
			if (this.lastCachedUntilMs && this.lastCachedUntilMs > now) {
				const secs = Math.max(0, Math.ceil((this.lastCachedUntilMs - now) / 1000));
				if (this.cacheTimeSpan) this.cacheTimeSpan.textContent = formatSeconds(secs);
			} else if (this.lastCachedUntilMs) {
				this.lastCachedUntilMs = null;
				this.cachedDisplay.textContent = '';
				this._renderHeader();
			}
			this._updateMarkers();
		}
	}

	CC.ui = {
		CounterUI
	};
})();

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
	const rolloverHandledForResetMs = { five_hour: null, seven_day: null };
	let lastTokenUpdateMs = 0;

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
			if (payload && typeof payload.settings === 'object' && !Array.isArray(payload.settings)) {
				next.settings = { ...settings, ...payload.settings };
				settings = next.settings;
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
			// Hide the usage row â€” it should not be visible outside chat/new pages
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
	window.addEventListener('beforeunload', unobserveUrl);

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
	}

	setInterval(tick, 1000);
})();


})();
