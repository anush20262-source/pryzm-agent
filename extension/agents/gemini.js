/**
 * PRYZM Gemini Client (v4 — Rate Limit Optimized)
 * ==================================================
 * Calls Gemini API directly via REST from Chrome extension service worker.
 * 
 * Rate limit solutions:
 *   - Primary model: flash-lite (30 RPM free tier vs 15 RPM for flash)
 *   - Multi-key rotation: add multiple keys separated by commas
 *   - Smart retry with exponential backoff
 *   - API key sent via header (not URL)
 *   - 60s timeout on all API calls
 */

// flash-lite first: 30 RPM free tier (double the rate of flash)
const GEMINI_MODELS = ['gemini-2.0-flash-lite', 'gemini-2.0-flash'];
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const API_TIMEOUT_MS = 60000;

// Track which key index to use next (round-robin)
let currentKeyIndex = 0;

/**
 * Get all stored API keys (supports comma-separated multi-key)
 */
async function getAllApiKeys() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['gemini_api_key'], (result) => {
      const raw = result.gemini_api_key || '';
      const keys = raw.split(',').map(k => k.trim()).filter(k => k.length > 10);
      resolve(keys);
    });
  });
}

/**
 * Get the next API key (rotates if multiple keys exist)
 */
async function getApiKey() {
  const keys = await getAllApiKeys();
  if (keys.length === 0) return '';
  if (keys.length === 1) return keys[0];
  // Round-robin rotation
  const key = keys[currentKeyIndex % keys.length];
  currentKeyIndex++;
  return key;
}

/**
 * Rotate to next key (called on rate limit)
 */
async function rotateKey() {
  const keys = await getAllApiKeys();
  if (keys.length > 1) {
    currentKeyIndex++;
    console.log(`[Gemini] Rotated to key #${(currentKeyIndex % keys.length) + 1} of ${keys.length}`);
  }
}

/**
 * Sleep for ms milliseconds
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Call Gemini API with retry logic and timeout
 */
async function callGemini(apiKey, model, contents, tools, systemInstruction, attempt = 1) {
  const url = `${API_BASE}/models/${model}:generateContent`;

  const body = {
    contents,
    generationConfig: { temperature: 0.7, maxOutputTokens: 8192 },
  };

  if (systemInstruction) {
    body.systemInstruction = { parts: [{ text: systemInstruction }] };
  }

  if (tools && tools.length > 0) {
    body.tools = [{ functionDeclarations: tools }];
  }

  // Timeout via AbortController
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (response.status === 429) {
      if (attempt <= 3) {
        await rotateKey(); // Try next key if available
        const newKey = await getApiKey();
        const waitSec = Math.pow(2, attempt) * 2; // 4s, 8s, 16s
        console.log(`[Gemini] Rate limited. Rotating key + waiting ${waitSec}s (attempt ${attempt}/3)...`);
        await sleep(waitSec * 1000);
        return callGemini(newKey || apiKey, model, contents, tools, systemInstruction, attempt + 1);
      }
      const err = new Error('Rate limit exceeded after 3 retries. Add more API keys in Settings (comma-separated) or wait a minute.');
      err.rateLimited = true;
      throw err;
    }

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Gemini API error (${response.status}): ${errText.substring(0, 300)}`);
    }

    return await response.json();
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      throw new Error('Gemini API call timed out after 60 seconds. Please try again.');
    }
    throw err;
  }
}

/**
 * Call Gemini with Google Search Grounding (no function calling)
 * Used by Scout agent to find competitors via web search.
 */
async function callGeminiWithSearch(apiKey, model, prompt, systemInstruction) {
  const url = `${API_BASE}/models/${model}:generateContent`;

  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    tools: [{ google_search: {} }],
    generationConfig: { temperature: 0.3, maxOutputTokens: 4096 },
  };

  if (systemInstruction) {
    body.systemInstruction = { parts: [{ text: systemInstruction }] };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (response.status === 429) {
      // Single retry for search grounding
      await sleep(5000);
      const retry = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify(body),
      });
      if (!retry.ok) throw new Error('Search grounding rate limited. Try again later.');
      return await retry.json();
    }

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Search grounding error (${response.status}): ${errText.substring(0, 200)}`);
    }

    return await response.json();
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') throw new Error('Search timed out after 60 seconds.');
    throw err;
  }
}

