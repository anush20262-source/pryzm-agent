# 🔮 PRYZM — E-Commerce Competitive Intelligence Agent

> **An agentic Chrome extension that refracts your market into actionable competitive wavelengths.**

PRYZM is an AI-powered browser extension that sits alongside an e-commerce merchant's workflow and autonomously identifies competitive gaps, reverse-engineers competitor ad psychology, and generates ready-to-deploy marketing creatives — all with human-in-the-loop approval.

---

## 🎯 Problem Statement

E-commerce store owners drown in "marketing spaghetti" — manually guessing what content, pricing, and hooks will drive sales while competitors silently out-position them. Existing tools (SEMrush, AdSpy, Koala Inspector) either cost $200+/month, require extensive setup, or dump raw data without actionable insights.

**PRYZM solves this** by bringing competitive intelligence directly into the browser, extracting store context automatically, and delivering a structured gap scorecard with AI-generated counter-strategies.

---

## 🏗️ Architecture

```
┌──────────────────────────────────────────────────────┐
│                  Chrome Extension (MV3)               │
│                                                       │
│  content.js ──→ background.js ──→ popup.html/js/css  │
│  (LISTEN)       (ORCHESTRATE)     (DISPLAY)           │
└────────────────────┬─────────────────────────────────┘
                     │ POST /api/analyze
                     │ POST /api/generate-creative
                     ▼
┌──────────────────────────────────────────────────────┐
│               Backend Server (Express.js)             │
│                                                       │
│  server.js ──→ scraper.js ──→ ai_engine.js           │
│  (ROUTES)      (SPY Agent)    (PRESCRIBE Agent)       │
│                     │              │                   │
│                     ▼              ▼                   │
│              Firecrawl API    Gemini 2.0 Flash         │
└──────────────────────────────────────────────────────┘
                     │
                     ▼
┌──────────────────────────────────────────────────────┐
│             MCP Server (Model Context Protocol)       │
│                                                       │
│  Tool: scrape_competitor_data                         │
│  Wraps Firecrawl in MCP for interoperability          │
└──────────────────────────────────────────────────────┘
```

### The Agent Lifecycle: Listen → Spy → Prescribe

| Phase | Agent | What It Does |
|-------|-------|-------------|
| 🎧 **LISTEN** | Store Extraction | Silently reads the merchant's dashboard to extract products, pricing, niche signals |
| 🕵️ **SPY** | Competitor Research | Scrapes competitor websites and ad copy using Firecrawl |
| 📋 **PRESCRIBE** | Gap Analysis + Creative Gen | Compares data across 4 dimensions, generates actionable scripts |

---

## 📚 Course Concepts Demonstrated

| Concept | Where | Day |
|---------|-------|-----|
| **MCP Server** | `mcp-server/` — wraps scraping in Model Context Protocol | Day 2 |
| **Agent Skills** | `skills/` — SKILL.md files for extraction, analysis, creative gen | Day 3 |
| **Human-in-the-Loop** | Extension UI — Review & Approve before any content goes live | Day 4 |
| **Multi-Agent Pipeline** | Listen → Spy → Prescribe orchestration in background.js | Day 3 |
| **Gemini API + ADK** | `ai_engine.js` — structured JSON output via Gemini 2.0 Flash | Day 1 |

---

## 🚀 Setup Instructions

### Prerequisites
- Node.js v18+ and npm
- Google Chrome browser
- Gemini API key ([get one free](https://aistudio.google.com/apikey))
- Firecrawl API key ([get one free](https://www.firecrawl.dev/)) — optional, demo mode works without it

### 1. Clone the Repository
```bash
git clone https://github.com/YOUR_USERNAME/pryzm-agent.git
cd pryzm-agent
```

### 2. Set Up the Backend
```bash
cd backend-server
npm install
cp ../.env.example .env
# Edit .env and add your API keys
node server.js
```
The server will start on `http://localhost:3000`.

### 3. Set Up the MCP Server (Optional)
```bash
cd mcp-server
npm install
node index.js
```

### 4. Load the Chrome Extension
1. Open Chrome → navigate to `chrome://extensions/`
2. Enable **Developer mode** (toggle in top-right)
3. Click **"Load unpacked"**
4. Select the `extension/` folder from this repo
5. The PRYZM icon will appear in your toolbar

### 5. Test It
1. Navigate to any e-commerce product page (e.g., a Shopify store)
2. Click the PRYZM extension icon
3. The Page X-Ray will show detected store data
4. Click **"Analyze Market"** to run the competitive analysis
5. View the gap scorecard and generate creatives

> **Demo Mode**: If no API keys are configured, PRYZM runs with realistic demo data so you can see the full experience.

---

## 📁 Project Structure

```
pryzm/
├── extension/                 # Chrome Extension (Manifest V3)
│   ├── manifest.json          # Extension configuration
│   ├── content.js             # 🎧 LISTEN — Store data extraction
│   ├── background.js          # 🧠 Orchestrator — Pipeline management
│   ├── popup.html             # Dashboard layout
│   ├── popup.css              # Premium dark industrial theme
│   ├── popup.js               # UI logic & view management
│   └── icons/                 # Extension icons
│
├── backend-server/            # Node.js API Server
│   ├── server.js              # Express routes
│   ├── scraper.js             # 🕵️ SPY — Firecrawl competitor scraping
│   ├── ai_engine.js           # 📋 PRESCRIBE — Gemini AI analysis
│   └── package.json
│
├── mcp-server/                # Model Context Protocol Server
│   ├── index.js               # MCP tool: scrape_competitor_data
│   └── package.json
│
├── skills/                    # Agent Skills (SKILL.md)
│   ├── store_extraction/      # Store data extraction skill
│   ├── gap_analysis/          # 4-pillar competitive scoring skill
│   └── creative_generation/   # Counter-strategy creative skill
│
├── prompts/                   # LLM Prompt Templates
│   ├── gap_analysis_prompt.json
│   └── creative_prompt.json
│
├── brand-assets/              # Brand identity & mockups
│   ├── BRAND_IDENTITY.md
│   ├── logo.png
│   └── mockup_*.png
│
├── .env.example
├── .gitignore
└── README.md                  # ← You are here
```

---

## 🎨 The Gap Scorecard (4 Dimensions)

PRYZM evaluates competitive position across four dimensions, scored 0-100:

| Dimension | What It Measures | Severity Thresholds |
|-----------|-----------------|-------------------|
| **Positioning** | Brand angle, target audience, USP clarity | 🔴 <30 🟡 30-70 🟢 >70 |
| **Pricing** | Price points, bundles, perceived value | 🔴 <30 🟡 30-70 🟢 >70 |
| **Features** | Product specs, materials, innovation | 🔴 <30 🟡 30-70 🟢 >70 |
| **Marketing** | Ad formats, hook psychology, content frequency | 🔴 <30 🟡 30-70 🟢 >70 |

---

## 👥 Team

- **Anush Pratap Singh**
- **Divya Sangwan**
- **Muhammad Umer Tahir**
- **Ankit Kumar**
- **Deepti Kalagatoori**

---

## 📜 License

This project was built for the [Kaggle AI Agents: Intensive Vibe Coding Capstone](https://www.kaggle.com/competitions/vibecoding-agents-capstone-project/).

Track: **Agents for Business**
