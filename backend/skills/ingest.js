/**
 * ingest.js
 * Document ingestion skill for F.R.I.D.A.Y.
 * Parses PDF, DOCX, and TXT files into knowledge chunks
 * and persists them to knowledge-base.json.
 */

const fs = require('fs');
const path = require('path');
const { addChunks } = require('./knowledge-engine');

const { v4: uuidv4 } = (() => {
  try { return require('uuid'); }
  catch { return { v4: () => Math.random().toString(36).substring(2) + Date.now().toString(36) }; }
})();

const CHUNK_SIZE = 400;
const CHUNK_OVERLAP = 50;

// ── Domain detection from filename + content ──────────────────
function detectDomain(filename, text) {
  const combined = (filename + ' ' + text.substring(0, 1500)).toLowerCase();
  
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

// ── Chunk plain text ──────────────────────────────────────────
function chunkText(text, source, domain) {
  const words = text.split(/\s+/).filter(w => w.length > 0);
  const chunks = [];
  let i = 0;

  while (i < words.length) {
    const slice = words.slice(i, i + CHUNK_SIZE);
    if (slice.length < 30) break;
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

// ── PDF parser ────────────────────────────────────────────────
async function parsePDF(filePath) {
  const pdfParse = require('pdf-parse');
  const buffer = fs.readFileSync(filePath);
  const data = await pdfParse(buffer);
  return data.text || '';
}

// ── DOCX parser ───────────────────────────────────────────────
async function parseDOCX(filePath) {
  const mammoth = require('mammoth');
  const result = await mammoth.extractRawText({ path: filePath });
  return result.value || '';
}

// ── TXT parser ────────────────────────────────────────────────
function parseTXT(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

// ── Main ingest function ──────────────────────────────────────
async function ingestFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return { success: false, error: `File not found: ${filePath}` };
  }

  const ext = path.extname(filePath).toLowerCase();
  const filename = path.basename(filePath);
  let text = '';

  try {
    if (ext === '.pdf') {
      text = await parsePDF(filePath);
    } else if (ext === '.docx' || ext === '.doc') {
      text = await parseDOCX(filePath);
    } else if (ext === '.txt' || ext === '.md') {
      text = parseTXT(filePath);
    } else {
      return { success: false, error: `Unsupported file type: ${ext}. Supported: PDF, DOCX, TXT, MD` };
    }
  } catch (err) {
    return { success: false, error: `Failed to parse ${filename}: ${err.message}` };
  }

  if (!text || text.trim().length < 100) {
    return { success: false, error: `${filename} appears to be empty or unreadable` };
  }

  // Clean up text
  text = text
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\t/g, ' ')
    .trim();

  const domain = detectDomain(filename, text);
  const source = `doc/${filename}`;
  const chunks = chunkText(text, source, domain);
  const result = addChunks(chunks);

  return {
    success: true,
    filename,
    domain,
    fileType: ext,
    wordCount: text.split(/\s+/).length,
    chunksCreated: chunks.length,
    chunksAdded: result.added,
    totalKB: result.total,
    preview: text.substring(0, 200) + '...'
  };
}

// ── Ingest from text string (direct paste) ────────────────────
async function ingestText(text, sourceName = 'manual-input', domainHint = 'general') {
  if (!text || text.trim().length < 50) {
    return { success: false, error: 'Text too short to be useful' };
  }

  const domain = domainHint !== 'general' ? domainHint : detectDomain(sourceName, text);
  const chunks = chunkText(text.trim(), `text/${sourceName}`, domain);
  const result = addChunks(chunks);

  return {
    success: true,
    source: sourceName,
    domain,
    chunksAdded: result.added,
    totalKB: result.total
  };
}

module.exports = { ingestFile, ingestText };
