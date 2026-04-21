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

	function setupTooltip(element, tooltip, { topOffset = 10 } = {}) {
		if (!element || !tooltip) return;
		if (element.hasAttribute('data-tooltip-setup')) return;
		element.setAttribute('data-tooltip-setup', 'true');
		element.classList.add('cc-tooltipTrigger');

		let pressTimer;
		let hideTimer;

		const show = () => {
			const rect = element.getBoundingClientRect();
			tooltip.style.opacity = '1';
			const tipRect = tooltip.getBoundingClientRect();

			let left = rect.left + rect.width / 2;
			if (left + tipRect.width / 2 > window.innerWidth) left = window.innerWidth - tipRect.width / 2 - 10;
			if (left - tipRect.width / 2 < 0) left = tipRect.width / 2 + 10;

			let top = rect.top - tipRect.height - topOffset;
			if (top < 10) top = rect.bottom + 10;

			tooltip.style.left = `${left}px`;
			tooltip.style.top = `${top}px`;
			tooltip.style.transform = 'translateX(-50%)';
		};

		const hide = () => {
			tooltip.style.opacity = '0';
			clearTimeout(hideTimer);
		};

		element.addEventListener('pointerdown', (e) => {
			if (e.pointerType === 'touch' || e.pointerType === 'pen') {
				pressTimer = setTimeout(() => {
					show();
					hideTimer = setTimeout(hide, 3000);
				}, 500);
			}
		});

		element.addEventListener('pointerup', () => clearTimeout(pressTimer));
		element.addEventListener('pointercancel', () => {
			clearTimeout(pressTimer);
			hide();
		});

		element.addEventListener('pointerenter', (e) => {
			if (e.pointerType === 'mouse') show();
		});

		element.addEventListener('pointerleave', (e) => {
			if (e.pointerType === 'mouse') hide();
		});
	}

	function makeTooltip(text) {
		const tip = document.createElement('div');
		tip.className = 'bg-bg-500 text-text-000 cc-tooltip';
		tip.textContent = text;
		document.body.appendChild(tip);
		return tip;
	}

	class CounterUI {
		constructor({ onUsageRefresh, onSettingsChange, onHistoryRequest } = {}) {
			this.onUsageRefresh = onUsageRefresh || null;
			this.onSettingsChange = onSettingsChange || null;
			this.onHistoryRequest = onHistoryRequest || null;

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
			this.settings = {
				showBreakdown: true,
				showLatency: true,
				showBadges: true
			};

			this.breakdownCard = null;
			this.domObserver = null;
		}

		applySettings(settings) {
			this.settings = { ...this.settings, ...settings };
			this._renderHeader();
			this.refreshProgressChrome();
			if (this.metrics) this.injectBadges(this.metrics.perMessageTokens);
		}

		getProgressChrome() {
			const root = document.documentElement;
			const modeDark = root.dataset?.mode === 'dark';
			const modeLight = root.dataset?.mode === 'light';
			const isDark = modeDark && !modeLight;

			return {
				strokeColor: isDark ? CC.COLORS.PROGRESS_OUTLINE_DARK : CC.COLORS.PROGRESS_OUTLINE_LIGHT,
				fillColor: isDark ? CC.COLORS.PROGRESS_FILL_DARK : CC.COLORS.PROGRESS_FILL_LIGHT,
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
					CC.waitForElement(CC.DOM.MODEL_SELECTOR_DROPDOWN, 60000).then((el) => {
						usageReattachPending = false;
						if (el) this.attachUsageLine();
					});
				}

				if (headerMissing && !headerReattachPending) {
					headerReattachPending = true;
					CC.waitForElement(CC.DOM.CHAT_MENU_TRIGGER, 60000).then((el) => {
						headerReattachPending = false;
						if (el) this.attachHeader();
					});
				}

				if (this.settings.showBadges && this.metrics?.perMessageTokens) {
					this.injectBadges(this.metrics.perMessageTokens);
				}
			});
			this.domObserver.observe(document.body, { childList: true, subtree: true });
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

			const dashboardBtn = document.createElement('div');
			dashboardBtn.className = 'cc-action-btn';
			dashboardBtn.innerHTML = '📊';
			dashboardBtn.onclick = (e) => { e.stopPropagation(); this.showDashboard(); };

			const settingsBtn = document.createElement('div');
			settingsBtn.className = 'cc-action-btn';
			settingsBtn.innerHTML = '⚙️';
			settingsBtn.onclick = (e) => { e.stopPropagation(); this.showSettings(); };

			const refreshBtn = document.createElement('div');
			refreshBtn.className = 'cc-action-btn';
			refreshBtn.innerHTML = '🔄';
			refreshBtn.onclick = (e) => { e.stopPropagation(); this._handleRefresh(); };

			actions.appendChild(dashboardBtn);
			actions.appendChild(settingsBtn);
			actions.appendChild(refreshBtn);

			this.usageLine.appendChild(main);
			this.usageLine.appendChild(actions);

			this.refreshProgressChrome();
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
			const chatMenu = document.querySelector(CC.DOM.CHAT_MENU_TRIGGER);
			if (!chatMenu) return;
			const anchor = chatMenu.closest(CC.DOM.CHAT_PROJECT_WRAPPER) || chatMenu.parentElement;
			if (!anchor) return;
			if (anchor.nextElementSibling !== this.headerContainer) anchor.after(this.headerContainer);
			this._renderHeader();
			this.refreshProgressChrome();
		}

		attachUsageLine() {
			if (!this.usageLine) return;
			const modelSelector = document.querySelector(CC.DOM.MODEL_SELECTOR_DROPDOWN);
			if (!modelSelector) return;
			const toolbarRow = modelSelector.closest('div[class*="flex"][class*="row"]') || modelSelector.parentElement?.parentElement;
			if (!toolbarRow) return;
			if (toolbarRow.nextElementSibling !== this.usageLine) toolbarRow.after(this.usageLine);
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
			const { breakdown, totalTokens } = this.metrics;
			card.innerHTML = `
				<h4>Context Info</h4>
				<div class="cc-details-item"><span>Text:</span><span>${breakdown.text.toLocaleString()}</span></div>
				<div class="cc-details-item"><span>Attachments:</span><span>${breakdown.attachments.toLocaleString()}</span></div>
				<div class="cc-details-item"><span>Tools:</span><span>${breakdown.tools.toLocaleString()}</span></div>
				<hr style="opacity:0.1; margin:4px 0">
				<div class="cc-details-item" style="font-weight:bold"><span>Total:</span><span>${totalTokens.toLocaleString()}</span></div>
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
			const history = await this.onHistoryRequest();
			const backdrop = document.createElement('div');
			backdrop.className = 'cc-overlay-backdrop';
			const overlay = document.createElement('div');
			overlay.className = 'cc-settings-overlay cc-dashboard-overlay';
			
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
					<div class="cc-chart-bar" style="height:${val}%" title="${date}: ${val.toFixed(1)}%"></div>
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
						<div style="font-size:20px; font-weight:bold">${Math.round(Math.max(...Object.values(days)))}%</div>
						<div style="font-size:10px; opacity:0.6">Peak Weekly</div>
					</div>
				</div>
				<button id="cc-dash-close" style="width:100%; margin-top:20px; padding:10px; border-radius:8px; background:var(--cc-fill); color:white; border:none; cursor:pointer;">Close</button>
			`;

			const close = () => {
				document.body.removeChild(backdrop);
				document.body.removeChild(overlay);
			};
			backdrop.onclick = close;
			overlay.querySelector('#cc-dash-close').onclick = close;
			document.body.appendChild(backdrop);
			document.body.appendChild(overlay);
		}

		showSettings() {
			const backdrop = document.createElement('div');
			backdrop.className = 'cc-overlay-backdrop';
			const overlay = document.createElement('div');
			overlay.className = 'cc-settings-overlay';
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
				<button id="cc-set-close" style="width:100%; margin-top:15px; padding:8px; border-radius:6px; background:var(--cc-fill); color:white; border:none; cursor:pointer;">Close</button>
			`;

			const close = () => {
				document.body.removeChild(backdrop);
				document.body.removeChild(overlay);
			};
			backdrop.onclick = close;
			overlay.querySelector('#cc-set-close').onclick = close;

			['badges', 'latency'].forEach(key => {
				overlay.querySelector(`#cc-set-${key}`).onchange = (e) => {
					this.onSettingsChange({ [`show${key.charAt(0).toUpperCase() + key.slice(1)}`]: e.target.checked });
				};
			});

			overlay.querySelector('#cc-set-limit').onchange = (e) => {
				this.onSettingsChange({ manualLimit: parseInt(e.target.value) || 0 });
			};

			document.body.appendChild(backdrop);
			document.body.appendChild(overlay);
		}

		injectBadges(perMessageTokens) {
			if (!this.settings.showBadges) {
				document.querySelectorAll('.cc-message-badge').forEach(b => b.remove());
				return;
			}
			for (const [uuid, tokens] of Object.entries(perMessageTokens)) {
				const bubble = document.querySelector(`[data-message-id="${uuid}"], [data-testid="message-wrapper-${uuid}"]`);
				if (bubble && !bubble.querySelector('.cc-message-badge')) {
					const badge = document.createElement('span');
					badge.className = 'cc-message-badge';
					badge.textContent = `${tokens} t`;
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

		setLatency({ startTime, ttft, duration }) {
			if (!this.settings.showLatency) {
				this.latencyGroup.textContent = '';
				return;
			}
			if (startTime) {
				this.latencyStartTime = startTime;
				this.latencyGroup.textContent = '...';
			} else if (ttft) {
				this.latencyGroup.textContent = `TTFT: ${ttft}ms`;
			} else if (duration) {
				this.latencyGroup.textContent = `Time: ${(duration / 1000).toFixed(1)}s`;
			}
		}

		setConversationMetrics(metrics = {}) {
			this.metrics = metrics;
			this.pendingCache = false;
			const { totalTokens, breakdown, perMessageTokens, cachedUntil } = metrics;

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
			if (isFull) {
				this.lengthDisplay.style.opacity = '0.5';
				this.lengthBar = null;
				this.lengthGroup.replaceChildren(this.lengthDisplay);
			} else {
				this.lengthDisplay.style.opacity = '';
				const bar = document.createElement('div');
				bar.className = 'cc-bar cc-bar--mini';
				this.lengthBar = bar;
				const fill = document.createElement('div');
				fill.className = 'cc-bar__fill';
				fill.style.width = `${pct}%`;
				bar.appendChild(fill);
				this.refreshProgressChrome();
				const barWrapper = document.createElement('span');
				barWrapper.className = 'inline-flex items-center';
				barWrapper.appendChild(bar);
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
			if (!this.lengthDisplay.textContent) return;
			const gap = this.lengthBar ? '\u00A0\u00A0' : '\u00A0';
			this.headerDisplay.replaceChildren(this.lengthGroup, document.createTextNode(gap), this.cachedDisplay);
			if (this.settings.showLatency) this.headerDisplay.appendChild(this.latencyGroup);
			this.headerContainer.appendChild(this.headerDisplay);
		}

		setUsage(usage) {
			this.refreshProgressChrome();
			const session = usage?.five_hour || null;
			const weekly = usage?.seven_day || null;
			const hasAnyUsage = !!(session?.utilization != null || weekly?.utilization != null);
			this.usageLine?.classList.toggle('cc-hidden', !hasAnyUsage);

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
