/**
 * PRYZM Scraper Module
 * ====================
 * Discovers and scrapes competitor stores using Firecrawl + Gemini.
 * Falls back to realistic demo data when API keys are missing.
 */

require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

// ── Firecrawl Init (lazy — only if key is present) ────────────────────────────
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
    console.warn('[Scraper] Firecrawl SDK not available:', err.message);
    return null;
  }
}

// ── Gemini Init ────────────────────────────────────────────────────────────────
function getGeminiModel() {
  if (!process.env.GEMINI_API_KEY) return null;
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  return genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * findCompetitors(storeData)
 * 1. Ask Gemini for competitor search queries
 * 2. Scrape top results with Firecrawl
 * 3. Normalize into a structured competitor list
 *
 * Falls back to mock data when keys are missing.
 */
async function findCompetitors(storeData) {
  const model = getGeminiModel();
  const firecrawl = await getFirecrawl();

  // ── Demo fallback ──
  if (!model || !firecrawl) {
    console.log('[Scraper] Running in DEMO mode — returning mock competitors.');
    return getMockCompetitorData(storeData);
  }

  try {
    // Step 1: Generate search queries with Gemini
    const queryPrompt = `
You are an e-commerce competitive research specialist.
Given this store profile, generate 3-5 Google search queries that would find direct competitors.

Store: ${storeData.store_name}
Platform: ${storeData.platform || 'unknown'}
Products: ${JSON.stringify(storeData.products?.slice(0, 5) || [])}
Niche signals: ${JSON.stringify(storeData.niche_signals || {})}

Return a JSON array of search query strings. Example:
["best leather wallets online store", "premium minimalist wallet brand"]
    `.trim();

    const queryResult = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: queryPrompt }] }],
      generationConfig: { responseMimeType: 'application/json' },
    });

    let queries;
    try {
      queries = JSON.parse(queryResult.response.text());
    } catch {
      queries = [`${storeData.store_name} competitors`, `best ${storeData.niche_signals?.keywords?.[0] || 'products'} online store`];
    }

    console.log(`[Scraper] Generated ${queries.length} search queries.`);

    // Step 2: Scrape top results for each query
    const competitors = [];
    for (const query of queries.slice(0, 3)) {
      try {
        // Use Firecrawl search (or scrape known URLs)
        const searchResults = await firecrawl.search(query, { limit: 2 });

        if (searchResults?.data) {
          for (const result of searchResults.data) {
            competitors.push({
              name: extractStoreName(result.url || result.metadata?.title || query),
              url: result.url || '',
              products: [],
              positioning: result.metadata?.description || '',
              content_strategy: '',
              raw_text: (result.markdown || result.content || '').substring(0, 5000),
            });
          }
        }
      } catch (err) {
        console.warn(`[Scraper] Failed to scrape query "${query}":`, err.message);
      }
    }

    // Step 3: If we got competitors, enrich them with Gemini
    if (competitors.length > 0) {
      const enriched = await enrichCompetitors(model, competitors, storeData);
      return { competitors: enriched };
    }

    // If scraping yielded nothing, fall back to demo data
    console.log('[Scraper] No scrape results — falling back to demo data.');
    return getMockCompetitorData(storeData);
  } catch (err) {
    console.error('[Scraper] Error during competitor discovery:', err.message);
    return getMockCompetitorData(storeData);
  }
}

/**
 * scrapeUrl(url)
 * Simple wrapper — scrapes a single URL and returns clean markdown.
 */
async function scrapeUrl(url) {
  const firecrawl = await getFirecrawl();

  if (!firecrawl) {
    return {
      success: false,
      mode: 'demo',
      message: 'Firecrawl API key not configured. Running in demo mode.',
      url,
    };
  }

  try {
    const result = await firecrawl.scrapeUrl(url, { formats: ['markdown'] });
    return {
      success: true,
      url,
      markdown: result.markdown || '',
      metadata: result.metadata || {},
    };
  } catch (err) {
    return {
      success: false,
      url,
      error: err.message,
    };
  }
}

// ── Internal Helpers ───────────────────────────────────────────────────────────

/**
 * Ask Gemini to extract structured competitor profiles from raw scraped text.
 */
