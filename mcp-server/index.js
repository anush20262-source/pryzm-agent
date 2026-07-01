/**
 * PRYZM MCP Server
 * =================
 * Exposes competitor scraping as a Model Context Protocol (MCP) tool.
 * Can be used by MCP-compatible AI clients to fetch competitor data on demand.
 *
 * Transport: stdio (for local tool use via MCP host)
 *
 * Scraping strategy:
 *   1. If FIRECRAWL_API_KEY is set → use Firecrawl for high-quality scraping
 *   2. Otherwise → fall back to fetch + cheerio (basic HTML scraping)
 */

require('dotenv').config();
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');
const cheerio = require('cheerio');

// ── Firecrawl Init ─────────────────────────────────────────────────────────────
let firecrawlApp = null;

async function getFirecrawl() {
  if (firecrawlApp) return firecrawlApp;
  if (!process.env.FIRECRAWL_API_KEY) return null;

  try {
    const FirecrawlModule = await import('@mendable/firecrawl-js');
    const FirecrawlApp = FirecrawlModule.default || FirecrawlModule.FirecrawlApp;
    firecrawlApp = new FirecrawlApp({ apiKey: process.env.FIRECRAWL_API_KEY });
    return firecrawlApp;
  } catch (err) {
    console.error('[MCP] Firecrawl SDK not available:', err.message);
    return null;
  }
}

// ── MCP Server Setup ───────────────────────────────────────────────────────────
const server = new Server(
  {
    name: 'pryzm-mcp-server',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// ── Tool Registration: List Tools ──────────────────────────────────────────────
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'scrape_competitor_data',
        description:
          "Scrapes a competitor's e-commerce website and returns structured data including products, pricing, positioning, and page content. Useful for competitive intelligence gathering.",
        inputSchema: {
          type: 'object',
          properties: {
            domain: {
              type: 'string',
              description: "The competitor's domain or full URL to scrape (e.g., 'bellroy.com' or 'https://bellroy.com').",
            },
            niche: {
              type: 'string',
              description: "The product niche or category to focus on (e.g., 'leather wallets', 'running shoes').",
            },
          },
          required: ['domain'],
        },
      },
    ],
  };
});

// ── Tool Registration: Call Tool ───────────────────────────────────────────────
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name !== 'scrape_competitor_data') {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ error: `Unknown tool: ${name}` }),
        },
      ],
      isError: true,
    };
  }

  try {
    const result = await scrapeCompetitorData(args.domain, args.niche || '');
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (err) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            error: 'Scraping failed',
            message: err.message,
          }),
        },
      ],
      isError: true,
    };
  }
});

// ── Core Scraping Logic ────────────────────────────────────────────────────────

/**
 * scrapeCompetitorData(domain, niche)
 * Scrapes a competitor domain and returns a structured competitor profile.
 * Uses Firecrawl if API key is available, otherwise falls back to cheerio.
 */
async function scrapeCompetitorData(domain, niche) {
  // Ensure domain has a protocol
  const url = domain.startsWith('http') ? domain : `https://${domain}`;
  const firecrawl = await getFirecrawl();

  if (!firecrawl) {
    // ── Cheerio fallback ──
    console.error('[MCP] No Firecrawl key — using cheerio fallback for:', url);
    return cheerioScrape(url, domain, niche);
  }

  // ── Live Firecrawl scraping ──
  try {
    const scrapeResult = await firecrawl.scrapeUrl(url, {
      formats: ['markdown'],
    });

    const pageContent = scrapeResult.markdown || scrapeResult.content || '';
    const metadata = scrapeResult.metadata || {};

    return {
      mode: 'firecrawl',
      competitor: {
        name: extractBrandName(domain, metadata),
        url,
        niche: niche || 'unknown',
        title: metadata.title || '',
        meta_description: metadata.description || '',
        products: extractProductMentions(pageContent),
        positioning: metadata.description || 'Could not extract positioning — review raw content.',
        content_strategy: detectContentStrategy(pageContent),
        page_content: pageContent.substring(0, 5000),
        scraped_at: new Date().toISOString(),
      },
    };
  } catch (err) {
    // If Firecrawl fails, try cheerio as last resort
    console.error(`[MCP] Firecrawl failed for ${url}: ${err.message}. Trying cheerio fallback...`);
    try {
      return await cheerioScrape(url, domain, niche);
    } catch (fallbackErr) {
      return {
        mode: 'error',
        message: `Firecrawl: ${err.message} | Cheerio fallback: ${fallbackErr.message}`,
        competitor: getMinimalProfile(domain, niche, url),
      };
    }
  }
}

// ── Cheerio Fallback Scraper ───────────────────────────────────────────────────

/**
 * Scrape a URL using fetch + cheerio when Firecrawl is unavailable.
 * Extracts products (via JSON-LD then DOM selectors), meta info, platform, and page text.
 */
