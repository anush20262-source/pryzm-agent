/**
 * PRYZM Background Service Worker (v4 — Full Featured)
 * =====================================================
 * Self-contained agent pipeline with:
 *   - State persistence (survives worker restarts)
 *   - Analysis history (per-store, timestamped)
 *   - Memory system (agents learn from past analyses)
 *   - Chat agent support
 *   - Pipeline guards (no duplicate runs)
 *   - Side Panel support
 */

// Load agent modules
importScripts(
  'agents/gemini.js',
  'agents/scout.js',
  'agents/analyst.js',
  'agents/creative.js',
  'agents/chat.js'
);

// ── Persistent State Helpers ────────────────────────────────────────
async function getState() {
  return new Promise(resolve => {
    chrome.storage.local.get(['pryzm_state'], (r) => {
      resolve(r.pryzm_state || {
        storeData: null,
        analysisData: null,
        scoutData: null,
        creativesData: null,
        chatHistory: [],
        pipelineRunning: false,
        pipelineStartedAt: null,
      });
    });
  });
}

async function saveState(updates) {
  const current = await getState();
  const newState = { ...current, ...updates };
  return new Promise(resolve => {
    chrome.storage.local.set({ pryzm_state: newState }, resolve);
  });
}

async function getHistory() {
  return new Promise(resolve => {
    chrome.storage.local.get(['pryzm_history'], (r) => {
      resolve(r.pryzm_history || []);
    });
  });
}

async function saveToHistory(storeData, analysisData) {
  const history = await getHistory();
  const entry = {
    id: Date.now().toString(),
    store_name: storeData.store_name || 'Unknown',
    store_url: storeData.url || '',
    platform: storeData.platform || 'unknown',
    overall_score: analysisData.overall_score || 0,
    ai_summary: analysisData.ai_summary || '',
    competitors_analyzed: analysisData.competitors_analyzed || [],
    timestamp: new Date().toISOString(),
    storeData,
    analysisData,
    scoutData: analysisData?.competitor_data || null,
  };
  history.unshift(entry); // newest first
  // Keep max 20 entries
  const trimmed = history.slice(0, 20);
  return new Promise(resolve => {
    chrome.storage.local.set({ pryzm_history: trimmed }, resolve);
  });
}

/**
 * Get memory context for a store — summary of last analysis
 */
async function getMemoryForStore(storeUrl) {
  const history = await getHistory();
  const past = history.find(h => h.store_url && storeUrl && h.store_url.includes(new URL(storeUrl).hostname));
  if (!past) return null;

  return `Previous analysis on ${past.timestamp}:
- Overall Score: ${past.overall_score}/100
- Competitors: ${past.competitors_analyzed.join(', ')}
- Summary: ${past.ai_summary}
${past.analysisData.gap_scorecard ? Object.entries(past.analysisData.gap_scorecard).map(([k, v]) =>
  `- ${k}: ${v.score}/100 (${v.severity}) — Gap: ${v.gap || 'N/A'}`
).join('\n') : ''}`;
}

// ── Pipeline timeout guard ──────────────────────────────────────────
async function checkPipelineStale() {
  const state = await getState();
  if (state.pipelineRunning && state.pipelineStartedAt) {
    const elapsed = Date.now() - state.pipelineStartedAt;
    if (elapsed > 5 * 60 * 1000) { // 5 minutes
      console.log('[BG] Pipeline timed out. Resetting.');
      await saveState({ pipelineRunning: false, pipelineStartedAt: null });
    }
  }
}

async function getCachedAnalysisForStore(storeData) {
  const currentUrl = (storeData?.url || '').trim().toLowerCase();
  if (!currentUrl) return null;

  const state = await getState();
  const cachedStore = state.storeData;
  const cachedUrl = (cachedStore?.url || '').trim().toLowerCase();

  if (!state.analysisData || !cachedStore || !cachedUrl) return null;
  if (currentUrl === cachedUrl || currentUrl.includes(cachedUrl) || cachedUrl.includes(currentUrl)) {
    return { storeData: cachedStore, analysisData: state.analysisData };
  }

  return null;
}

// ── Message Handler ───────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Support both formats:
  //   popup sends:     { type, data: {...} }
  //   sidepanel sends: { type, storeData:..., message:..., etc }
  handleMessage(message, sendResponse);
  return true; // All responses are async
});

