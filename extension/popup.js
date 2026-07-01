/**
 * PRYZM — Popup UI Controller (v2)
 * ==================================
 * No demo data. No fake results.
 * Shows real data from the content script, or shows "No store detected."
 * Communicates with the backend's real agent pipeline.
 */

// ============================================================
// STATE
// ============================================================
const state = { storeData: null, analysisData: null, creativesData: null };

// ============================================================
// INIT
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  bindButtons();

  // Try to get cached data from background.js
  try {
    chrome.runtime.sendMessage({ type: 'GET_CACHED_DATA' }, (resp) => {
      if (chrome.runtime.lastError || !resp) {
        // No background — show empty state
        switchView('xray');
        return;
      }
      if (resp.analysisData) {
        state.storeData = resp.storeData;
        state.analysisData = resp.analysisData;
        populateXRay(state.storeData);
        populateRadar(state.analysisData);
        switchView('radar');
      } else if (resp.storeData) {
        state.storeData = resp.storeData;
        populateXRay(state.storeData);
        switchView('xray');
      } else {
        // No cached data — try extracting from current page
        tryExtractFromPage();
      }
    });
  } catch (e) {
    switchView('xray');
  }
});

function tryExtractFromPage() {
  try {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]) return switchView('xray');
      chrome.tabs.sendMessage(tabs[0].id, { type: 'EXTRACT_STORE_DATA' }, (resp) => {
        if (chrome.runtime.lastError || !resp || !resp.success || !resp.data) {
          // No store on this page — show empty state (this is CORRECT behavior)
          switchView('xray');
          return;
        }
        const data = resp.data;
        // Only use this data if it actually has products or a detected platform
        if (data.products?.length > 0 || data.platform !== 'unknown') {
          state.storeData = data;
          populateXRay(data);
        }
        switchView('xray');
      });
    });
  } catch (e) {
    switchView('xray');
  }
}

// ============================================================
// BUTTON BINDINGS
// ============================================================
function bindButtons() {
  on('btn-scan', 'click', scanPage);
  on('btn-analyze', 'click', startAnalysis);
  on('btn-view-gaps', 'click', () => { populateGaps(state.analysisData); switchView('gaps'); });
  on('btn-gen-creatives', 'click', generateCreatives);
  on('btn-back-gaps', 'click', () => switchView('radar'));
  on('btn-back-actions', 'click', () => switchView('radar'));
  on('btn-regenerate', 'click', generateCreatives);
  on('btn-retry', 'click', startAnalysis);
}

function on(id, event, handler) {
  const el = document.getElementById(id);
  if (el) el.addEventListener(event, handler);
}

// ============================================================
// VIEW SWITCHING
// ============================================================
function switchView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const target = document.getElementById(`view-${name}`);
  if (target) {
    target.classList.add('active');
    // Trigger score bar animations
    setTimeout(() => {
      target.querySelectorAll('.score-bar-fill').forEach(bar => {
        bar.style.width = bar.dataset.width || '0%';
      });
    }, 100);
  }
}

// ============================================================
// VIEW 1: X-RAY
// ============================================================
function populateXRay(data) {
  if (!data || (!data.products?.length && data.platform === 'unknown')) {
    // No real store detected — keep showing empty state
    show('xray-empty');
    hide('xray-data');
    return;
  }

  hide('xray-empty');
  show('xray-data');

  setText('store-name', data.store_name || 'Unknown Store');
  setText('store-url', data.url || '');

  const badge = document.getElementById('platform-badge');
  if (badge) {
    const p = (data.platform || 'unknown').toLowerCase();
    badge.textContent = p === 'shopify' ? 'Shopify' : p === 'woocommerce' ? 'WooCommerce' : 'Unknown';
    badge.className = 'platform-badge badge-' + (p === 'shopify' ? 'shopify' : p === 'woocommerce' ? 'woocommerce' : 'unknown');
  }

  const products = data.products || [];
  setText('metric-products', products.length);
  setText('metric-price', getPriceRange(products));
  setText('metric-platform', capitalize(data.platform || 'unknown'));

  const kwContainer = document.getElementById('keyword-tags');
  if (kwContainer) {
    const keywords = data.niche_signals?.keywords || [];
    kwContainer.innerHTML = keywords.slice(0, 8).map(k =>
      `<span class="keyword-tag">${esc(k)}</span>`
    ).join('');
  }

  setText('meta-desc', data.niche_signals?.meta_description || '—');
}

