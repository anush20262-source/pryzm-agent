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

function extractPriceValues(products) {
  return (products || [])
    .map(p => parseFloat(String(p.price || '').replace(/[^0-9.]/g, '')))
    .filter(v => !isNaN(v) && v > 0);
}

function tokenize(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(token => token.length > 2 && !['the','and','for','with','from','your','this','that','into','have','were','will','store','products','product','shop','brand','online','best','top','buy'].includes(token));
}

function extractKeywords(...sources) {
  const counts = new Map();
  for (const source of sources) {
    for (const token of tokenize(source)) {
      counts.set(token, (counts.get(token) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([token]) => token);
}

function detectProductContext(storeData, competitorData) {
  const products = storeData?.products || [];
  const competitorProducts = (competitorData?.competitors || []).flatMap(c => c.products || []);
  const combined = [
    storeData?.store_name,
    storeData?.niche_signals?.meta_description,
    ...products.map(p => `${p.name || ''} ${p.description || ''}`),
    ...competitorProducts.map(p => `${p.name || ''} ${p.description || ''}`),
  ].join(' ').toLowerCase();

  if (/(wallet|card|leather|rfid)/i.test(combined)) return 'wallet';
  if (/(skincare|serum|cream|cleanser|beauty|skin|face)/i.test(combined)) return 'skincare';
  if (/(coffee|tea|bean|roast|brew)/i.test(combined)) return 'coffee';
  if (/(shoe|shoe|sneaker|jacket|shirt|apparel|fabric|fit)/i.test(combined)) return 'apparel';
  if (/(jewelry|ring|necklace|bracelet|gold|silver)/i.test(combined)) return 'jewelry';
  if (/(tech|device|charger|gadget|smart|audio|headphone)/i.test(combined)) return 'tech';
  if (/(supplement|vitamin|protein|health|wellness)/i.test(combined)) return 'wellness';
  return 'general';
}

function getContextualHints(context) {
  const templates = {
    wallet: {
      positioning: 'everyday carry, slim profile, and premium materials',
      feature: 'RFID protection, compact capacity, or gift-ready packaging',
      marketing: 'daily carry, pocket comfort, and premium feel',
      pricing: 'value vs premium feel',
    },
    skincare: {
      positioning: 'ingredient transparency and routine fit',
      feature: 'sensitive-skin compatibility, ingredient list, or bundle value',
      marketing: 'results, ingredient stories, and simple routines',
      pricing: 'trial-size value and bundle savings',
    },
    coffee: {
      positioning: 'roast character and origin story',
      feature: 'single-origin sourcing, freshness, or subscription value',
      marketing: 'brew experience, flavor notes, and morning ritual',
      pricing: 'roast quality and subscription convenience',
    },
    apparel: {
      positioning: 'fit confidence and fabric quality',
      feature: 'size guidance, fabric durability, or sustainability',
      marketing: 'style versatility, fit confidence, and everyday wear',
      pricing: 'durability and long-term value',
    },
    jewelry: {
      positioning: 'craftsmanship and gift appeal',
      feature: 'material quality, engraving, or limited edition details',
      marketing: 'gift-ready presentation and personal meaning',
      pricing: 'craftsmanship and sentimental value',
    },
    tech: {
      positioning: 'practical use cases and reliability',
      feature: 'setup simplicity, compatibility, or warranty',
      marketing: 'performance, convenience, and problem-solving',
      pricing: 'reliability and long-term usefulness',
    },
    wellness: {
      positioning: 'consistency and results-oriented support',
      feature: 'ingredient quality, science-backed benefits, or bundle savings',
      marketing: 'daily routine, consistency, and outcome stories',
      pricing: 'habit-building value and bundle convenience',
    },
    general: {
      positioning: 'clear product benefits and memorable brand promise',
      feature: 'a stronger hero feature or bundle offer',
      marketing: 'practical benefit and social proof',
      pricing: 'value, durability, or premium perception',
    },
  };

  return templates[context] || templates.general;
}

function buildLocalAnalysis(storeData, competitorData) {
  const competitors = (competitorData?.competitors || []).slice(0, 3);
  const products = storeData?.products || [];
  const priceValues = extractPriceValues(products);
  const competitorNames = competitors.map(c => c.name || c.title || 'Unknown').slice(0, 3);
  const metaDescription = storeData?.niche_signals?.meta_description || '';
  const context = detectProductContext(storeData, competitorData);
  const hints = getContextualHints(context);
  const keywords = extractKeywords(
    storeData?.store_name,
    metaDescription,
    ...products.map(p => `${p.name || ''} ${p.description || ''}`),
    ...competitors.flatMap(c => [`${c.positioning || ''} ${c.meta_description || ''}`, ...(c.products || []).map(p => `${p.name || ''} ${p.description || ''}`)])
  );

  const storeText = [storeData?.store_name, metaDescription, ...products.map(p => `${p.name || ''} ${p.description || ''}`)].join(' ').toLowerCase();
  const competitorText = competitors.map(c => `${c.positioning || ''} ${c.meta_description || ''} ${(c.products || []).map(p => `${p.name || ''} ${p.description || ''}`).join(' ')}`).join(' ').toLowerCase();

  const hasClearPositioning = /(premium|minimal|sustainable|craft|custom|guarantee|lifetime|gift|best|smart|eco|tech|durable|quality|trusted)/i.test(storeText);
  const competitorsHaveStrongerPositioning = /(premium|minimal|sustainable|craft|custom|guarantee|lifetime|gift|best|smart|eco|tech|durable|quality|trusted)/i.test(competitorText);
  const positioningScore = Math.max(35, Math.min(78, 56 + (hasClearPositioning ? 8 : -6) + (competitorsHaveStrongerPositioning ? 4 : 0)));

  const avgPrice = priceValues.length ? (priceValues.reduce((a, b) => a + b, 0) / priceValues.length).toFixed(0) : 'N/A';
  const priceScore = priceValues.length
    ? Math.max(38, Math.min(78, 58 - (priceValues.length > 3 ? 3 : 0) + (competitors.length ? 4 : 0)))
    : 46;

  const featureSignals = new Set((products || []).flatMap(p => tokenize(`${p.name || ''} ${p.description || ''}`)));
  const featureScore = Math.max(35, Math.min(80, 48 + (featureSignals.size >= 4 ? 8 : 0) + (competitors.length ? 4 : 0)));

  const contentSignals = competitors.some(c => c.content_strategy || c.page_content_snippet) ? 58 : 42;
  const marketingScore = Math.max(34, Math.min(80, contentSignals + (metaDescription ? 4 : -2)));

  const overallScore = Math.round((positioningScore + priceScore + featureScore + marketingScore) / 4);
  const keywordPhrase = keywords.slice(0, 2).join(' and ') || 'your product category';

  return {
    overall_score: overallScore,
    gap_scorecard: {
      positioning: {
        score: positioningScore,
        you: metaDescription || (products.length ? `Store positioning copy is limited for ${keywordPhrase}.` : 'No positioning copy detected.'),
        competitors: competitorNames.length ? `${competitorNames.join(', ')} appear to have clearer positioning signals around ${keywordPhrase}.` : 'Competitor positioning signals unavailable.',
        gap: `The store needs clearer positioning around ${keywordPhrase} and ${hints.positioning}.`,
        severity: positioningScore < 50 ? 'high' : 'medium',
      },
      pricing: {
        score: priceScore,
        you: priceValues.length ? `Estimated average price is about $${avgPrice}.` : 'No reliable price data available.',
        competitors: competitorNames.length ? `${competitorNames.join(', ')} appear to frame pricing more clearly around ${hints.pricing}.` : 'Competitor pricing signals unavailable.',
        gap: `Pricing should be framed around ${hints.pricing} rather than just a list price.`,
        severity: priceScore < 50 ? 'medium' : 'low',
      },
      features: {
        score: featureScore,
        you: products.length ? `${products.length} product(s) detected, but the feature story is not yet clearly packaged.` : 'Limited product feature data detected.',
        competitors: competitorNames.length ? `${competitorNames.join(', ')} show more explicit hero-feature storytelling for ${keywordPhrase}.` : 'Competitor feature story unavailable.',
        gap: `A stronger hero feature such as ${hints.feature} would make the offer more memorable.`,
        severity: featureScore < 50 ? 'medium' : 'low',
      },
      marketing: {
        score: marketingScore,
        you: metaDescription ? `Some product and store positioning copy is available for ${keywordPhrase}.` : 'Limited marketing copy available.',
        competitors: competitorNames.length ? `${competitorNames.join(', ')} appear to use stronger content and hook-based positioning around ${hints.marketing}.` : 'Competitor marketing signals unavailable.',
        gap: `The store should use hooks around ${hints.marketing} and more product-specific proof.`,
        severity: marketingScore < 50 ? 'high' : 'medium',
      },
    },
    competitors_analyzed: competitorNames,
    ai_summary: `PRYZM generated a ${context}-focused local heuristic analysis from the available store and competitor data. The biggest improvement areas are positioning clarity, pricing story, and stronger product-specific messaging for ${keywordPhrase}.`,
    hook_breakdown: [
      {
        type: 'Value-first hook',
        transcript_quote: `Better ${keywordPhrase} without sacrificing quality`,
        psychological_trigger: 'Practical benefit + reassurance',
        effectiveness_score: 7,
      },
      {
        type: 'Proof hook',
        transcript_quote: `Trusted by customers who want a more thoughtful ${keywordPhrase} experience`,
        psychological_trigger: 'Social proof + status',
        effectiveness_score: 6,
      },
    ],
    product_context: { category: context, keywords },
    analysis_mode: 'local_heuristic',
  };
}

async function runAnalystAgent(storeData, competitorData, onProgress, memory) {
  return buildLocalAnalysis(storeData, competitorData);
}

self.AnalystAgent = { runAnalystAgent };
