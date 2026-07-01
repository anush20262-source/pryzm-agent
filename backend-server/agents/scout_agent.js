/**
 * PRYZM Scout Agent
 * =================
 * The FIRST agent in the pipeline. Given the merchant's store data,
 * it autonomously searches for competitors and scrapes their stores.
 * 
 * Scraping strategy:
 *   - If FIRECRAWL_API_KEY is set → use MCP server (spawned as child process)
 *     which in turn uses Firecrawl or cheerio
 *   - Otherwise → fall back to local cheerio scraping (no MCP)
 * 
 * Tools:
 *   - search_competitors: Generates search queries and finds competitor URLs
 *   - scrape_store: Scrapes a competitor's store page for product/pricing data
 * 
 * Output: Structured competitor profiles with products, pricing, positioning
 */

const { runAgent } = require('./agent_runner');
const cheerio = require('cheerio');
const path = require('path');
const { spawn } = require('child_process');

// ── MCP Client (lazy-initialized) ─────────────────────────────────────────
let mcpClient = null;
let mcpTransport = null;
let mcpInitPromise = null;

/**
 * Get or create the MCP client connection.
 * Spawns the MCP server as a child process and connects via stdio.
 * Returns the client if successful, null if MCP is unavailable.
 */
async function getMcpClient() {
  // If no Firecrawl key, don't bother with MCP
  if (!process.env.FIRECRAWL_API_KEY) {
    return null;
  }

  // If already connected, return existing client
  if (mcpClient) return mcpClient;

  // If initialization is in progress, wait for it
  if (mcpInitPromise) return mcpInitPromise;

  mcpInitPromise = (async () => {
    try {
      const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
      const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

      const mcpServerPath = path.resolve(__dirname, '../../mcp-server/index.js');

      console.log('   [Scout] 🔌 Spawning MCP server...');

      mcpTransport = new StdioClientTransport({
        command: 'node',
        args: [mcpServerPath],
        env: {
          ...process.env,
          // Pass the Firecrawl key to the child process
          FIRECRAWL_API_KEY: process.env.FIRECRAWL_API_KEY,
        },
      });

      mcpClient = new Client({
        name: 'pryzm-scout-agent',
        version: '1.0.0',
      });

      await mcpClient.connect(mcpTransport);
      console.log('   [Scout] ✅ MCP server connected');

      // Verify the tool is available
      const { tools } = await mcpClient.listTools();
      const toolNames = tools.map(t => t.name);
      console.log(`   [Scout] 🔧 MCP tools available: ${toolNames.join(', ')}`);

      if (!toolNames.includes('scrape_competitor_data')) {
        console.warn('   [Scout] ⚠️ scrape_competitor_data not found in MCP tools');
        await closeMcpClient();
        return null;
      }

      return mcpClient;
    } catch (err) {
      console.error(`   [Scout] ❌ MCP init failed: ${err.message}`);
      mcpClient = null;
      mcpTransport = null;
      mcpInitPromise = null;
      return null;
    }
  })();

  return mcpInitPromise;
}

/**
 * Cleanly shut down the MCP client and child process.
 */
async function closeMcpClient() {
  if (mcpClient) {
    try {
      await mcpClient.close();
    } catch (e) { /* ignore close errors */ }
    mcpClient = null;
  }
  if (mcpTransport) {
    try {
      await mcpTransport.close();
    } catch (e) { /* ignore close errors */ }
    mcpTransport = null;
  }
  mcpInitPromise = null;
}

// ── Tool: Scrape via MCP server ───────────────────────────────────────────
/**
 * Call the MCP server's scrape_competitor_data tool.
 * Returns parsed result or throws on failure.
 */
async function scrapeViaMcp(client, url, niche) {
  console.log(`   [Scout] 🌐 Scraping via MCP: ${url}`);

  const result = await client.callTool({
    name: 'scrape_competitor_data',
    arguments: {
      domain: url,
      niche: niche || '',
    },
  });

  // MCP returns content as an array of content blocks
  if (result.isError) {
    const errorText = result.content?.[0]?.text || 'Unknown MCP error';
    throw new Error(`MCP scrape error: ${errorText}`);
  }

  const text = result.content?.[0]?.text || '{}';
  const parsed = JSON.parse(text);

  // The MCP server returns { mode, competitor } — extract the competitor data
  const competitor = parsed.competitor || parsed;
  return {
    url: competitor.url || url,
    title: competitor.title || '',
    meta_description: competitor.meta_description || '',
    platform: competitor.platform || 'unknown',
    products: competitor.products || [],
    product_count: (competitor.products || []).length,
    positioning: competitor.positioning || '',
    content_strategy: competitor.content_strategy || '',
    page_content_snippet: (competitor.page_content || '').substring(0, 1500),
    scraped_at: competitor.scraped_at || new Date().toISOString(),
    scrape_mode: parsed.mode || 'mcp',
  };
}