function scanPage() {
  try {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]) return;
      // Inject content script if needed
      chrome.scripting.executeScript({
        target: { tabId: tabs[0].id },
        files: ['content.js']
      }, () => {
        setTimeout(() => {
          chrome.tabs.sendMessage(tabs[0].id, { type: 'EXTRACT_STORE_DATA' }, (resp) => {
            if (chrome.runtime.lastError || !resp || !resp.success || !resp.data) {
              // Show error — genuinely no store here
              showError('No e-commerce store detected on this page. Navigate to a Shopify or WooCommerce store and try again.');
              return;
            }
            const data = resp.data;
            if (data.products?.length > 0 || data.platform !== 'unknown') {
              state.storeData = data;
              populateXRay(data);
            } else {
              showError('This page doesn\'t appear to be an e-commerce store. PRYZM works best on Shopify and WooCommerce product pages.');
            }
          });
        }, 500);
      });
    });
  } catch (e) {
    showError('Unable to scan this page. Make sure you\'re on an e-commerce store.');
  }
}

// ============================================================
// VIEW 2: LOADING
// ============================================================
function startAnalysis() {
  if (!state.storeData) {
    showError('No store data available. Please scan a store page first.');
    return;
  }

  switchView('loading');

  // Animate phases
  const phases = document.querySelectorAll('.phase-step');
  let current = 0;
  phases.forEach((p, i) => { p.classList.toggle('active', i === 0); p.classList.remove('done'); });

  const interval = setInterval(() => {
    if (current < phases.length) { phases[current].classList.remove('active'); phases[current].classList.add('done'); }
    current++;
    if (current < phases.length) phases[current].classList.add('active');
  }, 3000);

  // Call the REAL backend
  chrome.runtime.sendMessage({ type: 'ANALYZE_STORE', data: state.storeData }, (resp) => {
    clearInterval(interval);
    if (chrome.runtime.lastError || !resp || resp.error) {
      const msg = resp?.message || resp?.error || 'Backend is not running. Start it with: cd backend-server && node server.js';
      showError(msg);
      return;
    }
    // Unwrap backend response: { success, gap_analysis }
    state.analysisData = resp.gap_analysis || resp;
    if (resp.creatives) state.creativesData = resp.creatives;
    populateRadar(state.analysisData);
    switchView('radar');
  });
}

// ============================================================
// VIEW 3: THREAT RADAR
// ============================================================
function populateRadar(data) {
  if (!data) return;

  const scoreNum = document.getElementById('score-number');
  const scoreRing = document.getElementById('score-ring');
  if (scoreNum) {
    scoreNum.textContent = data.overall_score || '?';
    const color = getColor(data.overall_score || 0);
    scoreNum.style.color = `var(--${color})`;
    if (scoreRing) scoreRing.style.borderColor = `var(--${color})`;
  }

  const barsContainer = document.getElementById('score-bars');
  if (barsContainer && data.gap_scorecard) {
    const dims = [
      { key: 'positioning', label: 'Positioning', icon: '🎯' },
      { key: 'pricing', label: 'Pricing', icon: '💰' },
      { key: 'features', label: 'Features', icon: '📦' },
      { key: 'marketing', label: 'Marketing', icon: '📣' }
    ];

    barsContainer.innerHTML = dims.map(d => {
      const dim = data.gap_scorecard[d.key];
      const score = dim?.score || 0;
      const color = getColor(score);
      return `
        <div class="score-row">
          <span class="score-label">${d.icon} ${d.label}</span>
          <div class="score-bar-track">
            <div class="score-bar-fill ${color}" data-width="${score}%" style="width:0%"></div>
          </div>
          <span class="score-number ${color}">${score}</span>
        </div>
      `;
    }).join('');
  }

  setText('ai-summary', data.ai_summary || 'Analysis complete.');

  const compList = document.getElementById('competitor-list');
  if (compList) {
    compList.innerHTML = (data.competitors_analyzed || []).map(c =>
      `<span class="competitor-chip">${esc(c)}</span>`
    ).join('');
  }
}

