# PRYZM — Brand Identity Guide

> *Working name. The name is a codename derived from "Prism" — the extension refracts your market into hidden competitive wavelengths.*

---

## Logo

The PRYZM icon is a **geometric triangular prism** that refracts light from cyan to purple. It represents the core value: taking raw market data and splitting it into actionable competitive insights.

- **Primary icon**: `logo.png` in this folder
- **Use on dark backgrounds only** (the icon is designed for dark surfaces)
- **Minimum size**: 16×16px (Chrome extension icon requirement)

---

## Color Palette

### Primary Colors
| Swatch | Name | Hex | Usage |
|--------|------|-----|-------|
| 🟦 | **Cyan Primary** | `#4ECDC4` | Primary actions, buttons, links, highlights |
| 🟪 | **Purple Accent** | `#7B68EE` | Secondary accent, gradients, hover states |

### Background Layers
| Swatch | Name | Hex | Usage |
|--------|------|-----|-------|
| ⬛ | **Void** | `#0A0A0F` | Deepest background layer |
| ⬛ | **Surface** | `#12121A` | Card backgrounds |
| ⬛ | **Elevated** | `#1A1A25` | Hover states, modals |
| ⬛ | **Overlay** | `#1E1E2A` | Tooltips, dropdowns |

### Status / Semantic Colors
| Swatch | Name | Hex | Usage |
|--------|------|-----|-------|
| 🔴 | **Gap Red** | `#FF3B3B` | Gaps, weaknesses, critical issues |
| 🟢 | **Win Green** | `#00FF88` | Strengths, advantages, success |
| 🟡 | **Warn Yellow** | `#FFD93D` | Average, caution, needs attention |
| 🟠 | **High Orange** | `#FF8C42` | High priority |

### Text Colors
| Name | Hex | Usage |
|------|-----|-------|
| **Primary Text** | `#EAEAEA` | Headings, body text |
| **Secondary Text** | `#8B8B9A` | Labels, descriptions |
| **Muted Text** | `#5A5A6A` | Timestamps, meta info |

---

## Typography

| Role | Font | Weight | Size |
|------|------|--------|------|
| **Logo / Brand** | Inter | 800 (ExtraBold) | 20px |
| **Headings** | Inter | 700 (Bold) | 16-18px |
| **Body** | Inter | 400 (Regular) | 13-14px |
| **Labels / Tags** | Inter | 600 (SemiBold) | 11-12px |
| **Code / Data** | JetBrains Mono | 400 | 12px |

**Load via Google Fonts:**
```html
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400&display=swap" rel="stylesheet">
```

---

## Visual Style Rules

1. **Glassmorphism cards**: Cards use semi-transparent backgrounds with subtle backdrop blur
   ```css
   background: rgba(18, 18, 26, 0.85);
   backdrop-filter: blur(20px);
   border: 1px solid rgba(255, 255, 255, 0.06);
   border-radius: 12px;
   ```

2. **Glow effects**: Interactive elements get a subtle colored glow
   ```css
   box-shadow: 0 0 20px rgba(78, 205, 196, 0.15);
   ```

3. **Gradient text** (for the logo/brand name):
   ```css
   background: linear-gradient(135deg, #4ECDC4, #7B68EE);
   -webkit-background-clip: text;
   -webkit-text-fill-color: transparent;
   ```

4. **Score bars**: Use CSS gradients with rounded corners, green-to-red based on competitive score

5. **Cards**: Always have `border-radius: 12px`, subtle border, and smooth `transition: all 0.2s ease`

---

## Tone of Voice

| Attribute | Description |
|-----------|-------------|
| **Confident** | "You're losing 35% perceived value" — not "You might want to consider..." |
| **Direct** | Numbers, not vague advice. Show the gap quantitatively. |
| **Action-oriented** | Every insight ends with "Here's what to do about it" |
| **Professional** | Premium language. No slang. No emoji in data outputs. |

---

## Mockups Reference

All UI mockups are in this `brand-assets/` folder:
- `mockup_dashboard.png` — Main scorecard view
- `mockup_gap_analysis.png` — Detailed gap breakdown
- `mockup_action_hub.png` — Generated creatives view
- `mockup_loading.png` — Scanning/loading state
