/**
 * J.A.R.V.I.S / F.R.I.D.A.Y. Cyber Search Matrix Skill
 * Exposes a unified search engine with smart quota monitoring,
 * automatic DuckDuckGo/YouTube HTML scraper fallback, and statistical optimization.
 */

const fs = require('fs');
const path = require('path');

const STATS_FILE = path.join(__dirname, 'search_stats.json');

// Initialize stats if not present
function getStats() {
  if (!fs.existsSync(STATS_FILE)) {
    fs.writeFileSync(STATS_FILE, JSON.stringify({
      consecutiveFailures: 0,
      totalRequests: 0,
      apiRequests: 0,
      fallbackRequests: 0,
      avgLatencyMs: 0,
      categoryPreferences: {
        youtube: 'fallback', // Learn that video searches are best routed directly to YT scraper
        web: 'api'
      }
    }, null, 2));
  }
  try {
    return JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
  } catch (e) {
    return { consecutiveFailures: 0, totalRequests: 0, apiRequests: 0, fallbackRequests: 0, avgLatencyMs: 0, categoryPreferences: { youtube: 'fallback', web: 'api' } };
  }
}

// Save stats helper
function saveStats(stats) {
  try {
    fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));
  } catch (e) {}
}

// DuckDuckGo Fallback Scraper
async function fallbackWebSearch(query) {
  console.log(`Executing DuckDuckGo Fallback HTML scraper for: "${query}"`);
  try {
    const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    const html = await res.text();
    
    // Parse DuckDuckGo search result blocks
    const results = [];
    const matches = html.matchAll(/<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/g);
    
    for (const match of matches) {
      if (results.length >= 6) break;
      
      const rawUrl = match[1];
      let url = rawUrl;
      
      // DuckDuckGo redirects urls, parse the direct target url
      if (rawUrl.includes('uddg=')) {
        const parsedUrl = rawUrl.split('uddg=')[1]?.split('&')[0];
        if (parsedUrl) {
          url = decodeURIComponent(parsedUrl);
        }
      }

      results.push({
        title: match[2].replace(/<[^>]+>/g, '').trim(),
        url: url,
        snippet: match[3].replace(/<[^>]+>/g, '').trim()
      });
    }
    return results;
  } catch (err) {
    console.error('DuckDuckGo Scraper failed:', err.message);
    return [];
  }
}

// YouTube Fallback Scraper
async function fallbackYoutubeSearch(query) {
  console.log(`Executing YouTube Fallback HTML scraper for: "${query}"`);
  try {
    const res = await fetch(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    const html = await res.text();
    const results = [];

    // YouTube holds videoRenderer definitions in dynamic JSON inside script tags
    // Match videoId, title run text, and descriptionSnippet
    const videoMatches = html.matchAll(/"videoRenderer":\s*\{\s*"videoId":\s*"([^"]+)"[\s\S]*?"title":\s*\{\s*"runs":\s*\[\s*\{\s*"text":\s*"([^"]+)"/g);
    
    for (const match of videoMatches) {
      if (results.length >= 5) break;
      const videoId = match[1];
      const title = match[2].replace(/\\"/g, '"');
      
      results.push({
        title: title,
        url: `https://www.youtube.com/watch?v=${videoId}`,
        snippet: `Watch this video on YouTube. (ID: ${videoId})`
      });
    }
    return results;
  } catch (err) {
    console.error('YouTube scraper failed:', err.message);
    return [];
  }
}

// Tavily Search API client
async function tavilyApiSearch(query, apiKey) {
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      query: query,
      search_depth: 'basic',
      max_results: 5
    })
  });

  if (!res.ok) {
    throw new Error(`API returned HTTP ${res.status}: Quota exceeded or invalid key.`);
  }

  const data = await res.json();
  if (!data.results) {
    throw new Error('Invalid response format from Search API.');
  }

  return data.results.map(r => ({
    title: r.title,
    url: r.url,
    snippet: r.content
  }));
}

module.exports = {
  description: "Searches the web or YouTube utilizing Tavily Search API with auto-fallback to DuckDuckGo/YouTube scrapers on credit exhaustion.",
  
  parameters: {
    query: { type: "string", description: "Search terms or query string" },
    mode: { type: "string", description: "Search mode: 'web' or 'youtube'" }
  },

  async execute({ query, mode = 'web' }) {
    if (!query) {
      return { success: false, error: 'Query parameter is required.' };
    }

    const stats = getStats();
    stats.totalRequests += 1;

    const apiKey = process.env.SEARCH_API_KEY;
    const isYoutube = mode === 'youtube' || query.toLowerCase().includes('youtube') || query.toLowerCase().includes('video');

    // SELF-IMPROVEMENT LOGIC:
    // 1. If consecutive failures to the API key > 2, avoid API for next requests and force fallback.
    // 2. If it's a YouTube query, route directly to YouTube Scraper (learned preference).
    let route = 'api';
    if (!apiKey) {
      route = 'fallback';
    } else if (isYoutube && stats.categoryPreferences.youtube === 'fallback') {
      route = 'fallback';
    } else if (stats.consecutiveFailures >= 2) {
      console.warn('API key flagged as EXHAUSTED/INACTIVE. Directing query to fallback scraper.');
      route = 'fallback';
    }

    const t0 = Date.now();

    if (route === 'api') {
      try {
        stats.apiRequests += 1;
        const results = await tavilyApiSearch(query, apiKey);
        
        // Track stats success
        stats.consecutiveFailures = 0;
        const latency = Date.now() - t0;
        stats.avgLatencyMs = Math.round((stats.avgLatencyMs * 9 + latency) / 10);
        saveStats(stats);

        return {
          success: true,
          mode: isYoutube ? 'youtube' : 'web',
          source: 'External Search API (Tavily)',
          results
        };
      } catch (err) {
        console.error('External Search API failed:', err.message);
        
        // Flag error stats
        stats.consecutiveFailures += 1;
        saveStats(stats);

        // FALLBACK TRIGGER: API credits finished / timed out -> trigger scraper instantly
        console.log('API key credits exhausted or invalid. Falling back to scrapers.');
      }
    }

    // FALLBACK ROUTE (DuckDuckGo or YouTube scraper)
    stats.fallbackRequests += 1;
    let results = [];
    
    if (isYoutube) {
      results = await fallbackYoutubeSearch(query);
    } else {
      results = await fallbackWebSearch(query);
    }

    const latency = Date.now() - t0;
    stats.avgLatencyMs = Math.round((stats.avgLatencyMs * 9 + latency) / 10);
    saveStats(stats);

    return {
      success: true,
      mode: isYoutube ? 'youtube' : 'web',
      source: 'Local Scraper Fallback (Unlimited)',
      results,
      warning: route === 'api' ? 'External API credits finished. Triggered local fallback.' : undefined
    };
  }
};