async function cheerioScrape(url, domain, niche) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000); // 15s timeout

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
    signal: controller.signal,
  });
  clearTimeout(timeout);

  const html = await response.text();
  const $ = cheerio.load(html);

  // ── Extract products via JSON-LD ──
  const products = [];
  $('script[type="application/ld+json"]').each((i, el) => {
    try {
      const data = JSON.parse($(el).html());
      if (data['@type'] === 'Product' || data['@type'] === 'ItemList') {
        const items = data['@type'] === 'ItemList' ? (data.itemListElement || []) : [data];
        items.forEach(item => {
          const product = item.item || item;
          products.push({
            name: product.name || '',
            price: product.offers?.price
              ? `$${product.offers.price}`
              : product.offers?.lowPrice
                ? `$${product.offers.lowPrice}`
                : '',
          });
        });
      }
    } catch (e) { /* skip invalid JSON-LD */ }
  });

  // ── DOM fallback for products ──
  if (products.length === 0) {
    const selectors = [
      '.product-card', '.product-item', '.product-grid-item',
      '[data-product]', '.grid-product', '.productCard',
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

  // ── Meta info ──
  const title = $('title').text().trim();
  const metaDesc = $('meta[name="description"]').attr('content') || '';
  const ogTitle = $('meta[property="og:title"]').attr('content') || '';

  // ── Platform detection ──
  let platform = 'unknown';
  if (html.includes('Shopify') || html.includes('shopify')) platform = 'shopify';
  else if (html.includes('woocommerce') || html.includes('WooCommerce')) platform = 'woocommerce';
  else if (html.includes('BigCommerce')) platform = 'bigcommerce';
  else if (html.includes('Squarespace')) platform = 'squarespace';

  // ── Page text for analysis ──
  $('script, style, nav, footer, header').remove();
  const pageText = $('body').text().replace(/\s+/g, ' ').trim().substring(0, 5000);

  const metadata = { title: ogTitle || title, description: metaDesc };

  return {
    mode: 'cheerio',
    competitor: {
      name: extractBrandName(domain, metadata),
      url,
      niche: niche || 'unknown',
      platform,
      title: ogTitle || title,
      meta_description: metaDesc,
      products: products.slice(0, 10),
      positioning: metaDesc || 'Could not extract positioning — review raw content.',
      content_strategy: detectContentStrategy(pageText),
      page_content: pageText.substring(0, 5000),
      scraped_at: new Date().toISOString(),
    },
  };
}

// ── Extraction Helpers ─────────────────────────────────────────────────────────

/**
 * Extract a readable brand name from the domain or page metadata.
 */
function extractBrandName(domain, metadata) {
  if (metadata?.title) {
    // Take the first segment before common separators
    const titleBrand = metadata.title.split(/[|\-–—:]/)[0].trim();
    if (titleBrand.length > 1 && titleBrand.length < 40) return titleBrand;
  }
  // Fall back to domain name
  const clean = domain.replace(/^(https?:\/\/)?(www\.)?/, '');
  return clean.split('.')[0].charAt(0).toUpperCase() + clean.split('.')[0].slice(1);
}

/**
 * Naive product mention extraction from markdown content.
 * Looks for price patterns ($XX.XX) near product-like text.
 */
function extractProductMentions(content) {
  const priceRegex = /\$[\d,]+\.?\d{0,2}/g;
  const prices = content.match(priceRegex) || [];
  const products = [];

  for (const price of prices.slice(0, 10)) {
    // Grab the ~60 chars before the price as the likely product name
    const idx = content.indexOf(price);
    const before = content.substring(Math.max(0, idx - 60), idx).trim();
    const namePart = before.split(/[.\n]/).pop()?.trim() || 'Product';

    products.push({
      name: namePart.substring(0, 80),
      price,
    });
  }

  // Deduplicate by price
  const seen = new Set();
  return products.filter((p) => {
    if (seen.has(p.price)) return false;
    seen.add(p.price);
    return true;
  });
}

/**
 * Detect broad content strategy signals from page text.
 */
function detectContentStrategy(content) {
  const signals = [];
  const lower = content.toLowerCase();

  if (lower.includes('video') || lower.includes('watch')) signals.push('video content');
  if (lower.includes('review') || lower.includes('★') || lower.includes('stars')) signals.push('social proof / reviews');
  if (lower.includes('blog') || lower.includes('article')) signals.push('blog / content marketing');
  if (lower.includes('quiz') || lower.includes('find your')) signals.push('interactive quiz / finder');
  if (lower.includes('tiktok') || lower.includes('instagram') || lower.includes('reel')) signals.push('social media / short-form video');
  if (lower.includes('subscribe') || lower.includes('newsletter')) signals.push('email marketing');
  if (lower.includes('free shipping')) signals.push('free shipping incentive');
  if (lower.includes('warranty') || lower.includes('guarantee')) signals.push('warranty / guarantee messaging');

  return signals.length > 0
    ? `Detected strategies: ${signals.join(', ')}.`
    : 'No clear content strategy signals detected from homepage.';
}

/**
 * Minimal profile for when all scraping methods fail.
 */
function getMinimalProfile(domain, niche, url) {
  return {
    name: extractBrandName(domain, {}),
    url,
    niche: niche || 'e-commerce',
    title: '',
    meta_description: '',
    products: [],
    positioning: 'Unable to extract — scraping failed.',
    content_strategy: 'Unable to detect — scraping failed.',
    page_content: '',
    scraped_at: new Date().toISOString(),
  };
}

// ── Start the MCP Server ───────────────────────────────────────────────────────
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[PRYZM MCP] Server started — listening on stdio');
}

main().catch((err) => {
  console.error('[PRYZM MCP] Fatal error:', err);
  process.exit(1);
});
