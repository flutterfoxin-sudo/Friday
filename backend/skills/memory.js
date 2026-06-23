const fs = require('fs');
const path = require('path');

const MEMORY_FILE = path.join(__dirname, 'memory.json');

function getMemory() {
  const defaultMemory = {
    userProfile: {
      name: "User",
      preferences: {
        interests: []
      },
      extractedFacts: []
    },
    learnedKnowledge: {
      trading: [],
      geopolitics: [],
      legal: [],
      general: []
    },
    searchHistory: [],
    queryHistory: [],
    systemStats: {
      totalInteractions: 0,
      successfulSearches: 0
    }
  };

  if (!fs.existsSync(MEMORY_FILE)) {
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(defaultMemory, null, 2), 'utf8');
  }

  try {
    const mem = JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8'));
    if (!mem.learnedKnowledge) {
      mem.learnedKnowledge = {
        trading: [],
        geopolitics: [],
        legal: [],
        general: []
      };
    }
    return mem;
  } catch (err) {
    return defaultMemory;
  }
}

function saveMemory(data) {
  try {
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to save memory:', err);
  }
}

module.exports = {
  description: "Accesses, updates, or resets the J.A.R.V.I.S./F.R.I.D.A.Y. semantic memory and user profile context.",
  parameters: {
    action: { type: "string", description: "Action: 'get' | 'clear' | 'add_fact' | 'update_preferences' | 'add_learning'" },
    fact: { type: "string", description: "Fact string to add (for add_fact action)" },
    preferenceKey: { type: "string", description: "Preference key (for update_preferences)" },
    preferenceValue: { type: "string", description: "Preference value (for update_preferences)" },
    category: { type: "string", description: "Category for learning: 'trading' | 'geopolitics' | 'legal' | 'general'" },
    learning: { type: "string", description: "Learning text to store in the knowledge base" }
  },
  async execute({ action = 'get', fact = '', preferenceKey = '', preferenceValue = '', category = 'general', learning = '' }) {
    const memory = getMemory();

    if (action === 'clear') {
      const defaultMemory = {
        userProfile: { name: "User", preferences: { interests: [] }, extractedFacts: [] },
        learnedKnowledge: { trading: [], geopolitics: [], legal: [], general: [] },
        searchHistory: [],
        queryHistory: [],
        systemStats: { totalInteractions: 0, successfulSearches: 0 }
      };
      saveMemory(defaultMemory);
      return { success: true, message: "Memory cleared successfully.", memory: defaultMemory };
    }

    if (action === 'add_fact') {
      if (fact) {
        if (!memory.userProfile.extractedFacts.includes(fact)) {
          memory.userProfile.extractedFacts.push(fact);
        }
        saveMemory(memory);
        return { success: true, message: `Fact added: "${fact}"`, memory };
      }
      return { success: false, error: "Fact is required for add_fact action." };
    }

    if (action === 'update_preferences') {
      if (preferenceKey && preferenceValue) {
        memory.userProfile.preferences[preferenceKey] = preferenceValue;
        saveMemory(memory);
        return { success: true, message: `Preference updated: ${preferenceKey} = ${preferenceValue}`, memory };
      }
      return { success: false, error: "preferenceKey and preferenceValue are required." };
    }

    if (action === 'add_learning') {
      if (learning) {
        const cat = (category || 'general').toLowerCase();
        if (!memory.learnedKnowledge) {
          memory.learnedKnowledge = { trading: [], geopolitics: [], legal: [], general: [] };
        }
        if (!memory.learnedKnowledge[cat]) {
          memory.learnedKnowledge[cat] = [];
        }
        if (!memory.learnedKnowledge[cat].includes(learning)) {
          memory.learnedKnowledge[cat].push(learning);
        }
        saveMemory(memory);
        return { success: true, message: `Learning added to category [${cat}]: "${learning}"`, memory };
      }
      return { success: false, error: "learning is required for add_learning action." };
    }

    // Default 'get' action
    return { success: true, memory };
  }
};
