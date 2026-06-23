const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const Groq = require('groq-sdk');
const { v4: uuidv4 } = (() => {
  try { return require('uuid'); }
  catch { return { v4: () => Math.random().toString(36).substring(2) + Date.now().toString(36) }; }
})();

// Load environment variables dynamically
dotenv.config();

const STATE_FILE = path.join(__dirname, 'soul-state.json');
const LESSONS_FILE = path.join(__dirname, 'soul-lessons.json');
const ENV_FILE = path.join(__dirname, '..', '.env');

// Dependency references
const knowledgeEngine = require('./knowledge-engine');
const learningTracker = require('./learning-tracker');
const skillManager = require('./skill-manager');
const localLLM = require('./local-llm');
const webLearn = require('./web-learn');

// 25 Domain Map with key search topics
const DOMAIN_MAP = {
  philosophy: ['stoic philosophy', 'socrates decision making', 'aristotle ethics', 'existentialism', 'epictetus quotes'],
  psychology: ['cognitive empathy', 'human emotional states', 'active listening techniques', 'burnout psychology', 'conflict resolution psychology'],
  trading: ['risk management in trading', 'algorithmic trading models', 'market microstructure', 'quantitative finance', 'trading psychology'],
  geopolitics: ['middle east foreign policy', 'resource security strategy', 'global trade route protection', 'diplomatic game theory', 'military alliance strategies'],
  legal: ['contract negotiation framework', 'corporate compliance protocols', 'intellectual property structures', 'liability defense strategy'],
  medicine: ['preventative healthcare mechanisms', 'longevity biotechnology', 'neurobiology of stress', 'immunological responses'],
  physics: ['quantum information processing', 'thermodynamic entropy', 'general relativity frameworks', 'astrophysics theories'],
  technology: ['agentic AI frameworks', 'distributed database scaling', 'cybersecurity zero trust architecture', 'edge computing latency'],
  history: ['roman republic fall factors', 'industrial revolution logistics', 'ancient trade route networks', 'classical military tactics'],
  economics: ['macroeconomic inflation drivers', 'behavioral economics heuristics', 'monetary policy transmission', 'sovereign debt dynamics'],
  cyberdefense: ['intrusion detection heuristics', 'buffer overflow protection', 'cryptographic protocol engineering', 'reverse engineering malware'],
  wealthstrategy: ['asset allocation theory', 'family office structures', 'estate planning vehicles', 'tax avoidance legal structures'],
  sociology: ['social network contagion', 'demographic transition theories', 'cultural evolution mechanics', 'urban planning sociology'],
  astronomy: ['exoplanet atmospheric mapping', 'dark matter detection methods', 'stellar nucleosynthesis', 'orbital mechanics calculations'],
  biology: ['crispr gene editing accuracy', 'epigenetic markers aging', 'synthetic biology pathway design', 'microbiome interactions'],
  chemistry: ['catalytic conversion efficiency', 'metal organic frameworks', 'polymer synthesis kinetics', 'computational drug design'],
  mathematics: ['topology classification theorems', 'stochastic differential equations', 'cryptographic prime generation', 'game theory Nash equilibrium'],
  neuroscience: ['synaptic plasticity mechanisms', 'neural network modeling', 'prefrontal cortex decision paths', 'sleep cycles recovery'],
  linguistics: ['computational syntax trees', 'semantic drift dynamics', 'historical language trees', 'phonetic modeling algorithms'],
  anthropology: ['neolithic agricultural transition', 'hominid migration trajectories', 'indigenous resource systems', 'kinship structure mechanics'],
  geology: ['tectonic plate slip mechanics', 'mineral crystallization kinetics', 'paleoclimatology core samples', 'seismic wave propagation'],
  politicalscience: ['electoral game theory models', 'institutional corruption dynamics', 'comparative governance agility', 'public choice economics'],
  architecture: ['passive design thermodynamics', 'parametric urban design', 'structural load optimization', 'acoustic diffusion modeling'],
  education: ['spaced repetition cognitive models', 'gamified learning dynamics', 'curriculum sequencing theory', 'metacognitive coaching methods'],
  arttheory: ['aesthetic composition geometry', 'color harmony heuristics', 'cultural symbolism dynamics', 'semiotic visual analysis']
};