// ── Tool: Search for competitors ──────────────────────────────────────────
async function searchCompetitors({ niche, keywords }) {
  console.log(`   [Scout] 🔍 Searching competitors for niche: "${niche}"`);
  
  // Use Google search via a simple fetch (no API needed for organic results page)
  const queries = [
    `best ${niche} brands 2024`,
    `${niche} competitors top rated`,
    `${keywords?.join(' ')} online store`
  ];

  const competitors = [];
  
  for (const query of queries) {
    try {
      const encoded = encodeURIComponent(query);
      const response = await fetch(`https://www.google.com/search?q=${encoded}&num=5`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });
      const html = await response.text();
      const $ = cheerio.load(html);
      
      // Extract URLs from search results
      $('a[href*="http"]').each((i, el) => {
        const href = $(el).attr('href');
        if (href && !href.includes('google.com') && !href.includes('youtube.com') && 
            !href.includes('wikipedia.org') && !href.includes('amazon.com')) {
          // Clean Google redirect URLs
          const match = href.match(/url\?q=([^&]+)/);
          const url = match ? decodeURIComponent(match[1]) : href;
          if (url.startsWith('http') && !competitors.find(c => c.url === url)) {
            competitors.push({ url, source_query: query });
          }
        }
      });
    } catch (err) {
      console.log(`   [Scout] ⚠️ Search failed for "${query}": ${err.message}`);
    }
  }

  return {
    competitors_found: competitors.slice(0, 8),
    total: competitors.length,
    queries_used: queries
  };
}

// ── Tool: Scrape a store page (local cheerio fallback) ─────────────────────
async function scrapeStoreCheerio({ url }) {
  console.log(`   [Scout] 🌐 Scraping store (cheerio): ${url}`);
  
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
      signal: controller.signal
    });
    clearTimeout(timeout);
    
    const html = await response.text();
    const $ = cheerio.load(html);

    // Extract structured data
    const products = [];
    
    // Try JSON-LD first
    $('script[type="application/ld+json"]').each((i, el) => {
      try {
        const data = JSON.parse($(el).html());
        if (data['@type'] === 'Product' || data['@type'] === 'ItemList') {
          const items = data['@type'] === 'ItemList' ? (data.itemListElement || []) : [data];
          items.forEach(item => {
            const product = item.item || item;
            products.push({
              name: product.name || '',
              price: product.offers?.price || product.offers?.lowPrice || '',
              currency: product.offers?.priceCurrency || 'USD',
              description: (product.description || '').substring(0, 200),
            });
          });
        }
      } catch (e) { /* skip invalid JSON-LD */ }
    });

    // Fallback: DOM extraction for common e-commerce patterns
    if (products.length === 0) {
      // Try common product selectors
      const selectors = [
        '.product-card', '.product-item', '.product-grid-item',
        '[data-product]', '.grid-product', '.productCard'
      ];
      
      for (const sel of selectors) {
        $(sel).each((i, el) => {
          if (products.length >= 10) return false;
          const name = $(el).find('h2, h3, .product-title, .product-name, [data-product-title]').first().text().trim();
          const price = $(el).find('.price, .product-price, [data-price], .money').first().text().trim();
          if (name) products.push({ name, price: price || 'N/A' });
        });
        if (products.length > 0) break;
      }
    }

    // Extract meta info
    const title = $('title').text().trim();
    const metaDesc = $('meta[name="description"]').attr('content') || '';
    const ogTitle = $('meta[property="og:title"]').attr('content') || '';
    
    // Detect platform
    let platform = 'unknown';
    if (html.includes('Shopify') || html.includes('shopify')) platform = 'shopify';
    else if (html.includes('woocommerce') || html.includes('WooCommerce')) platform = 'woocommerce';
    else if (html.includes('BigCommerce')) platform = 'bigcommerce';
    else if (html.includes('Squarespace')) platform = 'squarespace';

    // Get page text for positioning analysis (first 3000 chars)
    $('script, style, nav, footer, header').remove();
    const pageText = $('body').text().replace(/\s+/g, ' ').trim().substring(0, 3000);

    return {
      url,
      title: ogTitle || title,
      meta_description: metaDesc,
      platform,
      products: products.slice(0, 10),
      product_count: products.length,
      page_content_snippet: pageText.substring(0, 1500),
      scraped_at: new Date().toISOString(),
      scrape_mode: 'cheerio-local',
    };
  } catch (err) {
    return {
      url,
      error: err.message,
      products: [],
      page_content_snippet: `Failed to scrape: ${err.message}`
    };
  }
}

