# 🔮 PRYZM — E-Commerce Competitive Intelligence Agent

> **An agentic Chrome extension that refracts your market into actionable competitive wavelengths.**

PRYZM is an AI-powered browser extension that sits alongside an e-commerce merchant's workflow and autonomously identifies competitive gaps, reverse-engineers competitor ad psychology, and generates ready-to-deploy marketing creatives — all with human-in-the-loop approval.

---

## 🎯 Problem Statement

E-commerce store owners drown in "marketing spaghetti" — manually guessing what content, pricing, and hooks will drive sales while competitors silently out-position them. Existing tools (SEMrush, AdSpy, Koala Inspector) either cost $200+/month, require extensive setup, or dump raw data without actionable insights.

**PRYZM solves this** by bringing competitive intelligence directly into the browser, extracting store context automatically, and delivering a structured gap scorecard with AI-generated counter-strategies.

---

## 🏗️ Architecture (v4)

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Chrome Extension (MV3)                          │
│                                                                        │
│  [UI]          [CONTENT SCRIPT]      [BACKGROUND SERVICE WORKER]       │
│  sidepanel ──→ content.js      ──→   background.js (Orchestrator)      │
│  (Chat,        (Scrapes Store)       │   │   │   │   │                 │
│   Dash)                              ▼   ▼   ▼   ▼   ▼                 │
│                                  ┌──────────────────────────────────┐  │
│                                  │        Agent Swarm               │  │
│                                  │ - GeminiAgent (LLM wrapper)      │  │
│                                  │ - ScoutAgent (Spy/Search)        │  │
│                                  │ - AnalystAgent (Gap Analysis)    │  │
│                                  │ - CreativeAgent (Copywriting)    │  │
│                                  │ - ChatAgent (Store-aware Chat)   │  │
│                                  └───────┬────────────┬─────────────┘  │
└──────────────────────────────────────────┼────────────┼────────────────┘
                                           ▼            ▼
                             ┌───────────────┐ ┌────────────────────────┐
                             │ Gemini API    │ │ MCP Server (stdio)     │
                             │ (2.0 Flash)   │ │ Tool: scrape_competitor│
                             └───────────────┘ │ (Wraps Firecrawl SDK)  │
                                               └────────────────────────┘
```

### The Agent Lifecycle: Listen → Spy → Prescribe → Defend

| Phase | Agent | What It Does |
|-------|-------|-------------|
| 🎧 **LISTEN** | Content Script | Silently reads the merchant's dashboard to extract products (JSON-LD, DOM) |
| 🕵️ **SPY** | Scout Agent | Finds competitors and scrapes web data (via MCP or Cheerio fallback) |
| 📋 **PRESCRIBE**| Analyst/Creative | Compares 4 dimensions, generates marketing hooks |
| 🛡️ **DEFEND** | Chat/Creative | Sanitizes outputs & blocks prompt injection (Security Guardrails) |

---

## 📚 Course Concepts Demonstrated (4/4 Completed)

| Concept | Where | Day |
|---------|-------|-----|
| **Multi-Agent Pipeline** | `background.js` → Swarm (Scout, Analyst, Creative, Chat) | Day 3 |
| **MCP Server** | `mcp-server/index.js` → wraps Firecrawl in Model Context Protocol | Day 2 |
| **Agent Skills** | `agents/analyst.js`, `creative.js` → Local heuristic + LLM tool calling | Day 3 |
| **Security Guardrails** | `agents/chat.js` & `creative.js` → Prompt injection & output filtering | Day 4 |

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
├── extension/                 # Chrome Extension (MV3)
│   ├── manifest.json          # Extension configuration
│   ├── content.js             # 🎧 LISTEN — Store data extraction
│   ├── background.js          # 🕵️ Orchestrator — Pipeline management
│   ├── sidepanel.html         # Dashboard layout
│   ├── sidepanel.css          # Premium dark industrial theme
│   ├── sidepanel.js           # UI logic & view management
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
