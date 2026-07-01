/**
 * PRYZM Gemini Client
 * ====================
 * Calls Gemini API directly via REST — no npm packages, no backend.
 * Works in Chrome extension service worker (background.js).
 * 
 * Handles:
 *   - Multi-turn conversations with tool calling
 *   - Retry with exponential backoff on 429 rate limits
 *   - Model fallback chain
 */

const GEMINI_MODELS = ['gemini-2.0-flash', 'gemini-1.5-flash-8b', 'gemini-1.5-pro'];
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

/**
 * Get the stored Gemini API key from chrome.storage
 */
async function getApiKey() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['gemini_api_key'], (result) => {
      resolve(result.gemini_api_key || '');
    });
  });
}

/**
 * Sleep for ms milliseconds
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Call Gemini API with retry logic
 */
async function callGemini(apiKey, model, contents, tools, systemInstruction, attempt = 1) {
  const url = `${API_BASE}/models/${model}:generateContent?key=${apiKey}`;
  
  if (attempt === 1) {
    console.log(`[Gemini] Calling API with key starting with: ${apiKey.substring(0, 8)}...`);
  }

  const body = {
    contents,
    generationConfig: { temperature: 0.7, maxOutputTokens: 4096 },
  };

  if (systemInstruction) {
    body.systemInstruction = { parts: [{ text: systemInstruction }] };
  }

  if (tools && tools.length > 0) {
    body.tools = [{ functionDeclarations: tools }];
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (response.status === 429) {
    if (attempt <= 3) {
      const waitSec = Math.pow(2, attempt) * 10;
      console.log(`[Gemini] Rate limited. Waiting ${waitSec}s (attempt ${attempt}/3)...`);
      await sleep(waitSec * 1000);
      return callGemini(apiKey, model, contents, tools, systemInstruction, attempt + 1);
    }
    throw { rateLimited: true, message: 'Rate limit exceeded after 3 retries' };
  }

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini API error (${response.status}): ${errText.substring(0, 200)}`);
  }

  return await response.json();
}

/**
 * runAgent — Executes an agent with tools in a multi-turn loop
 * 
 * Works entirely in the browser — no Node.js, no backend needed.
 * 
 * @param {Object} config
 * @param {string} config.name          - Agent name (for logging)
 * @param {string} config.systemPrompt  - System instruction
 * @param {string} config.userPrompt    - The task for the agent
 * @param {Array}  config.tools         - Gemini function declarations
 * @param {Object} config.toolHandlers  - Map of tool_name → async function(args)
 * @param {number} config.maxTurns      - Max rounds (default: 8)
 * @param {Function} config.onProgress  - Callback for progress updates
 * @returns {Object} Parsed JSON response
 */
async function runAgent({ name, systemPrompt, userPrompt, tools, toolHandlers, maxTurns = 8, onProgress }) {
  const apiKey = await getApiKey();
  if (!apiKey) {
    throw new Error('No Gemini API key. Open PRYZM settings and enter your API key.');
  }

  console.log(`🤖 [${name}] Starting...`);
  if (onProgress) onProgress({ agent: name, status: 'starting' });

  // Try each model in the fallback chain
  for (let mi = 0; mi < GEMINI_MODELS.length; mi++) {
    const model = GEMINI_MODELS[mi];
    console.log(`   [${name}] Using model: ${model}`);

    try {
      // Build conversation history
      const contents = [{ role: 'user', parts: [{ text: userPrompt }] }];
      
      for (let turn = 1; turn <= maxTurns; turn++) {
        console.log(`   [${name}] Turn ${turn}/${maxTurns}`);
        if (onProgress) onProgress({ agent: name, status: 'thinking', turn, maxTurns });

        const result = await callGemini(apiKey, model, contents, tools, systemPrompt);

        const candidate = result.candidates?.[0];
        if (!candidate) throw new Error('No response from Gemini');

        const parts = candidate.content?.parts || [];
        
        // Add model response to conversation history
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

        // Feed tool results back
        contents.push({ role: 'user', parts: toolResponseParts });
      }

      // Max turns — force final response
      contents.push({ role: 'user', parts: [{ text: 'Provide your final JSON response NOW.' }] });
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
        continue;
      }
      throw err;
    }
  }

  throw new Error('All Gemini models exhausted. Please wait and try again later.');
}

// Export for use in background.js via importScripts
self.GeminiAgent = { runAgent, getApiKey, callGemini };
