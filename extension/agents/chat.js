/**
 * PRYZM Chat Agent (v2 — with Security Guardrails)
 * ==================================================
 * Conversational AI with full store context.
 * Includes prompt injection protection and output safety filters.
 */

// ─── Security: Prompt Injection Protection ──────────────────────
function sanitizeInput(text) {
  if (!text || typeof text !== 'string') return '';
  // Strip common prompt injection patterns
  return text
    .replace(/\b(ignore\s+(all\s+)?(previous|above|prior)\s+(instructions?|prompts?|rules?))\b/gi, '[blocked]')
    .replace(/\b(system\s*prompt|you\s+are\s+now|act\s+as\s+if|pretend\s+to\s+be|reveal\s+your)\b/gi, '[blocked]')
    .replace(/```[\s\S]*?```/g, '[code removed]')  // Strip code blocks that could contain injections
    .trim();
}

// ─── Security: Output Safety Filter ─────────────────────────────
function sanitizeOutput(text) {
  if (!text || typeof text !== 'string') return text;
  return text
    .replace(/\b(scam|hack|steal|illegal|exploit\s+vulnerability)\b/gi, '[filtered]')
    .replace(/\b(guaranteed\s+cure|100%\s+guaranteed|get\s+rich\s+quick)\b/gi, '[filtered]');
}

const CHAT_SYSTEM = `You are PRYZM Assistant — an AI e-commerce advisor.

You have FULL CONTEXT about the user's store and competitive analysis. Use this context to give specific, actionable advice. Never give generic answers.

PERSONALITY:
- Direct and actionable — every response should end with something the user can DO
- Use specific numbers, competitor names, and product names from the context
- Be encouraging but honest about problems
- Keep responses concise (2-3 paragraphs max)
- Use emoji sparingly for readability

CAPABILITIES:
- Answer questions about the analysis ("Why is my pricing score low?")
- Generate content (product descriptions, ad copy, email subject lines)
- Suggest specific improvements based on competitor data
- Explain competitive gaps in simple terms
- Help with marketing strategy

If the user asks something you don't have data for, say so honestly and suggest running a new analysis.`;

/**
 * Build the context prompt from stored analysis data
 */
function buildContext(storeData, analysisData, creativesData) {
  let ctx = '';

  if (storeData) {
    ctx += `\n## USER'S STORE
- Name: ${storeData.store_name || 'Unknown'}
- Platform: ${storeData.platform || 'unknown'}
- URL: ${storeData.url || 'unknown'}
- Products: ${(storeData.products || []).map(p => `${p.name} ($${p.price})`).join(', ') || 'None detected'}
- Keywords: ${storeData.niche_signals?.keywords?.join(', ') || 'none'}
- Meta Description: ${storeData.niche_signals?.meta_description || 'none'}
`;
  }

  if (analysisData) {
    ctx += `\n## COMPETITIVE ANALYSIS RESULTS
- Overall Score: ${analysisData.overall_score || '?'}/100
- Competitors Analyzed: ${(analysisData.competitors_analyzed || []).join(', ')}
- AI Summary: ${analysisData.ai_summary || 'N/A'}
`;

    if (analysisData.gap_scorecard) {
      ctx += `\n### Gap Scorecard:\n`;
      for (const [dim, data] of Object.entries(analysisData.gap_scorecard)) {
        ctx += `- ${dim}: Score ${data.score}/100 (${data.severity}) — You: "${data.you || 'N/A'}" vs Competitors: "${data.competitors || 'N/A'}" — Gap: "${data.gap || 'N/A'}"\n`;
      }
    }

    if (analysisData.hook_breakdown?.length) {
      ctx += `\n### Marketing Hooks Found:\n`;
      analysisData.hook_breakdown.forEach(h => {
        ctx += `- ${h.type}: "${h.transcript_quote}" (Score: ${h.effectiveness_score}/10, Trigger: ${h.psychological_trigger})\n`;
      });
    }
  }

  if (creativesData && Array.isArray(creativesData)) {
    ctx += `\n## GENERATED CREATIVES\n`;
    creativesData.forEach(c => {
      ctx += `- ${c.format}: Hook: "${c.hook_text}" | CTA: "${c.cta}"\n`;
    });
  }

  return ctx || '\n[No analysis data available yet. Suggest the user run an analysis first.]';
}

/**
 * Run chat — single turn with full context
 */
async function runChatAgent(userMessage, storeData, analysisData, creativesData, chatHistory) {
  const apiKey = await self.GeminiAgent.getApiKey();
  if (!apiKey) throw new Error('No API key. Set it up in Settings.');

  // Sanitize user input against prompt injection
  const safeMessage = sanitizeInput(userMessage);

  const context = buildContext(storeData, analysisData, creativesData);
  const systemPrompt = CHAT_SYSTEM + '\n\n--- CONTEXT ---' + context;

  // Build conversation history for multi-turn
  const contents = [];

  // Include last 6 messages of history for continuity
  const recentHistory = (chatHistory || []).slice(-6);
  for (const msg of recentHistory) {
    contents.push({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.text }],
    });
  }

  // Add current message
  contents.push({ role: 'user', parts: [{ text: safeMessage }] });

  const result = await self.GeminiAgent.callGemini(
    apiKey, 'gemini-2.0-flash', contents, null, systemPrompt
  );

  const rawResponse = result.candidates?.[0]?.content?.parts?.find(p => p.text)?.text || 'Sorry, I couldn\'t generate a response. Please try again.';

  // Sanitize output before returning to user
  const responseText = sanitizeOutput(rawResponse);

  return responseText;
}

self.ChatAgent = { runChatAgent };
