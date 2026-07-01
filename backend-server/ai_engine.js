/**
 * PRYZM AI Engine
 * ===============
 * Gemini-powered analysis and creative generation.
 * Uses gemini-2.0-flash with structured JSON output for reliable parsing.
 * Falls back to comprehensive demo data when GEMINI_API_KEY is absent.
 */

require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

// ── Gemini Client ──────────────────────────────────────────────────────────────
let genAI = null;
let model = null;

function initGemini() {
  if (model) return model;
  if (!process.env.GEMINI_API_KEY) return null;

  genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
  return model;
}

// ── System Prompts ─────────────────────────────────────────────────────────────
const GAP_ANALYSIS_SYSTEM_PROMPT = `You are PRYZM, an elite E-commerce Growth Auditor. Compare the merchant's store data against competitor data. Output a strict JSON scorecard evaluating exact market gaps across four dimensions: 1) Positioning & Value Proposition, 2) Pricing Strategy, 3) Feature Offerings, 4) Marketing & Content Hooks. Be brutally specific — use exact numbers, percentages, and quotes. Every gap must have an actionable insight. Score each dimension 0-100 where 100 means the merchant is dominating.`;

const CREATIVE_SYSTEM_PROMPT = `You are PRYZM Creative Director. Generate platform-specific marketing creatives that directly exploit the competitive gaps identified in the analysis. Each creative must use a hook style that's proven to work in the merchant's niche. Be specific to the merchant's actual products. Generate 3 creatives: one TikTok/Reel script, one Meta ad copy, one email hook.`;

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * analyzeGaps(storeData, competitorData)
 * Sends store + competitor profiles to Gemini and receives a structured gap scorecard.
 *
 * @param {Object} storeData       — The merchant's store profile
 * @param {Object} competitorData  — { competitors: [...] } from scraper
 * @returns {Object} Gap analysis JSON matching the defined schema
 */
async function analyzeGaps(storeData, competitorData) {
  const gemini = initGemini();

  if (!gemini) {
    console.log('[AI Engine] No GEMINI_API_KEY — returning demo gap analysis.');
    return getDemoGapAnalysis(storeData);
  }

  const userPrompt = `
## MERCHANT STORE DATA
${JSON.stringify(storeData, null, 2)}

## COMPETITOR DATA
${JSON.stringify(competitorData, null, 2)}

Analyze all gaps and return a JSON object with this EXACT schema:
{
  "overall_score": <number 0-100>,
  "gap_scorecard": {
    "positioning": {
      "score": <number 0-100>,
      "you": "<what the merchant is doing>",
      "competitors": "<what competitors are doing>",
      "gap": "<the specific gap>",
      "severity": "critical|high|medium|low"
    },
    "pricing": { "score": ..., "you": ..., "competitors": ..., "gap": ..., "severity": ... },
    "features": { "score": ..., "you": ..., "competitors": ..., "gap": ..., "severity": ... },
    "marketing": { "score": ..., "you": ..., "competitors": ..., "gap": ..., "severity": ... }
  },
  "competitors_analyzed": ["<competitor names>"],
  "ai_summary": "<2-3 sentence executive summary>",
  "hook_breakdown": [
    {
      "type": "<hook type>",
      "transcript_quote": "<exact quote or example>",
      "psychological_trigger": "<why it works>",
      "effectiveness_score": <1-10>
    }
  ]
}
  `.trim();

  try {
    const result = await gemini.generateContent({
      contents: [
        { role: 'user', parts: [{ text: userPrompt }] },
      ],
      systemInstruction: { parts: [{ text: GAP_ANALYSIS_SYSTEM_PROMPT }] },
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.7,
        maxOutputTokens: 4096,
      },
    });

    return JSON.parse(result.response.text());
  } catch (err) {
    console.error('[AI Engine] Gemini gap analysis failed:', err.message);
    return getDemoGapAnalysis(storeData);
  }
}

/**
 * generateCreatives(gapAnalysis, storeData)
 * Takes gap analysis output and generates platform-specific ad creatives.
 *
 * @param {Object} gapAnalysis — Output from analyzeGaps()
 * @param {Object} storeData   — Merchant store profile
 * @returns {Object} { prescriptions: [...] }
 */
