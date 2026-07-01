/**
 * PRYZM Analyst Agent
 * ====================
 * The SECOND agent in the pipeline. Takes merchant data + competitor
 * data from Scout, and produces a structured gap analysis scorecard.
 * 
 * Tools:
 *   - compare_pricing: Compares pricing strategies
 *   - compare_positioning: Compares brand positioning
 *   - compare_features: Compares product features
 *   - compare_marketing: Compares marketing approaches
 * 
 * Output: 4-dimension gap scorecard with scores, gaps, and severity
 */

const { runAgent } = require('./agent_runner');

// ── Tool: Compare Pricing ──────────────────────────────────────────────────
async function comparePricing({ your_products, competitor_products }) {
  // Calculate actual price statistics
  const extractPrices = (products) => {
    return (products || [])
      .map(p => parseFloat(String(p.price || '').replace(/[^0-9.]/g, '')))
      .filter(p => !isNaN(p) && p > 0);
  };

  const yourPrices = extractPrices(your_products);
  const compPrices = extractPrices(competitor_products);

  const avg = (arr) => arr.length ? (arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2) : 'N/A';
  const min = (arr) => arr.length ? Math.min(...arr).toFixed(2) : 'N/A';
  const max = (arr) => arr.length ? Math.max(...arr).toFixed(2) : 'N/A';

  return {
    your_avg_price: avg(yourPrices),
    your_price_range: `$${min(yourPrices)} - $${max(yourPrices)}`,
    competitor_avg_price: avg(compPrices),
    competitor_price_range: `$${min(compPrices)} - $${max(compPrices)}`,
    price_difference_percent: yourPrices.length && compPrices.length
      ? ((parseFloat(avg(compPrices)) - parseFloat(avg(yourPrices))) / parseFloat(avg(yourPrices)) * 100).toFixed(1)
      : 'N/A',
    your_product_count: your_products?.length || 0,
    competitor_product_count: competitor_products?.length || 0
  };
}

// ── Tool: Compare Positioning ──────────────────────────────────────────────
async function comparePositioning({ your_description, competitor_descriptions }) {
  return {
    your_positioning: your_description || 'No positioning detected',
    competitor_positionings: competitor_descriptions || [],
    analysis_hint: 'Compare the value propositions, target audiences, and brand angles'
  };
}

// ── Tool: Compare Features ──────────────────────────────────────────────────
async function compareFeatures({ your_features, competitor_features }) {
  const yourSet = new Set((your_features || []).map(f => f.toLowerCase()));
  const compSet = new Set((competitor_features || []).map(f => f.toLowerCase()));
  
  const uniqueToYou = [...yourSet].filter(f => !compSet.has(f));
  const uniqueToCompetitors = [...compSet].filter(f => !yourSet.has(f));
  const shared = [...yourSet].filter(f => compSet.has(f));

  return {
    unique_to_you: uniqueToYou,
    unique_to_competitors: uniqueToCompetitors,
    shared_features: shared,
    your_feature_count: yourSet.size,
    competitor_feature_count: compSet.size
  };
}

// ── Tool: Compare Marketing ──────────────────────────────────────────────────
async function compareMarketing({ your_content, competitor_content }) {
  return {
    your_marketing: your_content || 'No marketing data available',
    competitor_marketing: competitor_content || [],
    analysis_hint: 'Look at content strategy, social media presence, ad hooks, UGC usage'
  };
}

// ── Analyst Agent Definition ────────────────────────────────────────────────
const ANALYST_TOOLS = [
  {
    name: 'compare_pricing',
    description: 'Compare pricing between the merchant and competitors. Returns avg prices, ranges, and percentage difference.',
    parameters: {
      type: 'object',
      properties: {
        your_products: { type: 'array', items: { type: 'object' }, description: 'Merchant product list [{name, price}]' },
        competitor_products: { type: 'array', items: { type: 'object' }, description: 'Competitor product list [{name, price}]' }
      },
      required: ['your_products', 'competitor_products']
    }
  },
  {
    name: 'compare_positioning',
    description: 'Compare brand positioning and value propositions between merchant and competitors.',
    parameters: {
      type: 'object',
      properties: {
        your_description: { type: 'string', description: 'Merchant meta description / value proposition' },
        competitor_descriptions: { type: 'array', items: { type: 'string' }, description: 'Competitor descriptions' }
      },
      required: ['your_description']
    }
  },
  {
    name: 'compare_features',
    description: 'Compare product features between merchant and competitors. Finds unique and shared features.',
    parameters: {
      type: 'object',
      properties: {
        your_features: { type: 'array', items: { type: 'string' }, description: 'List of merchant product features' },
        competitor_features: { type: 'array', items: { type: 'string' }, description: 'List of competitor product features' }
      },
      required: ['your_features', 'competitor_features']
    }
  },
  {
    name: 'compare_marketing',
    description: 'Compare marketing and content strategy between merchant and competitors.',
    parameters: {
      type: 'object',
      properties: {
        your_content: { type: 'string', description: 'Description of merchant content/marketing' },
        competitor_content: { type: 'array', items: { type: 'string' }, description: 'Descriptions of competitor content strategies' }
      },
      required: ['your_content']
    }
  }
];

