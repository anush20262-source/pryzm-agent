/**
 * PRYZM Analyst Agent (Browser Edition)
 * =======================================
 * Takes merchant + competitor data, produces gap scorecard.
 * Runs entirely in the extension — no backend.
 */

// ── Tools ─────────────────────────────────────────────────────────────
async function comparePricing({ your_products, competitor_products }) {
  const extract = (products) => (products || []).map(p => parseFloat(String(p.price || '').replace(/[^0-9.]/g, ''))).filter(p => !isNaN(p) && p > 0);
  const avg = (arr) => arr.length ? (arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2) : 'N/A';
  const yourP = extract(your_products), compP = extract(competitor_products);
  return {
    your_avg_price: avg(yourP), competitor_avg_price: avg(compP),
    your_range: yourP.length ? `$${Math.min(...yourP)} - $${Math.max(...yourP)}` : 'N/A',
    competitor_range: compP.length ? `$${Math.min(...compP)} - $${Math.max(...compP)}` : 'N/A',
    price_diff_pct: yourP.length && compP.length ? ((parseFloat(avg(compP)) - parseFloat(avg(yourP))) / parseFloat(avg(yourP)) * 100).toFixed(1) : 'N/A'
  };
}

async function comparePositioning({ your_description, competitor_descriptions }) {
  return { your_positioning: your_description || 'No positioning detected', competitor_positionings: competitor_descriptions || [] };
}

async function compareFeatures({ your_features, competitor_features }) {
  const yours = new Set((your_features || []).map(f => f.toLowerCase()));
  const theirs = new Set((competitor_features || []).map(f => f.toLowerCase()));
  return {
    unique_to_you: [...yours].filter(f => !theirs.has(f)),
    unique_to_competitors: [...theirs].filter(f => !yours.has(f)),
    shared: [...yours].filter(f => theirs.has(f))
  };
}

async function compareMarketing({ your_content, competitor_content }) {
  return { your_marketing: your_content || 'No data', competitor_marketing: competitor_content || [] };
}

const ANALYST_TOOLS = [
  { name: 'compare_pricing', description: 'Compare pricing between merchant and competitors.', parameters: { type: 'object', properties: { your_products: { type: 'array', items: { type: 'object' } }, competitor_products: { type: 'array', items: { type: 'object' } } }, required: ['your_products', 'competitor_products'] } },
  { name: 'compare_positioning', description: 'Compare brand positioning.', parameters: { type: 'object', properties: { your_description: { type: 'string' }, competitor_descriptions: { type: 'array', items: { type: 'string' } } }, required: ['your_description'] } },
  { name: 'compare_features', description: 'Compare product features.', parameters: { type: 'object', properties: { your_features: { type: 'array', items: { type: 'string' } }, competitor_features: { type: 'array', items: { type: 'string' } } }, required: ['your_features', 'competitor_features'] } },
  { name: 'compare_marketing', description: 'Compare marketing strategies.', parameters: { type: 'object', properties: { your_content: { type: 'string' }, competitor_content: { type: 'array', items: { type: 'string' } } }, required: ['your_content'] } }
];

const ANALYST_SYSTEM = `You are PRYZM Analyst — an elite gap analysis agent.
Use ALL 4 comparison tools with real data, then produce a scorecard.

OUTPUT (JSON):
{
  "overall_score": <0-100>,
  "gap_scorecard": {
    "positioning": { "score": <0-100>, "you": "...", "competitors": "...", "gap": "...", "severity": "critical|high|medium|low" },
    "pricing": { same },
    "features": { same },
    "marketing": { same }
  },
  "competitors_analyzed": ["Brand1", "Brand2"],
  "ai_summary": "2-3 sentence brutally honest summary",
  "hook_breakdown": [{ "type": "Hook style", "transcript_quote": "...", "psychological_trigger": "...", "effectiveness_score": <1-10> }]
}

RULES: Use ALL 4 tools. Use real data. Be brutally specific. Score honestly.`;

async function runAnalystAgent(storeData, competitorData, onProgress, memory) {
  const competitors = competitorData.competitors || [];
  const memoryContext = memory
    ? `\n\nPREVIOUS ANALYSIS (compare with current):\n${memory}\nNote what has IMPROVED and what has WORSENED since last time.`
    : '';

  const userPrompt = `Analyze gaps for "${storeData.store_name}":
Products: ${JSON.stringify(storeData.products?.slice(0, 10))}
Meta: "${storeData.niche_signals?.meta_description || ''}"

COMPETITORS:
${competitors.map((c, i) => `${i + 1}. ${c.name || c.title || 'Unknown'} (${c.url}): Products: ${JSON.stringify((c.products || []).slice(0, 5))}, Positioning: "${c.positioning || c.meta_description || ''}", Pricing: "${c.pricing_strategy || ''}", Content: "${(c.page_content_snippet || c.content_strategy || '').substring(0, 300)}"`).join('\n')}
${memoryContext}
Use ALL 4 tools, then produce the gap scorecard.`;

  return await self.GeminiAgent.runAgent({
    name: 'Analyst', systemPrompt: ANALYST_SYSTEM, userPrompt,
    tools: ANALYST_TOOLS,
    toolHandlers: { compare_pricing: comparePricing, compare_positioning: comparePositioning, compare_features: compareFeatures, compare_marketing: compareMarketing },
    maxTurns: 6, onProgress
  });
}

self.AnalystAgent = { runAnalystAgent };