async function handleMessage(msg, sendResponse) {
  const type = msg.type;
  const data = msg.data || msg; // fallback to msg itself for spread-style
  try {
    switch (type) {
      case 'STORE_DATA_EXTRACTED': {
        const extractedData = data.data || data;
        if (extractedData?.store_name || extractedData?.products?.length) {
          await saveState({ storeData: extractedData });
        }
        sendResponse({ success: true });
        break;
      }

      case 'GET_CACHED_DATA': {
        const state = await getState();
        const history = await getHistory();
        sendResponse({
          storeData: state.storeData,
          analysisData: state.analysisData,
          scoutData: state.scoutData,
          creativesData: state.creativesData,
          history: history.slice(0, 10),
          pipelineRunning: state.pipelineRunning,
        });
        break;
      }

      case 'CHECK_API_KEY': {
        const key = await self.GeminiAgent.getApiKey();
        sendResponse({ hasKey: !!key });
        break;
      }

      case 'SAVE_API_KEY': {
        const apiKey = msg.key || data.key || data;
        if (apiKey && typeof apiKey === 'string') {
          chrome.storage.local.set({ gemini_api_key: apiKey }, () => {
            sendResponse({ success: true });
          });
        } else {
          sendResponse({ error: 'No API key provided.' });
        }
        break;
      }

      case 'ANALYZE_STORE': {
        await checkPipelineStale();
        const state = await getState();
        if (state.pipelineRunning) {
          sendResponse({ error: 'Analysis is already running. Please wait.' });
          return;
        }
        const storeData = data.storeData || data;
        const cached = await getCachedAnalysisForStore(storeData);
        if (cached?.analysisData) {
          sendResponse({
            success: true,
            analysisData: cached.analysisData,
            gap_analysis: cached.analysisData,
            scout_data: { competitors_found: cached.analysisData.competitors_analyzed?.length || 0, niche_summary: 'Using cached analysis for this store.' },
            cached: true,
          });
          break;
        }
        runAnalysisPipeline(storeData, sendResponse);
        break;
      }

      case 'GENERATE_CREATIVES': {
        await checkPipelineStale();
        const state = await getState();
        if (state.pipelineRunning) {
          sendResponse({ error: 'Pipeline is running. Please wait.' });
          return;
        }
        runCreativePipeline(data, sendResponse);
        break;
      }

      case 'CHAT_MESSAGE': {
        runChat(data, sendResponse);
        break;
      }

      case 'GET_HISTORY': {
        const history = await getHistory();
        sendResponse({ history });
        break;
      }

      case 'LOAD_HISTORY_ENTRY': {
        const history = await getHistory();
        const entry = history.find(h => h.id === data.id);
        if (entry) {
          await saveState({
            storeData: entry.storeData,
            analysisData: entry.analysisData,
            scoutData: entry.scoutData || entry.analysisData?.competitor_data || null,
            creativesData: null,
            chatHistory: [],
          });
          sendResponse({ success: true, storeData: entry.storeData, analysisData: entry.analysisData });
        } else {
          sendResponse({ error: 'History entry not found.' });
        }
        break;
      }

      case 'CLEAR_CACHE': {
        await saveState({
          storeData: null, analysisData: null, scoutData: null, creativesData: null,
          chatHistory: [], pipelineRunning: false, pipelineStartedAt: null,
        });
        sendResponse({ success: true });
        break;
      }

      case 'GET_PIPELINE_STATUS': {
        await checkPipelineStale();
        const s = await getState();
        sendResponse({ running: s.pipelineRunning });
        break;
      }

      default:
        sendResponse({ error: `Unknown message type: ${type}` });
    }
  } catch (err) {
    console.error(`[BG] Error handling ${type}:`, err.message);
    sendResponse({ error: err.message });
  }
}

