/**
 * PRYZM Content Script — E-Commerce Data Extractor v4
 * 
 * Extracts product data from e-commerce stores using multiple strategies:
 *   1. Shopify /products.json API (most reliable, gets ALL products)
 *   2. JSON-LD structured data
 *   3. Open Graph meta tags
 *   4. DOM fallback (product cards + single product pages)
 * 
 * Detects platform (Shopify, WooCommerce) and sends normalized data to background.js.
 */

(() => {
  'use strict';

  // ─── Price Sanitizer ────────────────────────────────────────────
  // Cleans raw price strings like "Rs. 1,189.00 Rs. 1,699.00" or "From $29.99"
  function cleanPrice(raw) {
    if (!raw || typeof raw !== 'string') return String(raw || '');
    // Remove "From", "Sale", "Regular price", etc.
    let cleaned = raw.replace(/\b(from|sale|regular\s*price|was|now|starting\s*at)\b/gi, '').trim();
    // Extract the first price-like pattern (handles Rs., $, €, £, ₹)
    const match = cleaned.match(/[₹$€£]?\s?[\d,]+\.?\d*/);
    return match ? match[0].trim() : cleaned.split(/\s{2,}/)[0]?.trim() || raw.trim();
  }

  // ─── Platform Detection ───────────────────────────────────────────
  function detectPlatform() {
    // Shopify detection
    if (
      window.Shopify ||
      document.querySelector('meta[name="shopify-checkout-api-token"]') ||
      document.querySelector('link[href*="cdn.shopify.com"]') ||
      document.querySelector('script[src*="cdn.shopify.com"]')
    ) {
      return 'shopify';
    }

    // WooCommerce detection
    const generator = document.querySelector('meta[name="generator"]');
    if (
      document.body?.classList.contains('woocommerce') ||
      document.querySelector('.woocommerce') ||
      (generator && generator.content?.toLowerCase().includes('woocommerce'))
    ) {
      return 'woocommerce';
    }

    return 'unknown';
  }

  // ─── Shopify /products.json Extraction (BEST method) ──────────────
  async function extractShopifyApi() {
    try {
      const resp = await fetch(window.location.origin + '/products.json?limit=50', {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(5000),
      });
      if (!resp.ok) return [];

      const json = await resp.json();
      const raw = json.products || [];

      return raw.slice(0, 20).map(p => ({
        name: p.title || '',
        price: cleanPrice(String(p.variants?.[0]?.price || '')),
        description: (p.body_html || '').replace(/<[^>]*>/g, '').substring(0, 500),
        image: p.images?.[0]?.src || '',
      })).filter(p => p.name && p.name.length > 2);
    } catch {
      return [];
    }
  }

  // ─── JSON-LD Extraction (most reliable DOM method) ─────────────────
  function extractJsonLd() {
    const products = [];
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');

    for (const script of scripts) {
      try {
        let data = JSON.parse(script.textContent);

        // Handle @graph arrays (common in Shopify/WooCommerce)
        if (data['@graph']) {
          data = data['@graph'];
        }

        // Normalize to array
        const items = Array.isArray(data) ? data : [data];

        for (const item of items) {
          const type = item['@type'];
          if (
            type === 'Product' ||
            (Array.isArray(type) && type.includes('Product'))
          ) {
            const offers = item.offers;
            const price = String(
              offers?.price ?? offers?.lowPrice ?? offers?.[0]?.price ?? ''
            );
            const img = item.image;
            products.push({
              name: item.name || '',
              price: cleanPrice(price),
              description: (item.description || '').substring(0, 500),
              image: Array.isArray(img) ? img[0] : (typeof img === 'object' ? img?.url || '' : img || ''),
            });
          }
        }
      } catch {
        // Malformed JSON-LD — skip
      }
    }

    return products;
  }

  // ─── Open Graph Meta Tag Extraction ───────────────────────────────
  function extractOpenGraph() {
    const get = (prop) =>
      document.querySelector(`meta[property="${prop}"]`)?.content || '';

    const title = get('og:title');
    const price = get('og:price:amount') || get('product:price:amount');
    const desc = get('og:description');
    const image = get('og:image');

    if (title && price) {
      return [{ name: title, price: cleanPrice(price), description: desc, image }];
    }
    return [];
  }

  // ─── DOM Fallback Extraction ──────────────────────────────────────
  function extractFromDom() {
    const products = [];

    // 1. Try to find product cards (Homepage / Collection pages)
    // Use specific e-commerce selectors, avoid generic ones like .grid__item
    const cardSelectors = [
      '.product-card', '.grid-product', '.product-item', 'li.product',
      '.card-wrapper', '.product-block', '.product__card',
      '[data-product-card]', '.collection-product-card',
    ];

    let cards = [];
    for (const sel of cardSelectors) {
      cards = Array.from(document.querySelectorAll(sel));
      if (cards.length > 0) break;
    }

    if (cards.length > 0) {
      for (const card of cards.slice(0, 15)) {
        const nameEl = card.querySelector(
          'h2, h3, h4, .title, .product-card__title, .card__heading, ' +
          '.product-card__name, .product-title, a.product-link'
        );
        const priceEl = card.querySelector(
          '.price .money, .price-item, .product-price, .money, [data-price]'
        );
        const imgEl = card.querySelector('img');

        const name = nameEl?.textContent?.trim() || '';
        const price = priceEl?.dataset?.price || priceEl?.textContent?.trim() || '';
        const image = imgEl?.src || imgEl?.dataset?.src || '';

        if (name && price && name.length > 2 && !/^(sale|new|featured|trending)$/i.test(name)) {
          products.push({ name, price: cleanPrice(price), description: '', image });
        }
      }
    }

    // 2. Single Product Page fallback
    if (products.length === 0) {
      const h1 = document.querySelector('h1');
      const name = h1?.textContent?.trim() || '';

      const priceSelectors = [
        '.price .money', '.product-price .money', '.price-item--regular',
        '[data-price]', '.product-price', '.price', '.woocommerce-Price-amount',
        '.current-price', '#product-price', '.product__price',
      ];

      let price = '';
      for (const sel of priceSelectors) {
        const el = document.querySelector(sel);
        if (el) {
          price = el.dataset?.price || el.textContent?.trim() || '';
          if (price) break;
        }
      }

      let description = '';
      const descEl = document.querySelector(
        '.product-description, #product-description, .product__description, ' +
        '.woocommerce-product-details__short-description'
      );
      if (descEl) description = descEl.textContent?.trim().substring(0, 500) || '';

      let image = '';
      const imgEl = document.querySelector(
        '.product-featured-image img, .product__media img, ' +
        '.woocommerce-product-gallery img, #product-image img'
      );
      if (imgEl) image = imgEl.src || '';

      if (name && price && name.length > 2) {
        products.push({ name, price: cleanPrice(price), description, image });
      }
    }

    return products;
  }

  // ─── Meta / Niche Signals ─────────────────────────────────────────
  function extractNicheSignals() {
    const metaDesc =
      document.querySelector('meta[name="description"]')?.content || '';
    const metaKeywords =
      document.querySelector('meta[name="keywords"]')?.content || '';

    return {
      title: document.title || '',
      meta_description: metaDesc,
      keywords: metaKeywords
        ? metaKeywords.split(',').map((k) => k.trim()).filter(Boolean)
        : [],
    };
  }

  // ─── Store Name Detection ─────────────────────────────────────────
  function detectStoreName() {
    const appName =
      document.querySelector('meta[name="application-name"]')?.content;
    if (appName) return appName;

    const siteName =
      document.querySelector('meta[property="og:site_name"]')?.content;
    if (siteName) return siteName;

    const title = document.title || '';
    const cleaned = title.split(/[–—|·]/)[0]?.trim();
    return cleaned || new URL(window.location.href).hostname;
  }

  // ─── Master Extraction Pipeline ───────────────────────────────────
  async function extractAllData() {
    // 1. Block execution on Admin portals
    const host = window.location.hostname;
    const path = window.location.pathname;
    if (host.includes('admin.shopify.com') || path.startsWith('/admin')) {
      return null;
    }

    const platform = detectPlatform();

    // 2. For Shopify: try the /products.json API first (gets ALL products)
    let products = [];
    if (platform === 'shopify') {
      products = await extractShopifyApi();
    }

    // 3. Fallback chain: JSON-LD → OpenGraph → DOM
    if (products.length === 0) products = extractJsonLd();
    if (products.length === 0) products = extractOpenGraph();
    if (products.length === 0) products = extractFromDom();

    // 4. Compute price range
    const prices = products
      .map(p => parseFloat(String(p.price).replace(/[^0-9.]/g, '')))
      .filter(n => !isNaN(n) && n > 0);
    const minPrice = prices.length ? Math.min(...prices) : null;
    const maxPrice = prices.length ? Math.max(...prices) : null;

    return {
      store_name: detectStoreName(),
      storeName: detectStoreName(),
      platform,
      url: window.location.href,
      products,
      productsCount: products.length,
      minPrice,
      maxPrice,
      priceRange: minPrice != null ? `${cleanPrice(products[0]?.price).charAt(0) === '₹' ? '₹' : '$'}${minPrice} – ${cleanPrice(products[0]?.price).charAt(0) === '₹' ? '₹' : '$'}${maxPrice}` : null,
      niche_signals: extractNicheSignals(),
    };
  }

  // ─── Auto-Extract & Send on Page Load ─────────────────────────────
  (async () => {
    try {
      const data = await extractAllData();
      if (!data) return; // Silent abort on admin portals

      // Only send if we detected actual products
      if (data.products.length > 0) {
        chrome.runtime.sendMessage({
          type: 'STORE_DATA_EXTRACTED',
          data,
        });
      }
    } catch (err) {
      console.warn('[PRYZM] Auto-extraction failed:', err.message);
    }
  })();

  // ─── Listen for Manual Extraction Requests ────────────────────────
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'EXTRACT_STORE_DATA') {
      extractAllData()
        .then(data => {
          if (!data) sendResponse({ success: false, error: 'ADMIN_PORTAL' });
          else sendResponse({ success: true, data });
        })
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true; // Keep channel open for async response
    }
  });
})();
