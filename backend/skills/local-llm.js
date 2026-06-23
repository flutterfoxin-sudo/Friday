/**
 * local-llm.js
 * Ollama local LLM wrapper for F.R.I.D.A.Y.
 * Provides the same interface as Gemini so the rest of the system
 * is LLM-agnostic. Falls back gracefully if Ollama is offline.
 */

const http = require('http');

const OLLAMA_HOST = 'localhost';
const OLLAMA_PORT = 11434;
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || 'llama3.2:3b';
const TIMEOUT_MS = 600000; // 10 min — local inference can be slower with large BM25 contexts

// ── Check if Ollama is running ───────────────────────────────
let availabilityCache = {
  lastChecked: 0,
  value: false
};

async function isOllamaAvailable() {
  const now = Date.now();
  if (now - availabilityCache.lastChecked < 30000) {
    return availabilityCache.value;
  }
  return new Promise((resolve) => {
    const req = http.request(
      { hostname: OLLAMA_HOST, port: OLLAMA_PORT, path: '/api/tags', method: 'GET' },
      (res) => {
        const available = res.statusCode === 200;
        availabilityCache.lastChecked = Date.now();
        availabilityCache.value = available;
        resolve(available);
      }
    );
    req.on('error', () => {
      availabilityCache.lastChecked = Date.now();
      availabilityCache.value = false;
      resolve(false);
    });
    req.setTimeout(3000, () => {
      req.destroy();
      availabilityCache.lastChecked = Date.now();
      availabilityCache.value = false;
      resolve(false);
    });
    req.end();
  });
}

// ── List available local models ──────────────────────────────
async function listModels() {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: OLLAMA_HOST, port: OLLAMA_PORT, path: '/api/tags', method: 'GET' },
      (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try { resolve(JSON.parse(data).models || []); }
          catch { resolve([]); }
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

// ── Generate text via Ollama ─────────────────────────────────
async function generate({ prompt, systemPrompt = '', model = DEFAULT_MODEL, temperature = 0.7 }) {
  return new Promise((resolve, reject) => {
    const fullPrompt = systemPrompt
      ? `${systemPrompt}\n\nUser: ${prompt}\nAssistant:`
      : prompt;

    const body = JSON.stringify({
      model,
      prompt: fullPrompt,
      stream: false,
      options: { temperature, num_predict: 1024 }
    });

    const req = http.request(
      {
        hostname: OLLAMA_HOST,
        port: OLLAMA_PORT,
        path: '/api/generate',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body)
        }
      },
      (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            resolve({
              success: true,
              text: (parsed.response || '').trim(),
              model,
              source: 'local',
              done: parsed.done,
              evalDuration: parsed.eval_duration
            });
          } catch (err) {
            reject(new Error(`Failed to parse Ollama response: ${err.message}`));
          }
        });
      }
    );

    req.on('error', reject);
    req.setTimeout(TIMEOUT_MS, () => {
      req.destroy();
      reject(new Error('Ollama request timed out'));
    });

    req.write(body);
    req.end();
  });
}

// ── Chat endpoint (multi-turn) ────────────────────────────────
async function chat({ messages, model = DEFAULT_MODEL, systemPrompt = '' }) {
  return new Promise((resolve, reject) => {
    const chatMessages = systemPrompt
      ? [{ role: 'system', content: systemPrompt }, ...messages]
      : messages;

    const body = JSON.stringify({ model, messages: chatMessages, stream: false });

    const req = http.request(
      {
        hostname: OLLAMA_HOST,
        port: OLLAMA_PORT,
        path: '/api/chat',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body)
        }
      },
      (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            resolve({
              success: true,
              text: (parsed.message?.content || '').trim(),
              model,
              source: 'local'
            });
          } catch (err) {
            reject(new Error(`Failed to parse Ollama chat response: ${err.message}`));
          }
        });
      }
    );

    req.on('error', reject);
    req.setTimeout(TIMEOUT_MS, () => {
      req.destroy();
      reject(new Error('Ollama chat timed out'));
    });

    req.write(body);
    req.end();
  });
}

module.exports = {
  isOllamaAvailable,
  listModels,
  generate,
  chat,
  DEFAULT_MODEL
};
