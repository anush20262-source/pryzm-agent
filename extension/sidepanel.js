/* ===========================================================
   PRYZM Side Panel — Controller
   All event handlers use addEventListener (NO inline handlers)
   =========================================================== */

(() => {
  'use strict';

  // ——————————————————————————————————————————————————————————
  // State
  // ——————————————————————————————————————————————————————————
  const state = {
    storeData: null,
    analysisData: null,
    creativesData: null,
    chatMessages: [],
    activeTab: 'dashboard',
  };

  // ——————————————————————————————————————————————————————————
  // Utility — XSS-safe escaper
  // ——————————————————————————————————————————————————————————
  function esc(str) {
    if (str == null) return '';
    const d = document.createElement('div');
    d.appendChild(document.createTextNode(String(str)));
    return d.innerHTML;
  }

  // ——————————————————————————————————————————————————————————
  // DOM helpers
  // ——————————————————————————————————————————————————————————
  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

  function show(el) { el?.classList.remove('hidden'); }
  function hide(el) { el?.classList.add('hidden'); }
  function toggle(el, force) { el?.classList.toggle('hidden', !force); }

  // ——————————————————————————————————————————————————————————
  // Inject SVG gradient defs (needed for stroke gradients)
  // ——————————————————————————————————————————————————————————
  function injectSVGDefs() {
    const ns = 'http://www.w3.org/2000/svg';
    const defs = document.createElementNS(ns, 'svg');
    defs.setAttribute('width', '0');
    defs.setAttribute('height', '0');
    defs.style.position = 'absolute';
    defs.innerHTML = `
      <defs>
        <linearGradient id="scoreGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#8b5cf6"/>
          <stop offset="100%" stop-color="#6d28d9"/>
        </linearGradient>
        <linearGradient id="loadGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#8b5cf6"/>
          <stop offset="100%" stop-color="#a78bfa"/>
        </linearGradient>
      </defs>`;
    document.body.prepend(defs);
  }

  // ——————————————————————————————————————————————————————————
  // Tab switching
  // ——————————————————————————————————————————————————————————
  function initTabs() {
    $$('.sp-tab').forEach(tab => {
      tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });
  }

  function switchTab(name) {
    state.activeTab = name;

    $$('.sp-tab').forEach(t => {
      const active = t.dataset.tab === name;
      t.classList.toggle('active', active);
      t.setAttribute('aria-selected', String(active));
    });

    $$('.sp-panel').forEach(p => {
      const active = p.id === `panel-${name}`;
      p.classList.toggle('active', active);
    });
  }

  // ——————————————————————————————————————————————————————————
  // Chrome messaging helpers
  // ——————————————————————————————————————————————————————————
  function sendMsg(type, payload = {}) {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage({ type, ...payload }, response => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(response);
          }
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  // ——————————————————————————————————————————————————————————
  // Dashboard — Populate X-Ray
  // ——————————————————————————————————————————————————————————
  function populateXRay(data) {
    if (!data) return;
    state.storeData = data;

    hide($('#dashboardEmpty'));
    show($('#xraySection'));
    show($('#actionsSection'));

    $('#storeName').textContent = data.storeName || data.name || 'Unknown Store';
    $('#platformBadge').textContent = data.platform || 'Unknown';
    $('#productsCount').textContent = data.productsCount ?? data.products?.length ?? '—';

    if (data.priceRange) {
      $('#priceRange').textContent = data.priceRange;
    } else if (data.minPrice != null && data.maxPrice != null) {
      $('#priceRange').textContent = `$${data.minPrice} – $${data.maxPrice}`;
    } else {
      $('#priceRange').textContent = '—';
    }

    const kwContainer = $('#keywordsContainer');
    kwContainer.innerHTML = '';
    const keywords = data.keywords || data.tags || [];
    keywords.slice(0, 12).forEach(kw => {
      const span = document.createElement('span');
      span.className = 'sp-keyword';
      span.textContent = kw;
      kwContainer.appendChild(span);
    });
  }

  // ——————————————————————————————————————————————————————————
  // Dashboard — Populate Threat Radar
  // ——————————————————————————————————————————————————————————
  function populateRadar(data) {
    if (!data) return;
    state.analysisData = data;
    show($('#radarSection'));
    show($('#gapSection'));

    const overall = data.overall_score ?? data.overallScore ?? data.score ?? 0;
    $('#overallScore').textContent = overall;

    // Animate score ring
    const circumference = 2 * Math.PI * 58; // r=58
    const offset = circumference - (overall / 100) * circumference;
    const ring = $('#scoreRing');
    if (ring) {
      ring.style.strokeDasharray = circumference;
      // Trigger reflow for animation
      ring.style.strokeDashoffset = circumference;
      requestAnimationFrame(() => {
        ring.style.strokeDashoffset = offset;
      });
    }

    // Map analyst's gap_scorecard to dimension bars
    const scorecard = data.gap_scorecard || {};
    const dims = {
      positioning: scorecard.positioning?.score ?? data.positioning ?? 0,
      pricing:     scorecard.pricing?.score     ?? data.pricing     ?? 0,
      features:    scorecard.features?.score    ?? data.features    ?? 0,
      marketing:   scorecard.marketing?.score   ?? data.marketing   ?? 0,
    };

    Object.entries(dims).forEach(([key, val]) => {
      const bar = $(`#bar${capitalize(key)}`);
      const valEl = $(`#val${capitalize(key)}`);
      if (bar) {
        bar.style.width = '0%';
        requestAnimationFrame(() => { bar.style.width = `${val}%`; });
      }
      if (valEl) valEl.textContent = val;
    });

    // Gap analysis (convert scorecard object to array if needed)
    let gaps = data.gaps || data.gapAnalysis || [];
    if (gaps.length === 0 && data.gap_scorecard) {
      gaps = Object.entries(data.gap_scorecard).map(([category, details]) => ({
        title: `${capitalize(category)} Gap`,
        description: details.gap || `Comparison between your ${category} and competitors.`,
        severity: details.severity || 'medium'
      }));
    }
    populateGaps(gaps);
  }

  function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  // ——————————————————————————————————————————————————————————
  // Dashboard — Gap Analysis
  // ——————————————————————————————————————————————————————————
  function populateGaps(gaps) {
    const list = $('#gapList');
    list.innerHTML = '';

    if (!gaps || !gaps.length) {
      list.innerHTML = '<p class="sp-empty-sm" style="color:var(--text-muted);font-size:12px;">No gaps identified.</p>';
      return;
    }

    gaps.forEach(gap => {
      const sev = (gap.severity || 'medium').toLowerCase();
      const card = document.createElement('div');
      card.className = `sp-gap-card severity-${sev}`;
      card.innerHTML = `
        <div class="sp-gap-title">${esc(gap.title || gap.name)}</div>
        <div class="sp-gap-desc">${esc(gap.description || gap.detail || gap.gap || '')}</div>
        <span class="sp-gap-severity">${esc(sev)}</span>`;
      list.appendChild(card);
    });
  }

  // ——————————————————————————————————————————————————————————
  // Dashboard — History
  // ——————————————————————————————————————————————————————————
  function populateHistory(historyData) {
    const list = $('#historyList');
    list.innerHTML = '';

    if (!historyData || !historyData.length) {
      list.innerHTML = '<div class="sp-empty-sm" id="historyEmpty"><p>No past analyses yet.</p></div>';
      return;
    }

    historyData.forEach(item => {
      const card = document.createElement('div');
      card.className = 'sp-history-card';
      card.dataset.id = item.id || '';
      const score = item.score ?? item.overallScore ?? '—';
      const date = item.date ? new Date(item.date).toLocaleDateString() : '';
      card.innerHTML = `
        <div class="sp-history-score">${esc(score)}</div>
        <div class="sp-history-info">
          <div class="sp-history-name">${esc(item.storeName || item.name || 'Unknown')}</div>
          <div class="sp-history-date">${esc(date)}</div>
        </div>`;
      card.addEventListener('click', () => loadHistoryItem(item));
      list.appendChild(card);
    });
  }

  function loadHistoryItem(item) {
    if (item.storeData) populateXRay(item.storeData);
    if (item.analysisData) populateRadar(item.analysisData);
  }

  // ——————————————————————————————————————————————————————————
  // Dashboard — Loading state
  // ——————————————————————————————————————————————————————————
  function showLoading() {
    hide($('#dashboardEmpty'));
    hide($('#xraySection'));
    hide($('#radarSection'));
    hide($('#gapSection'));
    hide($('#actionsSection'));
    show($('#loadingState'));
    setLoadingPhase('scout', 0);
  }

  function hideLoading() {
    hide($('#loadingState'));
    // Reset phases
    $$('.sp-phase').forEach(p => {
      p.classList.remove('active', 'done');
    });
  }

  function setLoadingPhase(phase, pct) {
    const phases = ['scout', 'analyst', 'creative'];
    const idx = phases.indexOf(phase);

    phases.forEach((p, i) => {
      const el = $(`#phase-${p}`);
      if (i < idx) {
        el.classList.remove('active');
        el.classList.add('done');
      } else if (i === idx) {
        el.classList.add('active');
        el.classList.remove('done');
      } else {
        el.classList.remove('active', 'done');
      }
    });

    $('#loadingPct').textContent = `${Math.round(pct)}%`;

    // Animate ring
    const circumference = 2 * Math.PI * 52; // r=52
    const ring = $('.sp-ring-progress');
    if (ring) {
      ring.style.strokeDasharray = circumference;
      ring.style.strokeDashoffset = circumference - (pct / 100) * circumference;
    }
  }

  // ——————————————————————————————————————————————————————————
  // Dashboard — Error display
  // ——————————————————————————————————————————————————————————
  function showDashboardError(msg) {
    const el = $('#dashboardError');
    el.textContent = msg;
    show(el);
  }

  function hideDashboardError() {
    hide($('#dashboardError'));
  }

  // ——————————————————————————————————————————————————————————
  // Dashboard — Actions
  // ——————————————————————————————————————————————————————————
  async function handleScanPage() {
    hideDashboardError();
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) throw new Error('No active tab found.');

      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js'],
      });

      // Give content script time to initialise, then request data
      setTimeout(async () => {
        try {
          const response = await chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_STORE_DATA' });
          
          if (response?.error === 'ADMIN_PORTAL') {
            showDashboardError('You are on the store admin dashboard! Please open the live public storefront (e.g. yourstore.com) to scan products.');
            return;
          }

          if (response?.success && response?.data) {
            state.storeData = response.data;
            populateXRay(response.data);
            // Cache it in background
            chrome.runtime.sendMessage({ type: 'STORE_DATA_EXTRACTED', data: response.data });
          } else {
            showDashboardError('Could not detect a store on this page. Navigate to a Shopify or WooCommerce store.');
          }
        } catch (err) {
          showDashboardError('Could not communicate with the page. Try refreshing the page.');
        }
      }, 500);
    } catch (err) {
      showDashboardError(err.message);
    }
  }

  async function handleAnalyze() {
    hideDashboardError();

    // Check API key first
    try {
      const keyResult = await sendMsg('CHECK_API_KEY');
      if (!keyResult?.hasKey) {
        showDashboardError('Set up your API key in Settings before analyzing.');
        return;
      }
    } catch {
      // continue — background may handle it differently
    }

    if (!state.storeData) {
      showDashboardError('Scan a store page first before analyzing.');
      return;
    }

    showLoading();

    try {
      const result = await sendMsg('ANALYZE_STORE', { storeData: state.storeData });
      hideLoading();

      if (result?.error) {
        showDashboardError(result.error);
        show($('#dashboardEmpty'));
        return;
      }

      if (result?.analysisData) {
        populateRadar(result.analysisData);
        show($('#xraySection'));
        show($('#actionsSection'));
      }

      // Refresh history
      loadHistory();
    } catch (err) {
      hideLoading();
      showDashboardError('Analysis failed: ' + err.message);
      show($('#dashboardEmpty'));
    }
  }

  async function loadHistory() {
    try {
      const result = await sendMsg('GET_HISTORY');
      populateHistory(result?.history || []);
    } catch {
      // Silent fail for history
    }
  }

  // ——————————————————————————————————————————————————————————
  // Chat
  // ——————————————————————————————————————————————————————————
  function appendChatBubble(text, sender) {
    const container = $('#chatMessages');

    // Remove welcome if first message
    const welcome = $('.sp-chat-welcome', container);
    if (welcome) welcome.remove();

    const bubble = document.createElement('div');
    bubble.className = `sp-bubble sp-bubble-${sender}`;

    const content = document.createElement('span');
    content.textContent = text;
    bubble.appendChild(content);

    const time = document.createElement('span');
    time.className = 'sp-bubble-time';
    time.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    bubble.appendChild(time);

    container.appendChild(bubble);
    container.scrollTop = container.scrollHeight;
  }

  function showTypingIndicator() {
    const container = $('#chatMessages');
    const typing = document.createElement('div');
    typing.className = 'sp-typing';
    typing.id = 'typingIndicator';
    typing.innerHTML = '<span class="sp-typing-dot"></span><span class="sp-typing-dot"></span><span class="sp-typing-dot"></span>';
    container.appendChild(typing);
    container.scrollTop = container.scrollHeight;
  }

  function removeTypingIndicator() {
    const el = $('#typingIndicator');
    if (el) el.remove();
  }

  async function sendChat() {
    const input = $('#chatInput');
    const text = input.value.trim();
    if (!text) return;

    input.value = '';
    input.style.height = 'auto';
    hide($('#chatError'));

    appendChatBubble(text, 'user');
    state.chatMessages.push({ role: 'user', content: text });

    showTypingIndicator();

    try {
      const result = await sendMsg('CHAT_MESSAGE', {
        message: text,
        storeData: state.storeData,
        analysisData: state.analysisData,
        history: state.chatMessages,
      });

      removeTypingIndicator();

      if (result?.error) {
        const errEl = $('#chatError');
        errEl.textContent = result.error;
        show(errEl);
        return;
      }

      const reply = result?.response || result?.message || 'I couldn\'t generate a response.';
      appendChatBubble(reply, 'ai');
      state.chatMessages.push({ role: 'ai', content: reply });
    } catch (err) {
      removeTypingIndicator();
      const errEl = $('#chatError');
      errEl.textContent = 'Failed to get response: ' + err.message;
      show(errEl);
    }
  }

  // ——————————————————————————————————————————————————————————
  // Creatives
  // ——————————————————————————————————————————————————————————
  async function handleGenerateCreatives() {
    hide($('#creativesError'));

    if (!state.storeData && !state.analysisData) {
      const errEl = $('#creativesError');
      errEl.textContent = 'Run a store analysis first before generating creatives.';
      show(errEl);
      return;
    }

    // Show loading state on button
    const btn = $('#genCreativesEmptyBtn');
    if (btn) btn.textContent = '⏳ Generating…';

    try {
      const result = await sendMsg('GENERATE_CREATIVES', {
        storeData: state.storeData,
        analysisData: state.analysisData,
      });

      if (result?.error) {
        const errEl = $('#creativesError');
        errEl.textContent = result.error;
        show(errEl);
        if (btn) btn.textContent = '✦ Generate Creatives';
        return;
      }

      if (result?.creatives) {
        populateCreatives(result.creatives);
      }
    } catch (err) {
      const errEl = $('#creativesError');
      errEl.textContent = 'Generation failed: ' + err.message;
      show(errEl);
      if (btn) btn.textContent = '✦ Generate Creatives';
    }
  }

  function populateCreatives(data) {
    if (!data) return;
    state.creativesData = data;

    hide($('#creativesEmpty'));
    show($('#creativesList'));

    // Fill content
    const fill = (id, content) => {
      const el = $(`#${id}`);
      if (el) el.textContent = content || '';
    };

    fill('tiktokContent', data.tiktok || data.tiktokScript || '');
    fill('metaContent',   data.meta   || data.metaAd       || '');
    fill('emailContent',  data.email  || data.emailCopy     || '');
  }

  function handleCopy(targetId) {
    const el = $(`#${targetId}`);
    if (!el) return;

    const text = el.textContent;
    navigator.clipboard.writeText(text).then(() => {
      // Find the copy button associated with this target
      const btn = $(`.copy-btn[data-target="${targetId}"]`);
      if (btn) {
        btn.classList.add('copied');
        const orig = btn.textContent;
        btn.textContent = '✓';
        setTimeout(() => {
          btn.classList.remove('copied');
          btn.textContent = orig;
        }, 1500);
      }
    });
  }

  function handleEdit(targetId) {
    const bodyEl = $(`#${targetId}`);
    if (!bodyEl) return;

    // Derive edit textarea id: e.g. tiktokContent → tiktokEdit
    const editId = targetId.replace('Content', 'Edit');
    const editEl = $(`#${editId}`);
    if (!editEl) return;

    const isHidden = editEl.classList.contains('hidden');
    if (isHidden) {
      editEl.value = bodyEl.textContent;
      show(editEl);
      editEl.focus();
    } else {
      bodyEl.textContent = editEl.value;
      hide(editEl);
    }
  }

  async function handleRegenCreatives() {
    state.creativesData = null;
    hide($('#creativesList'));
    show($('#creativesEmpty'));
    await handleGenerateCreatives();
  }

  // ——————————————————————————————————————————————————————————
  // Settings
  // ——————————————————————————————————————————————————————————
  function createKeyRow(value = '') {
    const row = document.createElement('div');
    row.className = 'sp-input-group';
    row.innerHTML = `
      <input type="password" class="sp-input sp-key-input" placeholder="Enter API key (AIzaSy...)" value="${esc(value)}" autocomplete="off">
      <button class="sp-icon-btn sp-key-vis-btn" aria-label="Toggle visibility">👁</button>
      <button class="sp-icon-btn sp-key-del-btn" aria-label="Delete key" style="color:#ef4444;">✕</button>
    `;
    
    row.querySelector('.sp-key-vis-btn').addEventListener('click', () => {
      const input = row.querySelector('.sp-key-input');
      input.type = input.type === 'password' ? 'text' : 'password';
    });

    row.querySelector('.sp-key-del-btn').addEventListener('click', () => {
      row.remove();
      if ($$('.sp-key-input').length === 0) createKeyRow();
    });

    $('#apiKeysContainer').appendChild(row);
  }

  async function loadApiKey() {
    try {
      const result = await chrome.storage.local.get('gemini_api_key');
      const container = $('#apiKeysContainer');
      container.innerHTML = '';
      
      if (result?.gemini_api_key) {
        const keys = result.gemini_api_key.split(',').map(k => k.trim()).filter(Boolean);
        if (keys.length > 0) {
          keys.forEach(k => createKeyRow(k));
        } else {
          createKeyRow();
        }
      } else {
        createKeyRow();
      }
    } catch {
      createKeyRow();
    }
  }

  async function handleSaveKey() {
    const inputs = $$('.sp-key-input');
    const keys = inputs.map(input => input.value.trim()).filter(k => k.length > 10);
    const rawInput = keys.join(',');
    
    const status = $('#settingsStatus');
    const saveBtn = $('#saveKeyBtn');

    if (keys.length === 0) {
      status.textContent = '❌ No valid keys found. Keys should start with AIzaSy...';
      status.className = 'sp-status error';
      show(status);
      return;
    }

    // Disable button while testing
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = `Testing ${keys.length} key${keys.length > 1 ? 's' : ''}...`; }

    // Test only the FIRST key
    const testKey = keys[0];

    try {
      const testUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent';
      const resp = await fetch(testUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': testKey },
        body: JSON.stringify({ contents: [{ parts: [{ text: 'Say OK' }] }] }),
      });

      if (resp.status === 429) {
        await chrome.storage.local.set({ gemini_api_key: rawInput });
        status.textContent = keys.length > 1
          ? `✅ ${keys.length} keys saved! Key #1 is rate limited — PRYZM will auto-rotate to others.`
          : '✅ Key saved! Rate limited right now — wait a minute before analyzing.';
        status.className = 'sp-status success';
      } else if (!resp.ok) {
        status.textContent = '❌ First key is invalid. Make sure it starts with AIzaSy... from aistudio.google.com/apikey';
        status.className = 'sp-status error';
      } else {
        await chrome.storage.local.set({ gemini_api_key: rawInput });
        status.textContent = keys.length > 1
          ? `✅ ${keys.length} keys saved! PRYZM will rotate between them automatically.`
          : '✅ API key saved! Switch to Dashboard to start analyzing.';
        status.className = 'sp-status success';
      }
    } catch (err) {
      await chrome.storage.local.set({ gemini_api_key: rawInput });
      status.textContent = '⚠️ Could not validate (network error), but key(s) saved.';
      status.className = 'sp-status success';
    }

    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save All Keys'; }
    show(status);
    setTimeout(() => hide(status), 6000);
  }

  async function handleClearCache() {
    try {
      await sendMsg('CLEAR_CACHE');
      state.storeData = null;
      state.analysisData = null;
      state.creativesData = null;
      state.chatMessages = [];

      // Reset dashboard
      show($('#dashboardEmpty'));
      hide($('#xraySection'));
      hide($('#radarSection'));
      hide($('#gapSection'));
      hide($('#actionsSection'));

      // Reset creatives
      show($('#creativesEmpty'));
      hide($('#creativesList'));

      // Reset chat
      const chatContainer = $('#chatMessages');
      chatContainer.innerHTML = `
        <div class="sp-chat-welcome">
          <div class="sp-chat-welcome-icon">◆</div>
          <h3>PRYZM Intelligence</h3>
          <p>Ask me anything about your store, competitors, or market strategy.</p>
        </div>`;

      // Reset history
      populateHistory([]);
    } catch {
      // silent
    }
  }

  // ——————————————————————————————————————————————————————————
  // Incoming messages (progress updates from background)
  // ——————————————————————————————————————————————————————————
  function initMessageListener() {
    chrome.runtime.onMessage.addListener((message, _sender, _sendResponse) => {
      if (!message?.type) return;

      switch (message.type) {
        case 'AGENT_PROGRESS': {
          const d = message.data || message;
          const agentName = (d.agent || '').toLowerCase();
          const agentStatus = d.status || '';

          // Map agent name → loading phase
          const phaseMap = { scout: 'scout', analyst: 'analyst', creative: 'creative' };
          const phase = phaseMap[agentName] || agentName;

          // Calculate percentage based on agent + status
          let pct = 0;
          if (agentName === 'scout') {
            pct = agentStatus === 'searching' ? 10 :
                  agentStatus === 'found' ? 20 :
                  agentStatus === 'tool' ? 30 :
                  agentStatus === 'thinking' ? 25 :
                  agentStatus === 'done' ? 40 : 15;
          } else if (agentName === 'analyst') {
            pct = agentStatus === 'starting' ? 45 :
                  agentStatus === 'tool' ? 60 :
                  agentStatus === 'thinking' ? 55 :
                  agentStatus === 'done' ? 75 : 50;
          } else if (agentName === 'creative') {
            pct = agentStatus === 'starting' ? 80 :
                  agentStatus === 'tool' ? 85 :
                  agentStatus === 'thinking' ? 85 :
                  agentStatus === 'done' ? 95 : 80;
          }

          if (phase) setLoadingPhase(phase, pct);

          // Update status text
          const statusText = d.message || `${d.agent || 'Agent'} — ${agentStatus}${d.tool ? ` (${d.tool})` : ''}`;
          const pctEl = $('#loadingPct');
          if (pctEl) pctEl.textContent = `${Math.round(pct)}%`;

          break;
        }

        case 'STORE_DATA_EXTRACTED': {
          if (message.storeData) {
            populateXRay(message.storeData);
          }
          break;
        }

        case 'CREATIVES_GENERATED': {
          if (message.creatives) {
            populateCreatives(message.creatives);
          }
          break;
        }
      }
    });
  }

  // ——————————————————————————————————————————————————————————
  // Auto-resize chat input
  // ——————————————————————————————————————————————————————————
  function initChatInput() {
    const input = $('#chatInput');

    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 80) + 'px';
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendChat();
      }
    });
  }

  // ——————————————————————————————————————————————————————————
  // Bind all event handlers
  // ——————————————————————————————————————————————————————————
  function bindEvents() {
    // Close panel
    $('#closePanel').addEventListener('click', () => {
      window.close();
    });

    // Dashboard buttons
    $('#scanPageBtn').addEventListener('click', handleScanPage);
    $('#rescanBtn').addEventListener('click', handleScanPage);
    $('#analyzeBtn').addEventListener('click', handleAnalyze);
    $('#clearHistoryBtn').addEventListener('click', async () => {
      try {
        await sendMsg('CLEAR_CACHE');
        populateHistory([]);
      } catch { /* silent */ }
    });

    // Chat
    $('#chatSendBtn').addEventListener('click', sendChat);

    // Creatives
    $('#genCreativesEmptyBtn').addEventListener('click', handleGenerateCreatives);
    $('#regenCreativesBtn').addEventListener('click', handleRegenCreatives);

    // Creative copy/edit buttons (event delegation)
    $$('.copy-btn').forEach(btn => {
      btn.addEventListener('click', () => handleCopy(btn.dataset.target));
    });
    $$('.edit-btn').forEach(btn => {
      btn.addEventListener('click', () => handleEdit(btn.dataset.target));
    });

    // Settings
    $('#saveKeyBtn').addEventListener('click', handleSaveKey);
    $('#addKeyRowBtn').addEventListener('click', () => createKeyRow());
    $('#clearCacheBtn').addEventListener('click', handleClearCache);
  }

  // ——————————————————————————————————————————————————————————
  // Initialise on load
  // ——————————————————————————————————————————————————————————
  async function init() {
    injectSVGDefs();
    initTabs();
    initChatInput();
    bindEvents();
    initMessageListener();

    // Load settings
    loadApiKey();

    // Try to load cached data
    try {
      const cached = await sendMsg('GET_CACHED_DATA');
      if (cached?.storeData) {
        populateXRay(cached.storeData);
      }
      if (cached?.analysisData) {
        populateRadar(cached.analysisData);
      }
      if (cached?.creativesData) {
        populateCreatives(cached.creativesData);
      }
    } catch {
      // No cached data — show empty state
    }

    // Load history
    loadHistory();
  }

  // Wait for DOM
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