// ── Unified scrape_store handler (MCP → cheerio fallback) ──────────────────
/**
 * The scrape_store tool handler registered with the agent runner.
 * Tries MCP first (if Firecrawl key is set), falls back to cheerio.
 */
async function scrapeStore({ url }) {
  // Try MCP scraping first
  const client = await getMcpClient();
  if (client) {
    try {
      return await scrapeViaMcp(client, url);
    } catch (err) {
      console.warn(`   [Scout] ⚠️ MCP scrape failed, falling back to cheerio: ${err.message}`);
      // Fall through to cheerio
    }
  }

  // Cheerio fallback
  return scrapeStoreCheerio({ url });
}

// ── Scout Agent Definition ──────────────────────────────────────────────────
const SCOUT_TOOLS = [
  {
    name: 'search_competitors',
    description: 'Search the web to find competitor stores in a given niche. Returns a list of competitor URLs.',
    parameters: {
      type: 'object',
      properties: {
        niche: { type: 'string', description: 'The product niche/category (e.g., "leather wallets", "organic skincare")' },
        keywords: { type: 'array', items: { type: 'string' }, description: 'Specific keywords to search for' }
      },
      required: ['niche']
    }
  },
  {
    name: 'scrape_store',
    description: 'Scrape a competitor store URL to extract their products, pricing, positioning, and platform.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The full URL of the competitor store to scrape' }
      },
      required: ['url']
    }
  }
];

const SCOUT_SYSTEM_PROMPT = `You are PRYZM Scout — a competitive intelligence agent.

Your job is to find and research competitors for a merchant's e-commerce store.

PROCESS:
1. First, use search_competitors to find competitor stores in the merchant's niche
2. Then, use scrape_store on the top 3 most relevant competitor URLs
3. After scraping, compile your findings

OUTPUT FORMAT — You MUST respond with this exact JSON structure when done:
{
  "competitors": [
    {
      "name": "Brand Name",
      "url": "https://...",
      "platform": "shopify|woocommerce|unknown",
      "products": [{"name": "...", "price": "..."}],
      "positioning": "How they position themselves (1-2 sentences)",
      "pricing_strategy": "Their pricing approach (1-2 sentences)",
      "content_strategy": "How they do marketing (1-2 sentences)"
    }
  ],
  "niche_summary": "Brief summary of the competitive landscape"
}

RULES:
- Always scrape at least 2 competitor stores
- Focus on DIRECT competitors (same product category)
- Extract real data — never invent product names or prices
- If scraping fails for a URL, note the error and try another`;

/**
 * runScoutAgent — Finds and profiles competitors
 * @param {Object} storeData - The merchant's store data
 * @returns {Object} Competitor profiles
 */
async function runScoutAgent(storeData) {
  const niche = storeData.niche_signals?.keywords?.join(', ') || storeData.store_name || 'e-commerce';
  
  const hasMcp = !!process.env.FIRECRAWL_API_KEY;
  console.log(`   [Scout] Scraping mode: ${hasMcp ? 'MCP (Firecrawl/cheerio)' : 'local cheerio'}`);

  const userPrompt = `Analyze this merchant's store and find their top competitors:

MERCHANT STORE:
- Name: ${storeData.store_name}
- Platform: ${storeData.platform}
- Products: ${JSON.stringify(storeData.products?.slice(0, 5))}
- Niche keywords: ${storeData.niche_signals?.keywords?.join(', ') || 'unknown'}
- Meta description: ${storeData.niche_signals?.meta_description || 'none'}

Find 3 direct competitors in the "${niche}" space. Search for them, then scrape their stores to get real product and pricing data.`;

  try {
    const result = await runAgent({
      name: 'Scout',
      systemPrompt: SCOUT_SYSTEM_PROMPT,
      userPrompt,
      tools: SCOUT_TOOLS,
      toolHandlers: {
        search_competitors: searchCompetitors,
        scrape_store: scrapeStore,
      },
      maxTurns: 10, // Scout needs more turns (search + multiple scrapes)
    });

    return result;
  } finally {
    // Always clean up MCP connection when the agent run finishes
    await closeMcpClient();
  }
}

module.exports = { runScoutAgent, scrapeStore };
