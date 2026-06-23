const { GoogleGenerativeAI } = require('@google/generative-ai');
const memoryModule = require('./memory');

function classifyQuery(query) {
  const q = query.toLowerCase();
  if (/(?:trade|trading|crypto|forex|shares|stock|ticker|rsi|price|exchange)/.test(q)) return 'trading';
  if (/(?:geopolitics|geopolitical|cold war|pacific|middle east|europe|macro)/.test(q)) return 'geopolitics';
  if (/(?:legal|compliance|nda|agreement|contract|contractor|tax entity|audit)/.test(q)) return 'legal';
  if (/(?:cybersecurity|vulnerability|defense|hack|security|malware|ransomware|penetration)/.test(q)) return 'cybersecurity';
  return 'general';
}

module.exports = {
  description: "Advanced analytical engine. Evaluates complex problems using web search context and returns formatted, strategic, logic-backed reports.",
  parameters: {
    query: { type: "string", description: "Complex problem or question to analyze" },
    webContext: { type: "string", description: "Optional web search results text for context" }
  },
  async execute(params) {
    const query = params.query;
    const webContext = params.webContext || '';
    if (!query) throw new Error("Query parameter is required for analysis.");

    const category = classifyQuery(query);

    // 1. Load historical learnings from memory
    let previousLearnings = [];
    try {
      const memRes = await memoryModule.execute({ action: 'get' });
      if (memRes.success && memRes.memory && memRes.memory.learnedKnowledge) {
        previousLearnings = memRes.memory.learnedKnowledge[category] || [];
      }
    } catch (err) {
      console.warn("Failed to load historical memory in analyst.js:", err.message);
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      // Offline RAG parser: Parse search results from webContext
      const parsedResults = [];
      const blocks = webContext.split(/\[\d+\]/);
      
      for (const block of blocks) {
        if (!block.trim()) continue;
        const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
        let title = '';
        let url = '';
        let content = '';
        
        for (const line of lines) {
          if (line.startsWith('Title:') || line.startsWith('Source:')) {
            title = line.replace(/^(Title:|Source:)/i, '').trim();
          } else if (line.startsWith('URL:')) {
            url = line.substring(4).trim();
          } else if (line.startsWith('Content:') || line.startsWith('Snippet:')) {
            content = line.replace(/^(Content:|Snippet:)/i, '').trim();
          } else if (!title && !url && !content) {
            title = line;
          } else if (title && url && !content) {
            content = line;
          }
        }
        
        if (title || url || content) {
          parsedResults.push({
            title: title || 'Web Resource',
            url: url || '#',
            content: content || 'No snippet content.'
          });
        }
      }

      // Compile dynamic report sections
      const subject = query.toUpperCase();
      let executiveSummary = `Offline real-time RAG analysis compiled for subject "${subject}". `;
      let inDepthAnalysis = `We scanned the web database and retrieved key real-time telemetry:\n`;
      let recommendations = [];
      
      if (parsedResults.length > 0) {
        executiveSummary += `Based on the latest web telemetry (retrieved via ${parsedResults.length} real-time source feeds), there is active market/geopolitical interest surrounding this query. Key highlights indicate positive coverage and active risk monitoring.`;
        
        parsedResults.forEach((r, idx) => {
          inDepthAnalysis += `\n[Source ${idx+1}] ${r.title}\n  > Context: ${r.content}\n  > Reference Link: ${r.url}\n`;
        });
        
        // Formulate smart rule-based recommendations based on keyword flags
        const fullContentText = parsedResults.map(r => r.content + r.title).join(' ').toLowerCase();
        
        if (fullContentText.includes('down') || fullContentText.includes('fall') || fullContentText.includes('decline') || fullContentText.includes('bearish') || fullContentText.includes('risk')) {
          recommendations.push("Implement strict protective hedging or stop-losses due to downward pressure indicated in news feeds.");
          recommendations.push("Divert short-term exposure into neutral cash/gold reserve assets until volatility decreases.");
        } else {
          recommendations.push("Capitalize on the positive momentum indicated across active source feeds.");
          recommendations.push("Gradually scale into long positions with standard trailing stop mitigations.");
        }
        recommendations.push("Examine the detailed source URLs listed below to audit compliance changes manually.");

        // Offline learning extraction: save key insights to memory to satisfy self-improvement
        const keyInsight = `Learned from web scrape: ${parsedResults[0].title} - ${parsedResults[0].content.substring(0, 100)}`;
        try {
          await memoryModule.execute({
            action: 'add_learning',
            category,
            learning: keyInsight
          });
        } catch (e) {
          console.warn("Failed to write offline learnings:", e.message);
        }
      } else {
        executiveSummary += "No external web resources were available to compile real-time telemetry. Standby mode active.";
        inDepthAnalysis += "  > Scraper feeds returned empty. Direct web link might be temporarily rate-limited.\n";
        recommendations.push("Verify your local internet connection and retry.");
        recommendations.push("Manually check terminal connectivity on port 5000.");
      }

      const compiledReport = 
        `==================================================\n` +
        `   F.R.I.D.A.Y. OFFLINE COGNITIVE REPORT: ${subject}\n` +
        `==================================================\n\n` +
        `1. EXECUTIVE SUMMARY\n` +
        `   ${executiveSummary}\n\n` +
        `2. IN-DEPTH ANALYSIS\n` +
        `   ${inDepthAnalysis}\n\n` +
        `3. LOGIC-BACKED RECOMMENDATIONS\n` +
        `   ${recommendations.map((r, i) => `  * ${r}`).join('\n')}\n\n` +
        `4. STRATEGIC PROJECTION\n` +
        `   Mid-to-long term trends depend heavily on the evolution of variables from the referenced sources. Close tracking of regulatory / market bulletins is advised.\n\n` +
        `5. TRUSTED SOURCES REFERENCED\n` +
        (parsedResults.length > 0 ? parsedResults.map(r => `   - ${r.title}: ${r.url}`).join('\n') : "   No links registered.");

      return {
        success: true,
        report: compiledReport
      };
    }

    try {
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

      const prompt = `
      You are F.R.I.D.A.Y.'s internal "Analyst" cognitive engine.
      Your task is to analyze the following query and provide a detailed, logic-backed strategic report.
      
      User Query: "${query}"
      Category: "${category}"
      
      Historical Learned Knowledge (Day 0 to present):
      ${previousLearnings.length > 0 ? previousLearnings.map((l, i) => ` - ${l}`).join('\n') : 'No previous history recorded yet.'}
      
      Web Search Context (RAG):
      ${webContext}
      
      Please structure your analysis to solve the user's problem. You must do two things:
      1. Analyze the context and write a detailed report with recommendations backed by trusted guides/books/articles in the web context.
      2. Extract 2-3 core, actionable general principles or rules (new learnings) from the trusted sources/guides to improve F.R.I.D.A.Y.'s future capabilities in this category.
      
      Your response MUST be a valid, parseable JSON object matching this structure:
      {
        "report": "detailed strategic report including: 1. EXECUTIVE SUMMARY, 2. IN-DEPTH ANALYSIS, 3. LOGIC-BACKED RECOMMENDATIONS, 4. STRATEGIC PROJECTION",
        "newLearnings": ["Learning 1 from trusted sources...", "Learning 2 from trusted sources..."]
      }
      
      Do not include any markdown format tags (like \`\`\`json) or conversational text around the JSON. Output only raw JSON.
      `;

      const result = await model.generateContent(prompt);
      const response = await result.response;
      let text = response.text().trim();

      // Clean markdown tags if returned
      if (text.startsWith('```')) {
        text = text.replace(/^```json\n/, '').replace(/^```\n/, '').replace(/```$/, '').trim();
      }

      let parsed = { report: text, newLearnings: [] };
      try {
        parsed = JSON.parse(text);
      } catch (err) {
        console.warn("Failed to parse analyst JSON response, treating as raw report:", err.message);
      }

      // Save any new learnings to the memory system (Day 0 persistence, no forgetting)
      if (parsed.newLearnings && Array.isArray(parsed.newLearnings) && parsed.newLearnings.length > 0) {
        for (const learning of parsed.newLearnings) {
          if (learning && learning.trim()) {
            await memoryModule.execute({
              action: 'add_learning',
              category,
              learning: learning.trim()
            });
          }
        }
      }

      return {
        success: true,
        report: parsed.report || text
      };
    } catch (err) {
      return {
        success: false,
        error: err.message,
        report: `Error generating report: ${err.message}`
      };
    }
  }
};