/**
 * runAgent — Executes an agent with tools in a multi-turn loop
 * 
 * @param {Object} config
 * @param {string} config.name          - Agent name (for logging)
 * @param {string} config.systemPrompt  - System instruction
 * @param {string} config.userPrompt    - The task for the agent
 * @param {Array}  config.tools         - Gemini function declarations
 * @param {Object} config.toolHandlers  - Map of tool_name → async function(args)
 * @param {number} config.maxTurns      - Max rounds (default: 6)
 * @param {Function} config.onProgress  - Callback for progress updates
 * @returns {Object} Parsed JSON response
 */
async function runAgent({ name, systemPrompt, userPrompt, tools, toolHandlers, maxTurns = 6, onProgress }) {
  const apiKey = await getApiKey();
  if (!apiKey) {
    throw new Error('No Gemini API key configured. Open PRYZM Settings and add your key.');
  }

  console.log(`🤖 [${name}] Starting...`);
  if (onProgress) onProgress({ agent: name, status: 'starting' });

  // Try each model in the fallback chain
  for (let mi = 0; mi < GEMINI_MODELS.length; mi++) {
    const model = GEMINI_MODELS[mi];
    console.log(`   [${name}] Using model: ${model}`);

    try {
      const contents = [{ role: 'user', parts: [{ text: userPrompt }] }];
      
      for (let turn = 1; turn <= maxTurns; turn++) {
        console.log(`   [${name}] Turn ${turn}/${maxTurns}`);
        if (onProgress) onProgress({ agent: name, status: 'thinking', turn, maxTurns });

        const result = await callGemini(apiKey, model, contents, tools, systemPrompt);

        const candidate = result.candidates?.[0];
        if (!candidate) throw new Error('No response from Gemini');

        const parts = candidate.content?.parts || [];
        contents.push({ role: 'model', parts });

        // Check for function calls
        const functionCalls = parts.filter(p => p.functionCall);

        if (functionCalls.length === 0) {
          // No tool calls — agent is done
          const textPart = parts.find(p => p.text);
          const text = textPart?.text || '';
          console.log(`   [${name}] ✅ Done after ${turn} turn(s)`);
          if (onProgress) onProgress({ agent: name, status: 'done', turn });

          try {
            const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
            return JSON.parse(cleaned);
          } catch {
            return { raw_response: text };
          }
        }

        // Execute tool calls
        const toolResponseParts = [];
        for (const fc of functionCalls) {
          const call = fc.functionCall;
          const handler = toolHandlers[call.name];
          console.log(`   [${name}] 🔧 Tool: ${call.name}`);
          if (onProgress) onProgress({ agent: name, status: 'tool', tool: call.name });

          let toolResult;
          try {
            toolResult = handler ? await handler(call.args) : { error: `Unknown tool: ${call.name}` };
          } catch (e) {
            toolResult = { error: e.message };
          }

          toolResponseParts.push({
            functionResponse: { name: call.name, response: { result: toolResult } }
          });
        }

        contents.push({ role: 'user', parts: toolResponseParts });

        // Context window guard: if conversation is getting too long, summarize
        if (contents.length > 12) {
          console.log(`   [${name}] ⚠️ Long conversation (${contents.length} turns). Asking for final response.`);
          contents.push({ role: 'user', parts: [{ text: 'You have enough data. Provide your final JSON response NOW.' }] });
        }
      }

      // Max turns reached — force final response
      contents.push({ role: 'user', parts: [{ text: 'Provide your final JSON response NOW. No more tool calls.' }] });
      const final = await callGemini(apiKey, model, contents, null, systemPrompt);
      const text = final.candidates?.[0]?.content?.parts?.find(p => p.text)?.text || '';
      try {
        return JSON.parse(text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim());
      } catch {
        return { raw_response: text };
      }

    } catch (err) {
      if (err.rateLimited && mi + 1 < GEMINI_MODELS.length) {
        console.log(`   [${name}] Model ${model} rate limited. Trying ${GEMINI_MODELS[mi + 1]}...`);
        if (onProgress) onProgress({ agent: name, status: 'fallback', model: GEMINI_MODELS[mi + 1] });
        continue;
      }
      throw err;
    }
  }

  throw new Error('All Gemini models exhausted. Please wait a few minutes and try again.');
}

// Export for service worker
self.GeminiAgent = { runAgent, getApiKey, callGemini, callGeminiWithSearch };
