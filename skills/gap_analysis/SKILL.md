---
name: gap-analysis
description: >
  Performs competitive gap analysis across 4 dimensions (Positioning, Pricing,
  Features, Marketing) by comparing merchant store data against scraped
  competitor data. Uses Gemini AI to generate a structured JSON scorecard
  with severity ratings and actionable prescriptions.
---

# Gap Analysis Skill

## Purpose
This skill is the core intelligence engine of PRYZM. It takes structured store
data and competitor data, then produces a quantified competitive scorecard that
identifies exactly where the merchant is underperforming.

## When to Use
- After store data has been extracted (store_extraction skill)
- After competitor data has been scraped (via Firecrawl/MCP server)
- When the merchant wants to understand their competitive position

## The 4 Evaluation Dimensions

### 1. Positioning & Value Proposition
- Brand angle comparison (tech vs. heritage, luxury vs. budget)
- Target audience alignment
- Unique selling proposition strength
- Brand voice and messaging clarity

### 2. Pricing Strategy
- Price point comparison (absolute and relative)
- Bundle/accessory strategy
- Perceived value analysis
- Shipping and discount patterns

### 3. Feature Offerings
- Product spec comparison
- Material/quality signals
- Innovation and tech integration
- Product range breadth

### 4. Marketing & Content Hooks
- Ad creative formats (UGC, studio, lifestyle)
- Hook psychology (shame, fear, aspiration, curiosity)
- Content frequency and platform presence
- Social proof and review volume

## Scoring System
- **0-30**: Critical gap — immediate action needed
- **31-50**: Significant weakness — losing market share
- **51-70**: Average — competitive but not winning
- **71-85**: Strong — outperforming most competitors
- **86-100**: Dominant — market leader in this dimension

## Output Schema
```json
{
  "overall_score": 0-100,
  "gap_scorecard": {
    "positioning": {
      "score": 0-100,
      "you": "What the merchant is doing",
      "competitors": "What competitors are doing",
      "gap": "Specific gap description",
      "severity": "critical | high | medium | low"
    }
  },
  "competitors_analyzed": ["string"],
  "ai_summary": "2-3 sentence executive summary",
  "hook_breakdown": [
    {
      "type": "Hook style name",
      "transcript_quote": "Exact ad copy quote",
      "psychological_trigger": "Why it works",
      "effectiveness_score": 1-10
    }
  ]
}
```

## Implementation
See `/backend-server/ai_engine.js` for the Gemini prompt pipeline.
See `/prompts/gap_analysis_prompt.json` for the exact prompt template.
