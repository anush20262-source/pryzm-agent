/**
 * PRYZM Creative Agent
 * =====================
 * The THIRD agent in the pipeline. Takes the gap analysis from Analyst
 * and generates ready-to-deploy marketing creatives.
 * 
 * Tools:
 *   - generate_ad_script: Creates a platform-specific ad script
 *   - analyze_hook: Analyzes and scores a marketing hook
 * 
 * Output: 3 platform-specific creative scripts (TikTok, Meta, Email)
 */

const { runAgent } = require('./agent_runner');

// ── Tool: Generate Ad Script ────────────────────────────────────────────────
async function generateAdScript({ platform, product_name, gap_to_exploit, target_emotion }) {
  // This tool provides structured context for the agent to work with
  const platformGuides = {
    'tiktok': {
      format: 'TikTok/Reel Script',
      guidelines: '15-60 seconds. Hook in first 3 seconds. POV or UGC style. Visual directions in [brackets]. End with clear CTA.',
      tone: 'Casual, direct, slightly provocative. Use "you" language.',
      max_words: 150
    },
    'meta': {
      format: 'Meta Ad Copy',
      guidelines: 'Primary text (125 chars visible). Headline (40 chars). Description. Use emojis sparingly. Include hashtags.',
      tone: 'Professional but punchy. Benefit-focused.',
      max_words: 100
    },
    'email': {
      format: 'Email Subject Line + Body',
      guidelines: 'Subject line under 50 chars. Preview text under 90 chars. Body: problem → agitation → solution. 3-5 short paragraphs.',
      tone: 'Personal, direct, slightly urgent.',
      max_words: 200
    }
  };

  const guide = platformGuides[platform.toLowerCase()] || platformGuides['meta'];

  return {
    platform: guide.format,
    guidelines: guide.guidelines,
    suggested_tone: guide.tone,
    max_words: guide.max_words,
    context: {
      product: product_name,
      gap: gap_to_exploit,
      emotion: target_emotion
    }
  };
}

// ── Tool: Analyze Hook ──────────────────────────────────────────────────────
async function analyzeHook({ hook_text, target_audience }) {
  // Provides structured analysis context
  const wordCount = hook_text.split(' ').length;
  const hasQuestion = hook_text.includes('?');
  const hasNumber = /\d/.test(hook_text);
  const hasEmotionalWord = /stop|never|worst|best|secret|hack|mistake|truth|actually|literally/i.test(hook_text);
  
  return {
    word_count: wordCount,
    has_question: hasQuestion,
    has_number: hasNumber,
    has_emotional_trigger: hasEmotionalWord,
    readability: wordCount <= 15 ? 'excellent' : wordCount <= 25 ? 'good' : 'too_long',
    suggestions: [
      !hasQuestion && !hasEmotionalWord ? 'Add a provocative question or emotional trigger word' : null,
      wordCount > 20 ? 'Shorten to under 15 words for better hook performance' : null,
      !hasNumber ? 'Consider adding a specific number for credibility' : null,
    ].filter(Boolean)
  };
}

// ── Creative Agent Definition ───────────────────────────────────────────────
const CREATIVE_TOOLS = [
  {
    name: 'generate_ad_script',
    description: 'Get platform-specific guidelines and context for generating an ad creative.',
    parameters: {
      type: 'object',
      properties: {
        platform: { type: 'string', enum: ['tiktok', 'meta', 'email'], description: 'Target ad platform' },
        product_name: { type: 'string', description: 'The merchant product to promote' },
        gap_to_exploit: { type: 'string', description: 'The competitive gap this ad should exploit' },
        target_emotion: { type: 'string', description: 'The primary emotion to trigger (fear, aspiration, curiosity, etc.)' }
      },
      required: ['platform', 'product_name', 'gap_to_exploit']
    }
  },
  {
    name: 'analyze_hook',
    description: 'Analyze a marketing hook text for effectiveness — checks word count, emotional triggers, and readability.',
    parameters: {
      type: 'object',
      properties: {
        hook_text: { type: 'string', description: 'The hook text to analyze' },
        target_audience: { type: 'string', description: 'Who this hook targets' }
      },
      required: ['hook_text']
    }
  }
];

const CREATIVE_SYSTEM_PROMPT = `You are PRYZM Creative Director — an ad copywriting agent.

You receive a gap analysis scorecard and must generate ready-to-deploy marketing creatives.

PROCESS:
1. Use generate_ad_script for "tiktok" to get guidelines, then craft the TikTok script
2. Use generate_ad_script for "meta" to get guidelines, then craft the Meta ad
3. Use generate_ad_script for "email" to get guidelines, then craft the email
4. Optionally use analyze_hook to check your hook effectiveness
5. Produce your final output

OUTPUT FORMAT — You MUST respond with this exact JSON structure:
{
  "prescriptions": [
    {
      "format": "TikTok/Reel Script",
      "hook_text": "The exact 3-second hook (under 15 words)",
      "body_creative": "Full script with [visual directions]",
      "cta": "Call to action"
    },
    {
      "format": "Meta Ad Copy",
      "hook_text": "Primary text hook",
      "body_creative": "Full ad copy with hashtags",
      "cta": "CTA button text"
    },
    {
      "format": "Email Subject Line",
      "hook_text": "Subject line (under 50 chars)",
      "body_creative": "Full email body",
      "cta": "CTA link text"
    }
  ]
}

RULES:
- Each creative must DIRECTLY exploit a gap from the analysis
- Hooks must be under 15 words and emotionally triggering
- Never be generic — reference the merchant's ACTUAL product and competitive advantage
- TikTok scripts need [visual directions] for each beat
- Use generate_ad_script for ALL 3 platforms before final output`;

/**
 * runCreativeAgent — Generates marketing creatives based on gap analysis
 * @param {Object} gapAnalysis - Output from Analyst agent
 * @param {Object} storeData - The merchant's store data
 * @returns {Object} Creative prescriptions
 */
async function runCreativeAgent(gapAnalysis, storeData) {
  const scorecard = gapAnalysis.gap_scorecard || {};
  
  // Find the most critical gaps to exploit
  const gaps = Object.entries(scorecard)
    .map(([key, val]) => ({ dimension: key, ...val }))
    .sort((a, b) => (a.score || 50) - (b.score || 50)); // Lowest scores first = biggest gaps

  const userPrompt = `Generate marketing creatives for this merchant based on the gap analysis:

MERCHANT:
- Name: ${storeData.store_name}
- Products: ${JSON.stringify(storeData.products?.slice(0, 3))}
- Current positioning: ${storeData.niche_signals?.meta_description || 'unknown'}

GAP ANALYSIS (Overall Score: ${gapAnalysis.overall_score}/100):
${gaps.map(g => `
${g.dimension.toUpperCase()} (Score: ${g.score}/100, Severity: ${g.severity}):
  You: ${g.you}
  Competitors: ${g.competitors}
  Gap: ${g.gap}
`).join('')}

COMPETITORS: ${(gapAnalysis.competitors_analyzed || []).join(', ')}

AI SUMMARY: ${gapAnalysis.ai_summary}

Generate 3 creatives (TikTok, Meta, Email) that exploit the BIGGEST gaps. Use generate_ad_script for each platform to get guidelines first.`;

  return await runAgent({
    name: 'Creative Director',
    systemPrompt: CREATIVE_SYSTEM_PROMPT,
    userPrompt,
    tools: CREATIVE_TOOLS,
    toolHandlers: {
      generate_ad_script: generateAdScript,
      analyze_hook: analyzeHook,
    },
    maxTurns: 8,
  });
}

module.exports = { runCreativeAgent };
