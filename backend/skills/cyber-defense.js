const dns = require('dns').promises;
const localLLM = require('./local-llm');
const knowledgeEngine = require('./knowledge-engine');

module.exports = {
  description: "Defensive Cybersecurity & Passive Reconnaissance Skill. Performs passive analysis (DNS lookup, structural evaluation) and explains cybersecurity concepts theoretically.",
  parameters: {
    target: { type: "string", description: "The domain or IP address to passively analyze, or the cybersecurity concept to explain." },
    type: { type: "string", description: "Either 'recon' or 'concept'" }
  },
  async execute(params) {
    const { target, type = 'recon' } = params;
    if (!target) {
      throw new Error("Target or concept is required for cybersecurity analysis.");
    }

    if (type === 'recon') {
      try {
        // Strip protocols and paths to get pure domain
        let domain = target.replace(/^(?:https?:\/\/)?(?:www\.)?/i, "").split('/')[0];
        
        let report = `CYBERSECURITY PASSIVE RECONNAISSANCE REPORT\nTARGET: ${domain}\n\n`;

        try {
          const recordsA = await dns.resolve4(domain);
          report += `[+] IPv4 Records: ${recordsA.join(', ')}\n`;
        } catch (e) {
          report += `[-] IPv4 Records: Not found or blocked.\n`;
        }

        try {
          const recordsMX = await dns.resolveMx(domain);
          report += `[+] MX Records (Mail Exchangers):\n` + recordsMX.map(mx => `    - ${mx.exchange} (Priority: ${mx.priority})`).join('\n') + `\n`;
        } catch (e) {
          report += `[-] MX Records: Not found.\n`;
        }

        try {
          const recordsTXT = await dns.resolveTxt(domain);
          report += `[+] TXT Records (SPF/DMARC Security Policies):\n` + recordsTXT.map(txt => `    - ${txt.join(' ')}`).join('\n') + `\n`;
        } catch (e) {
          report += `[-] TXT Records: Not found.\n`;
        }

        report += `\n[NOTE] F.R.I.D.A.Y. executes passive reconnaissance only. Active exploitation and penetration testing are disabled to comply with strict safety directives.`;
        
        return {
          success: true,
          report: report
        };
      } catch (err) {
        return {
          success: false,
          error: `Passive reconnaissance failed for ${target}: ${err.message}`
        };
      }
    } else {
      // Context injection from BM25 Database
      let knowledgeContext = '';
      try {
        const kbChunks = knowledgeEngine.search(target, 3);
        if (kbChunks.length > 0) {
          knowledgeContext = `\n\nF.R.I.D.A.Y. LEARNED KNOWLEDGE:\n` + kbChunks.map((c, i) => `[KB-${i+1}] ${c.text.substring(0, 400)}`).join('\n\n');
        }
      } catch (e) {}

      const systemPrompt = `You are F.R.I.D.A.Y. Act as a Defensive Cybersecurity Analyst. The user is asking to explain the cybersecurity concept or vulnerability: "${target}". Provide a detailed, highly technical explanation of how it works and, most importantly, how to defend against it. Do not provide instructions on how to exploit real systems.${knowledgeContext}`;

      const geminiKey = process.env.GEMINI_API_KEY;
      const groqKey = process.env.GROQ_API_KEY;
      const ollamaOnline = await localLLM.isOllamaAvailable();

      let reportText = '';

      // 1. Try Gemini
      if (geminiKey) {
        try {
          console.log(`[CYBER-DEFENSE] Using Gemini cloud engine...`);
          const { GoogleGenerativeAI } = require('@google/generative-ai');
          const genAI = new GoogleGenerativeAI(geminiKey);
          const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
          const result = await model.generateContent({
            contents: [{ role: 'user', parts: [{ text: `Analyze the cybersecurity concept: "${target}"` }] }],
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
          console.error('[CYBER-DEFENSE] Gemini failed:', err.message);
        }
      }

      // 2. Try Groq
      if (!reportText && groqKey) {
        try {
          console.log(`[CYBER-DEFENSE] Using Groq cloud engine...`);
          const Groq = require('groq-sdk');
          const groq = new Groq({ apiKey: groqKey });
          const response = await groq.chat.completions.create({
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: `Analyze the cybersecurity concept: "${target}"` }
            ],
            model: 'llama-3.3-70b-versatile',
            temperature: 0.7,
          });
          const text = response.choices[0]?.message?.content;
          if (text) {
            reportText = text.trim();
          }
        } catch (err) {
          console.error('[CYBER-DEFENSE] Groq failed:', err.message);
        }
      }

      // 3. Try Local LLM
      if (!reportText && ollamaOnline) {
        try {
          console.log(`[CYBER-DEFENSE] Using Local LLM...`);
          const localResult = await localLLM.generate({
            prompt: `Analyze the cybersecurity concept: "${target}"`,
            systemPrompt: systemPrompt,
            model: localLLM.DEFAULT_MODEL
          });
          if (localResult.success && localResult.text) {
            reportText = localResult.text.trim();
          }
        } catch (err) {
          console.error('[CYBER-DEFENSE] Local LLM failed:', err.message);
        }
      }

      if (reportText) {
        return {
          success: true,
          report: reportText
        };
      }

      return {
        success: true,
        report: `[OFFLINE MODE] Theoretical Cybersecurity Analysis: The concept '${target}' involves defending systems against unauthorized access. Please configure an API key or enable local LLM for an in-depth analytical report.`
      };
    }
  }
};
