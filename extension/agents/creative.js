/**
 * PRYZM Creative Agent (Browser Edition)
 * ========================================
 * Generates ready-to-use ad creatives based on gap analysis.
 * Includes output guardrails for safe, compliant content.
 * Runs entirely in the extension.
 */

// ─── Output Safety Guardrail ─────────────────────────────────────
const BLOCKED_PATTERNS = /\b(scam|fake|illegal|steal|hack|kill|die|hate|racist|sexist|lawsuit|guaranteed\s+cure|100%\s+guaranteed|lose\s+\d+\s+pounds|get\s+rich\s+quick)\b/gi;
const MEDICAL_CLAIMS = /\b(cure|treat|diagnose|prevent\s+disease|FDA\s+approved|clinically\s+proven)\b/gi;

function sanitizeCreativeOutput(text) {
  if (!text || typeof text !== 'string') return text;
  let cleaned = text.replace(BLOCKED_PATTERNS, '[filtered]');
  cleaned = cleaned.replace(MEDICAL_CLAIMS, '[claim removed]');
  return cleaned;
}

async function generateAdScript({ platform, product_name, gap_to_exploit, target_emotion }) {
  const guides = {
    tiktok: { format: 'TikTok/Reel Script', guidelines: '15-60s. Hook in 3s. POV/UGC. [visual directions]. CTA.', tone: 'Casual, provocative', max_words: 150 },
    meta: { format: 'Meta Ad Copy', guidelines: '125 char primary. 40 char headline. Emojis sparingly. Hashtags.', tone: 'Professional, punchy', max_words: 100 },
    email: { format: 'Email Subject + Body', guidelines: 'Subject <50 chars. Problem→agitation→solution. 3-5 paragraphs.', tone: 'Personal, urgent', max_words: 200 }
  };
  return { ...(guides[platform.toLowerCase()] || guides.meta), context: { product: sanitizeCreativeOutput(product_name), gap: sanitizeCreativeOutput(gap_to_exploit), emotion: target_emotion } };
}

async function analyzeHook({ hook_text }) {
  const words = hook_text.split(' ').length;
  const hasQ = hook_text.includes('?'), hasNum = /\d/.test(hook_text);
  const hasEmo = /stop|never|worst|best|secret|hack|mistake|truth|actually|literally/i.test(hook_text);
  return {
    word_count: words, has_question: hasQ, has_number: hasNum, has_emotional_trigger: hasEmo,
    readability: words <= 15 ? 'excellent' : words <= 25 ? 'good' : 'too_long',
    suggestions: [!hasQ && !hasEmo ? 'Add emotional trigger' : null, words > 20 ? 'Shorten to <15 words' : null].filter(Boolean)
  };
}

const CREATIVE_TOOLS = [
  { name: 'generate_ad_script', description: 'Get platform-specific ad guidelines.', parameters: { type: 'object', properties: { platform: { type: 'string', enum: ['tiktok', 'meta', 'email'] }, product_name: { type: 'string' }, gap_to_exploit: { type: 'string' }, target_emotion: { type: 'string' } }, required: ['platform', 'product_name', 'gap_to_exploit'] } },
  { name: 'analyze_hook', description: 'Analyze a marketing hook for effectiveness.', parameters: { type: 'object', properties: { hook_text: { type: 'string' } }, required: ['hook_text'] } }
];

const CREATIVE_SYSTEM = `You are PRYZM Creative Director — an ad copywriting agent.
Generate 3 ready-to-deploy creatives exploiting the merchant's competitive gaps.

PROCESS: Use generate_ad_script for tiktok, meta, email. Optionally use analyze_hook.

OUTPUT (JSON):
{
  "prescriptions": [
    { "format": "TikTok/Reel Script", "hook_text": "<15 words", "body_creative": "Full script with [visual directions]", "cta": "Call to action" },
    { "format": "Meta Ad Copy", "hook_text": "...", "body_creative": "...", "cta": "..." },
    { "format": "Email Subject Line", "hook_text": "...", "body_creative": "...", "cta": "..." }
  ]
}

RULES: Each creative must exploit a real gap. Hooks <15 words. Reference actual products.`;

async function runCreativeAgent(gapAnalysis, storeData, onProgress) {
  const scorecard = gapAnalysis.gap_scorecard || {};
  const gaps = Object.entries(scorecard).map(([k, v]) => ({ dim: k, ...v })).sort((a, b) => (a.score || 50) - (b.score || 50));

  return await self.GeminiAgent.runAgent({
    name: 'Creative Director', systemPrompt: CREATIVE_SYSTEM,
    userPrompt: `Generate creatives for "${storeData.store_name}". Products: ${JSON.stringify(storeData.products?.slice(0, 3))}.
GAP ANALYSIS (Score: ${gapAnalysis.overall_score}/100):
${gaps.map(g => `${g.dim}: Score ${g.score}, Severity: ${g.severity}. Gap: ${g.gap}`).join('\n')}
Competitors: ${(gapAnalysis.competitors_analyzed || []).join(', ')}
Use generate_ad_script for all 3 platforms.`,
    tools: CREATIVE_TOOLS,
    toolHandlers: { generate_ad_script: generateAdScript, analyze_hook: analyzeHook },
    maxTurns: 8, onProgress
  });
}

self.CreativeAgent = { runCreativeAgent };