// ============================================================
// VIEW 4: GAP ANALYSIS
// ============================================================
function populateGaps(data) {
  if (!data) return;
  const container = document.getElementById('gap-cards');
  if (!container) return;

  const dims = [
    { key: 'positioning', label: 'Positioning & Value Proposition', icon: '🎯' },
    { key: 'pricing', label: 'Pricing Strategy', icon: '💰' },
    { key: 'features', label: 'Feature Offerings', icon: '📦' },
    { key: 'marketing', label: 'Marketing & Content Hooks', icon: '📣' }
  ];

  container.innerHTML = dims.map(d => {
    const dim = data.gap_scorecard?.[d.key];
    if (!dim) return '';
    const color = getColor(dim.score);
    return `
      <div class="card gap-card ${dim.severity}" style="animation: fadeInUp 0.4s ease forwards;">
        <div class="gap-header">
          <span class="gap-dimension">${d.icon} ${d.label}</span>
          <span class="badge badge-${dim.severity}">${dim.severity}</span>
        </div>
        <div class="score-row" style="margin:8px 0;">
          <span class="score-label">Score</span>
          <div class="score-bar-track"><div class="score-bar-fill ${color}" style="width:${dim.score}%"></div></div>
          <span class="score-number ${color}">${dim.score}</span>
        </div>
        <div class="gap-comparison">
          <div class="gap-side"><div class="gap-side-label you">You</div><div class="gap-side-text">${esc(dim.you)}</div></div>
          <div class="gap-side"><div class="gap-side-label them">Competitors</div><div class="gap-side-text">${esc(dim.competitors)}</div></div>
        </div>
        <div class="gap-description">${esc(dim.gap)}</div>
      </div>
    `;
  }).join('');

  // Hook DNA
  const hookSection = document.getElementById('hook-section');
  const hookCards = document.getElementById('hook-cards');
  if (data.hook_breakdown?.length > 0 && hookSection && hookCards) {
    hookSection.classList.remove('hidden');
    hookCards.innerHTML = data.hook_breakdown.map(h => {
      const c = h.effectiveness_score >= 7 ? 'green' : h.effectiveness_score >= 4 ? 'yellow' : 'red';
      return `
        <div class="card hook-card" style="animation: fadeInUp 0.4s ease forwards;">
          <div class="hook-type">${esc(h.type)}</div>
          <div class="hook-quote">"${esc(h.transcript_quote)}"</div>
          <div class="hook-trigger">🧠 <strong>Trigger:</strong> ${esc(h.psychological_trigger)}</div>
          <div class="hook-score">
            <span style="font-size:11px;color:var(--text-muted);">Effectiveness:</span>
            <div class="score-bar-track" style="max-width:120px;"><div class="score-bar-fill ${c}" style="width:${h.effectiveness_score * 10}%"></div></div>
            <span class="score-number ${c}">${h.effectiveness_score}/10</span>
          </div>
        </div>
      `;
    }).join('');
  }
}

