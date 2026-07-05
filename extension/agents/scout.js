/**
 * PRYZM Scout Agent (v3 — Search Grounding)
 * ============================================
 * Finds and researches competitors using Gemini's Google Search grounding.
 * No more broken Google.com scraping — Gemini searches the web itself.
 */

// ── Tool: Scrape a competitor store ──────────────────────────────────
async function scrapeStore({ url }) {
  console.log(`[Scout] 🌐 Scraping: ${url}`);
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const html = await response.text();

    // Extract JSON-LD products
    const products = [];
    const jsonLdRegex = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
    let ldMatch;
    while ((ldMatch = jsonLdRegex.exec(html)) !== null) {
      try {
        const data = JSON.parse(ldMatch[1]);
        const items = data['@type'] === 'Product' ? [data] :
                      data['@type'] === 'ItemList' ? (data.itemListElement || []).map(i => i.item || i) :
                      data['@graph'] ? data['@graph'].filter(i => i['@type'] === 'Product') : [];
        items.forEach(item => {
          if (item.name) products.push({
            name: item.name,
            price: item.offers?.price || item.offers?.lowPrice || '',
            currency: item.offers?.priceCurrency || 'USD',
            description: (item.description || '').substring(0, 200),
          });
        });
      } catch {}
    }

    // Meta info
    const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    const metaDescMatch = html.match(/<meta[^>]*name="description"[^>]*content="([^"]*)"[^>]*>/i);

    // Platform detection
    let platform = 'unknown';
    if (html.includes('cdn.shopify.com') || html.includes('Shopify')) platform = 'shopify';
    else if (html.includes('woocommerce') || html.includes('WooCommerce')) platform = 'woocommerce';
    else if (html.includes('BigCommerce')) platform = 'bigcommerce';
    else if (html.includes('squarespace')) platform = 'squarespace';

    // Page text snippet (strip tags, truncate — guard against prompt injection)
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    const rawText = (bodyMatch ? bodyMatch[1] : html)
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 1000);

    return {
      url, title: titleMatch?.[1] || '', meta_description: metaDescMatch?.[1] || '',
      platform, products: products.slice(0, 10), product_count: products.length,
      page_content_snippet: rawText, scraped_at: new Date().toISOString(),
    };
  } catch (err) {
    return { url, error: err.message, products: [], page_content_snippet: '' };
  }
}

// ── Scout Tools (only scrape_store — search is done via grounding) ────
const SCOUT_TOOLS = [
  {
    name: 'scrape_store',
    description: 'Scrape a competitor store URL for products, pricing, and positioning data.',
    parameters: {
      type: 'object',
      properties: { url: { type: 'string', description: 'Full URL of the competitor store to scrape' } },
      required: ['url'],
    },
  },
];

const SCOUT_SYSTEM = `You are PRYZM Scout — a competitive intelligence agent.
You have been given competitor URLs found via web search. Your job is to SCRAPE them and compile intelligence.

PROCESS:
1. Use scrape_store on the top 3 most relevant competitor URLs
2. Compile findings into a structured report

OUTPUT (JSON):
{
  "competitors": [
    {
      "name": "Store Name",
      "url": "https://...",
      "platform": "shopify|woocommerce|other",
      "products": [{"name": "...", "price": "...", "description": "..."}],
      "positioning": "Brief description of their brand positioning",
      "pricing_strategy": "premium|mid-range|budget",
      "content_strategy": "What marketing approach they use"
    }
  ],
  "niche_summary": "2-3 sentence competitive landscape summary"
}

RULES: Scrape at least 2 stores. Focus on DIRECT competitors. Use REAL scraped data only.`;

/**
 * runScoutAgent — Two-phase approach:
 *   Phase 1: Use Gemini Search Grounding to find competitor URLs
 *   Phase 2: Use function calling to scrape those URLs
 */
