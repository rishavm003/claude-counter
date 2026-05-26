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
					<span class="cc-statusText cc-statusText--${s.state}">${s.state} · ${s.detail}</span>
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
				this.latencyGroup.textContent = `⚡ ${Math.round(tps)} t/s`;
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
			this.lengthDisplay.innerHTML = `~${totalTokens.toLocaleString()} tokens <span style="opacity:0.5; font-size:9px">ⓘ</span>`;

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
				this.sessionUsageSpan.textContent = `Session: ${rawPct.toFixed(1)}%${this.sessionResetMs ? ` · ${formatResetCountdown(this.sessionResetMs)}` : ''}`;
				this.sessionBarFill.style.width = `${Math.min(100, rawPct)}%`;
				this.sessionBarFill.classList.toggle('cc-warn', rawPct >= 90);
			}

			if (weekly?.utilization != null) {
				const rawPct = weekly.utilization;
				this.weeklyResetMs = weekly.resets_at ? Date.parse(weekly.resets_at) : null;
				this.weeklyWindowStartMs = this.weeklyResetMs ? this.weeklyResetMs - 7 * 24 * 60 * 60 * 1000 : null;
				this.weeklyUsageSpan.textContent = `Weekly: ${rawPct.toFixed(1)}%${this.weeklyResetMs ? ` · ${formatResetCountdown(this.weeklyResetMs)}` : ''}`;
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
			// Bug #2 fix: inputTokens / outputTokens can be undefined → NaN cost display
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
