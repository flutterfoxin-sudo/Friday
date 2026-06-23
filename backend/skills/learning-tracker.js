const fs = require('fs');
const path = require('path');

const DATASET_FILE = path.join(__dirname, '..', 'identity', 'synthetic_dataset.jsonl');
const TELEMETRY_FILE = path.join(__dirname, '..', 'identity', 'learning_telemetry.json');

// Initialize telemetry file if missing
if (!fs.existsSync(TELEMETRY_FILE)) {
  fs.writeFileSync(TELEMETRY_FILE, JSON.stringify({
    totalQueries: 0,
    localSuccesses: 0,
    cloudFallbacks: 0,
    syntheticPairsExtracted: 0,
    intelligenceScale: 0.1 // 0.0 to 1.0 representing human equivalence progression
  }, null, 2));
}

function getTelemetry() {
  try {
    const data = JSON.parse(fs.readFileSync(TELEMETRY_FILE, 'utf8'));
    const defaults = {
      totalQueries: 0,
      localSuccesses: 0,
      cloudFallbacks: 0,
      syntheticPairsExtracted: 0,
      intelligenceScale: 0.1,
      soulCyclesCompleted: 0,
      soulArticlesLearned: 0,
      soulFactsVerified: 0,
      soulMythsDebunked: 0,
      soulWisdomExtracted: 0
    };
    return { ...defaults, ...data };
  } catch (err) {
    return {
      totalQueries: 0,
      localSuccesses: 0,
      cloudFallbacks: 0,
      syntheticPairsExtracted: 0,
      intelligenceScale: 0.1,
      soulCyclesCompleted: 0,
      soulArticlesLearned: 0,
      soulFactsVerified: 0,
      soulMythsDebunked: 0,
      soulWisdomExtracted: 0
    };
  }
}

function saveTelemetry(data) {
  fs.writeFileSync(TELEMETRY_FILE, JSON.stringify(data, null, 2));
}

module.exports = {
  recordQuery: function(engineUsed) {
    const data = getTelemetry();
    data.totalQueries += 1;
    if (engineUsed === 'local') {
      data.localSuccesses += 1;
      // Local success means we are more intelligent!
      data.intelligenceScale = Math.min(1.0, data.intelligenceScale + 0.005);
    } else if (engineUsed === 'groq' || engineUsed === 'gemini') {
      data.cloudFallbacks += 1;
    }
    saveTelemetry(data);
  },

  logSyntheticPair: function(instruction, output) {
    const pair = {
      instruction: instruction.trim(),
      output: output.trim(),
      system_prompt: "You are F.R.I.D.A.Y." // Keep it brief for now to save space
    };
    
    // Append to JSONL for future Unsloth/PyTorch training
    fs.appendFileSync(DATASET_FILE, JSON.stringify(pair) + '\n');
    
    // Update telemetry
    const data = getTelemetry();
    data.syntheticPairsExtracted += 1;
    // Each synthetic pair extracted makes the future local model smarter
    data.intelligenceScale = Math.min(1.0, data.intelligenceScale + 0.002);
    saveTelemetry(data);
  },

  getStats: function() {
    return getTelemetry();
  }
};
