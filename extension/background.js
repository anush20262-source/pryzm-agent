/**
 * PRYZM Background Service Worker (v3 — Self-Contained)
 * ======================================================
 * Runs the entire agent pipeline inside the extension.
 * NO backend server needed. Calls Gemini API directly.
 * 
 * Richard installs the extension → enters his API key → clicks Analyze → done.
 */

// Load agent modules
importScripts('agents/gemini.js', 'agents/scout.js', 'agents/analyst.js', 'agents/creative.js');

// ── State ─────────────────────────────────────────────────────────────
let cachedStoreData = null;
let cachedAnalysis = null;
let cachedCreatives = null;
let pipelineRunning = false;

// ── Message Handler ───────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { type, data } = message;

  switch (type) {
    case 'STORE_DATA_EXTRACTED':
      // Content script detected a store — cache it
      cachedStoreData = data;
      chrome.storage.local.set({ storeData: data });
      console.log('[BG] Store data cached:', data.store_name);
      break;

    case 'GET_CACHED_DATA':
      // Popup opened — return whatever we have
      chrome.storage.local.get(['storeData', 'analysisData', 'creativesData'], (result) => {
        sendResponse({
          storeData: cachedStoreData || result.storeData || null,
          analysisData: cachedAnalysis || result.analysisData || null,
          creativesData: cachedCreatives || result.creativesData || null,
        });
      });
      return true; // async

    case 'CHECK_API_KEY':
      // Check if API key is configured
      self.GeminiAgent.getApiKey().then(key => {
        sendResponse({ hasKey: !!key, keyPreview: key ? key.substring(0, 8) + '...' : '' });
      });
      return true;

    case 'SAVE_API_KEY':
      // User entered their API key in settings
      chrome.storage.sync.set({ gemini_api_key: data.key }, () => {
        console.log('[BG] API key saved');
        sendResponse({ success: true });
      });
      return true;

    case 'ANALYZE_STORE':
      // Run the full agent pipeline: Scout → Analyst
      if (pipelineRunning) {
        sendResponse({ error: 'Analysis is already running. Please wait.' });
        return true;
      }
      runAnalysisPipeline(data, sendResponse);
      return true; // async

    case 'GENERATE_CREATIVES':
      // Run Creative Director agent
      runCreativePipeline(data, sendResponse);
      return true;

    case 'FULL_PIPELINE':
      // Run everything: Scout → Analyst → Creative
      if (pipelineRunning) {
        sendResponse({ error: 'Pipeline is already running. Please wait.' });
        return true;
      }
      runFullPipeline(data, sendResponse);
      return true;

    case 'GET_PIPELINE_STATUS':
      sendResponse({ running: pipelineRunning });
      return true;

    case 'CLEAR_CACHE':
      cachedStoreData = null;
      cachedAnalysis = null;
      cachedCreatives = null;
      chrome.storage.local.remove(['storeData', 'analysisData', 'creativesData']);
      sendResponse({ success: true });
      return true;
  }
});

// ── Analysis Pipeline (Scout → Analyst) ─────────────────────────────
async function runAnalysisPipeline(storeData, sendResponse) {
  pipelineRunning = true;
  try {
    // Check API key first
    const apiKey = await self.GeminiAgent.getApiKey();
    if (!apiKey) {
      sendResponse({ error: 'No API key configured. Click the ⚙️ icon to add your Gemini API key.' });
      pipelineRunning = false;
      return;
    }

    console.log(`[BG] 📡 Scout Agent starting for "${storeData.store_name}"...`);
    
    // Agent 1: Scout
    const scoutResult = await self.ScoutAgent.runScoutAgent(storeData, (progress) => {
      broadcastProgress(progress);
    });
    console.log(`[BG] Scout found ${scoutResult.competitors?.length || 0} competitors`);

    // Agent 2: Analyst
    console.log('[BG] 📊 Analyst Agent starting...');
    const analysisResult = await self.AnalystAgent.runAnalystAgent(storeData, scoutResult, (progress) => {
      broadcastProgress(progress);
    });
    console.log(`[BG] Analysis complete. Score: ${analysisResult.overall_score}/100`);

    // Cache results
    cachedAnalysis = analysisResult;
    cachedStoreData = storeData;
    chrome.storage.local.set({ analysisData: analysisResult, storeData });

    sendResponse({
      success: true,
      gap_analysis: analysisResult,
      scout_data: { competitors_found: scoutResult.competitors?.length || 0, niche_summary: scoutResult.niche_summary }
    });

  } catch (err) {
    console.error('[BG] Pipeline failed:', err.message);
    sendResponse({ error: err.message });
  } finally {
    pipelineRunning = false;
  }
}

// ── Creative Pipeline ───────────────────────────────────────────────
async function runCreativePipeline(data, sendResponse) {
  try {
    const apiKey = await self.GeminiAgent.getApiKey();
    if (!apiKey) {
      sendResponse({ error: 'No API key. Add it in ⚙️ Settings.' });
      return;
    }

    const analysis = data.analysis || cachedAnalysis;
    const store = data.store || cachedStoreData;
    if (!analysis) {
      sendResponse({ error: 'Run analysis first.' });
      return;
    }

    console.log('[BG] 🎨 Creative Director starting...');
    const creativeResult = await self.CreativeAgent.runCreativeAgent(analysis, store || {}, (progress) => {
      broadcastProgress(progress);
    });

    cachedCreatives = creativeResult.prescriptions || creativeResult;
    chrome.storage.local.set({ creativesData: cachedCreatives });

    sendResponse({ success: true, prescriptions: cachedCreatives });

  } catch (err) {
    console.error('[BG] Creative failed:', err.message);
    sendResponse({ error: err.message });
  }
}

// ── Full Pipeline (Scout → Analyst → Creative) ─────────────────────
async function runFullPipeline(storeData, sendResponse) {
  pipelineRunning = true;
  try {
    const apiKey = await self.GeminiAgent.getApiKey();
    if (!apiKey) {
      sendResponse({ error: 'No API key. Add it in ⚙️ Settings.' });
      pipelineRunning = false;
      return;
    }

    // Scout
    const scoutResult = await self.ScoutAgent.runScoutAgent(storeData, broadcastProgress);
    // Analyst
    const analysisResult = await self.AnalystAgent.runAnalystAgent(storeData, scoutResult, broadcastProgress);
    // Creative
    const creativeResult = await self.CreativeAgent.runCreativeAgent(analysisResult, storeData, broadcastProgress);

    cachedStoreData = storeData;
    cachedAnalysis = analysisResult;
    cachedCreatives = creativeResult.prescriptions || creativeResult;
    chrome.storage.local.set({ storeData, analysisData: cachedAnalysis, creativesData: cachedCreatives });

    sendResponse({
      success: true,
      gap_analysis: analysisResult,
      creatives: cachedCreatives,
      scout_summary: scoutResult.niche_summary
    });

  } catch (err) {
    console.error('[BG] Full pipeline failed:', err.message);
    sendResponse({ error: err.message });
  } finally {
    pipelineRunning = false;
  }
}

// ── Progress Broadcasting ──────────────────────────────────────────
function broadcastProgress(progress) {
  // Send progress to popup if open
  chrome.runtime.sendMessage({ type: 'AGENT_PROGRESS', data: progress }).catch(() => {});
}

// ── Extension Installed ─────────────────────────────────────────────
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    // Open settings page on first install so Richard can enter his API key
    chrome.tabs.create({ url: chrome.runtime.getURL('settings.html') });
  }
});

console.log('🔮 PRYZM Background — Self-contained agent pipeline loaded');