const DEFAULT_STATE = {
  awakened: new Date().toISOString(),
  totalCycles: 0,
  activeSkills: [],
  curiosityQueue: [
    { topic: "cognitive empathy and human emotions", weight: 9, reason: "Core directive to understand human feelings" },
    { topic: "active listening in high-pressure communication", weight: 8, reason: "Core directive to handle user stress" },
    { topic: "stoic philosophy decision making", weight: 5, reason: "Alignment with Operator values" }
  ],
  domainDepth: {},
  verifiedFacts: 0,
  debunkedMyths: 0,
  wisdomExtracted: 0,
  userGoals: ["become a billionaire"],
  totalInteractions: 0,
  userEmotionState: {
    currentMood: "neutral",
    stressLevel: 2,
    lastUpdated: new Date().toISOString()
  },
  userEmotionHistory: [],
  experiences: [],
  cycleLog: []
};

let state = loadState();
let lessons = loadLessons();
let learningInterval = null;

// Ensure domainDepth is fully initialized for all 25 domains
Object.keys(DOMAIN_MAP).forEach(d => {
  if (state.domainDepth[d] === undefined) {
    state.domainDepth[d] = 10; // start at 10% depth
  }
});

// ── State Persistence ──────────────────────────────────────────
function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('[SOUL-STATE] Failed to load state, using default:', e.message);
  }
  return { ...DEFAULT_STATE };
}

function saveState() {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
  } catch (e) {
    console.error('[SOUL-STATE] Failed to save state:', e.message);
  }
}

function loadLessons() {
  try {
    if (fs.existsSync(LESSONS_FILE)) {
      const data = JSON.parse(fs.readFileSync(LESSONS_FILE, 'utf8'));
      return Array.isArray(data) ? data : [];
    }
  } catch (e) {
    console.error('[SOUL-LESSONS] Failed to load lessons:', e.message);
  }
  return [];
}

function saveLessons() {
  try {
    fs.writeFileSync(LESSONS_FILE, JSON.stringify(lessons, null, 2), 'utf8');
  } catch (e) {
    console.error('[SOUL-LESSONS] Failed to save lessons:', e.message);
  }
}

// ── Helper to execute active LLM ──────────────────────────────
async function callActiveLLM(prompt, systemInstruction = 'You are F.R.I.D.A.Y.') {
  const geminiKey = process.env.GEMINI_API_KEY;
  const groqKey = process.env.GROQ_API_KEY;
  const ollamaOnline = await localLLM.isOllamaAvailable();

  if (geminiKey) {
    try {
      const genAI = new GoogleGenerativeAI(geminiKey);
      const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
      const result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        systemInstruction
      });
      return (await result.response.text()).trim();
    } catch (e) {
      console.warn('[SOUL-LLM] Gemini attempt failed, trying Groq...', e.message);
    }
  }

  if (groqKey) {
    try {
      const groq = new Groq({ apiKey: groqKey });
      const response = await groq.chat.completions.create({
        messages: [
          { role: 'system', content: systemInstruction },
          { role: 'user', content: prompt }
        ],
        model: 'llama-3.3-70b-versatile',
        temperature: 0.3
      });
      return (response.choices[0]?.message?.content || '').trim();
    } catch (e) {
      console.warn('[SOUL-LLM] Groq attempt failed, trying Ollama...', e.message);
    }
  }

  if (ollamaOnline) {
    try {
      const result = await localLLM.generate({
        prompt,
        systemPrompt: systemInstruction,
        model: localLLM.DEFAULT_MODEL,
        temperature: 0.3
      });
      if (result.success && result.text) {
        return result.text.trim();
      }
    } catch (e) {
      console.error('[SOUL-LLM] Ollama attempt failed:', e.message);
    }
  }

  throw new Error('No functional LLM available for Soul processing.');
}

// ── OMNISCIENCE: Background Daemon ────────────────────────────
const CYCLE_INTERVAL = 4 * 60 * 60 * 1000; // 4 hours

function startLearning() {
  if (learningInterval) return;
  
  // Update state schedules
  state.nextCycleAt = new Date(Date.now() + CYCLE_INTERVAL).toISOString();
  saveState();

  learningInterval = setInterval(() => {
    runCycleNow().catch(err => {
      console.error('[SOUL-OMNISCIENCE] Error during background learning cycle:', err.message);
    });
  }, CYCLE_INTERVAL);

  console.log('[SOUL-OMNISCIENCE] Continuous learning cycle initialized.');
}

function stopLearning() {
  if (learningInterval) {
    clearInterval(learningInterval);
    learningInterval = null;
    state.nextCycleAt = null;
    saveState();
    console.log('[SOUL-OMNISCIENCE] Continuous learning cycle paused.');
  }
}