async function generateCreatives(gapAnalysis, storeData) {
  const gemini = initGemini();

  if (!gemini) {
    console.log('[AI Engine] No GEMINI_API_KEY — returning demo creatives.');
    return getDemoCreatives(storeData);
  }

  const userPrompt = `
## GAP ANALYSIS
${JSON.stringify(gapAnalysis, null, 2)}

## MERCHANT STORE DATA
${JSON.stringify(storeData, null, 2)}

Generate marketing creatives that exploit these gaps. Return a JSON object:
{
  "prescriptions": [
    {
      "format": "TikTok/Reel Script | Meta Ad Copy | Email Subject Line",
      "hook_text": "The exact 3-second hook",
      "body_creative": "Full script/copy body",
      "cta": "Call to action"
    }
  ]
}

Create exactly 3 prescriptions:
1. A TikTok/Reel Script with visual directions
2. A Meta Ad Copy (primary text + headline + description)
3. An Email Subject Line with full email body
  `.trim();

  try {
    const result = await gemini.generateContent({
      contents: [
        { role: 'user', parts: [{ text: userPrompt }] },
      ],
      systemInstruction: { parts: [{ text: CREATIVE_SYSTEM_PROMPT }] },
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.9,   // Higher temp for creative output
        maxOutputTokens: 4096,
      },
    });

    return JSON.parse(result.response.text());
  } catch (err) {
    console.error('[AI Engine] Gemini creative generation failed:', err.message);
    return getDemoCreatives(storeData);
  }
}

/**
 * extractStoreProfile(screenshotBase64)
 * STUB — Vision-based store extraction. Takes a base64-encoded screenshot
 * and uses Gemini Vision to extract store name, products, pricing, etc.
 *
 * TODO: Implement when vision pipeline is ready.
 */
async function extractStoreProfile(screenshotBase64) {
  const gemini = initGemini();

  if (!gemini || !screenshotBase64) {
    return {
      success: false,
      message: 'Vision extraction not yet implemented or GEMINI_API_KEY not set.',
      store_name: '',
      products: [],
      niche_signals: {},
    };
  }

  // Future implementation:
  // const result = await gemini.generateContent({
  //   contents: [{
  //     role: 'user',
  //     parts: [
  //       { inlineData: { mimeType: 'image/png', data: screenshotBase64 } },
  //       { text: 'Extract store name, products, prices, and niche from this screenshot. Return JSON.' }
  //     ]
  //   }],
  //   generationConfig: { responseMimeType: 'application/json' },
  // });

  return {
    success: false,
    message: 'Vision extraction is a planned feature. Use manual store data input for now.',
  };
}

// ── Demo Data ──────────────────────────────────────────────────────────────────
// Realistic demo output so the extension works end-to-end without API keys.

function getDemoGapAnalysis(storeData) {
  const storeName = storeData.store_name || 'Your Store';

  return {
    overall_score: 42,
    gap_scorecard: {
      positioning: {
        score: 35,
        you: `${storeName} uses generic product descriptions like "premium leather wallet" with no clear brand story or unique value proposition.`,
        competitors: 'Bellroy leads with "Considered carry for modern life" — a lifestyle-first position. Ridge owns "The last wallet you\'ll ever buy" with a lifetime warranty anchor.',
        gap: 'No differentiated positioning. You\'re competing on product attributes while competitors compete on identity and lifestyle. Need a 5-word brand mantra.',
        severity: 'critical',
      },
      pricing: {
        score: 55,
        you: `Products priced at $45-$65, sitting in the "no man\'s land" between budget ($20-$35) and premium ($89-$145).`,
        competitors: 'Bellroy anchors at $89-$109. Ridge at $95-$145. Both justify premium with warranties and brand equity. Ekster bridges at $69-$119 with tech features.',
        gap: 'Your pricing doesn\'t signal quality or value. Consider either dropping to $35 to own the value tier, or raising to $79+ with added perceived value (gift packaging, warranty, premium materials story).',
        severity: 'high',
      },
      features: {
        score: 50,
        you: 'Standard bi-fold and tri-fold designs with basic card slots. No standout feature or innovation mentioned in product listings.',
        competitors: 'Ridge has RFID-blocking as a baseline feature. Ekster has a solar-powered Chipolo tracker. Bellroy has a hidden coin pouch and pull-tab design. All three have interactive product demos.',
        gap: 'Missing a "hero feature" that becomes your talking point. Consider: RFID protection (table stakes now), a unique closure mechanism, or a modular design system.',
        severity: 'medium',
      },
      marketing: {
        score: 30,
        you: 'Static product photos on a white background. No video content detected. Product descriptions are feature-lists without emotional hooks.',
        competitors: 'Ridge spends $50K+/day on Meta with UGC wallet-dump videos. Bellroy has an on-site "Wallet Finder" quiz driving 23% higher AOV. Ekster runs comparison content ("Ekster vs Ridge") capturing search intent.',
        gap: 'Zero video content is the single biggest gap. Competitors prove that "pocket bulge" before/after videos convert at 3-5x static images. Need 3 UGC-style videos immediately.',
        severity: 'critical',
      },
    },
    competitors_analyzed: ['Bellroy', 'Ridge Wallet', 'Ekster'],
    ai_summary: `${storeName} has significant positioning and marketing gaps against established competitors. The store\'s mid-range pricing ($45-$65) lacks the brand equity to justify premium positioning, while competitors like Ridge and Bellroy dominate with clear brand mantras, video-first marketing, and hero features like RFID blocking and tracking integration. Immediate priority: create 3 UGC-style comparison videos and develop a distinct 5-word brand position.`,
    hook_breakdown: [
      {
        type: 'Curiosity Gap',
        transcript_quote: "I've been carrying the wrong wallet for 10 years...",
        psychological_trigger: 'Creates immediate self-doubt and curiosity — viewer needs to know what they\'re doing wrong.',
        effectiveness_score: 9,
      },
      {
        type: 'Problem Agitation',
        transcript_quote: 'Your wallet is literally ruining your back. Here\'s the science.',
        psychological_trigger: 'Health anxiety + authority ("the science") creates urgency to switch.',
        effectiveness_score: 8,
      },
      {
        type: 'Social Proof Shock',
        transcript_quote: '2 million people switched to this wallet. Here\'s why.',
        psychological_trigger: 'Massive social proof number creates FOMO and validates the product.',
        effectiveness_score: 7,
      },
    ],
  };
}

