/**
 * PRYZM Scout Agent (Browser Edition)
 * =====================================
 * Finds and researches competitors — runs entirely in the extension.
 * Uses fetch for web scraping (extensions bypass CORS).
 */

// ── Tool: Search for competitors ──────────────────────────────────────
async function searchCompetitors({ niche, keywords }) {
  console.log(`[Scout] 🔍 Searching competitors for: "${niche}"`);
  const competitors = [];
  const queries = [
    `best ${niche} brands online store`,
    `${niche} competitors top rated`,
    ...(keywords || []).slice(0, 2).map(k => `${k} online store`)
  ];

  for (const query of queries) {
    try {
      const encoded = encodeURIComponent(query);
      const response = await fetch(`https://www.google.com/search?q=${encoded}&num=5`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
      });
      const html = await response.text();
      // Extract URLs from Google results using regex (no cheerio in browser)
      const urlRegex = /url\?q=(https?:\/\/[^&"]+)/g;
      let match;
      while ((match = urlRegex.exec(html)) !== null) {
        const url = decodeURIComponent(match[1]);
        if (!url.includes('google.com') && !url.includes('youtube.com') &&
            !url.includes('wikipedia.org') && !url.includes('amazon.com') &&
            !url.includes('facebook.com') && !url.includes('instagram.com') &&
            !competitors.find(c => c.url === url)) {
          competitors.push({ url, source_query: query });
        }
      }
    } catch (err) {
      console.log(`[Scout] ⚠️ Search failed for "${query}": ${err.message}`);
    }
  }

  return { competitors_found: competitors.slice(0, 8), total: competitors.length, queries_used: queries };
}

// ── Tool: Scrape a competitor store ──────────────────────────────────────
async function scrapeStore({ url }) {
  console.log(`[Scout] 🌐 Scraping: ${url}`);
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept': 'text/html' },
      signal: controller.signal
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
            description: (item.description || '').substring(0, 200)
          });
        });
      } catch {}
    }

    // Extract meta info
    const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    const metaDescMatch = html.match(/<meta[^>]*name="description"[^>]*content="([^"]*)"[^>]*>/i);
    const ogTitleMatch = html.match(/<meta[^>]*property="og:title"[^>]*content="([^"]*)"[^>]*>/i);

    // Platform detection
    let platform = 'unknown';
    if (html.includes('cdn.shopify.com') || html.includes('Shopify')) platform = 'shopify';
    else if (html.includes('woocommerce') || html.includes('WooCommerce')) platform = 'woocommerce';
    else if (html.includes('BigCommerce')) platform = 'bigcommerce';

    // Page text for positioning (strip tags)
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    const pageText = (bodyMatch ? bodyMatch[1] : html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 1500);

    return {
      url, title: ogTitleMatch?.[1] || titleMatch?.[1] || '', meta_description: metaDescMatch?.[1] || '',
      platform, products: products.slice(0, 10), product_count: products.length,
      page_content_snippet: pageText, scraped_at: new Date().toISOString()
    };
  } catch (err) {
    return { url, error: err.message, products: [], page_content_snippet: '' };
  }
}

// ── Scout Agent Config ──────────────────────────────────────────────────
const SCOUT_TOOLS = [
  {
    name: 'search_competitors',
    description: 'Search the web for competitor stores in a niche. Returns competitor URLs.',
    parameters: {
      type: 'object',
      properties: {
        niche: { type: 'string', description: 'Product niche (e.g., "leather wallets")' },
        keywords: { type: 'array', items: { type: 'string' }, description: 'Keywords to search' }
      },
      required: ['niche']
    }
  },
  {
    name: 'scrape_store',
    description: 'Scrape a competitor store URL for products, pricing, and positioning.',
    parameters: {
      type: 'object',
      properties: { url: { type: 'string', description: 'Competitor store URL' } },
      required: ['url']
    }
  }
];

const SCOUT_SYSTEM = `You are PRYZM Scout — a competitive intelligence agent.
Find and research competitors for a merchant's e-commerce store.

PROCESS:
1. Use search_competitors to find competitor stores
2. Use scrape_store on the top 3 most relevant URLs
3. Compile findings

OUTPUT (JSON):
{
  "competitors": [{ "name": "...", "url": "...", "platform": "...", "products": [...], "positioning": "...", "pricing_strategy": "...", "content_strategy": "..." }],
  "niche_summary": "Brief competitive landscape summary"
}

RULES: Scrape at least 2 stores. Focus on direct competitors. Use real data only.`;

async function runScoutAgent(storeData, onProgress) {
  const niche = storeData.niche_signals?.keywords?.join(', ') || storeData.store_name || 'e-commerce';
  return await self.GeminiAgent.runAgent({
    name: 'Scout',
    systemPrompt: SCOUT_SYSTEM,
    userPrompt: `Find competitors for: ${storeData.store_name} (${storeData.platform}). Products: ${JSON.stringify(storeData.products?.slice(0, 5))}. Niche: "${niche}". Meta: "${storeData.niche_signals?.meta_description || ''}"`,
    tools: SCOUT_TOOLS,
    toolHandlers: { search_competitors: searchCompetitors, scrape_store: scrapeStore },
    maxTurns: 10,
    onProgress
  });
}

self.ScoutAgent = { runScoutAgent };