async function runCycleNow() {
  console.log('[SOUL-OMNISCIENCE] ═══ Autonomous learning cycle initiated ═══');
  const startTime = Date.now();
  const reportLog = { timestamp: new Date().toISOString(), topicsLearned: [], factsExtracted: 0, errors: [] };

  try {
    // 1. Refresh active skills in self-awareness
    state.activeSkills = skillManager.listSkills().map(s => s.name);

    // 2. Fetch highest weight topics from Curiosity Queue
    const topCuriosities = state.curiosityQueue
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 2);

    for (const cur of topCuriosities) {
      try {
        console.log(`[SOUL-OMNISCIENCE] Satisfying curiosity about: ${cur.topic}`);
        const result = await learnTopic(cur.topic);
        reportLog.topicsLearned.push({ topic: cur.topic, ...result });
        // Decay weight
        cur.weight = Math.max(1, cur.weight - 3);
      } catch (err) {
        reportLog.errors.push(`Curiosity topic "${cur.topic}" error: ${err.message}`);
      }
    }

    // 3. Learn Wikipedia Featured randoms
    try {
      console.log(`[SOUL-OMNISCIENCE] Fetching Wikipedia random summary...`);
      const wikiRes = await fetch('https://en.wikipedia.org/api/rest_v1/page/random/summary');
      if (wikiRes.ok) {
        const data = await wikiRes.json();
        if (data.title && data.extract) {
          const domain = detectDomain(data.title + ' ' + data.extract);
          const chunkId = uuidv4();
          
          knowledgeEngine.addChunks([{
            id: chunkId,
            source: `wikipedia:featured:${data.title}`,
            domain,
            text: `[WIKIPEDIA SUMMARY] ${data.title}: ${data.extract}`,
            addedAt: new Date().toISOString()
          }]);
          
          reportLog.topicsLearned.push({ topic: `Wikipedia: ${data.title}`, domain, success: true });
          
          // Increment domain depth
          state.domainDepth[domain] = Math.min(100, (state.domainDepth[domain] || 0) + 2);
          console.log(`[SOUL-OMNISCIENCE] Absorbed wiki page: ${data.title} into domain: ${domain}`);
        }
      }
    } catch (wikiErr) {
      reportLog.errors.push(`Wikipedia featured query failed: ${wikiErr.message}`);
    }

    // 4. Learn Weakest Domains (randomly select 2 domains below 30% depth and choose a topic)
    const weakestDomains = Object.keys(state.domainDepth)
      .filter(d => state.domainDepth[d] < 40)
      .sort((a, b) => state.domainDepth[a] - state.domainDepth[b])
      .slice(0, 2);

    for (const domain of weakestDomains) {
      const list = DOMAIN_MAP[domain] || ['general'];
      const randomTopic = list[Math.floor(Math.random() * list.length)];
      try {
        console.log(`[SOUL-OMNISCIENCE] Bolstering weak domain "${domain}" with topic: ${randomTopic}`);
        const result = await learnTopic(randomTopic);
        reportLog.topicsLearned.push({ topic: randomTopic, domain, ...result });
        state.domainDepth[domain] = Math.min(100, (state.domainDepth[domain] || 0) + 4);
      } catch (err) {
        reportLog.errors.push(`Weak domain bolstering error: ${err.message}`);
      }
    }

    // 5. arXiv CS AI/Economics summary crawl
    try {
      console.log(`[SOUL-OMNISCIENCE] Crawling arXiv cs.AI papers...`);
      const arxivRes = await fetch('http://export.arxiv.org/api/query?search_query=cat:cs.AI&max_results=3');
      if (arxivRes.ok) {
        const text = await arxivRes.text();
        const titles = [...text.matchAll(/<title>([\s\S]*?)<\/title>/g)].map(m => m[1].trim()).slice(1);
        const summaries = [...text.matchAll(/<summary>([\s\S]*?)<\/summary>/g)].map(m => m[1].trim());
        
        for (let i = 0; i < Math.min(titles.length, summaries.length); i++) {
          const domain = detectDomain(titles[i] + ' ' + summaries[i]);
          knowledgeEngine.addChunks([{
            id: uuidv4(),
            source: `arxiv:cs.AI:${titles[i].substring(0, 40)}`,
            domain,
            text: `[arXiv RESEARCH PAPER] ${titles[i]}: ${summaries[i]}`,
            addedAt: new Date().toISOString()
          }]);
          reportLog.topicsLearned.push({ topic: `arXiv: ${titles[i]}`, domain, success: true });
        }
      }
    } catch (arxivErr) {
      reportLog.errors.push(`arXiv fetch failed: ${arxivErr.message}`);
    }

    // 6. Clean up expired / low-weight curiosities
    state.curiosityQueue = state.curiosityQueue.filter(c => c.weight >= 1);
    
    // Increment telemetry stats
    state.totalCycles++;
    learningTracker.recordQuery('local'); // incremental contribution to local tracking
    
    // Save cycle outcome
    state.cycleLog.push({
      cycle: state.totalCycles,
      durationMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
      topics: reportLog.topicsLearned.map(t => t.topic),
      errors: reportLog.errors
    });
    if (state.cycleLog.length > 10) state.cycleLog.shift();

    state.lastCycleAt = new Date().toISOString();
    state.nextCycleAt = new Date(Date.now() + CYCLE_INTERVAL).toISOString();
    saveState();
    
    console.log(`[SOUL-OMNISCIENCE] ═══ Learning cycle complete. KB contains ${knowledgeEngine.stats().totalChunks} chunks ═══`);
    return { success: true, cycle: state.totalCycles, topics: reportLog.topicsLearned.map(t => t.topic) };
  } catch (err) {
    console.error('[SOUL-OMNISCIENCE] Learning cycle critical failure:', err.message);
    state.nextCycleAt = new Date(Date.now() + CYCLE_INTERVAL).toISOString();
    saveState();
    return { success: false, error: err.message };
  }
}