async function runScoutAgent(storeData, onProgress, memory) {
  const apiKey = await self.GeminiAgent.getApiKey();
  if (!apiKey) throw new Error('No API key configured.');

  const niche = storeData.niche_signals?.keywords?.join(', ') || storeData.store_name || 'e-commerce';
  const storeName = storeData.store_name || 'Unknown Store';
  const platform = storeData.platform || 'shopify';
  const topProducts = (storeData.products || []).slice(0, 3).map(p => p.name).join(', ');

  console.log('[Scout] Phase 1: Searching for competitors via Gemini Search Grounding...');
  if (onProgress) onProgress({ agent: 'Scout', status: 'searching', message: `Searching for ${niche} competitors on ${platform}...` });

  const memoryContext = memory
    ? `\n\nPREVIOUS ANALYSIS MEMORY:\n${memory}\nCompare with previous findings. Note any changes.`
    : '';

  // Build platform-specific search hints
  const platformSearchHints = {
    shopify: 'Look for stores on Shopify (URLs containing .myshopify.com or powered by Shopify)',
    woocommerce: 'Look for stores using WooCommerce (WordPress-based online stores)',
    bigcommerce: 'Look for stores on BigCommerce platform',
    squarespace: 'Look for stores built on Squarespace Commerce',
  };
  const platformHint = platformSearchHints[platform] || platformSearchHints.shopify;

  const searchPrompt = `Find the top 3 DIRECT e-commerce competitor stores for "${storeName}" in the "${niche}" niche.

SEARCH STRATEGY — Search specifically for:
1. "${niche} online store shopify" — find Shopify competitors
2. "${niche} shop similar to ${storeName}" — find direct alternatives
3. "best ${niche} brands online store" — find market leaders
4. "${(storeData.products || []).slice(0, 3).map(p => p.name).join(', ')} buy online" — product-based search

${platformHint}

Their website: ${storeData.url || 'unknown'}
Their products: ${topProducts}
${memoryContext}

RULES:
- Only return REAL e-commerce stores (not marketplaces like Amazon/eBay/Etsy)
- Only return stores that SELL products (not blogs, reviews, or directories)
- Prefer stores on Shopify, WooCommerce, BigCommerce, or Squarespace
- Each URL must be a direct store homepage (not a product page)
- Return at least 3, max 3 competitors

Return JSON array: [{"name": "Store Name", "url": "https://store.com", "why": "reason", "platform": "shopify|woocommerce|other"}]
Format: \`\`\`json [...] \`\`\``;

  let competitorUrls = [];

  try {
    const searchResult = await self.GeminiAgent.callGeminiWithSearch(
      apiKey, 'gemini-2.0-flash-lite', searchPrompt,
      'You are an e-commerce market researcher. Find REAL competitor online stores via web search. Focus on Shopify, WooCommerce, and independent D2C brands. Never suggest Amazon, eBay, Etsy, or Walmart. Always return valid JSON.'
    );

    const searchText = searchResult.candidates?.[0]?.content?.parts?.find(p => p.text)?.text || '';
    console.log('[Scout] Search grounding response received');

    // Parse competitor URLs from the response
    try {
      const cleaned = searchText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      competitorUrls = JSON.parse(cleaned);
    } catch {
      // Try to extract URLs with regex as fallback
      const urlRegex = /https?:\/\/[^\s"',\]]+/g;
      const urls = searchText.match(urlRegex) || [];
      competitorUrls = urls
        .filter(u => !u.includes('google.com') && !u.includes('youtube.com') && !u.includes('wikipedia.org'))
        .slice(0, 5)
        .map(url => ({ name: new URL(url).hostname, url, why: 'Found via web search' }));
    }
  } catch (err) {
    console.log(`[Scout] Search grounding failed: ${err.message}. Using fallback.`);
    // Fallback: ask Gemini without search grounding to suggest known competitors
    try {
      const fallbackResult = await self.GeminiAgent.callGemini(
        apiKey, 'gemini-2.0-flash',
        [{ role: 'user', parts: [{ text: `List 3-5 real online competitor stores for a "${niche}" store called "${storeName}". Return JSON array with name, url, why fields. Only real stores.` }] }],
        null,
        'Return valid JSON only. No explanations.'
      );
      const fbText = fallbackResult.candidates?.[0]?.content?.parts?.find(p => p.text)?.text || '[]';
      competitorUrls = JSON.parse(fbText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim());
    } catch {
      competitorUrls = [];
    }
  }

  console.log(`[Scout] Found ${competitorUrls.length} competitor URLs`);
  if (onProgress) onProgress({ agent: 'Scout', status: 'found', count: competitorUrls.length });

  // ── Phase 2: Scrape competitor stores ─────────────────────────────
  if (competitorUrls.length === 0) {
    return {
      competitors: [],
      niche_summary: `No competitors found for "${niche}". Try a more specific niche or add competitor URLs manually.`,
    };
  }

  const urlList = competitorUrls.slice(0, 5).map(c => c.url || c).join('\n');

  const scrapePrompt = `Here are competitor URLs found for "${storeName}" (${niche}):

${competitorUrls.slice(0, 5).map((c, i) => `${i + 1}. ${c.name || 'Unknown'}: ${c.url} — ${c.why || ''}`).join('\n')}

Scrape the top 3 most relevant ones using scrape_store. Then compile your findings.`;

  return await self.GeminiAgent.runAgent({
    name: 'Scout',
    systemPrompt: SCOUT_SYSTEM,
    userPrompt: scrapePrompt,
    tools: SCOUT_TOOLS,
    toolHandlers: { scrape_store: scrapeStore },
    maxTurns: 3,
    onProgress,
  });
}

self.ScoutAgent = { runScoutAgent };
