---
name: creative-generation
description: >
  Generates platform-specific marketing creatives (TikTok scripts, Meta ad copy,
  email hooks) that directly counter identified competitive gaps. Uses the gap
  analysis scorecard to craft counter-strategy content, not copies of competitor
  ads. Includes human-in-the-loop approval before any content is published.
---

# Creative Generation Skill

## Purpose
This skill transforms competitive intelligence into actionable marketing assets.
Instead of generic AI copy, it generates content specifically designed to exploit
the gaps identified in the gap analysis — making each creative a strategic weapon.

## When to Use
- After gap analysis is complete
- When the merchant clicks "Generate Creatives" in the Action Hub
- When the merchant needs ready-to-deploy marketing content

## Output Formats

### 1. TikTok/Reel Script
- **Hook** (0-3 seconds): Pattern interrupt based on winning hook psychology
- **Body** (3-20 seconds): Product demonstration addressing the specific gap
- **CTA** (20-30 seconds): Urgency-driven call to action
- Includes visual/staging directions in brackets

### 2. Meta Ad Copy
- **Headline**: 5-10 words, addresses the core gap
- **Body**: 2-3 sentences, positions against competitor weakness
- **Hashtags**: 5-8 niche-specific hashtags
- **CTA**: Platform-appropriate action button text

### 3. Email Hook
- **Subject Line**: 6-10 words, curiosity or fear-based
- **Preview Text**: First line visible in inbox
- **Body**: 3 short paragraphs with bullet points
- **CTA**: Single clear action link

## Counter-Strategy Logic
The creative generation prompt is designed to:
1. **Identify** the competitor's strongest angle from the hook breakdown
2. **Flip** that angle against them (e.g., if they push "modern metal", we push "classic leather")
3. **Exploit** the gap they're leaving open (e.g., if no one talks about card capacity, we lead with it)
4. **Match** the hook psychology that's proven to work in the niche

## Human-in-the-Loop
Every generated creative includes:
- ✏️ **Edit** button — opens inline text editor
- 📋 **Copy** button — copies to clipboard with confirmation
- ✅ **Approve** button — marks as ready to deploy (future: triggers posting)

No content is ever published without explicit merchant approval.

## Output Schema
```json
{
  "prescriptions": [
    {
      "format": "TikTok/Reel Script | Meta Ad Copy | Email Subject Line",
      "hook_text": "The exact opening hook",
      "body_creative": "Full body copy with visual directions",
      "cta": "Call to action text"
    }
  ]
}
```

## Implementation
See `/backend-server/ai_engine.js` for the Gemini creative prompt pipeline.
See `/prompts/creative_prompt.json` for the exact prompt template.