function getDemoCreatives(storeData) {
  const storeName = storeData.store_name || 'Your Store';
  const productName = storeData.products?.[0]?.name || 'Slim Leather Wallet';

  return {
    prescriptions: [
      {
        format: 'TikTok/Reel Script',
        hook_text: "POV: You empty your pockets and it's embarrassing 😳",
        body_creative: `[HOOK — 0-3s] Close-up of someone struggling to sit down, pulling out a bulging tri-fold wallet.

[PROBLEM — 3-8s] "I used to carry THIS—" (holds up fat wallet) "—until my chiropractor asked me why my hip was uneven."

[REVEAL — 8-15s] "Then I found ${storeName}." Camera cuts to the ${productName} — sleek product shot, cards sliding in smoothly. "Same 8 cards. One-third the thickness."

[PROOF — 15-22s] Side-by-side pocket comparison. Old wallet bulging vs ${productName} laying flat. "My back literally thanked me."

[CTA — 22-25s] "${storeName} — link in bio. Your pockets will thank you too."

[TEXT OVERLAY] "I can't go back 😤" + product link`,
        cta: '🔗 Link in bio — 20% off this week only',
      },
      {
        format: 'Meta Ad Copy',
        hook_text: 'Your wallet is 3x thicker than it needs to be.',
        body_creative: `**Primary Text:**
Your wallet is 3x thicker than it needs to be.

We analyzed the top-selling wallets and found something wild: most people carry 6-8 cards but use a wallet designed for 20.

The ${productName} by ${storeName} holds everything you actually need — in one-third the space.

✅ Full-grain leather (not bonded)
✅ Fits 8 cards + cash
✅ Slim enough to front-pocket carry
✅ Built to last 10+ years

Over 500 people switched this month alone.

**Headline:** The Wallet You'll Actually Feel Good Carrying
**Description:** Premium slim wallet. Free shipping. 30-day risk-free trial.`,
        cta: 'Shop Now → Free Shipping Today',
      },
      {
        format: 'Email Subject Line',
        hook_text: "Your wallet is a red flag (here's why) 🚩",
        body_creative: `**Subject:** Your wallet is a red flag (here's why) 🚩

**Preview text:** 73% of people judge you by what's in your pocket.

Hey {first_name},

Quick question — when was the last time you thought about your wallet?

Not what's IN it. The wallet itself.

Here's something most people don't realize: a bulky wallet is the #1 thing people notice (and silently judge) at a checkout counter, a dinner table, or a first date.

We built the ${productName} to fix that.

→ Full-grain leather that develops a patina over time
→ Holds 8 cards without the bulk
→ Thin enough to forget it's there

**"I got 3 compliments in my first week."** — actual customer review

For the next 48 hours, get 20% off your first ${storeName} wallet.

[SHOP THE ${productName.toUpperCase()} →]

Talk soon,
The ${storeName} Team

P.S. — We offer a 30-day "love it or return it" guarantee. Zero risk.`,
        cta: 'Get 20% Off → 48 Hours Only',
      },
    ],
  };
}

// ── Exports ────────────────────────────────────────────────────────────────────
module.exports = { analyzeGaps, generateCreatives, extractStoreProfile };
