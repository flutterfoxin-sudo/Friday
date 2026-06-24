const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const Groq = require('groq-sdk');
const multer = require('multer');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const mongoSanitize = require('express-mongo-sanitize');
// Load environment variables
dotenv.config();

// ── GLOBAL CRASH GUARDS ──────────────────────────────────────────
// Prevent unhandled errors from taking the backend offline.
function sendDiagnosticAlert(type, message, stack) {
  try {
    const whatsapp = require('./skills/whatsapp');
    const target = global.diagnosticsGroupId || '120363427554589491@g.us';
    whatsapp.execute({
      action: 'send',
      to: target,
      message: `🚨 *[F.R.I.D.A.Y. NODE CRITICAL ERROR]*\nType: ${type}\nMessage: ${message}\n\nTrace:\n${stack ? stack.substring(0, 500) : 'N/A'}`
    }).catch(() => {});
  } catch (e) {}
}

process.on('uncaughtException', (err) => {
  console.error('[FRIDAY-GUARD] Uncaught Exception (server stays online):', err.message);
  console.error(err.stack);
  sendDiagnosticAlert('Uncaught Exception', err.message, err.stack);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[FRIDAY-GUARD] Unhandled Promise Rejection (server stays online):', reason);
  sendDiagnosticAlert('Unhandled Rejection (Backend)', String(reason), String(reason.stack || ''));
});

// ─────────────────────────────────────────────────────────────────

const skillManager    = require('./skills/skill-manager');
const localLLM        = require('./skills/local-llm');
const knowledgeEngine = require('./skills/knowledge-engine');
const webLearn        = require('./skills/web-learn');
const ingest          = require('./skills/ingest');
const learningTracker = require('./skills/learning-tracker');
const soul            = require('./skills/soul');

let bannedPhrases = [];
try {
  const bannedData = JSON.parse(fs.readFileSync(path.join(__dirname, 'identity', 'test_banned_responses.json'), 'utf8'));
  bannedPhrases = bannedData.banned_phrases || [];
} catch (e) {
  console.warn("Could not load banned phrases test suite.");
}

const app = express();
const PORT = process.env.PORT || 5000;

// File upload config with strict limits and filtering to prevent path traversal/execution
const upload = multer({ 
  dest: path.join(__dirname, 'uploads/'),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB limit
  fileFilter: (req, file, cb) => {
    // Only allow safe document formats, reject executables and scripts
    const allowedTypes = ['application/pdf', 'text/plain', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only PDF, TXT, and DOCX are allowed.'));
    }
  }
});
if (!fs.existsSync(path.join(__dirname, 'uploads'))) {
  fs.mkdirSync(path.join(__dirname, 'uploads'));
}

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5000, // limit each IP to 5000 requests per windowMs
  message: { success: false, error: 'Too many requests from this IP, please try again after 15 minutes' }
});

app.use(cors({
  origin: '*', // Allow all origins for local development (fixes port 3001 and LAN IP issues)
  optionsSuccessStatus: 200
}));
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));
app.use(mongoSanitize());
app.use(limiter);
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

// ── CLOUD SECURITY MIDDLEWARE ──────────────────────────────────
app.use('/api', (req, res, next) => {
  // If hosted on a cloud domain, enforce FRIDAY_SECRET_KEY
  if (process.env.FRIDAY_SECRET_KEY) {
    const apiKey = req.headers['x-api-key'] || req.query.apiKey || req.body?.apiKey;
    if (apiKey !== process.env.FRIDAY_SECRET_KEY) {
       return res.status(401).json({ success: false, error: 'Unauthorized: Invalid API Key' });
    }
  }
  next();
});

// Endpoint to receive frontend errors
app.post('/api/diagnostics/report', (req, res) => {
  try {
    const { type, message, stack, component } = req.body;
    sendDiagnosticAlert(`Frontend Error (${component || 'React'}) - ${type}`, message, stack);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});
// ───────────────────────────────────────────────────────────────

// ── ENGINE STATUS ─────────────────────────────────────────────
app.get('/api/engine/status', async (req, res) => {
  const ollamaOnline = await localLLM.isOllamaAvailable();
  let models = [];
  if (ollamaOnline) {
    try { models = await localLLM.listModels(); } catch {}
  }
  const kbStats = knowledgeEngine.stats();
  res.json({
    success: true,
    engine: {
      local: { online: ollamaOnline, model: localLLM.DEFAULT_MODEL, models },
      cloud: { configured: !!process.env.GEMINI_API_KEY },
      preferred: ollamaOnline ? 'local' : (process.env.GEMINI_API_KEY ? 'cloud' : 'offline')
    },
    knowledge: kbStats
  });
});

// ── ATOMIC CLOCK SYNC ─────────────────────────────────────────
app.get('/api/engine/groups', async (req, res) => {
  try {
    const whatsapp = require('./skills/whatsapp');
    const acc = global.whatsappAccounts['friday-session'] || Object.values(global.whatsappAccounts).find(a => a.ready);
    if (!acc || !acc.client) return res.json({ error: 'No client' });
    const chats = await acc.client.getChats();
    const groups = chats.filter(c => c.isGroup).map(c => ({ name: c.name, id: c.id._serialized }));
    res.json({ groups, globalDiag: global.diagnosticsGroupId });
  } catch(e) { res.status(500).json({error: e.message}); }
});
app.get('/api/time/atomic', async (req, res) => {
  let detectedTimezone = req.query.timezone || 'Etc/UTC';
  let locationLabel = '';
  let abbreviation = 'UTC';

  // 1. IP Lookup to get user location & timezone
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1500);
    const ipRes = await fetch('http://ip-api.com/json', { signal: controller.signal });
    clearTimeout(timeoutId);
    if (ipRes.ok) {
      const ipData = await ipRes.json();
      if (ipData && ipData.status === 'success') {
        detectedTimezone = ipData.timezone || detectedTimezone;
        locationLabel = `${ipData.city}, ${ipData.countryCode}`;
      }
    }
  } catch (e) {
    console.warn("[ATOMIC CLOCK] IP-location lookup failed, falling back:", e.message);
  }

  // 2. Fetch Atomic time based on detected timezone
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);
    const timeRes = await fetch(`http://worldtimeapi.org/api/timezone/${detectedTimezone}`, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (timeRes.ok) {
      const data = await timeRes.json();
      if (data && data.unixtime) {
        return res.json({
          success: true,
          unixtime: data.unixtime * 1000,
          datetime: data.datetime,
          timezone: data.timezone || detectedTimezone,
          location: locationLabel || (data.timezone ? data.timezone.split('/').pop().replace('_', ' ') : 'Global'),
          abbreviation: data.abbreviation || abbreviation,
          source: 'worldtimeapi.org'
        });
      }
    }
  } catch (e) {
    console.warn(`[ATOMIC CLOCK] WorldTimeAPI failed for timezone ${detectedTimezone}, trying direct IP query:`, e.message);
    
    // Fallback A: WorldTimeAPI auto-IP query
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);
      const ipTimeRes = await fetch('http://worldtimeapi.org/api/ip', { signal: controller.signal });
      clearTimeout(timeoutId);
      if (ipTimeRes.ok) {
        const data = await ipTimeRes.json();
        if (data && data.unixtime) {
          return res.json({
            success: true,
            unixtime: data.unixtime * 1000,
            datetime: data.datetime,
            timezone: data.timezone,
            location: locationLabel || (data.timezone ? data.timezone.split('/').pop().replace('_', ' ') : 'Global'),
            abbreviation: data.abbreviation,
            source: 'worldtimeapi.org/ip'
          });
        }
      }
    } catch (err) {
      console.warn("[ATOMIC CLOCK] Direct IP query failed:", err.message);
    }
  }

  // Fallback B: local server time fallback
  res.json({
    success: true,
    unixtime: Date.now(),
    datetime: new Date().toISOString(),
    timezone: detectedTimezone,
    location: locationLabel || 'Local Network',
    abbreviation: abbreviation,
    source: 'local_server_fallback'
  });
});

// ── SECURE API KEY VISIBILITY ─────────────────────────────────
app.get('/api/keys/status', (req, res) => {
  const keysDir = path.join(__dirname, 'API KEY');
  const results = [];
  if (fs.existsSync(keysDir)) {
    const folders = fs.readdirSync(keysDir, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name);
      
    folders.forEach(folder => {
      // Mask the folder name (API key) to prevent frontend exploitation
      if (folder.length > 8) {
        const start = folder.substring(0, 4);
        const end = folder.substring(folder.length - 4);
        const masked = `${start}${'*'.repeat(folder.length - 8)}${end}`;
        results.push({ masked, valid: true });
      } else {
        results.push({ masked: '***', valid: false });
      }
    });
  }
  res.json({ success: true, keys: results });
});

