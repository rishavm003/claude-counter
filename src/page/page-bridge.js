(() => {
	'use strict';

	const CC_MARKER = 'ClaudeCounter';

	// Loaded either as a MAIN-world content script (Chrome/Edge/Brave 111+) or injected
	// with a <script> tag (fallback). Never run twice.
	if (window.__ccBridgeLoaded) return;
	window.__ccBridgeLoaded = true;
	// At document_start <html> may not exist yet (early userscript injection): mark it once it does.
	(function markLoaded() {
		if (document.documentElement) document.documentElement.setAttribute('data-cc-bridge', '1');
		else new MutationObserver((_, obs) => {
			if (!document.documentElement) return;
			obs.disconnect();
			document.documentElement.setAttribute('data-cc-bridge', '1');
		}).observe(document, { childList: true });
	})();

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

		if (url) {
			const orgMatch = url.match(/\/api\/organizations\/([^/?#]+)/);
			if (orgMatch && orgMatch[1] && orgMatch[1] !== 'undefined') {
				window.CC_LAST_ORG_ID = orgMatch[1];
			}
		}

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
							// TTFT = time until the first visible text token (not the first network byte)
							if (!ttftEmitted && generationStartTime) {
								post('cc:ttft', { ttft: Date.now() - generationStartTime });
								ttftEmitted = true;
							}
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


	let cachedOrgs = null;

	function getCookie(name) {
		try {
			return document.cookie.split('; ').find((r) => r.startsWith(name + '='))?.split('=')[1] || null;
		} catch {
			return null;
		}
	}

	async function loadOrgs(force = false) {
		if (cachedOrgs && !force) return cachedOrgs;
		const res = await originalFetch('https://claude.ai/api/organizations', { credentials: 'include' });
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const orgs = await res.json();
		cachedOrgs = Array.isArray(orgs) ? orgs : [];
		return cachedOrgs;
	}

	function isChatOrg(o) {
		return Array.isArray(o?.capabilities) && o.capabilities.includes('chat');
	}

	/** Pick the claude.ai chat org: lastActiveOrg cookie > first org with 'chat' capability > first org. */
	function pickChatOrg(orgs) {
		if (!Array.isArray(orgs) || orgs.length === 0) return null;
		const cookieId = getCookie('lastActiveOrg');
		const byCookie = cookieId && orgs.find((o) => (o.uuid || o.id) === cookieId);
		if (byCookie && isChatOrg(byCookie)) return byCookie;
		return orgs.find(isChatOrg) || byCookie || orgs[0];
	}

	/** Derive the subscription plan from org metadata (capabilities / rate_limit_tier). */
	function planFromOrg(o) {
		if (!o) return null;
		const caps = Array.isArray(o.capabilities) ? o.capabilities : [];
		const tier = String(o.rate_limit_tier || '');
		let name = 'Free';
		if (caps.includes('claude_max') || /max/i.test(tier)) {
			name = /20x/i.test(tier) ? 'Max 20x' : /5x/i.test(tier) ? 'Max 5x' : 'Max';
		} else if (caps.includes('claude_pro')) {
			name = 'Pro';
		} else if (caps.some((c) => /raven|team|enterprise/i.test(c)) || o.raven_type) {
			name = 'Team/Enterprise';
		}
		if (o.plan_display_name) name = o.plan_display_name;
		return { name, tier, capabilities: caps };
	}
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
					return orgId;
				}
			}

			// 2. Try API fallback (pick the chat org, not blindly orgs[0])
			const orgs = await loadOrgs();
			const chosen = pickChatOrg(orgs);
			if (chosen) {
				const orgId = chosen.uuid || chosen.id;
				window.CC_LAST_ORG_ID = orgId;
				return orgId;
			}
		} catch (e) {
		}
		return null;
	}

	discoverOrgId().then(id => {
		// postMessage, not CustomEvent.detail: Firefox hides page-created objects from content scripts.
		if (id) post('cc:org_ready', { orgId: id });
	});

	window.addEventListener('message', async (event) => {
		if (event.source !== window) return;
		const data = event.data;
		if (!data || data.cc !== CC_MARKER) return;
		if (data.type !== 'cc:request') return;

		const { requestId, kind, payload } = data;
		try {
			if (kind === 'usage') {
				let orgId = payload?.orgId || window.CC_LAST_ORG_ID;
				if (!orgId) orgId = await discoverOrgId();
				if (!orgId) throw new Error('Missing orgId');
				const fetchUsage = (id) => originalFetch(`https://claude.ai/api/organizations/${id}/usage`, {
					method: 'GET',
					credentials: 'include'
				});
				let res = await fetchUsage(orgId);
				// A non-chat (API console) org returns 403 here — fall back to the real chat org.
				if (res.status === 403 || res.status === 404) {
					try {
						const chat = pickChatOrg(await loadOrgs());
						const chatId = chat && (chat.uuid || chat.id);
						if (chatId && chatId !== orgId) {
							orgId = chatId;
							window.CC_LAST_ORG_ID = chatId;
							res = await fetchUsage(orgId);
						}
					} catch {
						// keep original response
					}
				}
				// check HTTP status before parsing JSON
				if (!res.ok) throw new Error(`HTTP ${res.status} fetching usage`);
				const json = await res.json();
				if (json && typeof json === 'object') {
					json._orgId = orgId;
					try {
						const orgs = await loadOrgs();
						json._plan = planFromOrg(orgs.find((o) => (o.uuid || o.id) === orgId));
					} catch {
						json._plan = null;
					}
				}
				postResponse(requestId, true, json, null);
				return;
			}

			if (kind === 'conversation') {
				let orgId = payload?.orgId || window.CC_LAST_ORG_ID;
				if (!orgId) orgId = await discoverOrgId();
				const conversationId = payload?.conversationId;
				if (!orgId || !conversationId) throw new Error('Missing orgId/conversationId');

				const url = `https://claude.ai/api/organizations/${orgId}/chat_conversations/${conversationId}?tree=true&rendering_mode=messages&render_all_tools=true`;
				const res = await originalFetch(url, {
					method: 'GET',
					credentials: 'include'
				});
				// check HTTP status before parsing JSON
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
