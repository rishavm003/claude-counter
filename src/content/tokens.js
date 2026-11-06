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

	// Wide (CJK / Hangul / Kana) characters are ~1 token each; everything else is estimated
	// from characters and words. This is still an ESTIMATE (no exact Claude tokenizer is bundled);
	// expect roughly ±15% on English prose and more drift on code or other scripts.
	const WIDE_CHAR_RE = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uf900-\ufaff]/g;

	function countTokens(text) {
		if (!text) return 0;
		const wide = (text.match(WIDE_CHAR_RE) || []).length;
		const rest = text.length - wide;
		if (rest <= 0) return wide;
		const restText = wide ? text.replace(WIDE_CHAR_RE, ' ') : text;
		const words = (restText.match(/\S+/g) || []).length;
		// Blend char-based (~3.6 chars/token) and word-based (~1.33 tokens/word) estimates.
		const byChars = rest / 3.6;
		const byWords = words * 1.33;
		return wide + Math.ceil((byChars + byWords) / 2);
	}

	function getModelInfo(modelId) {
		const id = String(modelId || '');
		if (id) {
			for (const info of CC.CONST.MODEL_INFO || []) {
				if (info.match.test(id)) return { ...info, id };
			}
		}
		return { ...CC.CONST.DEFAULT_MODEL_INFO, id: id || null };
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
		// guard against cyclic parent references in malformed conversation data.
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

	async function computeConversationMetrics(conversation) {
		const trunk = buildTrunk(conversation);

		let totalTokens = 0;
		let textTokens = 0;
		let attachmentTokens = 0;
		let toolTokens = 0;
		const perMessageTokens = {};
		let lastAssistantMs = null;
		let uncountedFiles = 0;
		// API-equivalent accounting: every assistant turn re-reads the whole context before it.
		let runningContext = 0;
		let apiInputTokens = 0;
		let apiOutputTokens = 0;

		for (const msg of trunk) {
			// Use updated_at (when the reply finished) — the cache clock starts after the response.
			const stamp = msg?.updated_at || msg?.created_at;
			if (msg?.sender === 'assistant' && stamp) {
				const msgMs = Date.parse(stamp);
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

			// Images / PDFs uploaded as files carry no text we can count.
			if (Array.isArray(msg?.files)) uncountedFiles += msg.files.length;
			if (Array.isArray(msg?.files_v2)) uncountedFiles += msg.files_v2.length;

			const msgTotal = msgTextTokens + msgToolTokens + msgAttachmentTokens;
			if (msg?.sender === 'assistant') {
				apiInputTokens += runningContext;
				apiOutputTokens += msgTotal;
			}
			runningContext += msgTotal;
			totalTokens += msgTotal;
			textTokens += msgTextTokens;
			toolTokens += msgToolTokens;
			attachmentTokens += msgAttachmentTokens;

			if (msg?.uuid) {
				perMessageTokens[msg.uuid] = msgTotal;
			}
		}

		const cachedUntil = lastAssistantMs ? lastAssistantMs + CC.CONST.CACHE_WINDOW_MS : null;

		const model = getModelInfo(conversation?.model);

		return {
			model,
			uncountedFiles,
			apiInputTokens,
			apiOutputTokens,
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

	CC.tokens = { computeConversationMetrics, countTokens, getModelInfo };
})();
