const fs = require('fs');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const Groq = require('groq-sdk');

const FRONTEND_SRC = path.join(__dirname, '..', '..', 'frontend', 'src');
const BACKUP_DIR = path.join(__dirname, '..', 'backups', 'frontend_baseline');

// Ensure backups exist
const targetFiles = ['Component/terminal.js', 'index.css', 'App.css'];

module.exports = {
  name: 'ui-modifier',
  description: 'Dynamically recompiles and modifies F.R.I.D.A.Y.s own frontend UI files using Gemini AI.',
  
  async execute(params) {
    const { action, query } = params;

    if (action === 'revert') {
      return this.revertUI();
    }

    if (action === 'modify' && query) {
      return this.modifyUI(query);
    }

    return { success: false, answer: 'Unknown UI action specified.' };
  },

  async revertUI() {
    try {
      console.log('[UI-MODIFIER] Reverting to baseline...');
      for (const file of targetFiles) {
        const backupPath = path.join(BACKUP_DIR, path.basename(file));
        const destPath = path.join(FRONTEND_SRC, file);
        if (fs.existsSync(backupPath)) {
          fs.copyFileSync(backupPath, destPath);
        }
      }
      return { success: true, answer: 'My frontend geometry has been successfully reverted to the baseline default, sir.' };
    } catch (err) {
      return { success: false, answer: `Failed to revert UI: ${err.message}` };
    }
  },

  async modifyUI(query) {
    if (!process.env.GROQ_API_KEY) {
      return { success: false, answer: 'Groq API Key missing. I cannot recompile my HUD geometry without cloud intelligence.' };
    }

    try {
      console.log(`[UI-MODIFIER] Initiating UI recompilation for query: "${query}"`);
      const terminalJsPath = path.join(FRONTEND_SRC, 'Component', 'terminal.js');
      const indexCssPath = path.join(FRONTEND_SRC, 'index.css');

      const currentTerminalJs = fs.existsSync(terminalJsPath) ? fs.readFileSync(terminalJsPath, 'utf8') : '';
      const currentIndexCss = fs.existsSync(indexCssPath) ? fs.readFileSync(indexCssPath, 'utf8') : '';

      const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

      const prompt = `You are F.R.I.D.A.Y.'s Core Engineering Matrix. 
The user wants to dynamically change your frontend React UI based on this request: "${query}"

Here is the current terminal.js:
\`\`\`javascript
${currentTerminalJs}
\`\`\`

Here is the current index.css:
\`\`\`css
${currentIndexCss}
\`\`\`

Provide the FULL updated code for index.css and terminal.js. Do not skip or truncate any logic. Output strictly valid JSON.
Format:
{
  "terminal_js": "full code here...",
  "index_css": "full code here..."
}`;

      const response = await groq.chat.completions.create({
        messages: [{ role: 'user', content: prompt }],
        model: 'llama-3.3-70b-versatile',
        response_format: { type: "json_object" },
      });

      const responseText = response.choices[0]?.message?.content || '{}';
      const parsed = JSON.parse(responseText);

      if (parsed.terminal_js && parsed.index_css) {
        fs.writeFileSync(terminalJsPath, parsed.terminal_js);
        fs.writeFileSync(indexCssPath, parsed.index_css);
        return { success: true, answer: 'HUD geometry recompilation complete. The interface has been updated, sir.' };
      } else {
        return { success: false, answer: 'The generation matrix failed to produce valid code structures.' };
      }

    } catch (err) {
      console.error(err);
      return { success: false, answer: `Critical error during UI recompilation: ${err.message}` };
    }
  }
};
