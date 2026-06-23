/**
 * web-learn.js
 * F.R.I.D.A.Y. self-learning web scraper.
 * Scrapes Wikipedia, Alison, and any URL to extract knowledge chunks
 * and persist them to knowledge-base.json via the BM25 engine.
 */

const https = require('https');
const http = require('http');
const { addChunks, stats } = require('./knowledge-engine');

const { v4: uuidv4 } = (() => {
  try { return require('uuid'); }
  catch { return { v4: () => Math.random().toString(36).substring(2) + Date.now().toString(36) }; }
})();

const CHUNK_SIZE = 400;   // words per chunk
const CHUNK_OVERLAP = 50; // word overlap between chunks

// ── Domain auto-detection ─────────────────────────────────────
function detectDomain(url, text) {
  const combined = (url + ' ' + text.substring(0, 1500)).toLowerCase();
  
  if (/philosoph|ethics|moral|socrates|plato|stoic|nietzsche|wisdom|virtue/.test(combined)) return 'philosophy';
  if (/psych|cognitive|behavior|mental|brain|empathy|emotion|sentiment|stress|anxiety|relationship/.test(combined)) return 'psychology';
  if (/trading|solana|bitcoin|crypto|portfolio|stock|market|price|invest|defi|liquidity/.test(combined)) return 'trading';
  if (/geopolit|nato|brics|cold.war|taiwan|diplomacy|sanction|military|foreign policy|trade route|treaty|republic|coalition/.test(combined)) return 'geopolitics';
  if (/legal|contract|nda|compliance|law|offshore|tax|regulation|statute|patent|infringement|liability/.test(combined)) return 'legal';
  if (/medicine|disease|treatment|health|longevity|clinical|anatomy|therap|gene/.test(combined)) return 'medicine';
  if (/quantum|physics|relativity|energy|entropy|dynamics|gravity|astrophysics/.test(combined)) return 'physics';
  if (/ai|artificial.intel|machine.learn|neural|llm|automation|workflow|software|algorithm|database|networking|web|api/.test(combined)) return 'technology';
  if (/history|ancient|century|dynasty|roman|empire|revolution|war|classical|civiliz/.test(combined)) return 'history';
  if (/economics|inflation|macroeconomic|monetary|fiscal|sovereign|microeconomics/.test(combined)) return 'economics';
  if (/cyber|security|vulnerab|hack|malware|cryptograph|penetration|firewall|exploit/.test(combined)) return 'cyberdefense';
  if (/portfolio|compound|wealth|invest|asset|allocation|hedge|estate|trust|tax|avoidance|inheritance|family office/.test(combined)) return 'wealthstrategy';
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

  return 'technology'; // default
}

// ── Text chunker ──────────────────────────────────────────────
function chunkText(text, source, domain) {
  const words = text.split(/\s+/).filter(w => w.length > 0);
  const chunks = [];
  let i = 0;

  while (i < words.length) {
    const slice = words.slice(i, i + CHUNK_SIZE);
    if (slice.length < 30) break; // skip tiny trailing chunks
    chunks.push({
      id: uuidv4(),
      source,
      domain,
      text: slice.join(' '),
      addedAt: new Date().toISOString()
    });
    i += CHUNK_SIZE - CHUNK_OVERLAP;
  }
  return chunks;
}

// ── HTTP fetch helper ─────────────────────────────────────────
function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) FridayBot/1.0',
        'Accept': 'text/html,application/json'
      },
      timeout: 15000
    }, (res) => {
      // Handle redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrl(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
  });
}

