/**
 * PRYZM Backend Server (v2)
 * ==========================
 * Express.js API that orchestrates REAL AI agents:
 *   Scout Agent   → Finds and scrapes competitors
 *   Analyst Agent → Produces gap analysis scorecard
 *   Creative Agent → Generates marketing creatives
 * 
 * No demo data. No fake results. Real agent loops with real tool calls.
 */

const express = require('express');
const cors = require('cors');
require('dotenv').config();

const { runScoutAgent } = require('./agents/scout_agent');
const { runAnalystAgent } = require('./agents/analyst_agent');
const { runCreativeAgent } = require('./agents/creative_agent');

// ── Validate environment ──────────────────────────────────────────────────
if (!process.env.GEMINI_API_KEY) {
  console.error('\n❌ FATAL: GEMINI_API_KEY is not set.');
  console.error('   1. Open backend-server/.env');
  console.error('   2. Paste your key from: https://aistudio.google.com/apikey');
  console.error('   3. Restart the server\n');
  process.exit(1);
}

// ── App Setup ─────────────────────────────────────────────────────────────
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Request logger
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ── Routes ────────────────────────────────────────────────────────────────

/**
 * GET /api/health
 * Simple health check
 */
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '2.0.0',
    agents: ['scout', 'analyst', 'creative'],
    timestamp: new Date().toISOString()
  });
});

/**
 * POST /api/analyze
 * Full pipeline: Scout → Analyst
 * 
 * Input: Store data from the Chrome extension
 * Output: Gap analysis scorecard
 */
app.post('/api/analyze', async (req, res) => {
  try {
    const storeData = req.body;

    // Validate input
    if (!storeData || !storeData.store_name) {
      return res.status(400).json({
        error: 'Missing store data. Need at least: { store_name, products, niche_signals }'
      });
    }

    console.log(`\n${'='.repeat(60)}`);
    console.log(`🔮 PRYZM ANALYSIS PIPELINE — "${storeData.store_name}"`);
    console.log(`${'='.repeat(60)}`);

    // AGENT 1: Scout — Find and scrape competitors
    console.log('\n📡 Phase 1: SCOUT AGENT — Finding competitors...');
    const scoutResult = await runScoutAgent(storeData);
    console.log(`   Scout found ${scoutResult.competitors?.length || 0} competitors`);

    // AGENT 2: Analyst — Gap analysis
    console.log('\n📊 Phase 2: ANALYST AGENT — Analyzing gaps...');
    const analysisResult = await runAnalystAgent(storeData, scoutResult);
    console.log(`   Analysis complete. Overall score: ${analysisResult.overall_score}/100`);

    console.log(`\n${'='.repeat(60)}`);
    console.log(`✅ PIPELINE COMPLETE`);
    console.log(`${'='.repeat(60)}\n`);

    res.json({
      success: true,
      store: storeData.store_name,
      gap_analysis: analysisResult,
      scout_data: {
        competitors_found: scoutResult.competitors?.length || 0,
        niche_summary: scoutResult.niche_summary
      }
    });

  } catch (err) {
    console.error('❌ Analysis pipeline failed:', err.message);
    res.status(500).json({
      error: 'Analysis failed',
      message: err.message,
      hint: 'Check your GEMINI_API_KEY in .env and try again'
    });
  }
});

/**
 * POST /api/generate-creative
 * Creative Agent: Gap Analysis → Marketing Creatives
 * 
 * Input: Gap analysis + store data
 * Output: Platform-specific ad scripts
 */
app.post('/api/generate-creative', async (req, res) => {
  try {
    const { analysis, store } = req.body;

    if (!analysis) {
      return res.status(400).json({
        error: 'Missing analysis data. Run /api/analyze first.'
      });
    }

    console.log(`\n🎨 CREATIVE AGENT — Generating creatives for "${store?.store_name || 'unknown'}"...`);

    // AGENT 3: Creative Director — Generate creatives
    const creativeResult = await runCreativeAgent(analysis, store || {});
    console.log(`   Generated ${creativeResult.prescriptions?.length || 0} creatives`);

    res.json({
      success: true,
      prescriptions: creativeResult.prescriptions || creativeResult
    });

  } catch (err) {
    console.error('❌ Creative generation failed:', err.message);
    res.status(500).json({
      error: 'Creative generation failed',
      message: err.message
    });
  }
});

/**
 * POST /api/full-pipeline
 * Runs ALL 3 agents in sequence: Scout → Analyst → Creative
 * One-shot endpoint for the extension to call
 */
app.post('/api/full-pipeline', async (req, res) => {
  try {
    const storeData = req.body;

    if (!storeData || !storeData.store_name) {
      return res.status(400).json({
        error: 'Missing store data.'
      });
    }

    console.log(`\n${'='.repeat(60)}`);
    console.log(`🔮 FULL PIPELINE — "${storeData.store_name}"`);
    console.log(`${'='.repeat(60)}`);

    // Scout
    console.log('\n📡 Agent 1: SCOUT...');
    const scoutResult = await runScoutAgent(storeData);

    // Analyst
    console.log('\n📊 Agent 2: ANALYST...');
    const analysisResult = await runAnalystAgent(storeData, scoutResult);

    // Creative
    console.log('\n🎨 Agent 3: CREATIVE DIRECTOR...');
    const creativeResult = await runCreativeAgent(analysisResult, storeData);

    console.log(`\n✅ FULL PIPELINE COMPLETE\n`);

    res.json({
      success: true,
      store: storeData.store_name,
      gap_analysis: analysisResult,
      creatives: creativeResult.prescriptions || creativeResult,
      scout_summary: scoutResult.niche_summary
    });

  } catch (err) {
    console.error('❌ Full pipeline failed:', err.message);
    res.status(500).json({ error: 'Pipeline failed', message: err.message });
  }
});

// ── Start Server ──────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🔮 PRYZM Backend v2.0 — REAL AGENTS`);
  console.log(`   Server: http://localhost:${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/api/health`);
  console.log(`   Agents: Scout → Analyst → Creative Director`);
  console.log(`   Gemini: ✅ Connected\n`);
});
