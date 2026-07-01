---
name: store-extraction
description: >
  Extracts and normalizes e-commerce store data from any webpage. Detects
  platform (Shopify, WooCommerce), products, pricing, and niche signals
  using JSON-LD structured data, Open Graph meta tags, and DOM selectors.
---

# Store Extraction Skill

## Purpose
This skill enables the PRYZM agent to extract structured business intelligence
from any e-commerce store webpage without requiring API access or authentication.

## When to Use
- When the user navigates to an e-commerce product page or store homepage
- When the extension needs to build a "client profile" for gap analysis
- When detecting what platform a competitor is running on

## Extraction Priority Order
1. **JSON-LD** (`<script type="application/ld+json">`) — Most reliable, schema.org Product
2. **Open Graph** meta tags — og:title, og:price:amount, og:image
3. **Meta tags** — description, keywords, generator
4. **DOM selectors** — h1, .price, .product-description (fallback)

## Output Schema
```json
{
  "store_name": "string",
  "platform": "shopify | woocommerce | unknown",
  "url": "string",
  "products": [
    {
      "name": "string",
      "price": "string",
      "description": "string",
      "image": "string"
    }
  ],
  "niche_signals": {
    "title": "string",
    "meta_description": "string",
    "keywords": ["string"]
  }
}
```

## Platform Detection Rules
| Signal | Platform |
|--------|----------|
| `window.Shopify` exists | Shopify |
| `meta[name="shopify-checkout-api-token"]` | Shopify |
| `body.woocommerce` class | WooCommerce |
| `meta[name="generator"]` contains "WooCommerce" | WooCommerce |
| None of the above | Unknown |

## Implementation
See `/extension/content.js` for the full extraction logic.
