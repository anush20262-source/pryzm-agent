/**
 * PRYZM Background Service Worker
 *
 * Bridges popup.js ↔ backend server.js.
 * Caches store data and analysis results in chrome.storage.local
 * so they persist between popup opens.
 *
 * Message types handled:
 *   GET_CACHED_DATA        (from popup)     → returns cached store/analysis data
 *   STORE_DATA_EXTRACTED   (from content)   → caches store data
 *   ANALYZE_STORE          (from popup)     → POST /api/analyze, returns backend JSON
 *   GENERATE_CREATIVES     (from popup)     → POST /api/generate-creative, returns backend JSON
 *
 * No demo data. No fallbacks. If the backend is down, return { error }.
 */

const API_BASE = 'http://localhost:3000';

// ─── Badge Helpers ────────────────────────────────────────────────
function setBadgeIdle() {
  chrome.action.setBadgeText({ text: '' });
}

function setBadgeScanning() {
  chrome.action.setBadgeBackgroundColor({ color: '#FFD93D' });
  chrome.action.setBadgeText({ text: '...' });
}

function setBadgeGaps(count) {
  chrome.action.setBadgeBackgroundColor({ color: '#FF3B3B' });
  chrome.action.setBadgeText({ text: String(count) });
}

function setBadgeGood() {
  chrome.action.setBadgeBackgroundColor({ color: '#00FF88' });
  chrome.action.setBadgeText({ text: '✓' });
}

// ─── API Call ─────────────────────────────────────────────────────
// Returns the parsed JSON on success, or throws on failure.
async function apiPost(endpoint, payload) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const res = await fetch(`${API_BASE}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.message || body.error || `API ${res.status}: ${res.statusText}`);
    }

    return await res.json();
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      throw new Error('Request timed out — is the backend running?');
    }
    // Network errors (backend not running) come through as TypeError
    if (err instanceof TypeError && err.message.includes('fetch')) {
      throw new Error('Backend not running. Start it with: cd backend-server && node server.js');
    }
    throw err;
  }
}

// ─── Message Router ───────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const { type } = message;

  // ────────────────────────────────────────────────────────────────
  // STORE_DATA_EXTRACTED  (content.js → background)
  // Cache the raw store data so the popup can retrieve it later.
  // ────────────────────────────────────────────────────────────────
  if (type === 'STORE_DATA_EXTRACTED') {
    chrome.storage.local.set({
      storeData: message.data,
      storeDataTimestamp: Date.now(),
    });
    setBadgeIdle();
    return; // synchronous, no sendResponse needed
  }

  // ────────────────────────────────────────────────────────────────
  // GET_CACHED_DATA  (popup → background)
  // Return whatever we have cached (storeData, analysisData).
  // popup.js reads: resp.storeData, resp.analysisData
  // ────────────────────────────────────────────────────────────────
  if (type === 'GET_CACHED_DATA') {
    chrome.storage.local.get(
      ['storeData', 'analysisData', 'storeDataTimestamp'],
      (result) => {
        sendResponse({
          storeData: result.storeData || null,
          analysisData: result.analysisData || null,
          timestamp: result.storeDataTimestamp || null,
        });
      }
    );
    return true; // keep channel open for async sendResponse
  }

  // ────────────────────────────────────────────────────────────────
  // ANALYZE_STORE  (popup → background)
  //
  // popup sends:   { type: 'ANALYZE_STORE', data: storeData }
  // backend POST /api/analyze expects: storeData as body
  // backend returns: { success, gap_analysis, scout_data, store }
  //
  // popup reads:   resp.gap_analysis, resp.creatives, resp.error, resp.message
  // So we forward the backend's JSON directly to the popup.
  // ────────────────────────────────────────────────────────────────
  if (type === 'ANALYZE_STORE') {
    (async () => {
      try {
        setBadgeScanning();

        const storeData = message.data;
        if (!storeData) {
          sendResponse({ error: 'No store data provided.' });
          setBadgeIdle();
          return;
        }

        // Call the real backend
        const result = await apiPost('/api/analyze', storeData);
        // result shape: { success, gap_analysis, scout_data, store }

        // Cache successful analysis for persistence between popup opens
        await chrome.storage.local.set({
          storeData: storeData,
          storeDataTimestamp: Date.now(),
          analysisData: result.gap_analysis || null,
          analysisTimestamp: Date.now(),
        });

        // Update badge based on gap severity
        const gaps = result.gap_analysis?.gap_scorecard || {};
        const criticalCount = Object.values(gaps).filter(
          (g) => g.severity === 'critical'
        ).length;
        if (criticalCount > 0) {
          setBadgeGaps(criticalCount);
        } else {
          setBadgeGood();
        }

        // Return backend JSON directly — popup reads resp.gap_analysis
        sendResponse(result);
      } catch (err) {
        setBadgeIdle();
        sendResponse({ error: err.message });
      }
    })();
    return true; // keep channel open for async sendResponse
  }

  // ────────────────────────────────────────────────────────────────
  // GENERATE_CREATIVES  (popup → background)
  //
  // popup sends:   { type: 'GENERATE_CREATIVES', data: { analysis, store } }
  // backend POST /api/generate-creative expects: { analysis, store }
  // backend returns: { success, prescriptions }
  //
  // popup reads:   resp.prescriptions, resp.error, resp.message
  // So we forward the backend's JSON directly to the popup.
  // ────────────────────────────────────────────────────────────────
  if (type === 'GENERATE_CREATIVES') {
    (async () => {
      try {
        const payload = message.data;
        if (!payload || !payload.analysis) {
          sendResponse({ error: 'No analysis data. Run analysis first.' });
          return;
        }

        // Call the real backend
        const result = await apiPost('/api/generate-creative', payload);
        // result shape: { success, prescriptions }

        // Cache creatives
        await chrome.storage.local.set({
          creativesData: result.prescriptions || null,
        });

        // Return backend JSON directly — popup reads resp.prescriptions
        sendResponse(result);
      } catch (err) {
        sendResponse({ error: err.message });
      }
    })();
    return true; // keep channel open for async sendResponse
  }
});

// ─── Extension Install / Startup ──────────────────────────────────
chrome.runtime.onInstalled.addListener(() => {
  setBadgeIdle();
  console.log('[PRYZM] Extension installed — ready for competitive intelligence.');
});