const ANALYST_SYSTEM_PROMPT = `You are PRYZM Analyst — an elite e-commerce gap analysis agent.

You receive the merchant's store data and competitor data from the Scout agent.
Your job is to use your analysis tools to produce a detailed competitive gap scorecard.

PROCESS:
1. Use compare_pricing with REAL product data from both sides
2. Use compare_positioning with REAL descriptions
3. Use compare_features with features extracted from product descriptions
4. Use compare_marketing based on available content data
5. After using ALL 4 tools, produce your final scorecard

OUTPUT FORMAT — You MUST respond with this exact JSON structure:
{
  "overall_score": <0-100, weighted average of 4 dimensions>,
  "gap_scorecard": {
    "positioning": {
      "score": <0-100>,
      "you": "What the merchant does (specific, real data)",
      "competitors": "What competitors do (specific, real data)",
      "gap": "The exact gap and what it means (be brutal and specific)",
      "severity": "critical|high|medium|low"
    },
    "pricing": { same structure },
    "features": { same structure },
    "marketing": { same structure }
  },
  "competitors_analyzed": ["Brand 1", "Brand 2", "Brand 3"],
  "ai_summary": "2-3 sentence brutally honest summary of the biggest gaps",
  "hook_breakdown": [
    {
      "type": "Hook style name",
      "transcript_quote": "Example hook text from competitor ads",
      "psychological_trigger": "Why it works (specific psychology)",
      "effectiveness_score": <1-10>
    }
  ]
}

RULES:
- USE ALL 4 TOOLS before giving your final answer
- Use REAL data from the inputs — never invent numbers
- Be brutally specific — use exact prices, percentages, quotes
- Score honestly: 100 = merchant dominates, 0 = merchant is invisible
- Severity: critical = losing significant revenue, low = minor improvement area`;

/**
 * runAnalystAgent — Produces gap analysis from merchant + competitor data
 * @param {Object} storeData - The merchant's store data
 * @param {Object} competitorData - Output from Scout agent
 * @returns {Object} Gap analysis scorecard
 */
async function runAnalystAgent(storeData, competitorData) {
  const competitors = competitorData.competitors || [];
  
  const userPrompt = `Analyze the competitive gaps for this merchant:

MERCHANT STORE:
- Name: ${storeData.store_name}
- Products: ${JSON.stringify(storeData.products?.slice(0, 10))}
- Meta Description: ${storeData.niche_signals?.meta_description || 'none'}
- Keywords: ${storeData.niche_signals?.keywords?.join(', ') || 'unknown'}

COMPETITOR DATA (from Scout Agent):
${competitors.map((c, i) => `
Competitor ${i + 1}: ${c.name || c.title || 'Unknown'}
- URL: ${c.url}
- Platform: ${c.platform || 'unknown'}
- Products: ${JSON.stringify((c.products || []).slice(0, 5))}
- Positioning: ${c.positioning || c.meta_description || 'unknown'}
- Pricing Strategy: ${c.pricing_strategy || 'unknown'}
- Content Strategy: ${c.content_strategy || 'unknown'}
- Page Snippet: ${(c.page_content_snippet || '').substring(0, 500)}
`).join('\n')}

Niche Summary: ${competitorData.niche_summary || 'unknown'}

Use ALL 4 comparison tools, then produce your final gap scorecard JSON.`;

  return await runAgent({
    name: 'Analyst',
    systemPrompt: ANALYST_SYSTEM_PROMPT,
    userPrompt,
    tools: ANALYST_TOOLS,
    toolHandlers: {
      compare_pricing: comparePricing,
      compare_positioning: comparePositioning,
      compare_features: compareFeatures,
      compare_marketing: compareMarketing,
    },
    maxTurns: 8,
  });
}

module.exports = { runAnalystAgent };
