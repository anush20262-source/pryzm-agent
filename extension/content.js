/**
 * PRYZM Content Script — E-Commerce Data Extractor
 * 
 * Runs on every page at document_idle. Extracts structured product data
 * from JSON-LD, Open Graph, meta tags, and DOM fallbacks. Detects
 * platform (Shopify, WooCommerce) and sends normalized data to background.js.
 */

(() => {
  'use strict';

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

  // ─── JSON-LD Extraction (most reliable) ───────────────────────────
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

        // Normalize to array for uniform processing
        const items = Array.isArray(data) ? data : [data];

        for (const item of items) {
          if (item['@type'] === 'Product' || item['@type']?.includes?.('Product')) {
            const price = item.offers?.price
              || item.offers?.lowPrice
              || item.offers?.[0]?.price
              || '';

            products.push({
              name: item.name || '',
              price: String(price),
              description: item.description || '',
              image: Array.isArray(item.image) ? item.image[0] : (item.image || ''),
            });
          }
        }
      } catch (e) {
        // Silently skip malformed JSON-LD blocks
      }
    }

    return products;
  }

  // ─── Open Graph Meta Tags ─────────────────────────────────────────
  function extractOpenGraph() {
    const get = (prop) =>
      document.querySelector(`meta[property="${prop}"]`)?.content || '';

    const title = get('og:title');
    const description = get('og:description');
    const price = get('og:price:amount') || get('product:price:amount');
    const image = get('og:image');

    if (title || price) {
      return [{
        name: title,
        price: price,
        description: description,
        image: image,
      }];
    }

    return [];
  }

  // ─── DOM Fallback Extraction ──────────────────────────────────────
  function extractFromDom() {
    const products = [];

    // Product name from h1
    const h1 = document.querySelector('h1');
    const name = h1?.textContent?.trim() || '';

    // Price from common selectors
    const priceSelectors = [
      '.price .money',
      '.product-price .money',
      '.price-item--regular',
      '[data-price]',
      '.product-price',
      '.price',
      '.woocommerce-Price-amount',
      '.current-price',
      '#product-price',
      '.product__price',
    ];

    let price = '';
    for (const sel of priceSelectors) {
      const el = document.querySelector(sel);
      if (el) {
        // Use data-price attribute if available, otherwise text
        price = el.dataset?.price || el.textContent?.trim() || '';
        if (price) break;
      }
    }

    // Description from common selectors
    const descSelectors = [
      '.product-description',
      '#product-description',
      '.product__description',
      '.woocommerce-product-details__short-description',
      '[data-product-description]',
      '.product-single__description',
    ];

    let description = '';
    for (const sel of descSelectors) {
      const el = document.querySelector(sel);
      if (el) {
        description = el.textContent?.trim().substring(0, 500) || '';
        if (description) break;
      }
    }

    // Product image
    const imgSelectors = [
      '.product-featured-image img',
      '.product__media img',
      '.woocommerce-product-gallery img',
      '#product-image img',
      '.product-image img',
    ];

    let image = '';
    for (const sel of imgSelectors) {
      const el = document.querySelector(sel);
      if (el) {
        image = el.src || el.dataset?.src || '';
        if (image) break;
      }
    }

    if (name && price && name.length > 2) {
      products.push({ name, price, description, image });
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
    // Try meta application-name first
    const appName =
      document.querySelector('meta[name="application-name"]')?.content;
    if (appName) return appName;

    // Try og:site_name
    const siteName =
      document.querySelector('meta[property="og:site_name"]')?.content;
    if (siteName) return siteName;

    // Fall back to page title (strip common suffixes)
    const title = document.title || '';
    const cleaned = title.split(/[–—|·]/)[0]?.trim();
    return cleaned || new URL(window.location.href).hostname;
  }

  // ─── Master Extraction Pipeline ───────────────────────────────────
  function extractAllData() {
    // 1. Block execution on Admin portals
    const host = window.location.hostname;
    const path = window.location.pathname;
    if (host.includes('admin.shopify.com') || path.includes('/wp-admin')) {
      throw new Error('ADMIN_PORTAL');
    }

    // 2. Merge products from all sources, prioritizing JSON-LD
    let products = extractJsonLd();
    if (products.length === 0) products = extractOpenGraph();
    if (products.length === 0) products = extractFromDom();

    const normalizedData = {
      store_name: detectStoreName(),
      platform: detectPlatform(),
      url: window.location.href,
      products,
      niche_signals: extractNicheSignals(),
    };

    return normalizedData;
  }

  // ─── Auto-Extract & Send on Page Load ─────────────────────────────
  try {
    const data = extractAllData();

    // Only send if we detected something meaningful
    if (data.store_name || data.products.length > 0) {
      chrome.runtime.sendMessage({
        type: 'STORE_DATA_EXTRACTED',
        data,
      });
    }
  } catch (err) {
    console.warn('[PRYZM] Auto-extraction failed:', err.message);
  }

  // ─── Listen for Manual Extraction Requests ────────────────────────
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'EXTRACT_STORE_DATA') {
      try {
        const data = extractAllData();
        sendResponse({ success: true, data });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
      return true; // Keep channel open for async response
    }
  });
})();