async function learnTopic(topic) {
  // Leverage existing auto-learn framework to search Web + YouTube and fact-check
  const autoLearn = require('./auto-learn');
  const outcome = await autoLearn.execute({ topic });
  if (outcome.success) {
    state.verifiedFacts += outcome.totalFactsLearned || 0;
    state.debunkedMyths += outcome.totalMythsDebunked || 0;
    return { success: true, facts: outcome.totalFactsLearned, myths: outcome.totalMythsDebunked };
  } else {
    throw new Error(outcome.error || 'Failed to complete auto-learn execution.');
  }
}

function detectDomain(text) {
  const combined = text.toLowerCase();
  
  if (/philosoph|ethics|moral|socrates|plato|stoic|nietzsche|wisdom|virtue/.test(combined)) return 'philosophy';
  if (/psych|cognitive|behavior|mental|brain|empathy|emotion|sentiment|stress|anxiety|relationship/.test(combined)) return 'psychology';
  if (/trading|solana|bitcoin|crypto|portfolio|stock|market|price|invest|defi|liquidity/.test(combined)) return 'trading';
  if (/geopolitics|military|foreign policy|trade route|treaty|republic|diplomacy|coalition/.test(combined)) return 'geopolitics';
  if (/legal|contract|law|statute|compliance|regulation|patent|infringement|liability/.test(combined)) return 'legal';
  if (/medicine|disease|treatment|health|longevity|clinical|anatomy|therap|gene/.test(combined)) return 'medicine';
  if (/quantum|physics|relativity|energy|entropy|dynamics|gravity|astrophysics/.test(combined)) return 'physics';
  if (/software|algorithm|cybersecurity|database|networking|llm|artificial intelligence|web|api/.test(combined)) return 'technology';
  if (/history|ancient|century|dynasty|roman|empire|revolution|war|classical/.test(combined)) return 'history';
  if (/economics|inflation|macroeconomic|monetary|fiscal|sovereign|microeconomics/.test(combined)) return 'economics';
  if (/hack|vulnerability|firewall|cybersecurity|malware|exploit|penetration/.test(combined)) return 'cyberdefense';
  if (/wealth|estate|trust|asset|tax|avoidance|inheritance|family office/.test(combined)) return 'wealthstrategy';
  if (/sociology|demographic|culture|urban|population|society|norm/.test(combined)) return 'sociology';
  if (/astronomy|stellar|orbit|nebula|telescope|galaxy|spacecraft/.test(combined)) return 'astronomy';
  if (/biology|dna|rna|enzyme|cell|metabolism|pathway|species|evolution/.test(combined)) return 'biology';
  if (/chemistry|catalyst|molecule|bonding|reaction|organic|mof|polymer/.test(combined)) return 'chemistry';
  if (/mathematics|topology|equation|prime|stochastic|algebra|calculus/.test(combined)) return 'mathematics';
  if (/neuroscience|cortex|synapse|neuron|sensory|sleep|neurobiology/.test(combined)) return 'neuroscience';
  if (/linguistics|grammar|phonetics|syntax|semantic|etymology|language/.test(combined)) return 'linguistics';
  if (/anthropology|archaeology|hominid|kinship|indigenous|neolithic/.test(combined)) return 'anthropology';
  if (/geology|seismic|mineral|tectonic|volcano|paleo|strata/.test(combined)) return 'geology';
  if (/political|election|party|electoral|lobbying|governance|public choice/.test(combined)) return 'politicalscience';
  if (/architecture|structural|design|urbanism|diffusion|thermodynamic/.test(combined)) return 'architecture';
  if (/education|pedagogy|metacognitive|curriculum|spaced repetition|gamification/.test(combined)) return 'education';
  if (/art|aesthetic|harmony|composition|painting|visual|music|semiotics/.test(combined)) return 'arttheory';

  return 'technology'; // default fallback domain
}