async function enrichCompetitors(model, competitors, storeData) {
  const prompt = `
Analyze these scraped competitor pages for a store named "${storeData.store_name}".
For each competitor, extract:
- name: the brand/store name
- positioning: their unique value proposition (1 sentence)
- content_strategy: what kind of marketing content they use (1 sentence)
- products: up to 3 products with name and price (if visible)

Raw competitor data:
${JSON.stringify(competitors.map((c) => ({ name: c.name, url: c.url, text: c.raw_text?.substring(0, 2000) })))}

Return a JSON array of competitor objects matching the schema above.
  `.trim();

  try {
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json' },
    });

    const enriched = JSON.parse(result.response.text());
    // Merge enriched data back with original URLs and raw_text
    return enriched.map((e, i) => ({
      ...competitors[i],
      ...e,
      url: competitors[i]?.url || e.url || '',
      raw_text: competitors[i]?.raw_text || '',
    }));
  } catch {
    return competitors; // Return un-enriched if Gemini fails
  }
}

/**
 * Extract a readable store name from a URL.
 */
function extractStoreName(urlOrTitle) {
  try {
    const hostname = new URL(urlOrTitle).hostname;
    return hostname.replace(/^www\./, '').split('.')[0];
  } catch {
    return urlOrTitle.split(' ').slice(0, 3).join(' ');
  }
}

/**
 * Comprehensive mock competitor data for demo mode.
 * Tailored to the leather wallet niche as a realistic example.
 */
function getMockCompetitorData(storeData) {
  const storeName = storeData.store_name || 'Your Store';
  const niche = storeData.niche_signals?.keywords?.[0] || 'leather wallets';

  return {
    competitors: [
      {
        name: 'Bellroy',
        url: 'https://bellroy.com',
        products: [
          { name: 'Slim Sleeve Wallet', price: '$89.00' },
          { name: 'Note Sleeve', price: '$99.00' },
          { name: 'Hide & Seek Wallet', price: '$109.00' },
        ],
        positioning: 'Premium slim wallets with a sustainability angle — "Considered carry for modern life." Targets professionals who want to slim their pockets without sacrificing card capacity.',
        content_strategy: 'Heavy on lifestyle video content, Instagram Reels showing pocket-bulge comparisons, and an interactive "Wallet Finder" quiz on-site.',
        raw_text: `Bellroy — Slim Your Wallet. Premium leather goods designed for modern carry. Our wallets use environmentally certified leather and are backed by a 3-year warranty. Shop men's wallets: Slim Sleeve $89, Note Sleeve $99, Hide & Seek $109. Free shipping on orders over $50. "I switched from a tri-fold and I can't believe the difference" — 4,200+ 5-star reviews.`,
      },
      {
        name: 'Ridge Wallet',
        url: 'https://ridgewallet.com',
        products: [
          { name: 'The Ridge Wallet - Aluminum', price: '$95.00' },
          { name: 'The Ridge Wallet - Carbon Fiber', price: '$125.00' },
          { name: 'The Ridge Wallet - Titanium', price: '$145.00' },
        ],
        positioning: 'RFID-blocking metal wallets positioned as a tech-forward upgrade. "The last wallet you\'ll ever buy." Lifetime warranty as a key differentiator.',
        content_strategy: 'Aggressive Meta ads with UGC-style "wallet dump" videos. TikTok presence with 500K+ followers. Heavy influencer gifting program.',
        raw_text: `Ridge Wallet — The Last Wallet You'll Ever Buy. RFID-blocking technology. Aerospace-grade materials. Holds 1-12 cards. Lifetime warranty. As seen on Shark Tank. Over 2 million wallets sold. Starting at $95. Carbon Fiber $125. Titanium $145. 30-day money-back guarantee. "My old wallet was 3 inches thick, this changed everything" — Featured in GQ, Forbes, Business Insider.`,
      },
      {
        name: 'Ekster',
        url: 'https://ekster.com',
        products: [
          { name: 'Parliament Wallet', price: '$89.00' },
          { name: 'Senate Cardholder', price: '$69.00' },
          { name: 'City Coat Wallet', price: '$119.00' },
        ],
        positioning: 'Smart wallets with Chipolo tracker integration. "Never lose your wallet again." Bridges the gap between traditional leather and tech.',
        content_strategy: 'Comparison-style content ("Ekster vs Ridge"), YouTube reviews, and a strong email funnel offering 15% first-order discount.',
        raw_text: `Ekster — Smart Wallets for Modern Life. Built-in solar-powered tracker. Premium Dutch-designed leather. Quick-access card mechanism pops cards out with one click. Parliament $89, Senate $69. Track your wallet from your phone. "The card pop-up mechanism is genius" — 15,000+ reviews averaging 4.7 stars. As featured in Wired, TechCrunch.`,
      },
    ],
  };
}

// ── Exports ────────────────────────────────────────────────────────────────────
module.exports = { findCompetitors, scrapeUrl };