// ── Basic HTML → plain text ───────────────────────────────────
function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\[edit\]/gi, '')
    .replace(/\[citation needed\]/gi, '')
    .replace(/\[\d+\]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// ── Wikipedia API (fast, clean JSON) ─────────────────────────
async function scrapeWikipedia(title) {
  const apiUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
  const sectionsUrl = `https://en.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=true&titles=${encodeURIComponent(title)}&format=json`;

  let fullText = '';
  const source = `wikipedia/${title}`;

  try {
    // Get full article text via MediaWiki API
    const raw = await fetchUrl(sectionsUrl);
    const parsed = JSON.parse(raw);
    const pages = parsed.query?.pages || {};
    const page = Object.values(pages)[0];
    fullText = page?.extract || '';
  } catch {
    // Fallback to summary API
    try {
      const raw = await fetchUrl(apiUrl);
      const parsed = JSON.parse(raw);
      fullText = parsed.extract || '';
    } catch (err) {
      return { success: false, error: err.message, source };
    }
  }

  if (!fullText || fullText.length < 100) {
    return { success: false, error: 'Article too short or not found', source };
  }

  const domain = detectDomain(title, fullText);
  const chunks = chunkText(fullText, source, domain);
  const result = addChunks(chunks);

  return {
    success: true,
    source,
    domain,
    chunksAdded: result.added,
    totalKB: result.total,
    preview: fullText.substring(0, 150) + '...'
  };
}

// ── Generic URL scraper ───────────────────────────────────────
async function scrapeUrl(url) {
  // If it's a YouTube URL, extract the transcript instead of raw HTML
  if (url.includes('youtube.com/watch') || url.includes('youtu.be/')) {
    try {
      const { YoutubeTranscript } = require('youtube-transcript');
      const transcriptList = await YoutubeTranscript.fetchTranscript(url);
      
      const text = transcriptList.map(t => t.text).join(' ');
      if (text.length < 50) return { success: false, error: 'YouTube transcript is empty or unavailable.', source: url };

      const source = url.replace(/https?:\/\//, '').substring(0, 80);
      const domain = detectDomain(url, text);
      const chunks = chunkText(text, `youtube_transcript:${source}`, domain);
      const result = addChunks(chunks);

      return {
        success: true,
        source: `youtube_transcript:${source}`,
        domain,
        chunksAdded: result.added,
        totalKB: result.total,
        preview: text.substring(0, 150) + '...'
      };
    } catch (err) {
      return { success: false, error: `Failed to fetch YouTube transcript: ${err.message}`, source: url };
    }
  }

  let html;
  try {
    html = await fetchUrl(url);
  } catch (err) {
    return { success: false, error: `Failed to fetch: ${err.message}`, source: url };
  }

  const text = htmlToText(html);
  if (text.length < 200) {
    return { success: false, error: 'Extracted text too short (page may require JavaScript)', source: url };
  }

  const source = url.replace(/https?:\/\//, '').substring(0, 80);
  const domain = detectDomain(url, text);
  const chunks = chunkText(text, source, domain);
  const result = addChunks(chunks);

  return {
    success: true,
    source,
    domain,
    chunksAdded: result.added,
    totalKB: result.total,
    preview: text.substring(0, 150) + '...'
  };
}

// ── Auto-learn topic sweep ────────────────────────────────────
const AUTO_LEARN_TOPICS = {
  geopolitics: ['Geopolitics','Cold_War','NATO','BRICS','Taiwan_Strait_Crisis','Petrodollar','Geopolitical_risk'],
  trading:     ['Technical_analysis','Foreign_exchange_market','Elliott_wave_principle','Relative_strength_index','Risk_management'],
  history:     ['History_of_capitalism','British_Empire','Industrial_Revolution','History_of_money'],
  technology:  ['Artificial_intelligence','Large_language_model','Automation','Machine_learning'],
  legal:       ['Contract_law','Non-disclosure_agreement','Offshore_financial_centre'],
  wealth:      ['Modern_portfolio_theory','Compound_interest','Asset_allocation','Hedge_fund'],
  cybersecurity: ['Computer_security','Network_security','Cryptography','Vulnerability_management','Penetration_test']
};

async function autoLearn(onProgress) {
  const results = [];
  const topics = Object.entries(AUTO_LEARN_TOPICS);

  for (const [domain, titles] of topics) {
    for (const title of titles) {
      if (onProgress) onProgress({ domain, title, status: 'scraping' });
      const result = await scrapeWikipedia(title);
      results.push({ title, ...result });
      // Polite delay to avoid rate limiting
      await new Promise(r => setTimeout(r, 800));
    }
  }

  return {
    success: true,
    processed: results.length,
    successful: results.filter(r => r.success).length,
    failed: results.filter(r => !r.success).length,
    knowledgeStats: stats(),
    results
  };
}

module.exports = {
  scrapeWikipedia,
  scrapeUrl,
  autoLearn,
  AUTO_LEARN_TOPICS
};