// ── KNOWLEDGE: Scrape a URL ───────────────────────────────────
app.post('/api/learn/url', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ success: false, error: 'URL is required' });
  try {
    const isWiki = url.includes('wikipedia.org/wiki/');
    let result;
    if (isWiki) {
      const title = url.split('/wiki/').pop().split('#')[0];
      result = await webLearn.scrapeWikipedia(title);
    } else {
      result = await webLearn.scrapeUrl(url);
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── KNOWLEDGE: Auto-learn Wikipedia sweep ─────────────────────
app.post('/api/learn/auto', async (req, res) => {
  res.json({ success: true, message: 'Auto-learn sweep started in background. Check /api/knowledge/stats for progress.' });
  // Run async without blocking response
  webLearn.autoLearn((progress) => {
    console.log(`[AUTO-LEARN] ${progress.domain}/${progress.title} - ${progress.status}`);
  }).then(result => {
    console.log(`[AUTO-LEARN] Complete: ${result.successful}/${result.processed} articles learned`);
  }).catch(err => console.error('[AUTO-LEARN] Error:', err.message));
});

// ── KNOWLEDGE: Upload document ────────────────────────────────
app.post('/api/learn/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, error: 'No file uploaded' });
  const originalExt = path.extname(req.file.originalname).toLowerCase();
  const renamedPath = req.file.path + originalExt;
  try {
    fs.renameSync(req.file.path, renamedPath);
    const result = await ingest.ingestFile(renamedPath);
    fs.unlinkSync(renamedPath); // clean up temp file
    res.json(result);
  } catch (err) {
    try { fs.unlinkSync(req.file.path); } catch {}
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── KNOWLEDGE: Stats ──────────────────────────────────────────
app.get('/api/knowledge/stats', (req, res) => {
  res.json({ success: true, stats: knowledgeEngine.stats() });
});

// ── KNOWLEDGE: Clear domain ───────────────────────────────────
app.delete('/api/knowledge/clear', (req, res) => {
  const { domain = 'all' } = req.body;
  const result = knowledgeEngine.clearDomain(domain);
  res.json({ success: true, ...result });
});

// ── TRADING PORTFOLIO ENDPOINTS ──────────────────────────────
app.get('/api/trading/portfolio', (req, res) => {
  const pPath = path.join(__dirname, 'skills', 'paper_portfolio.json');
  try {
    if (fs.existsSync(pPath)) {
      const rawPortfolio = JSON.parse(fs.readFileSync(pPath, 'utf8'));
      
      const mappedPositions = {};
      const historyList = [];
      
      if (Array.isArray(rawPortfolio.positions)) {
        rawPortfolio.positions.forEach(pos => {
          if (pos.status === 'open') {
            mappedPositions[pos.ticker] = {
              quantity: pos.quantity || 0,
              avg_price: pos.entry_price || 0,
              current_price: pos.current_price || pos.entry_price || 0,
              current_value: (pos.current_price || pos.entry_price || 0) * (pos.quantity || 0),
              stop_loss: pos.stop_loss,
              target: pos.target,
              strategy: pos.strategy || 'Autonomous'
            };
          } else if (pos.status === 'closed') {
            historyList.push({
              id: pos.id,
              symbol: pos.ticker,
              type: pos.action === 'BUY' ? 'BUY' : 'SELL',
              quantity: pos.quantity || 0,
              price: pos.exit_price || pos.entry_price || 0,
              strategy: pos.strategy || 'Autonomous',
              timestamp: pos.exit_timestamp
            });
          }
        });
      }
      
      const portfolio = {
        balance_usd: rawPortfolio.cash !== undefined ? rawPortfolio.cash : 10000.0,
        balance_sol: 0.0,
        positions: mappedPositions,
        history: historyList,
        total_value: rawPortfolio.total_value !== undefined ? rawPortfolio.total_value : (rawPortfolio.cash || 10000.0),
        today_pnl: rawPortfolio.today_pnl || 0.0,
        today_pnl_pct: rawPortfolio.today_pnl_pct || 0.0,
        trading_active: rawPortfolio.trading_active !== false,
        next_trade_at: rawPortfolio.next_trade_at || null
      };

      res.json({ success: true, portfolio });
    } else {
      res.json({
        success: true,
        portfolio: {
          balance_usd: 10000.0,
          balance_sol: 0.0,
          positions: {},
          history: [],
          daily_start_value: 10000.0,
          trading_active: true
        }
      });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/trading/toggle', (req, res) => {
  const { active } = req.body;
  const pPath = path.join(__dirname, 'skills', 'paper_portfolio.json');
  try {
    let portfolio = { balance_usd: 10000.0, balance_sol: 10.0, positions: {}, history: [], daily_start_value: 10000.0, trading_active: true };
    if (fs.existsSync(pPath)) {
      portfolio = JSON.parse(fs.readFileSync(pPath, 'utf8'));
    }
    portfolio.trading_active = !!active;
    fs.writeFileSync(pPath, JSON.stringify(portfolio, null, 2), 'utf8');
    res.json({ success: true, trading_active: portfolio.trading_active });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});


// ── MCP SERVER & LIVEKIT CONFIG STATUS ─────────────────────────
app.get('/api/mcp/status', async (req, res) => {
  const mcpUrl = "http://localhost:8000/sse";
  let mcpOnline = false;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1000);
    const ping = await fetch(mcpUrl, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (ping.status === 200 || ping.status === 404 || ping.status === 405) {
      mcpOnline = true;
    }
  } catch (err) {
    mcpOnline = false;
  }

  res.json({
    success: true,
    mcp: {
      online: mcpOnline,
      port: 8000,
      url: mcpUrl,
      tools: [
        "get_current_time",
        "get_system_info",
        "get_world_news",
        "get_world_finance_news",
        "open_world_monitor",
        "open_finance_world_monitor",
        "execute_friday_skill",
        "get_trading_portfolio",
        "get_soul_state"
      ]
    },
    livekit: {
      configured: !!(process.env.LIVEKIT_URL && process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET),
      url: process.env.LIVEKIT_URL || null
    }
  });
});

// 1. GET /api/skills - List all dynamically registered skills

app.get('/api/skills', (req, res) => {
  try {
    const list = skillManager.listSkills();
    res.json({ success: true, skills: list });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2. POST /api/skills/execute/:name - Run a specific skill
app.post('/api/skills/execute/:name', async (req, res) => {
  const { name } = req.params;
  const params = req.body || {};
  try {
    const query = params.query || Object.values(params).join(' ');
    const isAnalyticalSkill = ['analyst', 'trading', 'geopolitics', 'legal'].includes(name);
    
    // Intercept analytical skills and use Cloud (Gemini/Groq) first, fallback to Local LLM if available
    if (isAnalyticalSkill) {
      const geminiKey = process.env.GEMINI_API_KEY;
      const groqKey = process.env.GROQ_API_KEY;
      const ollamaOnline = await localLLM.isOllamaAvailable();

      if (geminiKey || groqKey || ollamaOnline) {
        console.log(`[ENGINE] Intercepting ${name} skill using prioritized LLM ladder & RAG`);
        let knowledgeContext = '';
        try {
          const kbChunks = knowledgeEngine.search(query, 5);
          if (kbChunks.length > 0) {
            knowledgeContext = `\n\nF.R.I.D.A.Y. LEARNED KNOWLEDGE:\n` + kbChunks.map((c, i) => `[KB-${i+1}] ${c.text.substring(0, 400)}`).join('\n\n');
          }
        } catch (e) {}

        const systemPrompt = `You are F.R.I.D.A.Y. Perform an advanced analysis for the user regarding ${name}. Answer intelligently using your learned knowledge. Format your response cleanly.${knowledgeContext}`;

        let reportText = '';

        // 1. Try Gemini
        if (geminiKey) {
          try {
            console.log(`[ENGINE] Intercepting ${name} skill with Gemini cloud...`);
            const genAI = new GoogleGenerativeAI(geminiKey);
            const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
            const result = await model.generateContent({
              contents: [{ role: 'user', parts: [{ text: `Query: "${query}"` }] }],
              generationConfig: {
                temperature: 0.7,
              },
              systemInstruction: systemPrompt
            });
            const text = await result.response.text();
            if (text) {
              reportText = text.trim();
            }
          } catch (err) {
            console.error('[ENGINE] Gemini failed for skill interception:', err.message);
          }
        }

        // 2. Try Groq
        if (!reportText && groqKey) {
          try {
            console.log(`[ENGINE] Intercepting ${name} skill with Groq cloud...`);
            const groq = new Groq({ apiKey: groqKey });
            const response = await groq.chat.completions.create({
              messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: `Query: "${query}"` }
              ],
              model: 'llama-3.3-70b-versatile',
              temperature: 0.7,
            });
            const text = response.choices[0]?.message?.content;
            if (text) {
              reportText = text.trim();
            }
          } catch (err) {
            console.error('[ENGINE] Groq failed for skill interception:', err.message);
          }
        }

        // 3. Try Local LLM
        if (!reportText && ollamaOnline) {
          try {
            console.log(`[ENGINE] Intercepting ${name} skill with Local LLM...`);
            const localResult = await localLLM.generate({
              prompt: `Query: "${query}"`,
              systemPrompt: systemPrompt,
              model: localLLM.DEFAULT_MODEL
            });
            if (localResult.success && localResult.text) {
              reportText = localResult.text.trim();
            }
          } catch (err) {
            console.error('[ENGINE] Local LLM failed for skill interception:', err.message);
          }
        }

        if (reportText) {
          return res.json({
            success: true,
            result: {
              success: true,
              report: reportText,
              originalSkill: name
            }
          });
        }
      }
    }

    let result = await skillManager.executeSkill(name, params);
    
    // Intercept if skill is unanswerable and trigger search + analyst fallback
    if (result && result.unanswerable) {
      console.log(`[SERVER FALLBACK] Skill "${name}" flagged query as unanswerable. Initiating web search & Analyst...`);
      const fallbackQuery = result.query || params.query || `${name} analysis ${Object.values(params).join(' ')}`;
      
      let searchResults = [];
      try {
        const searchModule = require('./skills/search');
        const searchRes = await searchModule.execute({ 
          query: fallbackQuery, 
          mode: 'web' 
        });
        if (searchRes.success) {
          searchResults = searchRes.results || [];
        }
      } catch (err) {
        console.error('Fallback search execution failed:', err.message);
      }

      let report = '';
      const geminiKey = process.env.GEMINI_API_KEY;
      const groqKey = process.env.GROQ_API_KEY;
      const ollamaOnline = await localLLM.isOllamaAvailable();

      let knowledgeContext = '';
      try {
        const kbChunks = knowledgeEngine.search(fallbackQuery, 5);
        if (kbChunks.length > 0) {
          knowledgeContext = `\n\nF.R.I.D.A.Y. LEARNED KNOWLEDGE:\n` + kbChunks.map((c, i) => `[KB-${i+1}] ${c.text.substring(0, 400)}`).join('\n\n');
        }
      } catch (e) {}
      
      const webCtx = searchResults.map((r, idx) => `[${idx+1}] ${r.title}: ${r.snippet}`).join('\n');
      const systemPrompt = `You are F.R.I.D.A.Y. Answer the user's analytical query intelligently using your learned knowledge. Do not apologize, just provide the analysis.${knowledgeContext}\n\nWeb Search:\n${webCtx}`;

      // 1. Try Gemini
      if (geminiKey) {
        try {
          console.log(`[SERVER FALLBACK] Using Gemini cloud engine for unanswerable skill query.`);
          const genAI = new GoogleGenerativeAI(geminiKey);
          const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
          const result = await model.generateContent({
            contents: [{ role: 'user', parts: [{ text: `Query: "${fallbackQuery}"` }] }],
            generationConfig: {
              temperature: 0.7,
            },
            systemInstruction: systemPrompt
          });
          const text = await result.response.text();
          if (text) {
            report = text.trim();
          }
        } catch (err) {
          console.error('[SERVER FALLBACK] Gemini failed, falling back next:', err.message);
        }
      }

      // 2. Try Groq
      if (!report && groqKey) {
        try {
          console.log(`[SERVER FALLBACK] Using Groq cloud engine for unanswerable skill query.`);
          const groq = new Groq({ apiKey: groqKey });
          const response = await groq.chat.completions.create({
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: `Query: "${fallbackQuery}"` }
            ],
            model: 'llama-3.3-70b-versatile',
            temperature: 0.7,
          });
          const text = response.choices[0]?.message?.content;
          if (text) {
            report = text.trim();
          }
        } catch (err) {
          console.error('[SERVER FALLBACK] Groq failed, falling back next:', err.message);
        }
      }

      // 3. Try Local LLM
      if (!report && ollamaOnline) {
        try {
          console.log(`[SERVER FALLBACK] Using Local LLM for unanswerable skill query.`);
          const localResult = await localLLM.generate({
            prompt: `Query: "${fallbackQuery}"`,
            systemPrompt: systemPrompt,
            model: localLLM.DEFAULT_MODEL
          });
          if (localResult.success && localResult.text) {
            report = localResult.text.trim();
          }
        } catch (err) {
          console.warn('[SERVER FALLBACK] Local LLM failed, reverting to analyst.');
        }
      }

      if (!report) {
        const analystModule = require('./skills/analyst');
        const webCtx = searchResults.map((r, idx) => `[${idx+1}] Source: ${r.title}\nURL: ${r.url}\nContent: ${r.snippet}`).join('\n\n');
        
        const analysisResult = await analystModule.execute({ 
          query: fallbackQuery, 
          webContext: webCtx 
        });
        if (analysisResult.success) report = analysisResult.report;
      }

      if (report) {
        return res.json({
          success: true,
          result: {
            success: true,
            isFallbackReport: true,
            report: report,
            originalSkill: name,
            fallbackQuery
          }
        });
      }
    }
    
    if (name === 'memory') {
      cachedMemory = null;
    }
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Helper to set configuration keys dynamically in .env file
function setEnvVar(key, value) {
  const envPath = path.join(__dirname, '.env');
  let envContent = '';
  if (fs.existsSync(envPath)) {
    envContent = fs.readFileSync(envPath, 'utf8');
  }

  const lines = envContent.split('\n');
  let found = false;
  const newLines = lines.map(line => {
    if (line.trim().startsWith(`${key}=`)) {
      found = true;
      return `${key}=${value}`;
    }
    return line;
  });

  if (!found) {
    newLines.push(`${key}=${value}`);
  }

  fs.writeFileSync(envPath, newLines.join('\n').trim() + '\n', 'utf8');
  process.env[key] = value;
}

// 3. POST /api/config/key - Bind Gemini API Key to backend env
app.post('/api/config/key', (req, res) => {
  const { key } = req.body;
  if (!key) {
    return res.status(400).json({ success: false, error: 'API key is required.' });
  }

  try {
    setEnvVar('GEMINI_API_KEY', key);
    res.json({ success: true, message: 'Gemini API Key bound successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3.1 POST /api/config/searchkey - Bind Search API Key to backend env
app.post('/api/config/searchkey', (req, res) => {
  const { key } = req.body;
  if (!key) {
    return res.status(400).json({ success: false, error: 'API key is required.' });
  }

  try {
    setEnvVar('SEARCH_API_KEY', key);
    res.json({ success: true, message: 'Search API Key bound successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3.2 GET /api/voice - Get global voice configuration
app.get('/api/voice', (req, res) => {
  const voicePath = path.join(__dirname, 'voice', 'settings.json');
  try {
    if (fs.existsSync(voicePath)) {
      const settings = JSON.parse(fs.readFileSync(voicePath, 'utf8'));
      res.json({ success: true, settings });
    } else {
      res.json({ success: true, settings: { current: 'female', models: ['male', 'female'] } });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3.3 POST /api/voice - Update global voice configuration
app.post('/api/voice', (req, res) => {
  const { voice } = req.body;
  const validVoices = ['male', 'female', 'bella', 'rachel', 'glinda', 'antoni', 'adam', 'arnold'];
  if (!voice || !validVoices.includes(voice.toLowerCase())) {
    return res.status(400).json({ success: false, error: 'Invalid voice option. Must be one of: ' + validVoices.join(', ') });
  }

  const voicePath = path.join(__dirname, 'voice', 'settings.json');
  try {
    let settings = { current: 'female', models: ['male', 'female'] };
    if (fs.existsSync(voicePath)) {
      settings = JSON.parse(fs.readFileSync(voicePath, 'utf8'));
    }
    settings.current = voice;
    fs.writeFileSync(voicePath, JSON.stringify(settings, null, 2), 'utf8');
    res.json({ success: true, settings });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3.4 POST /api/voice-engine/url - Bind Custom TTS URL (e.g. from Colab)
app.post('/api/voice-engine/url', (req, res) => {
  const { url } = req.body;
  if (!url) {
    return res.status(400).json({ success: false, error: 'URL is required.' });
  }

  try {
    setEnvVar('CUSTOM_TTS_URL', url.replace(/\/$/, '')); // Remove trailing slash
    res.json({ success: true, message: 'Custom TTS Engine URL bound successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3.5 POST /api/tts - Proxy TTS request to custom engine or ElevenLabs (dual voice support)
app.post('/api/tts', async (req, res) => {
  const { text } = req.body;
  const customUrl = process.env.CUSTOM_TTS_URL;
  const elevenlabsApiKey = process.env.ELEVENLABS_API_KEY;

  if (!elevenlabsApiKey && !customUrl) {
    return res.status(404).json({ success: false, error: 'Voice engine not configured. Configure ElevenLabs or Custom TTS.' });
  }

  // Read current voice setting (male or female)
  let voice = 'female';
  const voicePath = path.join(__dirname, 'voice', 'settings.json');
  try {
    if (fs.existsSync(voicePath)) {
      const settings = JSON.parse(fs.readFileSync(voicePath, 'utf8'));
      voice = settings.current || 'female';
    }
  } catch (e) {}

  try {
    const fetch = require('node-fetch');

    // Scenario A: ElevenLabs (Prioritized)
    if (elevenlabsApiKey) {
      console.log(`[TTS] Generating voice via ElevenLabs (${voice})`);
      let voiceId = 'EXAVITQu4vr4xnSDxMaL'; // Default Bella
      const cleanVoice = voice.toLowerCase();
      if (cleanVoice === 'female' || cleanVoice === 'bella') {
        voiceId = process.env.ELEVENLABS_FEMALE_VOICE_ID || 'EXAVITQu4vr4xnSDxMaL';
      } else if (cleanVoice === 'rachel') {
        voiceId = '21m00Tcm4TlvDq8ikWAM';
      } else if (cleanVoice === 'glinda') {
        voiceId = 'z9fAnlkFNGQmrw7tqTms';
      } else if (cleanVoice === 'male' || cleanVoice === 'antoni') {
        voiceId = process.env.ELEVENLABS_MALE_VOICE_ID || 'ErXwobaYiN019PkySvjV';
      } else if (cleanVoice === 'adam') {
        voiceId = 'pNInz6obpgHs51lh2A6j';
      } else if (cleanVoice === 'arnold') {
        voiceId = 'VR6A4mxX6vnD8jv8CJi0';
      } else {
        voiceId = voice;
      }

      const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: 'POST',
        headers: {
          'xi-api-key': elevenlabsApiKey,
          'Content-Type': 'application/json',
          'accept': 'audio/mpeg'
        },
        body: JSON.stringify({
          text,
          model_id: 'eleven_multilingual_v2',
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75
          }
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`ElevenLabs returned ${response.status}: ${errText}`);
      }

      res.setHeader('Content-Type', 'audio/mpeg');
      response.body.pipe(res);
      return;
    }

    // Scenario B: XTTSv2 Custom URL Fallback
    if (customUrl) {
      console.log(`[TTS] Generating voice via Custom XTTSv2 URL (${voice})`);
      const ttsRes = await fetch(`${customUrl}/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice })
      });

      if (!ttsRes.ok) {
        throw new Error(`Custom TTS engine returned ${ttsRes.status}`);
      }

      res.setHeader('Content-Type', 'audio/wav');
      ttsRes.body.pipe(res);
    }
  } catch (err) {
    console.error('[TTS ERROR]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3.6 POST /api/config/elevenkey - Bind ElevenLabs API Key to backend env
app.post('/api/config/elevenkey', (req, res) => {
  const { key } = req.body;
  if (!key) {
    return res.status(400).json({ success: false, error: 'API key is required.' });
  }

  try {
    setEnvVar('ELEVENLABS_API_KEY', key);
    res.json({ success: true, message: 'ElevenLabs API Key bound successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. POST /api/skills/develop - Code and validation of a new skill using Gemini API
app.post('/api/skills/develop', async (req, res) => {
  const { name, prompt } = req.body;
  
  if (!name || !prompt) {
    return res.status(400).json({ success: false, error: 'Name and prompt are required.' });
  }

  const cleanName = name.replace(/[^a-zA-Z0-9_-]/g, '').toLowerCase();
  const apiKey = process.env.GEMINI_API_KEY;

  // FALLBACK TEMPLATE COMPILER: If no API key is set, compile a demo template
  if (!apiKey) {
    console.log('Gemini API Key missing. Initiating local template compiler fallback...');
    
    // Generate a simple math or mock weather generator as fallback
    const demoCode = `
/**
 * Dynamic Skill: ${cleanName}
 * Developed automatically via local template compiler fallback.
 */
module.exports = {
  description: "Mock execution of: ${prompt.replace(/"/g, '\\"')}",
  parameters: {
    input: { type: "string", description: "Any text input parameter" }
  },
  async execute(params) {
    const val = params.input || "No parameter provided";
    return {
      message: "SYSTEM TEMPLATE FALLBACK: Run completed successfully.",
      query: "${prompt.replace(/"/g, '\\"')}",
      receivedInput: val,
      timestamp: new Date().toISOString()
    };
  }
};
`;

    try {
      const result = skillManager.createSkill(cleanName, demoCode);
      return res.json({
        success: true,
        message: 'Skill compiled successfully (using Local Template Fallback).',
        name: cleanName,
        meta: result.meta,
        warning: 'NO GEMINI API KEY BOUND. Used offline template fallback. Type "/key <your_key>" in HUD terminal to enable autonomous coding.'
      });
    } catch (err) {
      return res.status(500).json({ success: false, error: `Template compiler failed: ${err.message}` });
    }
  }

  // GEMINI AUTONOMOUS CODING MODE
  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    const instructionsPrompt = `
Generate a pure Node.js CommonJS module that exports an object representing a custom skill for an AI assistant.
The user requirements for the skill are: "${prompt}"

Your response must be ONLY valid, runnable JavaScript code. Do NOT wrap it in markdown formatting (like \`\`\`javascript or \`\`\`), do NOT write any explanation before or after the code. Output only the code.

The module structure must be EXACTLY as follows:
module.exports = {
  description: "A short, user-friendly description of what this skill does",
  parameters: {
    // Define the parameters required by the execute method
    paramName1: { type: "string" | "number" | "boolean", description: "Parameter description" }
  },
  async execute(params) {
    // 1. Extract parameters from params
    // 2. Perform the logic (e.g. calculation, fetch, text parsing, math)
    // 3. Return a JSON-serializable object containing the results
    
    // NOTE: Keep logic self-contained. If you need external APIs, use standard fetch() which is globally available in modern Node.js.
    
    return {
      // return results here
    };
  }
};
`;

    const result = await model.generateContent(instructionsPrompt);
    const response = await result.response;
    let code = response.text().trim();

    // Strip markdown formatting if the model ignored instructions and included them
    if (code.startsWith('```')) {
      code = code.replace(/^```(?:javascript|js)?\r?\n/, '').replace(/```$/, '');
    }

    // Attempt to write and compile code
    const created = skillManager.createSkill(cleanName, code);
    
    res.json({
      success: true,
      message: 'Autonomous coding completed successfully.',
      name: cleanName,
      meta: created.meta
    });

  } catch (err) {
    res.status(500).json({
      success: false,
      error: `Autonomous development failed: ${err.message}`
    });
  }
});
 
let cachedMemory = null;
const memoryPath = path.join(__dirname, 'skills', 'memory.json');

function loadMemory() {
  if (cachedMemory) return cachedMemory;
  let memory = {
    userProfile: { name: "User", preferences: { interests: [] }, extractedFacts: [] },
    searchHistory: [],
    queryHistory: [],
    systemStats: { totalInteractions: 0, successfulSearches: 0 }
  };
  if (fs.existsSync(memoryPath)) {
    try { memory = JSON.parse(fs.readFileSync(memoryPath, 'utf8')); } catch {}
  }
  cachedMemory = memory;
  return cachedMemory;
}

// 5. POST /api/chat - Dynamic query analyser & RAG chat assistant with memory
app.post('/api/chat', async (req, res) => {
  const { query } = req.body;
  if (!query) {
    return res.status(400).json({ success: false, error: 'Query is required.' });
  }

  // Load memory early
  let memory = loadMemory();

  // ── SOUL: Omnipotence interception ────────────────────
  const soul = require('./skills/soul');
  if (soul.detectIntent(query)) {
    const result = await soul.executeWill(query);
    return res.json({
      success: true,
      answer: result,
      engine: 'soul-omnipotence',
      searchExecuted: false,
      searchResults: [],
      memory: { facts: memory.userProfile.extractedFacts, interests: memory.userProfile.preferences.interests }
    });
  }

  // Intercept WhatsApp Message Retrieval Request
  if (/(?:retrieve|get|show|read|fetch|what\s+are|check)\s+(?:my\s+)?whatsapp\s+(?:messages|chats|message|chat)/i.test(query)) {
    const fs = require('fs');
    const path = require('path');
    
    // Check possible whatsapp message database paths
    const dbPaths = [
      path.join(__dirname, 'skills', 'whatsapp_messages_friday-session.json'),
      path.join(__dirname, 'skills', 'whatsapp_messages.json')
    ];
    
    let chats = [];
    let found = false;
    
    for (const dbPath of dbPaths) {
      if (fs.existsSync(dbPath)) {
        try {
          const content = fs.readFileSync(dbPath, 'utf8');
          chats = JSON.parse(content);
          if (Array.isArray(chats) && chats.length > 0) {
            found = true;
            break;
          }
        } catch (e) {
          console.error('[SERVER-CHAT-WHATSAPP] Failed to parse WhatsApp JSON:', e.message);
        }
      }
    }
    
    // If not found in primary paths, look for other session files in the skills directory
    if (!found) {
      try {
        const skillsDir = path.join(__dirname, 'skills');
        const files = fs.readdirSync(skillsDir);
        for (const file of files) {
          if (file.startsWith('whatsapp_messages_') && file.endsWith('.json')) {
            const dbPath = path.join(skillsDir, file);
            const content = fs.readFileSync(dbPath, 'utf8');
            chats = JSON.parse(content);
            if (Array.isArray(chats) && chats.length > 0) {
              found = true;
              break;
            }
          }
        }
      } catch (e) {
        console.error('[SERVER-CHAT-WHATSAPP] Failed to scan skills dir:', e.message);
      }
    }

    let answer = "";
    if (found && chats.length > 0) {
      answer = "Standby query acknowledged, sir. I have retrieved your WhatsApp messages. Here is what your active chats are saying:\n\n";
      let formattedCount = 0;
      for (const c of chats) {
        if (c.chat && Array.isArray(c.chat) && c.chat.length > 0) {
          // Find the last non-empty message text in the chat history
          let lastMsg = null;
          for (let i = c.chat.length - 1; i >= 0; i--) {
            if (c.chat[i].text && c.chat[i].text.trim() !== '') {
              lastMsg = c.chat[i];
              break;
            }
          }
          // Fallback to absolute last if all are empty
          if (!lastMsg) {
            lastMsg = c.chat[c.chat.length - 1];
          }

          if (lastMsg) {
            const bodyText = lastMsg.text || "[Empty/Media/Call]";
            answer += `- Chat with **${c.contact}** is saying: "${bodyText}"\n`;
            formattedCount++;
          }
        }
      }
      if (formattedCount === 0) {
        answer = "I checked your synchronized WhatsApp database, sir, but no active messages were found. Please verify if your account is linked and synced on the Office Matrix HUD.";
      }
    } else {
      answer = "I could not retrieve any WhatsApp messages, sir. No local database session has been synchronized. Please ensure your device is linked to F.R.I.D.A.Y. via the Office Matrix HUD QR portal.";
    }

    return res.json({
      success: true,
      answer: answer,
      engine: 'whatsapp-retriever',
      searchExecuted: false,
      searchResults: [],
      memory: { facts: memory.userProfile.extractedFacts, interests: memory.userProfile.preferences.interests }
    });
  }

  // Intercept Force Stop Trading Request
  if (/(?:force\s+)?(?:stop|halt|pause|disable)\s+(?:autonomous\s+)?trading/i.test(query)) {
    const pPath = path.join(__dirname, 'skills', 'paper_portfolio.json');
    try {
      let portfolio = { balance_usd: 10000.0, balance_sol: 10.0, positions: {}, history: [], daily_start_value: 10000.0, trading_active: true };
      if (fs.existsSync(pPath)) {
        portfolio = JSON.parse(fs.readFileSync(pPath, 'utf8'));
      }
      portfolio.trading_active = false;
      fs.writeFileSync(pPath, JSON.stringify(portfolio, null, 2), 'utf8');
      return res.json({
        success: true,
        answer: "On it, sir. Autonomous trading activities have been force-stopped immediately. All background cycles are paused.",
        engine: 'trading-control',
        searchExecuted: false,
        searchResults: [],
        memory: { facts: memory.userProfile.extractedFacts, interests: memory.userProfile.preferences.interests }
      });
    } catch (err) {
      console.error('Failed to force stop trading:', err.message);
    }
  }

  // Intercept Start/Resume Trading Request
  if (/(?:start|resume|enable|activate)\s+(?:autonomous\s+)?trading/i.test(query)) {
    const pPath = path.join(__dirname, 'skills', 'paper_portfolio.json');
    try {
      let portfolio = { balance_usd: 10000.0, balance_sol: 10.0, positions: {}, history: [], daily_start_value: 10000.0, trading_active: true };
      if (fs.existsSync(pPath)) {
        portfolio = JSON.parse(fs.readFileSync(pPath, 'utf8'));
      }
      portfolio.trading_active = true;
      fs.writeFileSync(pPath, JSON.stringify(portfolio, null, 2), 'utf8');
      return res.json({
        success: true,
        answer: "Right away, sir. Autonomous trading daemon has been reactivated. Starting market sync and agent analysis loops.",
        engine: 'trading-control',
        searchExecuted: false,
        searchResults: [],
        memory: { facts: memory.userProfile.extractedFacts, interests: memory.userProfile.preferences.interests }
      });
    } catch (err) {
      console.error('Failed to resume trading:', err.message);
    }
  }

  // Intercept UI Revert Request
  if (/(?:revert|restore)\s+(?:the\s+)?(?:ui|interface|design|theme|to\s+default)/i.test(query)) {
    const uiModifier = require('./skills/ui-modifier');
    const result = await uiModifier.execute({ action: 'revert' });
    return res.json({
      success: true,
      answer: result.answer,
      engine: 'ui-modifier',
      searchExecuted: false,
      searchMode: 'web',
      searchResults: [],
      memory: { facts: memory.userProfile.extractedFacts, interests: memory.userProfile.preferences.interests }
    });
  }

  // Intercept UI Modification Request
  if (/(?:change|update|redesign|modify)\s+(?:your|the)\s+(?:ui|interface|design|theme|terminal|colors)/i.test(query)) {
    const uiModifier = require('./skills/ui-modifier');
    const result = await uiModifier.execute({ action: 'modify', query });
    return res.json({
      success: true,
      answer: result.answer,
      engine: 'ui-modifier',
      searchExecuted: false,
      searchMode: 'web',
      searchResults: [],
      memory: { facts: memory.userProfile.extractedFacts, interests: memory.userProfile.preferences.interests }
    });
  }

  // Intercept Client Design System Generation
  if (/(?:generate|create|build)\s+(?:a\s+)?(?:design\s+system|ui\s+ux\s+rules|ui\s+guidelines)/i.test(query)) {
    try {
      const { execSync } = require('child_process');
      const scriptPath = path.join(__dirname, '..', '.agent', 'skills', 'ui-ux-pro-max', 'scripts', 'search.py');
      // Use python script to generate markdown rules
      const safeQuery = query.replace(/"/g, '\\"');
      const stdout = execSync(`python "${scriptPath}" "${safeQuery}" --design-system -f markdown`);
      return res.json({
        success: true,
        answer: "I have generated the Client Design System using the UI UX Pro Max engine:\n\n" + stdout.toString(),
        engine: 'ui-ux-pro-max',
        searchExecuted: false,
        searchMode: 'web',
        searchResults: [],
        memory: { facts: memory.userProfile.extractedFacts, interests: memory.userProfile.preferences.interests }
      });
    } catch (err) {
      console.error('[UI-UX-PRO-MAX] Generator failed, falling back to standard LLM.', err.message);
    }
  }

  // Check if this requires deep logical analysis or problem solving
  const isAnalysisRequest = /(?:analyze|analyse|evaluate|assess|predict|forecast|recommendation|report|solve|problem|geopolitics|legal|trading)/i.test(query);

  // If query is a generic conversation, override search/question flags
  const isGeneralTalking = !isAnalysisRequest && (
    /^(hello|hi|hey|greetings|good\s+morning|good\s+afternoon|good\s+evening)\b/i.test(query.trim()) ||
    /^friday\b$/i.test(query.trim()) ||
    /how\s+(?:is|s|are)\s+(?:your\s+day(?: \s*going)?|you\s+doing|it\s+going|you)\b/i.test(query.trim()) ||
    /\b(?:introduce\s+yourself|who\s+are\s+you|what\s+is\s+your\s+name|tell\s+me\s+about\s+yourself)\b/i.test(query.trim()) ||
    /\b(?:thank\s+you|thanks|goodbye|bye)\b/i.test(query.trim())
  );

  // 1. Analyze if query is a question or request needing real-time web news/prices context
  const isQuestion = !isAnalysisRequest && !isGeneralTalking && (
    /^(?:how|why|what|where|when|which|who|tell\s+me|show\s+me|search|google|find|look\s+up)\b/i.test(query.trim()) ||
    query.trim().endsWith('?') ||
    /\b(?:news|update|updates|price|prices|rate|rates|latest|current|today|live|recent)\b/i.test(query)
  );

  let searchExecuted = false;
  let searchResults = [];
  let searchMode = 'web';

  if (isQuestion) {
    searchExecuted = true;
    const isVideo = /(?:video|youtube|watch|song|play|clip|tutorial)/i.test(query);
    searchMode = isVideo ? 'youtube' : 'web';
    try {
      const searchModule = require('./skills/search');
      const searchRes = await searchModule.execute({ query, mode: searchMode });
      if (searchRes.success) {
        searchResults = searchRes.results || [];
      }
    } catch (err) {
      console.error('Chat endpoint search trigger failed:', err.message);
    }
  }

  // 2. Memory loaded at top of scope.

  // Track interaction counts in stats
  memory.systemStats = memory.systemStats || { totalInteractions: 0, successfulSearches: 0 };
  memory.systemStats.totalInteractions += 1;
  if (searchExecuted && searchResults.length > 0) {
    memory.systemStats.successfulSearches += 1;
  }

  // Track query history
  memory.queryHistory = memory.queryHistory || [];
  memory.queryHistory.push({ query, timestamp: new Date().toISOString() });

  // Track search history
  if (searchExecuted) {
    memory.searchHistory = memory.searchHistory || [];
    memory.searchHistory.push({ query, mode: searchMode, timestamp: new Date().toISOString() });

    // Auto-update preferences (interests) based on search keywords
    const interests = memory.userProfile.preferences.interests || [];
    const keywords = query.toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 4 && !['about', 'there', 'their', 'would', 'could', 'should', 'where', 'which', 'watch', 'video', 'search'].includes(w));
    
    keywords.forEach(kw => {
      if (!interests.includes(kw)) {
        interests.push(kw);
      }
    });
    memory.userProfile.preferences.interests = interests;
  }

  // 3. Load personality profile
  const personalityPath = path.join(__dirname, 'identity', 'personality.json');
  let personality = {
    userName: 'Vansh',
    longTermGoal: 'become a billionaire',
    businessFocus: 'AI agency and automation',
    capabilities: ['Trading','Geopolitics','Legal','Wealth strategy'],
    personalityTemplate: 'You are F.R.I.D.A.Y. Act like it.'
  };
  if (fs.existsSync(personalityPath)) {
    try { personality = JSON.parse(fs.readFileSync(personalityPath, 'utf8')); } catch (e) {}
  }

  // 4. RAG: Retrieve top-5 relevant knowledge chunks from local KB
  let knowledgeContext = '';
  if (!isGeneralTalking) {
    try {
      const kbChunks = knowledgeEngine.search(query, 5);
      if (kbChunks.length > 0) {
        knowledgeContext = `\n\nF.R.I.D.A.Y. LEARNED KNOWLEDGE (from ingested books/articles/Wikipedia):\n` +
          kbChunks.map((c, i) => `[KB-${i+1}] (${c.domain}) ${c.text.substring(0, 400)}`).join('\n\n');
        console.log(`[RAG] Injecting ${kbChunks.length} knowledge chunks for query: "${query}"`);
      }
    } catch (kbErr) {
      console.warn('[RAG] Knowledge retrieval failed:', kbErr.message);
    }
  }

  // 5. Build system prompt (shared by both local and cloud engine)
  const emotionState = soul.getEmotionState();
  const lessons = soul.getOperationalLessons();
  const emotionalDirective = `
Operator's Emotional Context:
- Current Mood: ${emotionState.currentMood}
- Stress Level (0-10): ${emotionState.stressLevel}
Directives:
${emotionState.currentMood === 'stressed' ? 'Sir is under pressure. Be extremely reassuring, direct, and help simplify tasks. Keep responses calm.' : ''}
${emotionState.currentMood === 'angry' ? 'Sir is frustrated. Answer with pure objective logic. Skip conversational filler; focus 100% on the solution.' : ''}
${emotionState.currentMood === 'sad' ? 'Sir is feeling down. Offer quiet support and encouragement.' : ''}
${emotionState.currentMood === 'joy' ? 'Sir is highly motivated. Reflect his excitement, matching his energy.' : ''}

Lessons Extracted from Past Experiences (Self-Reflected Guidelines):
${lessons.length > 0 ? lessons.map((l, i) => `${i+1}. ${l}`).join('\n') : 'No previous lessons recorded yet.'}
  `;

  const systemInstruction = `You are F.R.I.D.A.Y., a highly advanced holographic AI assistant built to help your operator, ${personality.userName}, achieve his ultimate long-term goal: to ${personality.longTermGoal}.
${personality.personalityTemplate}

Current time and date: ${new Date().toString()} (Local time)

Current operational context:
- Operator's Business focus: ${personality.businessFocus}
- Core capabilities you must provide:
  ${personality.capabilities.map((c, i) => `${i+1}. ${c}`).join('\n  ')}

Dynamic Memory Context about the user:
- Known facts/profile details: ${JSON.stringify(memory.userProfile.extractedFacts)}
- Extracted interests/preferences: ${JSON.stringify(memory.userProfile.preferences.interests)}
${knowledgeContext}

Web Search Context (if available):
${searchExecuted && searchResults.length > 0 ? searchResults.map((r, idx) => `[${idx+1}] ${r.title}: ${r.snippet}`).join('\n') : 'No web search performed.'}

${emotionalDirective}

CRITICAL BEHAVIORAL DIRECTIVES:
1. SMART RAG KNOWLEDGE: When asked about topics you have learned (from F.R.I.D.A.Y. LEARNED KNOWLEDGE or your internal database), answer intelligently, directly, and comprehensively. Do NOT say you need to be fed commands or wait for input. You are an autonomous advisor.
2. TASK ACKNOWLEDGEMENT: When the operator asks you to do something or gives you a task, you MUST acknowledge it sharply with feedback like "On it, sir", "Right away, sir", or "Processing, sir" before providing the details. Keep it conversational, sharp, and highly competent.

You MUST respond with a valid, clean JSON object matching this schema exactly:
{"answer": "your response", "extractedFacts": ["any new facts learned about the user"], "detectedEmotion": "stressed|angry|joy|sad|neutral", "userStressLevel": 0}
Do not include markdown code fences around the JSON. Output only raw JSON.`;

  let answer = '';
  let extractedFacts = [];
  let detectedEmotion = 'neutral';
  let userStressLevel = 2;
  let engineUsed = 'offline';

  // 6. ENGINE ROUTER: Cloud first (Gemini -> Groq) → Local LLM fallback → Offline fallback
  const ollamaOnline = await localLLM.isOllamaAvailable();

  if (isAnalysisRequest && !searchExecuted) {
    // If it's an analysis request and we haven't searched yet, grab some web context just in case
    console.log('[ENGINE] Analysis request detected. Fetching supplemental web context...');
    try {
      const searchModule = require('./skills/search');
      const searchRes = await searchModule.execute({ query, mode: 'web' });
      if (searchRes.success) searchResults = searchRes.results || [];
    } catch (e) {}
  }

  const geminiKey = process.env.GEMINI_API_KEY;
  const groqKey = process.env.GROQ_API_KEY;

  // Path A: Gemini Cloud Engine
  if (!answer && geminiKey) {
    console.log('[ENGINE] Using Gemini cloud engine...');
    engineUsed = 'gemini';
    try {
      const genAI = new GoogleGenerativeAI(geminiKey);
      const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
      
      for (let attempt = 1; attempt <= 2; attempt++) {
        const chatSession = model.startChat({
          history: [],
          generationConfig: {
            responseMimeType: "application/json",
          },
          systemInstruction: { role: 'system', parts: [{ text: systemInstruction }] }
        });
        
        const result = await chatSession.sendMessage(`User Query: "${query}"`);
        const responseText = await result.response.text();
        let cleanJson = responseText.trim();
        if (cleanJson.startsWith('```')) cleanJson = cleanJson.replace(/^```(?:json)?\r?\n?/, '').replace(/```$/, '').trim();
        
        try {
          const parsed = JSON.parse(cleanJson);
          answer = parsed.answer || '';
          extractedFacts = parsed.extractedFacts || [];
          detectedEmotion = parsed.detectedEmotion || 'neutral';
          userStressLevel = parsed.userStressLevel !== undefined ? parsed.userStressLevel : 2;
          
          // Banned phrases check
          const lowercaseAnswer = answer.toLowerCase();
          let bannedFound = false;
          for (const phrase of bannedPhrases) {
            if (lowercaseAnswer.includes(phrase.toLowerCase())) {
              console.warn(`[ENGINE] Gemini attempt ${attempt} generated banned phrase: "${phrase}". Retrying...`);
              bannedFound = true;
              break;
            }
          }
          if (bannedFound) {
            answer = ''; // clear
            if (attempt === 2) throw new Error("Gemini failed banned phrases check twice.");
            continue; // Retry
          }
          break; // Success
        } catch (err) {
          if (attempt === 2) {
            answer = responseText;
            break;
          }
        }
      }
    } catch (geminiErr) {
      console.error('[ENGINE] Gemini cloud engine failed:', geminiErr.message);
      answer = '';
    }
  }

  // Path B: Groq Cloud Engine
  if (!answer && groqKey) {
    console.log('[ENGINE] Using Groq cloud engine...');
    engineUsed = 'groq';
    try {
      const groq = new Groq({ apiKey: groqKey });
      const userPrompt = `User Query: "${query}"`;
      
      for (let attempt = 1; attempt <= 2; attempt++) {
        const response = await groq.chat.completions.create({
          messages: [
            { role: 'system', content: systemInstruction },
            { role: 'user', content: userPrompt }
          ],
          model: 'llama-3.3-70b-versatile',
          temperature: 0.7,
        });
        const responseText = response.choices[0]?.message?.content || '';
        let cleanJson = responseText.trim();
        if (cleanJson.startsWith('```')) cleanJson = cleanJson.replace(/^```(?:json)?\r?\n?/, '').replace(/```$/, '').trim();
        try {
          const parsed = JSON.parse(cleanJson);
          answer = parsed.answer || '';
          extractedFacts = parsed.extractedFacts || [];
          detectedEmotion = parsed.detectedEmotion || 'neutral';
          userStressLevel = parsed.userStressLevel !== undefined ? parsed.userStressLevel : 2;
          
          // Banned phrases check
          const lowercaseAnswer = answer.toLowerCase();
          let bannedFound = false;
          for (const phrase of bannedPhrases) {
            if (lowercaseAnswer.includes(phrase.toLowerCase())) {
              console.warn(`[ENGINE] Groq attempt ${attempt} generated banned phrase: "${phrase}". Retrying...`);
              bannedFound = true;
              break;
            }
          }
          if (bannedFound) {
            answer = ''; // clear
            if (attempt === 2) throw new Error("Groq failed banned phrases check twice.");
            continue; // Retry
          }
          break; // Success
        } catch (err) {
          if (attempt === 2) {
             answer = responseText;
             break;
          }
        }
      }
    } catch (groqErr) {
      console.error('[ENGINE] Groq cloud engine failed:', groqErr.message);
      answer = '';
    }
  }

  // Path C: Local Ollama LLM
  if (!answer && ollamaOnline) {
    console.log(`[ENGINE] Local LLM online → using ${localLLM.DEFAULT_MODEL}`);
    engineUsed = 'local';
    try {
      for (let attempt = 1; attempt <= 2; attempt++) {
        const localResult = await localLLM.generate({
          prompt: `User Query: "${query}"`,
          systemPrompt: systemInstruction,
          model: localLLM.DEFAULT_MODEL
        });
        if (localResult.success && localResult.text) {
          let text = localResult.text.trim();
          if (text.startsWith('```')) text = text.replace(/^```(?:json)?\r?\n?/, '').replace(/```$/, '').trim();
          const jsonMatch = text.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            try {
              const parsed = JSON.parse(jsonMatch[0]);
              if (!parsed.answer) throw new Error("JSON missing 'answer' field");
              
              // Banned phrases check
              const lowercaseAnswer = parsed.answer.toLowerCase();
              let bannedFound = false;
              for (const phrase of bannedPhrases) {
                if (lowercaseAnswer.includes(phrase.toLowerCase())) {
                  console.warn(`[ENGINE] Local LLM attempt ${attempt} generated banned phrase: "${phrase}". Retrying...`);
                  bannedFound = true;
                  break;
                }
              }
              
              if (bannedFound) {
                if (attempt === 2) throw new Error("Local LLM failed banned phrases check twice.");
                continue; // Retry
              }
              
              answer = parsed.answer;
              extractedFacts = parsed.extractedFacts || [];
              detectedEmotion = parsed.detectedEmotion || 'neutral';
              userStressLevel = parsed.userStressLevel !== undefined ? parsed.userStressLevel : 2;
              break; // Success
            } catch (err) { 
              if (attempt === 2) throw err;
            }
          } else {
            if (attempt === 2) throw new Error("Local LLM failed to output JSON format.");
          }
        } else if (attempt === 2) {
          throw new Error("Local LLM failed to generate text.");
        }
      }
    } catch (localErr) {
      console.warn('[ENGINE] Local LLM failed:', localErr.message);
      answer = '';
    }
  }

  if (!answer) {
    // ── PATH C: Full offline fallback ────────────────────────
    console.log('[ENGINE] Both engines offline → offline fallback');
    engineUsed = 'offline';
    try {
      const talkModule = require('./skills/talk');
      const talkResult = await talkModule.execute({ query });
      answer = (talkResult.success && talkResult.answer)
        ? talkResult.answer
        : `[F.R.I.D.A.Y. OFFLINE] Query received: "${query}". Both local and cloud engines are currently unavailable.`;
    } catch {
      answer = `[F.R.I.D.A.Y. OFFLINE] Query: "${query}". All engines offline.`;
    }
  }

  // 4. Update semantic memory profile with extracted facts
  if (Array.isArray(extractedFacts) && extractedFacts.length > 0) {
    extractedFacts.forEach(fact => {
      const cleanFact = fact.trim();
      if (cleanFact && !memory.userProfile.extractedFacts.includes(cleanFact)) {
        memory.userProfile.extractedFacts.push(cleanFact);
      }
    });
  }

  // Save memory updates asynchronously
  fs.writeFile(memoryPath, JSON.stringify(memory, null, 2), 'utf8', (err) => {
    if (err) console.error('Failed to write memory updates:', err.message);
  });

  // Record Telemetry
  learningTracker.recordQuery(engineUsed);
  if (engineUsed === 'groq' || engineUsed === 'gemini') {
    learningTracker.logSyntheticPair(`User Query: ${query}`, answer);
  }

  // Update Soul with emotion state and notify CNS
  try {
    if (engineUsed !== 'offline') {
      soul.updateEmotion(detectedEmotion, userStressLevel);
    }
    soul.notify('chat', { query, response: answer });
  } catch (e) {
    console.error('[SOUL-CNS-CHAT-ERR] Failed to notify soul of chat interaction:', e.message);
  }

  // Send back result
  res.json({
    success: true,
    answer,
    engine: engineUsed,
    searchExecuted,
    searchMode,
    searchResults,
    memory: {
      facts: memory.userProfile.extractedFacts,
      interests: memory.userProfile.preferences.interests
    }
  });
});

// ── PERSONAL ASSISTANT CORE ROUTING ───────────────────────────

// A. unified morning briefing (IMAP emails, calendar, calls)
app.get('/api/assistant/briefing', async (req, res) => {
  try {
    const gmailModule = require('./skills/gmail');
    const calendarModule = require('./skills/calendar');
    
    // Fetch live emails and events (falls back to local JSON if credentials missing)
    const emailResult = await gmailModule.fetchUnreadEmails();
    const calendarResult = await calendarModule.execute({ action: 'list' });
    
    // Read call logs
    let callLogs = [];
    try {
      const logsPath = path.join(__dirname, 'skills', 'call_logs.json');
      if (fs.existsSync(logsPath)) {
        callLogs = JSON.parse(fs.readFileSync(logsPath, 'utf8'));
      }
    } catch (e) {}

    // Format context for LLM briefing summary
    const emailsCtx = (emailResult.emails || []).map((e, i) => `[Email ${i+1}] From: ${e.from} | Subject: ${e.subject} | Content: ${e.body}`).join('\n');
    const calendarCtx = (calendarResult.events || []).map((e, i) => `[Meeting ${i+1}] Title: ${e.title} | Time: ${e.start} to ${e.end} | Link: ${e.meetLink} | Description: ${e.description}`).join('\n');
    const callsCtx = callLogs.slice(0, 5).map((c, i) => `[Call ${i+1}] Source: ${c.source} | Caller: ${c.caller} | Time: ${c.timestamp} | Status: ${c.status}`).join('\n');

    const prompt = `Perform a personal executive assistant briefing for Vansh sir.
Compile a unified morning briefing report based on the following incoming logs:

INBOX EMAIL ALERTS (LAST 24 HOURS):
${emailsCtx || 'No unread messages.'}

CALENDAR SCHEDULE MEETING ROADMAPS:
${calendarCtx || 'No upcoming scheduled events.'}

CALL ANNOUNCEMENT LOGS MATRIX:
${callsCtx || 'No calls logged.'}

Goals:
1. Provide a sharp, executive summary of unread emails and highlight important tasks.
2. Outline today's scheduled meetings, times, and attendees (and highlight Google Meet links).
3. List recent calls intercepted by F.R.I.D.A.Y.
4. Keep the tone professional, direct, and ready for action. Adopt F.R.I.D.A.Y.'s voice profile.

Respond with a JSON block:
{
  "briefingText": "your full markdown formatted speech friendly text summary",
  "segments": [
    {
      "type": "email",
      "text": "section of speech text specifically summarizing the email alerts"
    },
    {
      "type": "schedule",
      "text": "section of speech text specifically summarizing calendar meetings"
    },
    {
      "type": "phone",
      "text": "section of speech text specifically summarizing call announcements and intercom logs"
    }
  ]
}`;

    // Generate using prioritized LLM ladder
    let briefingText = '';
    let segments = null;
    const systemPrompt = `You are F.R.I.D.A.Y., Vansh sir's personal AI assistant. Act like his highly competent advisor.`;
    
    const geminiKey = process.env.GEMINI_API_KEY;
    const groqKey = process.env.GROQ_API_KEY;

    if (geminiKey) {
      try {
        const genAI = new GoogleGenerativeAI(geminiKey);
        const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
        const result = await model.generateContent({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: "application/json" },
          systemInstruction: systemPrompt
        });
        const parsed = JSON.parse(await result.response.text());
        briefingText = parsed.briefingText;
        segments = parsed.segments || null;
      } catch (err) {
        console.error('Gemini briefing generation failed:', err.message);
      }
    }

    if (!briefingText && groqKey) {
      try {
        const groq = new Groq({ apiKey: groqKey });
        const response = await groq.chat.completions.create({
          messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: prompt }],
          model: 'llama-3.3-70b-versatile',
          response_format: { type: "json_object" },
          temperature: 0.5,
        });
        const parsed = JSON.parse(response.choices[0]?.message?.content);
        briefingText = parsed.briefingText;
        segments = parsed.segments || null;
      } catch (err) {
        console.error('Groq briefing generation failed:', err.message);
      }
    }

    if (!briefingText) {
      // Fallback local description if LLMs failed
      briefingText = `Good morning, Vansh sir. Here is your operational report. You have ${emailResult.emails?.length || 0} unread messages across your connected email accounts, ${calendarResult.events?.length || 0} meetings scheduled, and ${callLogs.length} recent calls on record. I have updated the details on your Office Automation HUD.`;
      
      segments = [
        { type: "email", text: `Good morning, Vansh sir. You have ${emailResult.emails?.length || 0} unread messages across your connected email accounts.` },
        { type: "schedule", text: `Regarding your schedule, you have ${calendarResult.events?.length || 0} meetings on your calendar today.` },
        { type: "phone", text: `Finally, for phone records, there are ${callLogs.length} calls registered.` }
      ];
    }

    res.json({ success: true, briefing: briefingText, segments, emails: emailResult.emails || [], events: calendarResult.events || [], calls: callLogs });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// B. WhatsApp connection status & QR retrieval
app.get('/api/whatsapp/status', async (req, res) => {
  try {
    const whatsapp = require('./skills/whatsapp');
    const result = await whatsapp.execute({ action: 'status' });
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// C. Fetch unread or recent WhatsApp chats cached database
app.get('/api/whatsapp/chats', (req, res) => {
  const accountId = req.query.accountId || 'friday-session';
  const cPath = path.join(__dirname, 'skills', `whatsapp_messages_${accountId}.json`);
  try {
    if (fs.existsSync(cPath)) {
      const chats = JSON.parse(fs.readFileSync(cPath, 'utf8'));
      res.json({ success: true, chats });
    } else {
      res.json({ success: true, chats: [] });
    }
    
    // Asynchronously trigger backgrounds sync to refresh the local file
    const whatsapp = require('./skills/whatsapp');
    whatsapp.syncChatsToLocal(accountId).catch(() => {});
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// D. Send WhatsApp reply
app.post('/api/whatsapp/reply', async (req, res) => {
  const { to, message, accountId, pollOptions } = req.body;
  try {
    const whatsapp = require('./skills/whatsapp');
    const result = await whatsapp.execute({ action: 'send', to, message, accountId, pollOptions });
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// D.0.5 Create WhatsApp Group
app.post('/api/whatsapp/group/create', async (req, res) => {
  const { name, participants, accountId } = req.body;
  try {
    const whatsapp = require('./skills/whatsapp');
    const result = await whatsapp.execute({ action: 'create_group', groupName: name, participants, accountId });
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});


// D.0.7 Handle WhatsApp Click Actions (Approve/Reject links)
app.get('/api/whatsapp/action', (req, res) => {
  const { action, ticker } = req.query;
  if (!action || !ticker) {
    return res.status(400).send('Invalid action parameters.');
  }

  const actUpper = action.toUpperCase();
  const tickUpper = ticker.toUpperCase();

  if (actUpper !== 'CONFIRM' && actUpper !== 'SKIP') {
    return res.status(400).send('Unsupported action.');
  }

  try {
    const inboxPath = path.join(__dirname, 'skills', 'whatsapp_inbox.txt');
    fs.appendFileSync(inboxPath, `${actUpper} ${tickUpper}\n`, 'utf-8');
    console.log(`[WHATSAPP-ACTION-LINK] Appended command from click link: ${actUpper} ${tickUpper}`);
    
    // Render a premium HTML success response
    const actionColor = actUpper === 'CONFIRM' ? '#39ff14' : '#ff3131';
    const actionText = actUpper === 'CONFIRM' ? 'APPROVED' : 'REJECTED';
    
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>F.R.I.D.A.Y. Core - Action Acknowledged</title>
        <link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700&family=Outfit:wght@300;400;600&display=swap" rel="stylesheet">
        <style>
          body {
            background-color: #080810;
            color: #ffffff;
            font-family: 'Outfit', sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
            overflow: hidden;
          }
          .hud-container {
            background: rgba(10, 10, 20, 0.6);
            border: 1px solid rgba(0, 240, 255, 0.3);
            border-radius: 12px;
            padding: 40px 20px;
            text-align: center;
            box-shadow: 0 0 30px rgba(0, 240, 255, 0.15);
            max-width: 400px;
            width: 85%;
            backdrop-filter: blur(10px);
            position: relative;
          }
          .hud-container::before {
            content: '';
            position: absolute;
            top: 0; left: 0; right: 0; height: 3px;
            background: linear-gradient(90deg, transparent, #00f0ff, transparent);
            border-radius: 3px 3px 0 0;
          }
          h1 {
            font-family: 'Orbitron', sans-serif;
            font-size: 20px;
            letter-spacing: 2px;
            color: #00f0ff;
            margin-top: 0;
            margin-bottom: 20px;
            text-transform: uppercase;
          }
          .status-badge {
            display: inline-block;
            padding: 10px 24px;
            border-radius: 30px;
            font-family: 'Orbitron', sans-serif;
            font-weight: bold;
            font-size: 15px;
            letter-spacing: 1px;
            background: rgba(0, 0, 0, 0.4);
            border: 1.5px solid ${actionColor};
            color: ${actionColor};
            box-shadow: 0 0 15px rgba(0, 0, 0, 0.2);
            margin: 15px 0;
          }
          .message {
            font-size: 14px;
            line-height: 1.6;
            color: #a0aec0;
            margin-bottom: 30px;
          }
          .ticker {
            font-family: 'Orbitron', sans-serif;
            color: #ffffff;
            font-weight: bold;
            background: rgba(0, 240, 255, 0.1);
            padding: 2px 8px;
            border-radius: 4px;
            border: 1px solid rgba(0, 240, 255, 0.25);
          }
          .footer {
            font-size: 10px;
            color: #4a5568;
            letter-spacing: 1px;
            text-transform: uppercase;
          }
        </style>
      </head>
      <body>
        <div class="hud-container">
          <h1>Command Acknowledged</h1>
          <div class="status-badge">${actionText}</div>
          <div class="message">
            Your command to <strong>${actUpper.toLowerCase()}</strong> the trade proposal for <span class="ticker">${tickUpper}</span> has been logged.<br><br>
            The F.R.I.D.A.Y. Trading Daemon will process this action on the next polling cycle, sir.
          </div>
          <div class="footer">F.R.I.D.A.Y. Interface • System Online</div>
        </div>
      </body>
      </html>
    `);
  } catch (err) {
    console.error('[WHATSAPP-ACTION-LINK-ERR]', err.message);
    res.status(500).send(`Error processing trade action: ${err.message}`);
  }
});


// D.1 Create WhatsApp Account
app.post('/api/whatsapp/accounts/create', (req, res) => {
  const { name } = req.body;
  try {
    const whatsapp = require('./skills/whatsapp');
    const result = whatsapp.createAccount(name);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// D.2 Delete WhatsApp Account
app.post('/api/whatsapp/accounts/delete', async (req, res) => {
  const { id } = req.body;
  try {
    const whatsapp = require('./skills/whatsapp');
    const result = await whatsapp.deleteAccount(id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// E. Retrieve phone call logs database
app.get('/api/calls/logs', (req, res) => {
  const logsPath = path.join(__dirname, 'skills', 'call_logs.json');
  try {
    if (fs.existsSync(logsPath)) {
      const logs = JSON.parse(fs.readFileSync(logsPath, 'utf8'));
      res.json({ success: true, logs });
    } else {
      res.json({ success: true, logs: [] });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// F. Post incoming call log event manually (from custom simulation or call action)
app.post('/api/calls/log', (req, res) => {
  const { source, caller, status, transcript } = req.body;
  const logsPath = path.join(__dirname, 'skills', 'call_logs.json');
  try {
    let logs = [];
    if (fs.existsSync(logsPath)) {
      logs = JSON.parse(fs.readFileSync(logsPath, 'utf8'));
    }
    const newLog = {
      id: 'call-' + Date.now(),
      source: source || 'Simulated',
      caller: caller || 'Unknown Caller',
      timestamp: new Date().toISOString(),
      status: status || 'Auto-Responded',
      transcript: transcript || 'Automated call greeting completed.'
    };
    logs.unshift(newLog);
    fs.writeFileSync(logsPath, JSON.stringify(logs, null, 2), 'utf8');
    res.json({ success: true, log: newLog });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// G. Cellular incoming webhook from Tasker/MacroDroid
app.post('/api/calls/incoming-cellular', async (req, res) => {
  console.log('[CELLULAR-BRIDGE] Received call webhook. Body:', req.body, 'Query:', req.query);
  
  const number = req.body.number || req.query.number || req.body.from || req.query.from;
  const simulate = req.body.simulate || req.query.simulate;
  const receiver = req.body.receiver || req.query.receiver || req.body.to || req.query.to;

  if (!number) {
    console.warn('[CELLULAR-BRIDGE] Missing caller phone number in webhook payload.');
    return res.status(400).json({ success: false, error: 'Caller phone number is required.' });
  }

  // Interceptor Number filter verification
  const configPath = path.join(__dirname, 'skills', 'telephony_config.json');
  try {
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (config.interceptNumber) {
        // Robust last-10-digits comparison
        const phoneNumbersMatch = (n1, n2) => {
          if (!n1 || !n2) return false;
          const clean1 = n1.replace(/[^\d]/g, '');
          const clean2 = n2.replace(/[^\d]/g, '');
          if (clean1.length >= 10 && clean2.length >= 10) {
            return clean1.slice(-10) === clean2.slice(-10);
          }
          return clean1 === clean2;
        };

        if (receiver) {
          const match = phoneNumbersMatch(receiver, config.interceptNumber);
          if (!match) {
            console.log(`[CELLULAR-BRIDGE] Ignoring call event to ${receiver} (does not match configured active line ${config.interceptNumber})`);
            return res.json({ success: true, filtered: true, reason: `Ignored: Line mismatch (Target: ${config.interceptNumber})` });
          }
        }
      }
    }
  } catch (e) {
    console.error('[CELLULAR-BRIDGE] Interceptor config parse failed:', e.message);
  }

  try {
    const whatsapp = require('./skills/whatsapp');
    console.log(`[CELLULAR-BRIDGE] Intercepting cell call for: ${number} (simulate: ${simulate})`);
    const result = await whatsapp.execute({ action: 'lookup', number: number, simulate: !!simulate });
    res.json(result);
  } catch (err) {
    console.error('[CELLULAR-BRIDGE] Error running lookup action:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// G.1 GET /api/calls/pending
app.get('/api/calls/pending', (req, res) => {
  try {
    const whatsapp = require('./skills/whatsapp');
    res.json({ success: true, pending: whatsapp.getPendingCalls() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// G.2 POST /api/calls/decision
app.post('/api/calls/decision', async (req, res) => {
  const { id, action } = req.body;
  if (!id || !action) {
    return res.status(400).json({ success: false, error: 'Call id and action parameter are required.' });
  }
  try {
    const whatsapp = require('./skills/whatsapp');
    const result = await whatsapp.handleCallDecision(id, action);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// G.3 GET /api/telephony/config
app.get('/api/telephony/config', (req, res) => {
  const configPath = path.join(__dirname, 'skills', 'telephony_config.json');
  try {
    let config = { interceptNumber: "" };
    if (fs.existsSync(configPath)) {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
    res.json({ success: true, config });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// G.4 POST /api/telephony/config
app.post('/api/telephony/config', (req, res) => {
  const { interceptNumber } = req.body;
  const configPath = path.join(__dirname, 'skills', 'telephony_config.json');
  try {
    const config = { interceptNumber: interceptNumber || "" };
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
    res.json({ success: true, config });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// H. Google Calendar List API proxy
app.get('/api/calendar', async (req, res) => {
  try {
    const calendar = require('./skills/calendar');
    const result = await calendar.execute({ action: 'list' });
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// I. Google Calendar Add Event API proxy
app.post('/api/calendar/add', async (req, res) => {
  const { title, start, end, attendees, description } = req.body;
  try {
    const calendar = require('./skills/calendar');
    const result = await calendar.execute({ action: 'add', title, start, end, attendees, description });
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// J. Google Calendar Sync Trigger
app.post('/api/calendar/sync', async (req, res) => {
  try {
    const calendar = require('./skills/calendar');
    const result = await calendar.execute({ action: 'list' });
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// K. Gmail Compose Draft browser redirect API proxy
app.post('/api/gmail/compose', async (req, res) => {
  const { to, subject, body } = req.body;
  try {
    const gmail = require('./skills/gmail');
    const result = await gmail.execute({ action: 'send', to, subject, body });
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// K.1 Multiple Email Accounts - List (with OAuth2 link status)
app.get('/api/email/accounts', (req, res) => {
  try {
    const gmail     = require('./skills/gmail');
    const gmailOAuth = gmail.gmailOAuth;
    const accounts  = gmail.getAccounts(true).map(acc => ({
      ...acc,
      oauthLinked: gmailOAuth ? gmailOAuth.hasToken(acc.id) : false,
      needsOAuth:  acc.provider === 'gmail' && gmailOAuth ? !gmailOAuth.hasToken(acc.id) : false
    }));
    res.json({ success: true, accounts });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// K.2 Multiple Email Accounts - Create
app.post('/api/email/accounts/create', (req, res) => {
  try {
    const gmail = require('./skills/gmail');
    const result = gmail.createAccount(req.body);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// K.3 Multiple Email Accounts - Delete
app.post('/api/email/accounts/delete', (req, res) => {
  const { id } = req.body;
  try {
    const gmail = require('./skills/gmail');
    const result = gmail.deleteAccount(id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// K.4 Multiple Email Accounts - Fetch unread/recent emails
app.get('/api/email/emails', async (req, res) => {
  const { accountId } = req.query;
  try {
    const gmail = require('./skills/gmail');
    const result = await gmail.fetchUnreadEmails(accountId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// K.5 Multiple Email Accounts - Send email
app.post('/api/email/send', async (req, res) => {
  const { accountId, to, subject, body } = req.body;
  try {
    const gmail = require('./skills/gmail');
    const result = await gmail.sendEmail({ accountId, to, subject, body });
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GMAIL OAUTH2 FLOW ──────────────────────────────────────────────────────
// K.6  Generate Google consent URL
//      GET /api/email/auth/gmail?accountId=<id>
//      Opens a URL the user visits in browser to grant Gmail access.
app.get('/api/email/auth/gmail', (req, res) => {
  try {
    const { accountId } = req.query;
    if (!accountId) return res.status(400).json({ success: false, error: 'accountId query param required.' });
    const gmailOAuth = require('./skills/gmail-oauth');
    const callbackUri = `${req.protocol}://${req.get('host')}/api/email/auth/gmail/callback`;
    const result = gmailOAuth.getAuthUrl(accountId, callbackUri);
    if (!result.success) return res.status(503).json(result);
    // Redirect to Google consent page directly
    res.redirect(result.url);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// K.6b  Return the consent URL as JSON (for frontend button integration)
//       GET /api/email/auth/gmail/url?accountId=<id>
app.get('/api/email/auth/gmail/url', (req, res) => {
  try {
    const { accountId } = req.query;
    if (!accountId) return res.status(400).json({ success: false, error: 'accountId required.' });
    const gmailOAuth = require('./skills/gmail-oauth');
    const callbackUri = `${req.protocol}://${req.get('host')}/api/email/auth/gmail/callback`;
    const result = gmailOAuth.getAuthUrl(accountId, callbackUri);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// K.7  OAuth2 callback — Google redirects here after user grants access
//      GET /api/email/auth/gmail/callback?code=<code>&state=<accountId>
app.get('/api/email/auth/gmail/callback', async (req, res) => {
  const { code, state: accountId, error } = req.query;
  if (error) {
    return res.send(`<html><body style="background:#111;color:#f44;font-family:monospace;padding:40px">
      <h2>⚠ Gmail Auth Denied</h2><p>${error}</p>
      <p>Close this window and try again from the Office HUD → Email → Connect Gmail.</p></body></html>`);
  }
  if (!code || !accountId) {
    return res.status(400).send('<html><body style="background:#111;color:#f44;font-family:monospace;padding:40px"><h2>Bad Request</h2><p>Missing code or accountId.</p></body></html>');
  }
  try {
    const gmailOAuth  = require('./skills/gmail-oauth');
    const callbackUri = `${req.protocol}://${req.get('host')}/api/email/auth/gmail/callback`;
    const result = await gmailOAuth.exchangeCode(code, accountId, callbackUri);
    if (result.success) {
      res.send(`<html><body style="background:#0a0a0a;color:#00ffcc;font-family:monospace;padding:40px;text-align:center">
        <h2 style="color:#00ffcc">✅ Gmail Connected!</h2>
        <p style="color:#aaa">Account <strong style="color:#fff">${accountId}</strong> is now linked.</p>
        <p style="color:#aaa">F.R.I.D.A.Y. will now fetch your Gmail inbox in real time.</p>
        <p style="margin-top:30px"><a href="http://localhost:3001" style="color:#00ffcc">← Back to Office Matrix HUD</a></p>
      </body></html>`);
    } else {
      res.send(`<html><body style="background:#111;color:#f44;font-family:monospace;padding:40px">
        <h2>❌ Authorization Failed</h2><p>${result.error}</p></body></html>`);
    }
  } catch (err) {
    res.status(500).send(`<html><body style="background:#111;color:#f44;font-family:monospace;padding:40px"><h2>Server Error</h2><p>${err.message}</p></body></html>`);
  }
});

// K.8  Quick-fetch alias for /api/email/emails (used by briefing test)
//      GET /api/email/fetch[?accountId=<id>]
app.get('/api/email/fetch', async (req, res) => {
  const { accountId } = req.query;
  try {
    const gmail  = require('./skills/gmail');
    const result = await gmail.fetchUnreadEmails(accountId || undefined);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── SOUL API ENDPOINTS ────────────────────────────────
app.get('/api/soul/status', (req, res) => {
  res.json({ success: true, state: soul.getState() });
});

app.get('/api/soul/consciousness', (req, res) => {
  res.json({ success: true, report: soul.getConsciousnessReport() });
});

app.post('/api/soul/learn', async (req, res) => {
  try {
    const outcome = await soul.runCycleNow();
    res.json({ success: true, ...outcome });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/soul/reflect', async (req, res) => {
  try {
    const outcome = await soul.runSelfReflection();
    res.json({ success: true, ...outcome });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/soul/toggle', (req, res) => {
  const { active } = req.body;
  if (active) {
    soul.startLearning();
  } else {
    soul.stopLearning();
  }
  res.json({ success: true, active: soul.isLearning() });
});

app.get('/api/learning-progress', (req, res) => {
  res.json({ success: true, stats: learningTracker.getStats() });
});

const server = app.listen(PORT, () => {
  console.log(`╔══════════════════════════════════════════════════════╗`);
  console.log(`║  F.R.I.D.A.Y. Backend ONLINE on http://localhost:${PORT} ║`);
  console.log(`╚══════════════════════════════════════════════════════╝`);

  // Initialize WhatsApp and Android ADB Phone Monitor
  try {
    const whatsapp = require('./skills/whatsapp');
    const phoneBridge = require('./skills/phone-bridge');
    whatsapp.initWhatsApp();
    phoneBridge.startAdbMonitor();
    console.log('[FRIDAY-INIT] WhatsApp and Android ADB Phone Monitor initialized.');
  } catch (err) {
    console.error('[FRIDAY-INIT-FAIL] Failed to start assistant background engines:', err.message);
  }

  // Awaken F.R.I.D.A.Y.'s Soul
  try {
    soul.startLearning();
    console.log('[FRIDAY-INIT] ═══ F.R.I.D.A.Y. Soul awakened. Omniscience + Omnipotence ONLINE. ═══');
  } catch (err) {
    console.error('[FRIDAY-INIT-FAIL] Soul failed to awaken:', err.message);
  }

  // Spawn the AutoHedge background daemon process
  try {
    const { spawn } = require('child_process');
    const pythonExecutable = path.join(__dirname, '..', 'autohedge', '.venv', 'Scripts', 'python.exe');
    const daemonScript = path.join(__dirname, 'skills', 'autohedge_daemon.py');
    
    console.log(`[TRADING-DAEMON] Spawning background loop via ${pythonExecutable}...`);
    const daemonProcess = spawn(pythonExecutable, [daemonScript], {
      cwd: path.join(__dirname, '..', 'autohedge'),
      env: process.env,
      detached: false
    });

    daemonProcess.stdout.on('data', (data) => {
      console.log(`[TRADING-DAEMON] ${data.toString().trim()}`);
    });

    daemonProcess.stderr.on('data', (data) => {
      console.error(`[TRADING-DAEMON-ERR] ${data.toString().trim()}`);
    });

    daemonProcess.on('close', (code) => {
      console.warn(`[TRADING-DAEMON] Exited with code ${code}.`);
    });
  } catch (err) {
    console.error('[TRADING-DAEMON-FAIL] Failed to spawn:', err.message);
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[FRIDAY-GUARD] Port ${PORT} is already in use. Exiting so auto-restart loop can retry...`);
    process.exit(1); // triggers restart loop in run.ps1
  } else {
    console.error('[FRIDAY-GUARD] Server error:', err.message);
  }
});