// ── Analysis Pipeline (Scout → Analyst) ─────────────────────────────
async function runAnalysisPipeline(storeData, sendResponse) {
  await saveState({ pipelineRunning: true, pipelineStartedAt: Date.now() });

  try {
    const apiKey = await self.GeminiAgent.getApiKey();
    if (!apiKey) {
      sendResponse({ error: 'No API key configured. Open Settings and add your Gemini API key.' });
      await saveState({ pipelineRunning: false });
      return;
    }

    // Get memory from past analyses
    const memory = await getMemoryForStore(storeData.url);

    // Agent 1: Scout
    console.log(`[BG] 📡 Scout Agent starting for "${storeData.store_name}"...`);
    broadcastProgress({ agent: 'Scout', status: 'searching', message: 'Searching for competitors...' });
    const scoutResult = await self.ScoutAgent.runScoutAgent(storeData, broadcastProgress, memory);
    console.log(`[BG] Scout found ${scoutResult.competitors?.length || 0} competitors`);
    broadcastProgress({ agent: 'Scout', status: 'done', message: `Found ${scoutResult.competitors?.length || 0} competitors` });

    // Cooldown between agents — prevents burst rate limiting
    await new Promise(r => setTimeout(r, 3000));

    // Agent 2: Analyst
    console.log('[BG] 📊 Analyst Agent starting...');
    broadcastProgress({ agent: 'Analyst', status: 'starting', message: 'Analyzing competitive gaps...' });
    const analysisResult = await self.AnalystAgent.runAnalystAgent(storeData, scoutResult, broadcastProgress, memory);
    console.log(`[BG] Analysis complete. Score: ${analysisResult.overall_score}/100`);

    const enrichedAnalysis = { ...analysisResult, competitor_data: scoutResult };

    // Save results + history
    await saveState({ storeData, analysisData: enrichedAnalysis, scoutData: scoutResult, creativesData: null });
    await saveToHistory(storeData, enrichedAnalysis);

    broadcastProgress({ agent: 'Analyst', status: 'done', message: `Score: ${analysisResult.overall_score || 0}/100` });

    sendResponse({
      success: true,
      analysisData: enrichedAnalysis,
      gap_analysis: enrichedAnalysis,
      scout_data: { competitors_found: scoutResult.competitors?.length || 0, niche_summary: scoutResult.niche_summary },
      scoutData: scoutResult,
      competitor_data: scoutResult,
    });

  } catch (err) {
    console.error('[BG] Pipeline failed:', err.message);
    sendResponse({ error: err.message });
  } finally {
    await saveState({ pipelineRunning: false, pipelineStartedAt: null });
  }
}

// ── Creative Pipeline ───────────────────────────────────────────────
async function runCreativePipeline(data, sendResponse) {
  await saveState({ pipelineRunning: true, pipelineStartedAt: Date.now() });

  try {
    const apiKey = await self.GeminiAgent.getApiKey();
    if (!apiKey) {
      sendResponse({ error: 'No API key. Add it in Settings.' });
      await saveState({ pipelineRunning: false });
      return;
    }

    const state = await getState();
    const analysis = data?.analysis || data?.analysisData || state.analysisData;
    const store = data?.store || data?.storeData || state.storeData;
    if (!analysis) {
      sendResponse({ error: 'Run analysis first before generating creatives.' });
      await saveState({ pipelineRunning: false });
      return;
    }

    console.log('[BG] 🎨 Creative Director starting...');
    const creativeResult = await self.CreativeAgent.runCreativeAgent(analysis, store || {}, broadcastProgress);
    const prescriptions = creativeResult.prescriptions || creativeResult;

    await saveState({ creativesData: prescriptions, pipelineRunning: false });

    sendResponse({ success: true, prescriptions, creatives: prescriptions });

  } catch (err) {
    console.error('[BG] Creative failed:', err.message);
    sendResponse({ error: err.message });
  } finally {
    await saveState({ pipelineRunning: false, pipelineStartedAt: null });
  }
}

// ── Chat ────────────────────────────────────────────────────────────
async function runChat(data, sendResponse) {
  try {
    const state = await getState();
    const chatHistory = state.chatHistory || [];

    const response = await self.ChatAgent.runChatAgent(
      data.message,
      state.storeData,
      state.analysisData,
      state.creativesData,
      chatHistory
    );

    // Save to history
    chatHistory.push({ role: 'user', text: data.message });
    chatHistory.push({ role: 'assistant', text: response });
    // Keep last 20 messages
    const trimmed = chatHistory.slice(-20);
    await saveState({ chatHistory: trimmed });

    sendResponse({ success: true, response });

  } catch (err) {
    console.error('[BG] Chat failed:', err.message);
    sendResponse({ error: err.message });
  }
}

// ── Progress Broadcasting ──────────────────────────────────────────
function broadcastProgress(progress) {
  chrome.runtime.sendMessage({ type: 'AGENT_PROGRESS', data: progress }).catch(() => {});
}

// ── Side Panel Setup ────────────────────────────────────────────────
chrome.sidePanel?.setOptions?.({
  path: 'sidepanel.html',
  enabled: true,
});

// Open side panel when extension icon is clicked
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel?.open?.({ tabId: tab.id });
});

// ── Extension Installed ─────────────────────────────────────────────
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('settings.html') });
  }
});

console.log('🔮 PRYZM v4 — Self-contained agents with memory, chat, and history');