// ============================================================
// VIEW 5: ACTION HUB
// ============================================================
function generateCreatives() {
  if (state.creativesData) {
    populateActions(state.creativesData);
    switchView('actions');
    return;
  }

  if (!state.analysisData) {
    showError('Run analysis first before generating creatives.');
    return;
  }

  switchView('loading');
  chrome.runtime.sendMessage({
    type: 'GENERATE_CREATIVES',
    data: { analysis: state.analysisData, store: state.storeData }
  }, (resp) => {
    if (chrome.runtime.lastError || !resp || resp.error) {
      showError(resp?.message || 'Failed to generate creatives. Is the backend running?');
      return;
    }
    state.creativesData = resp.prescriptions || resp;
    populateActions(state.creativesData);
    switchView('actions');
  });
}

function populateActions(creatives) {
  const container = document.getElementById('creative-cards');
  if (!container || !creatives) return;

  const icons = { 'TikTok/Reel Script': '🎬', 'Meta Ad Copy': '📱', 'Email Subject Line': '📧' };

  container.innerHTML = (Array.isArray(creatives) ? creatives : []).map((c, i) => `
    <div class="card creative-card" style="animation: fadeInUp 0.4s ease forwards; animation-delay: ${i * 80}ms;">
      <div class="creative-header">
        <span class="creative-platform">${icons[c.format] || '📝'} ${esc(c.format)}</span>
        <span class="badge badge-low">Ready</span>
      </div>
      <div class="creative-hook">"${esc(c.hook_text)}"</div>
      <div class="creative-body">${esc(c.body_creative).replace(/\n/g, '<br>')}</div>
      <div class="creative-cta">CTA: ${esc(c.cta)}</div>
      <textarea class="creative-edit-area" id="edit-${i}">${c.hook_text}\n\n${c.body_creative}\n\n${c.cta}</textarea>
      <div class="creative-actions">
        <button class="btn-secondary btn-sm" id="copy-${i}" onclick="copyScript(${i})">📋 Copy</button>
        <button class="btn-secondary btn-sm" onclick="toggleEdit(${i})">✏️ Edit</button>
      </div>
    </div>
  `).join('');
}

// ============================================================
// ERROR VIEW
// ============================================================
function showError(message) {
  setText('error-message', message);
  switchView('error');
}

// ============================================================
// CLIPBOARD & EDIT
// ============================================================
function copyScript(index) {
  const creatives = state.creativesData;
  if (!creatives?.[index]) return;
  const c = creatives[index];
  const editArea = document.getElementById(`edit-${index}`);
  const text = editArea?.classList.contains('active') ? editArea.value : `${c.hook_text}\n\n${c.body_creative}\n\n${c.cta}`;
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById(`copy-${index}`);
    if (btn) { btn.textContent = '✓ Copied!'; btn.classList.add('copied'); setTimeout(() => { btn.textContent = '📋 Copy'; btn.classList.remove('copied'); }, 2000); }
  }).catch(console.error);
}

function toggleEdit(index) {
  const el = document.getElementById(`edit-${index}`);
  if (el) { el.classList.toggle('active'); if (el.classList.contains('active')) el.focus(); }
}

window.copyScript = copyScript;
window.toggleEdit = toggleEdit;

// ============================================================
// HELPERS
// ============================================================
function getColor(score) { return score >= 70 ? 'green' : score >= 40 ? 'yellow' : 'red'; }
function getPriceRange(products) {
  if (!products?.length) return '—';
  const p = products.map(p => parseFloat(String(p.price || '').replace(/[^0-9.]/g, ''))).filter(p => !isNaN(p) && p > 0);
  if (!p.length) return '—';
  const min = Math.min(...p), max = Math.max(...p);
  return min === max ? `$${min}` : `$${min} – $${max}`;
}
function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }
function esc(t) { if (!t) return ''; const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }
function setText(id, t) { const el = document.getElementById(id); if (el) el.textContent = t; }
function show(id) { const el = document.getElementById(id); if (el) el.classList.remove('hidden'); }
function hide(id) { const el = document.getElementById(id); if (el) el.classList.add('hidden'); }
