/**
 * PRYZM Agent Runner
 * ==================
 * Core agent execution loop — the engine behind every PRYZM agent.
 * 
 * This implements a REAL agent loop:
 *   1. Send prompt + tools to Gemini
 *   2. If Gemini calls a tool → execute it → feed result back
 *   3. Repeat until Gemini returns a final text response
 *   4. Parse structured output
 * 
 * Features:
 *   - Automatic retry with exponential backoff on rate limits (429)
 *   - Model fallback chain: gemini-2.0-flash → gemini-1.5-flash → gemini-1.5-pro
 *   - Real multi-turn agentic loop with tool calling
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

// Validate API key at startup
if (!process.env.GEMINI_API_KEY) {
  console.error('❌ GEMINI_API_KEY is not set in .env file');
  console.error('   Get one free at: https://aistudio.google.com/apikey');
  process.exit(1);
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Model fallback chain — if one hits rate limits, try the next
const MODEL_CHAIN = ['gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-2.5-flash-preview-05-20'];

/**
 * sleep — wait for ms milliseconds
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * sendWithRetry — sends a message with retry on 429 rate limit errors
 * Tries exponential backoff, then falls back to next model in chain
 */
async function sendWithRetry(chat, message, modelIndex, config) {
  const maxRetries = 3;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await chat.sendMessage(message);
      return result;
    } catch (err) {
      const is429 = err.message?.includes('429') || err.message?.includes('quota') || err.message?.includes('RESOURCE_EXHAUSTED');
      
      if (is429 && attempt < maxRetries) {
        // Extract retry delay from error if available
        const delayMatch = err.message.match(/retry in (\d+)/i);
        const waitSec = delayMatch ? parseInt(delayMatch[1]) + 5 : Math.pow(2, attempt) * 10;
        console.log(`   ⏳ Rate limited. Waiting ${waitSec}s before retry ${attempt + 1}/${maxRetries}...`);
        await sleep(waitSec * 1000);
        continue;
      }
      
      if (is429 && modelIndex + 1 < MODEL_CHAIN.length) {
        // Try next model in the fallback chain
        const nextModel = MODEL_CHAIN[modelIndex + 1];
        console.log(`   🔄 Switching to fallback model: ${nextModel}`);
        throw { retryWithModel: modelIndex + 1 };
      }
      
      throw err; // Not a rate limit error, propagate
    }
  }
}

/**
 * runAgent — Executes an agent with tools in a multi-turn loop
 * 
 * @param {Object} config
 * @param {string} config.name          - Agent name (for logging)
 * @param {string} config.systemPrompt  - System instruction for the agent
 * @param {string} config.userPrompt    - The task/question for the agent
 * @param {Array}  config.tools         - Gemini function declarations
 * @param {Object} config.toolHandlers  - Map of tool_name → async function(args)
 * @param {number} config.maxTurns      - Max tool-call rounds (default: 8)
 * @returns {Object} Parsed JSON response from the agent
 */
async function runAgent({ name, systemPrompt, userPrompt, tools, toolHandlers, maxTurns = 8 }) {
  console.log(`\n🤖 [${name}] Starting agent...`);

  // Try each model in the fallback chain
  for (let modelIndex = 0; modelIndex < MODEL_CHAIN.length; modelIndex++) {
    const modelName = MODEL_CHAIN[modelIndex];
    console.log(`   [${name}] Using model: ${modelName}`);

    try {
      const result = await _runWithModel({
        name, systemPrompt, userPrompt, tools, toolHandlers, maxTurns, modelName, modelIndex
      });
      return result;
    } catch (err) {
      if (err.retryWithModel !== undefined && err.retryWithModel < MODEL_CHAIN.length) {
        console.log(`   [${name}] Falling back to ${MODEL_CHAIN[err.retryWithModel]}...`);
        continue; // Try next model
      }
      throw err;
    }
  }

  throw new Error(`All models exhausted. Rate limit exceeded on all: ${MODEL_CHAIN.join(', ')}`);
}

/**
 * _runWithModel — Internal: run agent loop with a specific model
 */
async function _runWithModel({ name, systemPrompt, userPrompt, tools, toolHandlers, maxTurns, modelName, modelIndex }) {
  const model = genAI.getGenerativeModel({
    model: modelName,
    systemInstruction: systemPrompt,
    tools: tools.length > 0 ? [{ functionDeclarations: tools }] : undefined,
  });

  const chat = model.startChat({
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 4096,
    },
  });

  let turn = 0;
  let currentPrompt = userPrompt;

  while (turn < maxTurns) {
    turn++;
    console.log(`   [${name}] Turn ${turn}/${maxTurns}`);

    const result = await sendWithRetry(chat, currentPrompt, modelIndex, { name });
    const response = result.response;

    // Check if the model wants to call tools
    const functionCalls = response.functionCalls();

    if (!functionCalls || functionCalls.length === 0) {
      // No tool calls — agent is done. Extract final response.
      const text = response.text();
      console.log(`   [${name}] ✅ Agent finished after ${turn} turn(s)`);

      // Try to parse as JSON
      try {
        const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        return JSON.parse(cleaned);
      } catch (e) {
        return { raw_response: text };
      }
    }

    // Execute each tool call
    const toolResults = [];
    for (const call of functionCalls) {
      const handler = toolHandlers[call.name];
      if (!handler) {
        console.error(`   [${name}] ❌ Unknown tool: ${call.name}`);
        toolResults.push({
          functionResponse: {
            name: call.name,
            response: { error: `Unknown tool: ${call.name}` },
          },
        });
        continue;
      }

      console.log(`   [${name}] 🔧 Calling tool: ${call.name}(${JSON.stringify(call.args).substring(0, 120)}...)`);

      try {
        const toolOutput = await handler(call.args);
        toolResults.push({
          functionResponse: {
            name: call.name,
            response: { result: toolOutput },
          },
        });
      } catch (err) {
        console.error(`   [${name}] ❌ Tool error: ${err.message}`);
        toolResults.push({
          functionResponse: {
            name: call.name,
            response: { error: err.message },
          },
        });
      }
    }

    // Feed tool results back to the agent for the next turn
    currentPrompt = toolResults;
  }

  // Max turns exceeded — force a final response
  console.warn(`   [${name}] ⚠️ Max turns (${maxTurns}) reached. Forcing final response.`);
  const finalResult = await sendWithRetry(
    chat,
    'You have used all available turns. Provide your final structured JSON response NOW.',
    modelIndex,
    { name }
  );
  const text = finalResult.response.text();
  try {
    const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    return JSON.parse(cleaned);
  } catch (e) {
    return { raw_response: text };
  }
}

module.exports = { runAgent };
