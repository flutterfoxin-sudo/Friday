const search = require('./search');
const webLearn = require('./web-learn');
const knowledgeEngine = require('./knowledge-engine');
const learningTracker = require('./learning-tracker');
const Groq = require('groq-sdk');
const { v4: uuidv4 } = (() => {
  try { return require('uuid'); }
  catch { return { v4: () => Math.random().toString(36).substring(2) + Date.now().toString(36) }; }
})();

module.exports = {
  description: "Autonomous Deep Learning Matrix. Searches Web & YouTube, scrapes text, uses LLM to fact-check & debunk myths, injects to Cognitive Core.",
  parameters: {
    topic: { type: "string", description: "The topic to learn about" }
  },
  
  async execute({ topic }) {
    if (!topic) return { success: false, error: 'Topic is required.' };
    
    console.log(`[AUTO-LEARN] Initiating deep autonomous sweep for: ${topic}`);

    const allResults = [];
    
    // 1. Fetch 4 Web Results
    try {
      const webSearch = await search.execute({ query: topic, mode: 'web' });
      if (webSearch.success && webSearch.results) {
        allResults.push(...webSearch.results.slice(0, 4));
      }
    } catch(e) { console.warn('Web search failed:', e.message); }

    // 2. Fetch 2 YouTube Results
    try {
      const ytSearch = await search.execute({ query: topic + ' tutorial explanation', mode: 'youtube' });
      if (ytSearch.success && ytSearch.results) {
        allResults.push(...ytSearch.results.slice(0, 2));
      }
    } catch(e) { console.warn('YouTube search failed:', e.message); }

    let totalFactsLearned = 0;
    let totalMythsDebunked = 0;
    let processedUrls = 0;
    
    const apiKey = process.env.GROQ_API_KEY;
    const groq = apiKey ? new Groq({ apiKey }) : null;

    // Loop through URLs
    for (const res of allResults) {
      if (!res.url) continue;
      console.log(`[AUTO-LEARN] Scraping: ${res.url}`);
      
      let scrapeRes;
      try {
        if (res.url.includes('wikipedia.org/wiki/')) {
          const title = res.url.split('/wiki/').pop().split('#')[0];
          scrapeRes = await webLearn.scrapeWikipedia(title);
        } else {
          scrapeRes = await webLearn.scrapeUrl(res.url);
        }
      } catch(e) { console.warn(`Scrape failed for ${res.url}`); continue; }

      if (!scrapeRes.success) continue;

      processedUrls++;
      const rawText = scrapeRes.preview || "No text available"; // We use preview to save context space, or we can use the chunks if we had access to them.
      // Actually, scrapeRes automatically adds chunks to knowledgeEngine! 
      // Wait, webLearn.js ALREADY adds raw chunks to knowledge engine.
      // To satisfy the user, we ALSO run the fact-checking LLM on the snippet/preview and add those as highly-weighted facts/myths.
      
      if (groq) {
        try {
          console.log(`[AUTO-LEARN] Running Cognitive Fact-Checker on: ${res.url}`);
          const prompt = `You are F.R.I.D.A.Y.'s internal truth-engine. Analyze this scraped text snippet about "${topic}".
1. Extract 1-3 undeniable, verified core facts.
2. Identify if there are any common myths or wrong information implied here, and debunk them.

Output ONLY a JSON object matching this structure:
{
  "facts": ["fact 1", "fact 2"],
  "myths": ["myth: [the myth] - truth: [the truth]"]
}

Source Text:
${res.snippet}
${rawText.substring(0, 1500)}`;

          const llmRes = await groq.chat.completions.create({
            messages: [{ role: 'user', content: prompt }],
            model: 'llama-3.3-70b-versatile',
            temperature: 0.2
          });
          
          let cleanJson = (llmRes.choices[0]?.message?.content || '').trim();
          if (cleanJson.startsWith('```')) cleanJson = cleanJson.replace(/^```json\n?/, '').replace(/```$/, '').trim();
          
          const parsed = JSON.parse(cleanJson);
          
          const newChunks = [];
          
          if (parsed.facts && parsed.facts.length > 0) {
            totalFactsLearned += parsed.facts.length;
            parsed.facts.forEach(f => {
              newChunks.push({
                id: uuidv4(), source: `fact_check:${res.url}`, domain: scrapeRes.domain,
                text: `[VERIFIED FACT] Regarding ${topic}: ${f}`,
                addedAt: new Date().toISOString()
              });
              // Boost telemetry
              learningTracker.logSyntheticPair(`What is a verified fact about ${topic}?`, f);
            });
          }
          
          if (parsed.myths && parsed.myths.length > 0) {
            totalMythsDebunked += parsed.myths.length;
            parsed.myths.forEach(m => {
              newChunks.push({
                id: uuidv4(), source: `myth_debunker:${res.url}`, domain: scrapeRes.domain,
                text: `[DEBUNKED MYTH WARNING] Regarding ${topic}: ${m}`,
                addedAt: new Date().toISOString()
              });
              // Boost telemetry
              learningTracker.logSyntheticPair(`What is a common myth about ${topic}?`, m);
            });
          }
          
          if (newChunks.length > 0) {
            knowledgeEngine.addChunks(newChunks);
          }
          
        } catch(e) {
          console.warn('[AUTO-LEARN] Fact check failed:', e.message);
        }
      }
    }
    
    return {
      success: true,
      report: `Digested ${processedUrls} sources. Cognitive Core updated with ${totalFactsLearned} verified facts and ${totalMythsDebunked} debunked myths.`,
      topic,
      processedUrls,
      totalFactsLearned,
      totalMythsDebunked
    };
  }
};
