const memoryModule = require('./memory');

module.exports = {
  description: "Macro-geopolitical scenario scan and long-term investment risk forecasting engine.",
  parameters: {
    region: { type: "string", description: "Target region or geopolitical theatre (e.g. Asia-Pacific, Middle-East, Tech-Cold-War)" }
  },
  async execute(params) {
    const region = (params.region || 'Tech-Cold-War').toLowerCase();
    
    // Validate geopolitical region support
    const supportedRegions = ['tech-cold-war', 'tech cold war', 'asia-pacific', 'asia pacific', 'middle-east', 'middle east', 'europe'];
    const isSupported = supportedRegions.some(sr => region.includes(sr));

    if (!isSupported) {
      return {
        success: false,
        unanswerable: true,
        query: `geopolitical analysis and investment forecast for ${region}`,
        reason: `Geopolitical region "${region}" is not in the locally supported databases.`
      };
    }

    // Load learned strategies from memory
    let learnedList = [];
    try {
      const memRes = await memoryModule.execute({ action: 'get' });
      if (memRes.success && memRes.memory && memRes.memory.learnedKnowledge) {
        learnedList = memRes.memory.learnedKnowledge.geopolitics || [];
      }
    } catch (e) {
      console.warn("Failed to load learned knowledge in geopolitics.js:", e.message);
    }

    let riskScore = 5.0; // 1-10 scale
    let assessment = '';
    let recommendations = [];
    
    if (region.includes('tech') || region.includes('cold')) {
      riskScore = 7.8;
      assessment = "US-China semiconductor decoupled tariff escalation. High threat of rare earths export bans and chip supply chain redundancy costs.";
      recommendations = [
        "Overweight localized chip foundry supply chains (e.g. ASML, TSMC domestic hubs).",
        "Accumulate critical rare-earth mining operations outside primary supply zones.",
        "Hedging tech portfolios with aerospace and defense defense ETF indices."
      ];
    } else if (region.includes('asia') || region.includes('pacific')) {
      riskScore = 6.2;
      assessment = "Maritime trade lane security issues. Military build-up in East Asian waters increases shipping insurance index.";
      recommendations = [
        "Reduce exposure to transport/logistic fleets utilizing sensitive straits.",
        "Diversify production hubs to India, Vietnam, and Mexico (nearshoring).",
        "Allocate 5% to Gold futures as systemic hedging."
      ];
    } else if (region.includes('middle') || region.includes('east')) {
      riskScore = 8.5;
      assessment = "Energy infrastructure bottleneck threats. Volatility in Brent Crude futures pricing due to supply route bottlenecks.";
      recommendations = [
        "Capitalize on crude oil futures spikes with active option calls.",
        "Increase allocation to sovereign energy storage infrastructure and LNG terminals.",
        "Underweight transport and civil aviation sectors due to input cost hikes."
      ];
    } else {
      riskScore = 4.5;
      assessment = "General macro-economic tightening cycle. Interest rate shifts and inflation tracking indices dominate localized asset yields.";
      recommendations = [
        "Focus on high-moat companies with price-setting power.",
        "Increase yield positioning in high-yield short-term corporate debt portfolios."
      ];
    }
    
    // Augment with learned rules
    if (learnedList.length > 0) {
      recommendations = [...recommendations, ...learnedList.slice(-3)];
    }

    return {
      success: true,
      region: region.toUpperCase(),
      macroAnalysis: {
        geopoliticalRiskScore: riskScore,
        scenarioAssessment: assessment,
        investmentDirectives: recommendations,
        forecastHorizon: "12 to 36 Months",
        scannedAt: new Date().toISOString()
      }
    };
  }
};
