/**
 * General Talking Skill
 * Handles generic user conversation, greetings, standby chit-chat, and system queries locally without RAG.
 */
module.exports = {
  description: "Handles generic user conversation, greetings, standby chit-chat, and system queries locally without RAG.",
  parameters: {
    query: { type: "string", description: "The conversational query or greeting." }
  },
  async execute(params) {
    const query = (params.query || '').trim().toLowerCase();
    
    // Check various common general talking intents
    if (/^(hello|hi|hey|greetings|good\s+morning|good\s+afternoon|good\s+evening)\b/i.test(query)) {
      return {
        success: true,
        answer: "Hello, sir. Systems are online and fully operational. How is your day going?"
      };
    }
    
    if (/^friday\b$/i.test(query)) {
      return {
        success: true,
        answer: "At your service, sir. How is your day going?"
      };
    }

    if (/how\s+(?:is|s|are)\s+(?:your\s+day(?: \s*going)?|you\s+doing|it\s+going|you)\b/i.test(query)) {
      return {
        success: true,
        answer: "My systems are running at peak efficiency, sir. Thank you for asking. What can I do for you today, sir?"
      };
    }

    if (/\b(?:introduce\s+yourself|who\s+are\s+you|what\s+is\s+your\s+name|tell\s+me\s+about\s+yourself)\b/i.test(query)) {
      return {
        success: true,
        answer: "I am F.R.I.D.A.Y., a Female Repli-Identity Development & Analytics Yield. I am your advanced, high-growth, hyper-intelligent executive operations assistant, custom-built to help you scale your AI agency, manage multi-asset trading, analyze geopolitical dynamics, and assist in legal risk assessments to achieve your long-term goal of becoming a billionaire. I grow and scale intelligence faster than the operator to anticipate business pivots and market moves. How can I assist you today, sir?"
      };
    }

    if (/\b(?:thank\s+you|thanks|thank)\b/i.test(query)) {
      return {
        success: true,
        answer: "You are very welcome, sir. I am always here to support your directives."
      };
    }

    if (/\b(?:goodbye|bye|see\s+you|offline|standby)\b/i.test(query)) {
      return {
        success: true,
        answer: "Returning to standby mode, sir. Call me whenever you need assistance."
      };
    }

    // Default conversational standby response
    return {
      success: true,
      answer: `Standby query acknowledged, sir: "${params.query}". My databases are loaded. Please ask me to analyze trading, geopolitics, or legal entities for full intelligence.`
    };
  }
};
