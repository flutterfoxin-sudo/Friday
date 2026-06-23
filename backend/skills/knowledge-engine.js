/**
 * knowledge-engine.js
 * Custom BM25 retrieval engine — zero external dependencies.
 * Powers F.R.I.D.A.Y.'s local knowledge search.
 */

const fs = require('fs');
const path = require('path');

const KB_FILE = path.join(__dirname, 'knowledge-base.json');
const K1 = 1.5;  // BM25 term frequency saturation
const B  = 0.75; // BM25 length normalization

let cachedChunks = [];
let tokenizedDocs = [];
let cachedDf = {};
let cachedAvgDocLen = 0;

// Initialize cache synchronously on startup
function initCache() {
  cachedChunks = loadChunks();
  tokenizedDocs = [];
  cachedDf = {};
  
  if (cachedChunks.length === 0) {
    cachedAvgDocLen = 0;
    return;
  }

  let totalTokens = 0;
  for (const chunk of cachedChunks) {
    const tokens = tokenize(chunk.text);
    tokenizedDocs.push(tokens);
    totalTokens += tokens.length;
    
    const seen = new Set(tokens);
    for (const t of seen) {
      cachedDf[t] = (cachedDf[t] || 0) + 1;
    }
  }
  
  cachedAvgDocLen = totalTokens / tokenizedDocs.length;
}

// ── Storage helpers ─────────────────────────────────────────
function loadChunks() {
  try {
    if (!fs.existsSync(KB_FILE)) return [];
    return JSON.parse(fs.readFileSync(KB_FILE, 'utf8')) || [];
  } catch { return []; }
}

function saveChunks(chunks) {
  // NEW: Auto-backup before overwrite
  try {
    if (fs.existsSync(KB_FILE)) {
      const backupDir = path.join(__dirname, '..', 'backups');
      if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
      fs.copyFileSync(KB_FILE, path.join(backupDir, `kb-${Date.now()}.json`));
      // Prune: keep only latest 3
      const old = fs.readdirSync(backupDir).filter(f => f.startsWith('kb-')).sort().reverse();
      for (const f of old.slice(3)) fs.unlinkSync(path.join(backupDir, f));
    }
  } catch (e) {
    console.error('[KB-BACKUP-ERR] Failed to perform auto-backup:', e.message);
  }

  // EXISTING (unchanged):
  fs.writeFileSync(KB_FILE, JSON.stringify(chunks, null, 2), 'utf8');
  // Re-init cache immediately to reflect new state
  initCache();
}

// ── Tokeniser ────────────────────────────────────────────────
function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 2 && !STOPWORDS.has(t));
}

const STOPWORDS = new Set([
  'the','and','for','are','was','were','this','that','with','have',
  'from','they','will','been','has','had','not','but','its','can',
  'all','one','which','you','your','our','their','about','into',
  'more','also','than','then','when','what','who','how','each','per'
]);

// Call once when module loads
initCache();

// ── BM25 scoring ─────────────────────────────────────────────
function bm25Score(queryTokens, docTokens, avgDocLen, docCount, df) {
  const docLen = docTokens.length;
  const tf_map = {};
  for (const t of docTokens) tf_map[t] = (tf_map[t] || 0) + 1;

  let score = 0;
  for (const qt of queryTokens) {
    if (!tf_map[qt]) continue;
    const tf = tf_map[qt];
    const idf = Math.log((docCount - (df[qt] || 0) + 0.5) / ((df[qt] || 0) + 0.5) + 1);
    const numerator   = tf * (K1 + 1);
    const denominator = tf + K1 * (1 - B + B * (docLen / avgDocLen));
    score += idf * (numerator / denominator);
  }
  return score;
}

// ── Public API ───────────────────────────────────────────────
function search(query, topK = 5) {
  if (cachedChunks.length === 0) return [];

  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return [];

  // Score each chunk using precomputed cache
  const scored = cachedChunks.map((chunk, i) => ({
    chunk,
    score: bm25Score(queryTokens, tokenizedDocs[i], cachedAvgDocLen, cachedChunks.length, cachedDf)
  }));

  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(s => ({ ...s.chunk, score: s.score }));
}

function addChunks(newChunks) {
  const existingIds = new Set(cachedChunks.map(c => c.id));
  const existingTexts = new Set(cachedChunks.map(c => c.text.substring(0, 100)));

  const toAdd = newChunks.filter(c =>
    !existingIds.has(c.id) && !existingTexts.has(c.text.substring(0, 100))
  );

  const merged = [...cachedChunks, ...toAdd];
  saveChunks(merged); // This triggers cache rebuild
  return { added: toAdd.length, total: merged.length };
}

function stats() {
  const domains = {};
  const sources = new Set();
  for (const c of cachedChunks) {
    domains[c.domain] = (domains[c.domain] || 0) + 1;
    sources.add(c.source);
  }
  return {
    totalChunks: cachedChunks.length,
    domains,
    sources: [...sources],
    sourceCount: sources.size
  };
}

function clearDomain(domain) {
  const filtered = domain === 'all' ? [] : cachedChunks.filter(c => c.domain !== domain);
  const removed = cachedChunks.length - filtered.length;
  saveChunks(filtered); // This triggers cache rebuild
  return { removed, remaining: filtered.length };
}

module.exports = { search, addChunks, stats, clearDomain, tokenize };
