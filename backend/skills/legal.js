const memoryModule = require('./memory');

module.exports = {
  description: "Corporate legal risk auditor skill. Parses business structures, contracts, and advises on legal risk mitigations.",
  parameters: {
    context: { type: "string", description: "Contract/agency situation (e.g. Client-Agreement, Independent-Contractor, Offshore-Tax-Entity)" }
  },
  async execute(params) {
    const context = (params.context || 'Client-Agreement').toLowerCase();
    
    // Validate legal context support
    const supportedContexts = ['client-agreement', 'client agreement', 'offshore-tax-entity', 'offshore tax entity', 'nda', 'contractor', 'independent contractor'];
    const isSupported = supportedContexts.some(sc => context.includes(sc));

    if (!isSupported) {
      return {
        success: false,
        unanswerable: true,
        query: `legal risk assessment and audit checklist for ${context}`,
        reason: `Legal context "${context}" is not in the locally supported databases.`
      };
    }

    // Load learned strategies from memory
    let learnedList = [];
    try {
      const memRes = await memoryModule.execute({ action: 'get' });
      if (memRes.success && memRes.memory && memRes.memory.learnedKnowledge) {
        learnedList = memRes.memory.learnedKnowledge.legal || [];
      }
    } catch (e) {
      console.warn("Failed to load learned knowledge in legal.js:", e.message);
    }

    let legalRiskLevel = 'LOW';
    let complianceChecklist = [];
    let protectiveClauses = [];
    
    if (context.includes('client') || context.includes('agreement')) {
      legalRiskLevel = 'MEDIUM';
      complianceChecklist = [
        "Define exact delivery parameters and scope limitations to prevent scope creep.",
        "Mandate written approvals at each milestone stage to waive liability.",
        "Clarify payment schedules, Net-15/30 guidelines, and late-fee penalties."
      ];
      protectiveClauses = [
        "Limitation of Liability: Cap liability at 100% of the total fees paid by the client.",
        "Intellectual Property: Retain background IP; assign deliverables only upon full invoice payment.",
        "Jurisdiction: Exclusively bind disputes to Delaware state courts (standard corporate protection)."
      ];
    } else if (context.includes('tax') || context.includes('offshore') || context.includes('entity')) {
      legalRiskLevel = 'HIGH';
      complianceChecklist = [
        "Establish formal corporate presence with local registered agents.",
        "Audit compliance guidelines for CFC (Controlled Foreign Corporation) rules.",
        "Structure agency as double-tier LLC to isolate asset ownership from operations."
      ];
      protectiveClauses = [
        "Intercompany Agreements: Maintain arms-length transfer pricing documents.",
        "Indemnification: Shield corporate officers from operational liabilities."
      ];
    } else {
      legalRiskLevel = 'LOW';
      complianceChecklist = [
        "Implement standard NDA protocols for all operational communications.",
        "Utilize digital contracts with cryptographic signatures."
      ];
      protectiveClauses = [
        "Confidentiality: Bind all contractors for a period of 5 years post-termination."
      ];
    }
    
    // Augment with learned rules
    if (learnedList.length > 0) {
      complianceChecklist = [...complianceChecklist, ...learnedList.slice(-2).map(r => `[LEARNED] ${r}`)];
    }

    return {
      success: true,
      legalProfile: {
        riskRating: legalRiskLevel,
        checklist: complianceChecklist,
        strategicClauses: protectiveClauses,
        complianceStandard: "Corporate Agency Standards v2026",
        auditedAt: new Date().toISOString()
      }
    };
  }
};