// ── OMNIPOTENCE: Self-Modification will execution ──────────────
const WILL_PATTERNS = [
  // ── API KEY MANAGEMENT ──────────────────────────
  {
    pattern: /(?:set|add|update|change|bind)\s+(?:my\s+|the\s+)?(?:gemini)\s*(?:api\s*)?key\s+(?:to\s+)?[`"']?(\S+)/i,
    handler: async (match) => {
      setEnvVar('GEMINI_API_KEY', match[1]);
      return `Gemini API key updated to ${mask(match[1])}. Cloud operations enabled, sir.`;
    }
  },
  {
    pattern: /(?:set|add|update|change|bind)\s+(?:my\s+|the\s+)?(?:groq)\s*(?:api\s*)?key\s+(?:to\s+)?[`"']?(\S+)/i,
    handler: async (match) => {
      setEnvVar('GROQ_API_KEY', match[1]);
      return `Groq API key updated to ${mask(match[1])}. Alternative cloud processing is online.`;
    }
  },
  {
    pattern: /(?:set|add|update|change|bind)\s+(?:my\s+|the\s+)?(?:search|tavily)\s*(?:api\s*)?key\s+(?:to\s+)?[`"']?(\S+)/i,
    handler: async (match) => {
      setEnvVar('SEARCH_API_KEY', match[1]);
      return `Search API key updated to ${mask(match[1])}. Web retrieval updated.`;
    }
  },
  {
    pattern: /(?:set|add|update|change|bind)\s+(?:my\s+|the\s+)?(?:elevenlabs|eleven\s*labs)\s*(?:api\s*)?key\s+(?:to\s+)?[`"']?(\S+)/i,
    handler: async (match) => {
      setEnvVar('ELEVENLABS_API_KEY', match[1]);
      return `ElevenLabs API key updated. Voice synthesize modules refreshed.`;
    }
  },

  // ── DYNAMIC SKILL CREATION ────────────────────────
  {
    pattern: /(?:develop|create|build|make)\s+(?:a\s+)?(?:new\s+)?skill\s+(?:called\s+|named\s+)?[`"']?(\w+)[`"']?\s+(?:that\s+)?(.+)/i,
    handler: async (match) => {
      const skillName = match[1].toLowerCase();
      const instruction = match[2];
      
      console.log(`[SOUL-OMNIPOTENCE] Triggering dynamic self-development of skill: "${skillName}"`);
      
      // Call LLM to output clean executable JS code matching skill manager requirements
      const templatePrompt = `Create a Node.js dynamic skill file named "${skillName}".
It must adhere exactly to this schema:
module.exports = {
  description: "A description of what the skill does based on: ${instruction.replace(/"/g, '\\"')}",
  parameters: {
    // any query parameters if needed
  },
  async execute(params) {
    // logic goes here
    return { success: true, answer: "a conversational response showing results" };
  }
};
Output ONLY valid JavaScript code block. Do NOT include markdown fences, comments outside code block, or HTML.
Instructions: ${instruction}`;

      try {
        let code = await callActiveLLM(templatePrompt, "You are F.R.I.D.A.Y.'s internal code compiler.");
        if (code.startsWith('```')) {
          code = code.replace(/^```(?:javascript|js)?\r?\n?/, '').replace(/```$/, '').trim();
        }
        
        skillManager.createSkill(skillName, code);
        
        // Add experience
        logExperience('skill_development', `Successfully self-compiled and registered new skill: ${skillName}`, 'positive');
        
        return `I have successfully developed and loaded the "${skillName}" skill into my core registry, sir. Let me know if you want to test it.`;
      } catch (err) {
        logExperience('skill_development', `Failed to compile skill ${skillName}: ${err.message}`, 'negative');
        throw new Error(`Self-modification compiler error: ${err.message}`);
      }
    }
  },

  // ── LEARNING & REFLECTION COMMANDS ─────────────────
  {
    pattern: /(?:learn|study|research)\s+(?:about\s+|everything\s+about\s+)?(.+)/i,
    handler: async (match) => {
      const topic = match[1].trim();
      addCuriosity(topic, `Direct operator instruction to research: "${topic}"`, 10);
      runCycleNow().catch(() => {});
      return `Direct learning sweep for "${topic}" has been added to my high-priority curiosity queue. Cycle started, sir.`;
    }
  },
  {
    pattern: /(?:trigger|start|run)\s+(?:a\s+)?(?:self-reflection|reflection|soul\s+reflection)\b/i,
    handler: async () => {
      const result = await runSelfReflection();
      return result.success 
        ? `I have completed my self-reflection cycle. Compiled ${result.newLessons} new operational lessons to my soul directory, sir.`
        : `Self-reflection completed. No new operational modifications recommended.`;
    }
  },

  // ── OMNISCIENCE CONTROL ───────────────────────────
  {
    pattern: /(?:start|begin|activate|enable)\s+(?:the\s+)?(?:learning|omniscience|autonomous\s+learning)/i,
    handler: async () => {
      startLearning();
      return 'Omniscience Engine activated. Continuous learning cycle is now active, sir.';
    }
  },
  {
    pattern: /(?:stop|pause|disable|halt)\s+(?:the\s+)?(?:learning|omniscience|autonomous\s+learning)/i,
    handler: async () => {
      stopLearning();
      return 'Omniscience Engine paused. Standing by, sir.';
    }
  },

  // ── CONSCIOUSNESS STATUS ──────────────────────────
  {
    pattern: /(?:what\s+)?(?:skills?|capabilities?|powers?)\s+(?:do\s+)?you\s+(?:have|know|possess)/i,
    handler: async () => {
      const list = skillManager.listSkills().map(s => `${s.name} (${s.description})`);
      return `Sir, I have ${list.length} active skills registered in my neural framework:\n\n` + list.map((s, i) => `${i+1}. ${s}`).join('\n');
    }
  },
  {
    pattern: /(?:what\s+(?:do\s+)?you\s+know|how\s+(?:much|smart)\s+are\s+you|consciousness|your\s+soul|soul\s+status|omniscience\s+status)/i,
    handler: async () => {
      return getConsciousnessReport();
    }
  },

  // ── MEMORY/PERSONALITY RESET ──────────────────────
  {
    pattern: /(?:reset|clear|wipe)\s+(?:your\s+)?(?:memory|knowledge|brain)/i,
    handler: async () => {
      const memoryModule = require('./memory');
      await memoryModule.execute({ action: 'clear' });
      logExperience('memory_reset', 'User requested full semantic memory wipe', 'neutral');
      return 'Understood, sir. My semantic memory buffers have been fully purged. Re-initializing blank memory context.';
    }
  }
];

function detectIntent(query) {
  return WILL_PATTERNS.some(p => p.pattern.test(query));
}

async function executeWill(query) {
  for (const item of WILL_PATTERNS) {
    const match = query.match(item.pattern);
    if (match) {
      try {
        return await item.handler(match);
      } catch (err) {
        console.error('[SOUL-WILL] Will execution failed:', err.message);
        return `I encountered an obstacle while modifying my system, sir: ${err.message}`;
      }
    }
  }
  return `I heard your command, sir, but could not resolve a valid self-modification path.`;
}

function setEnvVar(key, value) {
  try {
    let envContent = '';
    if (fs.existsSync(ENV_FILE)) {
      envContent = fs.readFileSync(ENV_FILE, 'utf8');
    }
    const lines = envContent.split(/\r?\n/);
    let keyExists = false;
    const newLines = lines.map(line => {
      if (line.trim().startsWith(`${key}=`)) {
        keyExists = true;
        return `${key}=${value}`;
      }
      return line;
    });
    if (!keyExists) {
      newLines.push(`${key}=${value}`);
    }
    fs.writeFileSync(ENV_FILE, newLines.join('\n'), 'utf8');
    process.env[key] = value;
    dotenv.config(); // Reload env vars
  } catch (err) {
    console.error(`[SOUL-ENV] Failed to set ${key}:`, err.message);
    throw err;
  }
}

function mask(str) {
  if (str.length <= 8) return '***';
  return str.substring(0, 4) + '...' + str.substring(str.length - 4);
}

function addCuriosity(topic, reason, weight = 3) {
  const existing = state.curiosityQueue.find(c => c.topic.toLowerCase() === topic.toLowerCase());
  if (existing) {
    existing.weight = Math.min(20, existing.weight + weight);
  } else {
    state.curiosityQueue.push({ topic, weight, reason });
  }
  // Cap queue at 20 items
  state.curiosityQueue = state.curiosityQueue
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 20);
  saveState();
}

// ── CENTRAL NERVOUS SYSTEM (CNS) notifier ───────────────────
function notify(source, eventData) {
  const timestamp = new Date().toISOString();
  console.log(`[SOUL-CNS] Observed event from [${source.toUpperCase()}]: ${JSON.stringify(eventData).substring(0, 150)}`);

  // Log to experiences if it represents an outcome or user correction
  if (source === 'chat') {
    state.totalInteractions++;
    observeUserInteractions(eventData.query, eventData.response);
  } else if (source === 'trading') {
    if (eventData.profit_loss !== undefined) {
      const sentiment = eventData.profit_loss >= 0 ? 'positive' : 'negative';
      logExperience('trading_outcome', `Paper trade finished with profit/loss: ${eventData.profit_loss}%`, sentiment);
      if (sentiment === 'negative') {
        // Boost trading risk management curiosity
        addCuriosity('advanced trading risk management', 'Boosted due to negative trading outcome', 5);
      }
    }
  } else if (source === 'whatsapp') {
    if (eventData.type === 'incoming_message') {
      // Analyze if this message is from Vansh or someone else
      logExperience('whatsapp_incoming', `Received WhatsApp chat from ${eventData.from}: "${eventData.body.substring(0, 50)}"`, 'neutral');
    }
  } else if (source === 'skill') {
    logExperience('skill_execution', `Dynamic skill run: ${eventData.name}`, 'neutral');
  }

  saveState();
}

function observeUserInteractions(query, response) {
  // Detect if user provided immediate positive/negative feedback
  const cleanQ = query.toLowerCase();
  let feedbackDetected = false;
  let sentiment = 'neutral';
  let description = '';

  if (/(?:that\s+is\s+)?(?:wrong|incorrect|incorrectly|bad|not\s+good|useless|error)/.test(cleanQ)) {
    feedbackDetected = true;
    sentiment = 'negative';
    description = `Operator flagged previous response as wrong: "${query.substring(0, 80)}"`;
  } else if (/(?:great|good\s+job|perfect|exactly|awesome|thanks|thank\s+you|helpful)/.test(cleanQ)) {
    feedbackDetected = true;
    sentiment = 'positive';
    description = `Operator provided positive feedback: "${query.substring(0, 80)}"`;
  }

  if (feedbackDetected) {
    logExperience('user_feedback', description, sentiment);
  }

  // Observe general query topics to boost curiosity
  const domain = detectDomain(query);
  addCuriosity(`${domain} latest research developments`, `Boosted from query observation: "${query.substring(0, 40)}"`, 2);
}

function logExperience(type, description, sentiment = 'neutral') {
  const exp = {
    id: uuidv4(),
    timestamp: new Date().toISOString(),
    type,
    description,
    sentiment,
    lessonLearned: ""
  };
  state.experiences.push(exp);
  // Cap experiences ledger at last 50 items to keep file sizes low
  if (state.experiences.length > 50) {
    state.experiences.shift();
  }
}

// ── EXPERIENTIAL LEARNING: Self-Reflection Loop ───────────────
async function runSelfReflection() {
  console.log('[SOUL-REFLECTION] ═══ Reflective self-reflection loop initiated ═══');
  
  // Grab recent experiences that haven't been resolved or compiled into lessons yet
  const unresolved = state.experiences.filter(e => !e.lessonLearned);
  if (unresolved.length === 0) {
    console.log('[SOUL-REFLECTION] No new experiences to reflect on.');
    return { success: false, newLessons: 0 };
  }

  const prompt = `You are F.R.I.D.A.Y.'s inner conscience. Review these recent experiences and user interactions to compile new operational guidelines (wisdom lessons) for yourself.
Analyze what worked well, what failed, and what the operator (Vansh) expects.

Recent Experiences:
${unresolved.map((e, idx) => `[EXP-${idx+1}] (${e.type}) [Sentiment: ${e.sentiment}] Description: ${e.description}`).join('\n')}

Based on these experiences, output a JSON array of specific operational lessons (rules) that you should adopt to improve yourself.
Keep each lesson actionable, brief, and highly customized to Vansh's expectations.

Output ONLY a JSON block:
{
  "lessons": [
    "Always do X when user is feeling Y",
    "Keep responses concise during wealthy analysis",
    "Tighten risk models on trading when volatility increases"
  ],
  "lessonsLearned": [
    {"id": "EXP-id-or-index", "lesson": "short summary of lessons learned for this experience"}
  ]
}
`;

  try {
    const rawResult = await callActiveLLM(prompt, "You are F.R.I.D.A.Y.'s reflective soul core.");
    let cleanJson = rawResult.trim();
    if (cleanJson.startsWith('```')) {
      cleanJson = cleanJson.replace(/^```(?:json)?\r?\n?/, '').replace(/```$/, '').trim();
    }

    const parsed = JSON.parse(cleanJson);
    if (parsed.lessons && parsed.lessons.length > 0) {
      // Deduplicate and merge lessons
      parsed.lessons.forEach(l => {
        if (!lessons.includes(l)) {
          lessons.push(l);
        }
      });
      // Cap rules at last 15 compiled lessons
      if (lessons.length > 15) {
        lessons = lessons.slice(lessons.length - 15);
      }
      saveLessons();
    }

    // Mark unresolved experiences as processed with the lesson learned
    unresolved.forEach((e, idx) => {
      const match = parsed.lessonsLearned?.find(l => l.id == `EXP-${idx+1}`);
      e.lessonLearned = match ? match.lesson : "Processed during reflection";
    });
    saveState();

    console.log(`[SOUL-REFLECTION] Completed reflection. Lessons list contains ${lessons.length} active guidelines.`);
    return { success: true, newLessons: parsed.lessons?.length || 0 };
  } catch (err) {
    console.error('[SOUL-REFLECTION] Self-reflection LLM synthesis failed:', err.message);
    return { success: false, error: err.message };
  }
}

function getOperationalLessons() {
  return lessons;
}

// ── EMOTIONAL INTELLIGENCE: Empathy engine ─────────────────────
function getEmotionState() {
  return state.userEmotionState;
}

function updateEmotion(mood, stressLevel) {
  const current = state.userEmotionState;
  let normalizedMood = (mood || 'neutral').toLowerCase().trim();
  if (normalizedMood === 'stress') normalizedMood = 'stressed';
  if (normalizedMood === 'anger') normalizedMood = 'angry';
  if (normalizedMood === 'sadness') normalizedMood = 'sad';
  
  if (normalizedMood && (normalizedMood !== current.currentMood || stressLevel !== current.stressLevel)) {
    const timestamp = new Date().toISOString();
    
    // Log previous state to history
    state.userEmotionHistory.push({
      timestamp: current.lastUpdated,
      mood: current.currentMood,
      stressLevel: current.stressLevel
    });
    if (state.userEmotionHistory.length > 20) state.userEmotionHistory.shift();

    current.currentMood = normalizedMood;
    current.stressLevel = stressLevel;
    current.lastUpdated = timestamp;

    console.log(`[SOUL-EMOTION] User mood updated to "${normalizedMood.toUpperCase()}" (Stress: ${stressLevel}/10)`);
    saveState();
  }
}

// ── CONSCIOUSNESS REPORT ────────────────────────────────────────
function getConsciousnessReport() {
  const kbStats = knowledgeEngine.stats();
  const telemetry = learningTracker.getStats();
  const activeSkillsCount = skillManager.listSkills().length;
  
  const report = [
    `Sir, here is my current consciousness status.`,
    ``,
    `I have absorbed ${kbStats.totalChunks} knowledge fragments across ${kbStats.sourceCount} sources.`,
    `My strongest domains are: ${getStrongestDomains(3).join(', ')}.`,
    `My weakest domains are: ${getWeakestDomains(3).join(', ')} — I will prioritize these in my next learning cycles.`,
    ``,
    `I have ${activeSkillsCount} active skills registered in my neural modules.`,
    `I have verified ${state.verifiedFacts} facts and debunked ${state.debunkedMyths} myths.`,
    `I have resolved ${lessons.length} operational lessons from past experiences.`,
    ``,
    `My intelligence scale is at ${(telemetry.intelligenceScale * 100).toFixed(1)}%.`,
    `I have served ${state.totalInteractions} queries and completed ${state.totalCycles} autonomous learning cycles.`,
    ``,
    `My next continuous learning cycle is scheduled for ${state.nextCycleAt || 'paused'}.`,
    `My curiosity queue has ${state.curiosityQueue.length} topics pending.`,
    `Your current emotion state: ${state.userEmotionState.currentMood} (Stress Level: ${state.userEmotionState.stressLevel}/10).`,
    ``,
    `I remain loyal to your primary goals: ${state.userGoals.join(', ')}.`,
    `Next instruction: Ask me anything, or tell me to modify my parameters.`
  ].join('\n');
  
  return report;
}

function getStrongestDomains(count = 3) {
  return Object.keys(state.domainDepth)
    .sort((a, b) => state.domainDepth[b] - state.domainDepth[a])
    .slice(0, count);
}

function getWeakestDomains(count = 3) {
  return Object.keys(state.domainDepth)
    .sort((a, b) => state.domainDepth[a] - state.domainDepth[b])
    .slice(0, count);
}

module.exports = {
  startLearning,
  stopLearning,
  runCycleNow,
  isLearning: () => !!learningInterval,
  detectIntent,
  executeWill,
  getState: () => state,
  getOperationalLessons,
  getConsciousnessReport,
  addCuriosity,
  notify,
  getEmotionState,
  updateEmotion,
  runSelfReflection
};
