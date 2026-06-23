import React, { useState, useEffect, useRef } from 'react';
import './terminal.css';

// Extracted to prevent 60FPS re-rendering when audio level changes
const TerminalLog = React.memo(({ history, interimText }) => {
  const terminalEndRef = useRef(null);

  useEffect(() => {
    if (terminalEndRef.current) {
      terminalEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [history, interimText]);

  return (
    <div className="term-body">
      {history.slice(-50).map((line, idx) => (
        <div key={idx} className="term-line final-glow">
          <span className="term-prompt">&gt;</span> {line}
        </div>
      ))}
      {interimText && (
        <div className="term-line interim-glow">
          <span className="term-prompt">&gt;</span> {interimText}
          <span className="term-cursor">▒</span>
        </div>
      )}
      <div ref={terminalEndRef} />
    </div>
  );
});

export default function Terminal() {
  const [history, setHistory] = useState([
    'SYSTEM: INITIATING MULTI-LINGUAL VOICE MATRIX...',
    'SYSTEM: LANG CONFIG READY. SELECT MODE BELOW.',
    'SYSTEM: BACKEND COMMAND CONSOLE STATUS [ONLINE]',
    'SYSTEM: TYPE /help TO VIEW ALL AVAILABLE HUD COMMANDS.'
  ]);
  const [interimText, setInterimText] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [isFridayActive, setIsFridayActive] = useState(false);
  const [langMode, setLangMode] = useState('en-IN'); // en-IN default
  const [audioLevel, setAudioLevel] = useState(0); // 0-8 bars
  const [commandInput, setCommandInput] = useState(''); // Text prompt command input
  const [voiceModel, setVoiceModel] = useState('female'); // voice model selector: 'male' or 'female'

  const audioStreamRef = useRef(null);
  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);

  const activeTimerRef = useRef(null);
  const audioDataRef = useRef(new Uint8Array(64));
  const lastSearchRef = useRef(null); // { query, mode }
  const isFridayActiveRef = useRef(false); // Guard for duplicate voice activations
  const voiceTimeoutRef = useRef(null); // Force finalization timeout for stuck voice input

  const BACKEND_URL = 'http://localhost:5000';

  // Synchronize voice configuration with backend global settings.json
  useEffect(() => {
    const fetchVoiceSetting = async () => {
      try {
        const res = await fetch(`${BACKEND_URL}/api/voice`);
        const data = await res.json();
        if (data.success && data.settings && data.settings.current) {
          setVoiceModel(data.settings.current);
        }
      } catch (err) {
        console.warn('Failed to fetch voice settings:', err);
      }
    };
    fetchVoiceSetting();

    // Expose setter globally so navbar dropdown or external commands can update terminal's local voice state
    window.FRIDAY_VOICE = {
      getVoice: () => voiceModel,
      setVoice: async (newVoice) => {
        setVoiceModel(newVoice);
        try {
          await fetch(`${BACKEND_URL}/api/voice`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ voice: newVoice })
          });
          // Dispatch a custom event to let the navbar know it updated
          window.dispatchEvent(new CustomEvent('friday-voice-changed', { detail: { voice: newVoice } }));
        } catch (err) {
          console.warn('Failed to save voice setting to backend:', err);
        }
      }
    };

    return () => {
      delete window.FRIDAY_VOICE;
    };
  }, [voiceModel]);

  // Native TTS Speech Synthesis function for F.R.I.D.A.Y. voice output
  const speakText = (text) => {
    if (!('speechSynthesis' in window)) {
      console.warn('SpeechSynthesis not supported.');
      return;
    }

    window.speechSynthesis.cancel(); // Cancel active speech

    // Strip markers, citations, markdown, and punctuation formatting that introduce pauses
    const cleanText = text
      .replace(/\[\d+\]/g, '') // remove citation brackets like [1], [2]
      .replace(/\[.*?\]/g, '') // remove any other bracketed text/system tags
      .replace(/SYSTEM:|ASSISTANT:|WARNING:|ERROR:/gi, '')
      .replace(/[*_`#~]/g, '') // remove markdown indicators
      .replace(/[-/\\|]/g, ' ') // replace hyphens, slashes, bars with spaces to prevent breaks
      .replace(/[:;]/g, ',') // turn colons/semicolons into soft comma pauses
      .replace(/\s+/g, ' ') // collapse duplicate spaces
      .trim();

    if (!cleanText) return;

    const utterance = new SpeechSynthesisUtterance(cleanText);

    // Get available voices
    const voices = (window.speechSynthesis && typeof window.speechSynthesis.getVoices === 'function' ? window.speechSynthesis.getVoices() : []) || [];
    
    let selectedVoice = null;

    if (voiceModel === 'female') {
      // Prioritize high-quality "natural" or "neural" English female voices first (Edge/Chrome natural female voices like Aria, Jenny, Siri)
      selectedVoice = voices.find(v => {
        const name = v.name.toLowerCase();
        const lang = v.lang.toLowerCase();
        return lang.startsWith('en') && 
               name.includes('natural') && 
               (name.includes('aria') || name.includes('jenny') || name.includes('siri') || name.includes('female') || name.includes('susan'));
      });

      if (!selectedVoice) {
        // Prioritize standard English female/zira voices next
        selectedVoice = voices.find(v => {
          const name = v.name.toLowerCase();
          const lang = v.lang.toLowerCase();
          return lang.startsWith('en') && 
                 (name.includes('female') || name.includes('zira') || name.includes('siri') || name.includes('aria') || name.includes('jenny') || name.includes('susan') || name.includes('hazel'));
        });
      }

      if (!selectedVoice) {
        // Fallback to Google UK/US female voices
        selectedVoice = voices.find(v => {
          const name = v.name.toLowerCase();
          const lang = v.lang.toLowerCase();
          return lang.startsWith('en') && name.includes('google') && name.includes('female');
        });
      }
    } else {
      // Prioritize high-quality "natural" or "neural" English male voices first (Edge/Chrome natural voices)
      selectedVoice = voices.find(v => {
        const name = v.name.toLowerCase();
        const lang = v.lang.toLowerCase();
        return lang.startsWith('en') && 
               name.includes('natural') && 
               (name.includes('guy') || name.includes('ryan') || name.includes('male') || name.includes('james'));
      });

      if (!selectedVoice) {
        // Prioritize standard English male/david voices next
        selectedVoice = voices.find(v => {
          const name = v.name.toLowerCase();
          const lang = v.lang.toLowerCase();
          return lang.startsWith('en') && 
                 (name.includes('male') || name.includes('david') || name.includes('guy') || name.includes('ryan'));
        });
      }

      if (!selectedVoice) {
        // Fallback to Google UK/US male voices
        selectedVoice = voices.find(v => {
          const name = v.name.toLowerCase();
          const lang = v.lang.toLowerCase();
          return lang.startsWith('en') && name.includes('google') && !name.includes('female');
        });
      }
    }

    if (!selectedVoice) {
      if (voiceModel === 'female') {
        selectedVoice = voices.find(v => {
          const name = v.name.toLowerCase();
          const lang = v.lang.toLowerCase();
          return lang.startsWith('en') && !name.includes('male') && !name.includes('guy') && !name.includes('david');
        });
      } else {
        selectedVoice = voices.find(v => {
          const name = v.name.toLowerCase();
          const lang = v.lang.toLowerCase();
          return lang.startsWith('en') && (name.includes('male') || name.includes('guy') || name.includes('david'));
        });
      }
    }

    if (!selectedVoice) {
      // Fallback English voice
      selectedVoice = voices.find(v => v.lang.toLowerCase().startsWith('en'));
    }

    if (!selectedVoice) {
      // Absolute fallback
      selectedVoice = voices[0];
    }

    if (selectedVoice) {
      utterance.voice = selectedVoice;
    }

    if (voiceModel === 'female') {
      utterance.pitch = 1.08; // Siri-like pleasant female pitch
      utterance.rate = 1.0;   // Clean reading pace
    } else {
      utterance.pitch = 0.92; // Jarvis-like deeper male pitch
      utterance.rate = 0.96;  // Paced tempo
    }

    utterance.onstart = () => {
      if (window.FRIDAY && typeof window.FRIDAY.setSpeaking === 'function') {
        window.FRIDAY.setSpeaking(true);
      }
    };

    utterance.onend = () => {
      if (window.FRIDAY && typeof window.FRIDAY.setSpeaking === 'function') {
        window.FRIDAY.setSpeaking(false);
      }
    };

    utterance.onerror = () => {
      if (window.FRIDAY && typeof window.FRIDAY.setSpeaking === 'function') {
        window.FRIDAY.setSpeaking(false);
      }
    };

    window.speechSynthesis.speak(utterance);
  };

  // Run dynamic cognitive system skill via backend API
  const runSkill = async (name, params) => {
    setHistory(prev => [
      ...prev,
      `SYSTEM: INITIATING COGNITIVE SKILL [${name.toUpperCase()}]`,
      `PARAMS: ${JSON.stringify(params)}`
    ]);

    if (window.FRIDAY && typeof window.FRIDAY.setThinking === 'function') {
      window.FRIDAY.setThinking(true);
    }

    try {
      const res = await fetch(`${BACKEND_URL}/api/skills/execute/${name}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params)
      });
      const data = await res.json();
      
      if (data.success && data.result) {
        let textOutput = '';
        let speechText = '';
        
        if (data.result.isFallbackReport) {
          const lines = data.result.report.split('\n').map(l => l.trim()).filter(Boolean);
          const summaryLine = lines.find(l => l.toUpperCase().includes('SUMMARY') || l.toUpperCase().includes('EXECUTIVE'));
          const idx = lines.indexOf(summaryLine);
          let summarySpeech = '';
          if (idx !== -1 && lines[idx + 1]) {
            summarySpeech = lines[idx + 1];
          } else {
            summarySpeech = lines.slice(0, 2).join(' ');
          }
          
          textOutput = `SYSTEM ANALYST REPORT FALLBACK (Source: Web RAG):\n> ${summarySpeech}\n[FULL REPORT TRANSFERRED TO COGNITIVE SCANNER]`;
          speechText = `Skill ${name} fell back to web analysis. Summary: ${summarySpeech}`;
          
          if (window.FRIDAY_ANALYZER && typeof window.FRIDAY_ANALYZER.showReport === 'function') {
            window.FRIDAY_ANALYZER.showReport(data.result.report, 'WEB RAG ANALYST REPORT');
          }
        } else if (name === 'analyst' && data.result.report) {
          const lines = data.result.report.split('\n').map(l => l.trim()).filter(Boolean);
          const summaryLine = lines.find(l => l.toUpperCase().includes('SUMMARY') || l.toUpperCase().includes('EXECUTIVE'));
          const idx = lines.indexOf(summaryLine);
          let summarySpeech = '';
          if (idx !== -1 && lines[idx + 1]) {
            summarySpeech = lines[idx + 1];
          } else {
            summarySpeech = lines.slice(0, 2).join(' ');
          }
          
          textOutput = `COGNITIVE ANALYST REPORT:\n> ${summarySpeech}\n[FULL REPORT TRANSFERRED TO COGNITIVE SCANNER]`;
          speechText = `Analysis report complete. Summary: ${summarySpeech}`;
          
          if (window.FRIDAY_ANALYZER && typeof window.FRIDAY_ANALYZER.showReport === 'function') {
            window.FRIDAY_ANALYZER.showReport(data.result.report, 'STRATEGIC ANALYST REPORT');
          }
        } else if (name === 'trading') {
          const a = data.result.analysis;
          textOutput = `TRADING REPORT: Ticker ${data.result.ticker} (${data.result.market.toUpperCase()})\n` +
                       `> Price: $${a.lastPriceUSD}\n` +
                       `> RSI: ${a.relativeStrengthIndexRSI}\n` +
                       `> Action: ${a.suggestedAction}\n` +
                       `> Rationale: ${a.rationality}`;
          speechText = `Trading analysis complete for ${data.result.ticker}. Suggested action is ${a.suggestedAction}. Rationale: ${a.rationality}`;
          
          if (window.FRIDAY_ANALYZER && typeof window.FRIDAY_ANALYZER.showReport === 'function') {
            window.FRIDAY_ANALYZER.showReport(textOutput, `TRADING ANALYSIS REPORT - ${data.result.ticker.toUpperCase()}`);
          }
        } else if (name === 'geopolitics') {
          const m = data.result.macroAnalysis;
          textOutput = `GEOPOLITICAL SCAN: ${data.result.region}\n` +
                       `> Risk: ${m.geopoliticalRiskScore}/10\n` +
                       `> Scenario: ${m.scenarioAssessment}\n` +
                       `> Directives:\n` + m.investmentDirectives.map(d => `  * ${d}`).join('\n');
          speechText = `Geopolitical analysis for ${data.result.region} shows a risk level of ${m.geopoliticalRiskScore}. ${m.scenarioAssessment}`;
          
          if (window.FRIDAY_ANALYZER && typeof window.FRIDAY_ANALYZER.showReport === 'function') {
            window.FRIDAY_ANALYZER.showReport(textOutput, `GEOPOLITICAL SCAN REPORT - ${data.result.region.toUpperCase()}`);
          }
        } else if (name === 'legal') {
          const l = data.result.legalProfile;
          textOutput = `LEGAL COMPLIANCE RISK: ${l.riskRating} RISK\n` +
                       `> Checklist:\n` + l.checklist.map(c => `  * ${c}`).join('\n') +
                       `\n> Strategic Clauses:\n` + l.strategicClauses.map(s => `  * ${s}`).join('\n');
          speechText = `Legal risk assessment complete. Risk rating is ${l.riskRating}. Please check the contract checklist on the terminal.`;
          
          if (window.FRIDAY_ANALYZER && typeof window.FRIDAY_ANALYZER.showReport === 'function') {
            window.FRIDAY_ANALYZER.showReport(textOutput, `LEGAL COMPLIANCE REPORT - ${l.riskRating.toUpperCase()} RISK`);
          }
        } else {
          textOutput = `OUTPUT: ${JSON.stringify(data.result, null, 2)}`;
          speechText = `Skill ${name} completed successfully.`;
        }
        
        setHistory(prev => [...prev, textOutput]);
        speakText(speechText);
      } else {
        setHistory(prev => [...prev, `SYSTEM ERROR: Skill execution failed: ${data.error || 'Unknown error'}`]);
        speakText("Skill execution failed.");
      }
    } catch (err) {
      setHistory(prev => [...prev, `SYSTEM ERROR: Skill execution backend offline.`]);
      speakText("Connection offline.");
    } finally {
      if (window.FRIDAY && typeof window.FRIDAY.setThinking === 'function') {
        window.FRIDAY.setThinking(false);
      }
    }
  };



  // Global mock test hook for automated verification
  useEffect(() => {
    window.mockSpeechResult = (text, isFinal = true) => {
      if (isFinal) {
        setHistory(prev => [...prev, `[MOCK VOICE]: "${text}"`]);
        setInterimText('');
      } else {
        setInterimText(text);
      }
      scanVoiceInput(text, isFinal);
    };
    return () => {
      delete window.mockSpeechResult;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Wake word & voice command scanner
  const scanVoiceInput = (text, isFinal = true) => {
    const cleanText = text.trim().toLowerCase();
    if (!cleanText) return;
    
    // 1. Wake word pattern
    const wakeWordPattern = /\b(friday|frida|fryday|f\.r\.i\.d\.a\.y|फ्राइडे)\b/i;
    if (wakeWordPattern.test(cleanText)) {
      triggerFridayActivation();
    }

    // Isolate command triggers to final results only to avoid partial/multiple execution
    if (!isFinal) return;

    // Strip wake word from the start of the command if present
    const cleanCommandText = cleanText.replace(/^(?:friday|frida|fryday|f\.r\.i\.d\.a\.y|फ्राइडे)[\s,,.]*/i, '').trim();
    if (!cleanCommandText) return;

    // Shared Word Map for index parsing
    const wordMap = {
      'one': 1, '1': 1, 'first': 1,
      'two': 2, '2': 2, 'second': 2,
      'three': 3, '3': 3, 'third': 3,
      'four': 4, '4': 4, 'fourth': 4,
      'five': 5, '5': 5, 'fifth': 5,
      'six': 6, '6': 6, 'sixth': 6,
      'seven': 7, '7': 7, 'seventh': 7,
      'eight': 8, '8': 8, 'eighth': 8,
      'nine': 9, '9': 9, 'ninth': 9,
      'ten': 10, '10': 10, 'tenth': 10
    };

    // A. Close Inline Media Player Command
    const closeMediaPattern = /^(?:close|exit|hide)\s+(?:video|website|media|player|clip)|^(?:go\s+)?back(?:\s+to\s+results)?/i;
    if (closeMediaPattern.test(cleanCommandText)) {
      if (window.FRIDAY_SEARCH && typeof window.FRIDAY_SEARCH.closeMedia === 'function') {
        window.FRIDAY_SEARCH.closeMedia();
        setHistory(prev => [...prev, 'SYSTEM: CLOSED MEDIA PLAYER. RETURNED TO SEARCH RESULTS.']);
      }
      return;
    }

    // B. Browser Redirection Command
    const redirectPattern = /^(?:redirect|open)\s+(?:to\s+)?(?:search\s+results|browser|system\s+browser|results)/i;
    const isRedirect = redirectPattern.test(cleanCommandText) || cleanCommandText === 'redirect';
    if (isRedirect) {
      executeRedirectToBrowser();
      return;
    }

    // B.1 Refresh / Reload Search Command
    const refreshPattern = /^(?:refresh|reload|update)\s+(?:search|results|matrix)/i;
    if (refreshPattern.test(cleanCommandText) || cleanCommandText === 'refresh') {
      executeSearchRefresh();
      return;
    }

    // D. Download Strategic Report Command
    const downloadReportPattern = /^(?:download|save|get)\s+(?:the\s+|strategic\s+|pdf\s+|analyses\s+|analysis\s+)?report$/i;
    if (downloadReportPattern.test(cleanCommandText) || cleanCommandText === 'download report') {
      if (window.FRIDAY_ANALYZER && typeof window.FRIDAY_ANALYZER.downloadReport === 'function') {
        const success = window.FRIDAY_ANALYZER.downloadReport();
        if (success) {
          setHistory(prev => [...prev, 'SYSTEM: STRATEGIC REPORT PDF GENERATED AND DOWNLOADED.']);
          speakText("Strategic report downloaded, sir.");
        } else {
          setHistory(prev => [...prev, 'SYSTEM WARNING: No strategic report available to download.']);
          speakText("There is no active report to download, sir.");
        }
      } else {
        setHistory(prev => [...prev, 'SYSTEM WARNING: Dr. Analyzer terminal link is offline.']);
      }
      return;
    }

    // A.0 Explicit Basic Skill Activation Commands
    if (/^(?:activate|start|run|open)?\s*(?:trading|trade|market|market\s+analysis)$/i.test(cleanCommandText)) {
      runSkill('trading', { ticker: 'BTC', market: 'crypto' });
      return;
    }
    if (/^(?:activate|start|run|open|give)?\s*(?:legal|legal\s+advice|legal\s+audit|compliance)$/i.test(cleanCommandText)) {
      runSkill('legal', { context: 'client-agreement' });
      return;
    }
    if (/^(?:activate|start|run|open)?\s*(?:geopolitics|geopolitical|geopolitical\s+scan)$/i.test(cleanCommandText)) {
      runSkill('geopolitics', { region: 'tech-cold-war' });
      return;
    }

    // A.1 Trading Voice Trigger (Strict matching first, then flexible keyword match)
    const tradingPattern = /^(?:analyze|analyse|check|trade)\s+([a-z0-9]+)\s*(?:on|in)?\s*(crypto|forex|shares|stock|market)?$/i;
    let matchedTrading = false;
    let ticker = '';
    let market = '';

    if (tradingPattern.test(cleanCommandText)) {
      const match = cleanCommandText.match(tradingPattern);
      ticker = match[1].trim().toLowerCase();
      market = (match[2] || '').trim().toLowerCase();
      matchedTrading = true;
    } else if (/(?:trade|trading|stock|shares|crypto|forex|rsi|price|exchange|ticker|market)/i.test(cleanCommandText)) {
      const tokens = cleanCommandText.toLowerCase().split(/\s+/);
      const ignoreWords = ['trade', 'trading', 'stock', 'shares', 'crypto', 'forex', 'rsi', 'price', 'exchange', 'ticker', 'market', 'check', 'analyze', 'analyse', 'what', 'is', 'the', 'of', 'on', 'in', 'for', 'can', 'you', 'please'];
      for (const token of tokens) {
        const cleanToken = token.replace(/[^a-zA-Z0-9]/g, '');
        if (cleanToken.length >= 3 && cleanToken.length <= 6 && !ignoreWords.includes(cleanToken)) {
          ticker = cleanToken;
          break;
        }
      }
      if (!ticker) {
        if (cleanCommandText.includes('bitcoin') || cleanCommandText.includes('btc')) ticker = 'btc';
        else if (cleanCommandText.includes('ethereum') || cleanCommandText.includes('eth')) ticker = 'eth';
        else if (cleanCommandText.includes('apple') || cleanCommandText.includes('aapl')) ticker = 'aapl';
        else if (cleanCommandText.includes('nvidia') || cleanCommandText.includes('nvda')) ticker = 'nvda';
        else if (cleanCommandText.includes('tesla') || cleanCommandText.includes('tsla')) ticker = 'tsla';
      }
      if (ticker) {
        matchedTrading = true;
        if (['btc', 'eth', 'sol', 'ada', 'doge', 'xrp', 'crypto'].includes(ticker.toLowerCase()) || cleanCommandText.includes('crypto')) {
          market = 'crypto';
        } else if (['eurusd', 'gbpusd', 'usdjpy', 'audusd', 'forex'].includes(ticker.toLowerCase()) || cleanCommandText.includes('forex')) {
          market = 'forex';
        } else {
          market = 'shares';
        }
      }
    }

    if (matchedTrading && ticker) {
      if (!market) {
        if (['btc', 'eth', 'sol', 'ada', 'doge', 'xrp', 'crypto'].includes(ticker)) {
          market = 'crypto';
        } else if (['eurusd', 'gbpusd', 'usdjpy', 'audusd', 'forex'].includes(ticker)) {
          market = 'forex';
        } else {
          market = 'shares';
        }
      }
      runSkill('trading', { ticker, market });
      return;
    }

    // A.2 Geopolitics Voice Trigger
    const geopoliticsPattern = /^(?:forecast|predict|check|analyze|analyse)\s*(?:geopolitical|geopolitics|investment)?\s*(?:risk|scenario)?\s*(?:for|in)?\s*(tech-cold-war|tech\s+cold\s+war|asia-pacific|asia\s+pacific|middle-east|middle\s+east|europe)$/i;
    let matchedGeopolitics = false;
    let region = '';

    if (geopoliticsPattern.test(cleanCommandText)) {
      const match = cleanCommandText.match(geopoliticsPattern);
      region = match[1].trim().replace(/\s+/g, '-').toLowerCase();
      matchedGeopolitics = true;
    } else if (/(?:geopolitics|geopolitical|cold war|asia pacific|middle east|europe|macro risk)/i.test(cleanCommandText)) {
      const lower = cleanCommandText.toLowerCase();
      if (lower.includes('asia pacific') || lower.includes('asia-pacific')) region = 'asia-pacific';
      else if (lower.includes('middle east') || lower.includes('middle-east')) region = 'middle-east';
      else if (lower.includes('europe')) region = 'europe';
      else if (lower.includes('cold war')) region = 'tech-cold-war';
      
      if (region) {
        matchedGeopolitics = true;
      }
    }

    if (matchedGeopolitics && region) {
      runSkill('geopolitics', { region });
      return;
    }

    // A.3 Legal Voice Trigger
    const legalPattern = /^(?:assess|audit|check|give)\s*(?:legal|risk|checklist)?\s*(?:for)?\s*(client-agreement|client\s+agreement|offshore-tax-entity|offshore\s+tax\s+entity|nda|contractor)$/i;
    let matchedLegal = false;
    let context = '';

    if (legalPattern.test(cleanCommandText)) {
      const match = cleanCommandText.match(legalPattern);
      context = match[1].trim().replace(/\s+/g, '-').toLowerCase();
      matchedLegal = true;
    } else if (/(?:legal|compliance|nda|agreement|contract|contractor|tax entity|audit)/i.test(cleanCommandText)) {
      const lower = cleanCommandText.toLowerCase();
      if (lower.includes('nda')) context = 'nda';
      else if (lower.includes('tax entity') || lower.includes('offshore')) context = 'offshore-tax-entity';
      else if (lower.includes('contractor')) context = 'contractor';
      else if (lower.includes('agreement')) context = 'client-agreement';
      
      if (context) {
        matchedLegal = true;
      }
    }

    if (matchedLegal && context) {
      runSkill('legal', { context });
      return;
    }

    // A.4 Cyber Defense Voice Trigger
    const cyberReconPattern = /^(?:analyze|analyse|scan|check|hack)\s+(?:security|vulnerabilities|recon|domain)?\s*(?:for\s+)?([a-z0-9.-]+\.[a-z]{2,})$/i;
    const cyberConceptPattern = /^(?:explain|analyze|analyse)\s+(?:cybersecurity\s+)?(?:concept|vulnerability|attack|defense)\s+(.+)$/i;
    
    if (cyberReconPattern.test(cleanCommandText)) {
      const match = cleanCommandText.match(cyberReconPattern);
      const target = match[1].trim();
      runSkill('cyber-defense', { target, type: 'recon' });
      return;
    } else if (cyberConceptPattern.test(cleanCommandText)) {
      const match = cleanCommandText.match(cyberConceptPattern);
      const target = match[1].trim();
      runSkill('cyber-defense', { target, type: 'concept' });
      return;
    } else if (/(?:cybersecurity|vulnerability|hack|penetration test|malware)/i.test(cleanCommandText)) {
      runSkill('analyst', { query: cleanCommandText });
      return;
    }

    // A.5 Analyst Voice Trigger (General analytical/problem solving queries)
    const analystPattern = /(?:analyze|analyse|evaluate|assess|predict|forecast|solve|problem|recommendation|report|strategy)/i;
    if (analystPattern.test(cleanCommandText)) {
      runSkill('analyst', { query: cleanCommandText });
      return;
    }

    // C. Inline Media Play / Open website in Terminal itself Command
    const mediaSuffixPattern = /^(?:play|open|show)\s+(?:result|link|page|number)?\s*(\w+|\d+)\s+(video|clip|media|website|site)/i;
    const mediaPrefixPattern = /^(?:play|open|show)\s+(video|clip|media|website|site)\s+(?:result|link|page|number)?\s*(\w+|\d+)/i;

    let mediaMatch = null;
    let mediaIndexStr = '';
    let mediaTypeStr = '';

    if (mediaSuffixPattern.test(cleanCommandText)) {
      mediaMatch = cleanCommandText.match(mediaSuffixPattern);
      mediaIndexStr = mediaMatch[1];
      mediaTypeStr = mediaMatch[2];
    } else if (mediaPrefixPattern.test(cleanCommandText)) {
      mediaMatch = cleanCommandText.match(mediaPrefixPattern);
      mediaTypeStr = mediaMatch[1];
      mediaIndexStr = mediaMatch[2];
    }

    if (mediaMatch) {
      const type = (mediaTypeStr.includes('video') || mediaTypeStr.includes('clip') || mediaTypeStr.includes('media')) ? 'video' : 'website';
      const index = wordMap[mediaIndexStr.toLowerCase()];
      if (index) {
        executeMediaPlay(index, type);
        return;
      }
    }

    // 2. Voice-triggered search (relax matches and priorities)
    // Check YouTube searches first (both suffix-based "on youtube" and prefix-based)
    const ytPrefixPattern = /^(?:search youtube for|youtube search for|search videos for|search video for|youtube search|youtube)\s+(.+)/i;
    const ytSuffixPattern = /^(?:search for|search|google|find|look up)\s+(.+)\s+on\s+youtube$/i;

    const webSearchPattern = /^(?:search the web for|search web for|web search for|google search for|search for|web search|search|google|find|look up)\s+(.+)/i;

    if (ytPrefixPattern.test(cleanCommandText)) {
      const match = cleanCommandText.match(ytPrefixPattern);
      const queryStr = match[1].trim();
      executeSearch(queryStr, 'youtube');
      return;
    } else if (ytSuffixPattern.test(cleanCommandText)) {
      const match = cleanCommandText.match(ytSuffixPattern);
      const queryStr = match[1].trim();
      executeSearch(queryStr, 'youtube');
      return;
    } else if (webSearchPattern.test(cleanCommandText)) {
      const match = cleanCommandText.match(webSearchPattern);
      const queryStr = match[1].trim();
      executeSearch(queryStr, 'web');
      return;
    }

    // 3. Voice-triggered redirection (open result X in system browser)
    const openPattern = /^(?:open|redirect to|go to|click) (?:result|link|page|number)?\s*(\w+|\d+)/i;
    if (openPattern.test(cleanCommandText)) {
      const match = cleanCommandText.match(openPattern);
      const indexStr = match[1].trim().toLowerCase();
      const index = wordMap[indexStr];
      if (index) {
        executeRedirection(index);
        return;
      }
    }

    // 4. Voice-triggered autonomous skill development (relaxed patterns)
    const developNamedPattern = /^(?:develop|create|build) a? skill (?:called|named) ([a-z0-9_-]+) to (.+)/i;
    const developGenericPattern = /^(?:develop|create|build) a? skill to (.+)/i;

    if (developNamedPattern.test(cleanCommandText)) {
      const match = cleanCommandText.match(developNamedPattern);
      const name = match[1].trim().toLowerCase();
      const prompt = match[2].trim();
      executeAutonomousDevelopment(name, prompt);
      return;
    } else if (developGenericPattern.test(cleanCommandText)) {
      const match = cleanCommandText.match(developGenericPattern);
      const prompt = match[1].trim();
      const randomName = `skill_${Math.floor(Date.now() / 1000)}`;
      executeAutonomousDevelopment(randomName, prompt);
      return;
    }

    // F. Voice Switching Commands
    const switchToFemalePattern = /(?:change|switch|set)\s+(?:voice\s+)?to\s+(?:female\s+version|female\s+voice|female)[\s,.]*$/i;
    const switchToMalePattern = /(?:change|switch|set)\s+(?:voice\s+)?to\s+(?:male\s+version|male\s+voice|male)[\s,.]*$/i;

    if (switchToFemalePattern.test(cleanCommandText)) {
      if (window.FRIDAY_VOICE && typeof window.FRIDAY_VOICE.setVoice === 'function') {
        window.FRIDAY_VOICE.setVoice('female');
        setHistory(prev => [...prev, 'SYSTEM: SPEECH SYNTHESIS SWITCHED TO FEMALE MODEL (SIRI).']);
        speakText("Voice model switched to female, sir.");
      }
      return;
    }

    if (switchToMalePattern.test(cleanCommandText)) {
      if (window.FRIDAY_VOICE && typeof window.FRIDAY_VOICE.setVoice === 'function') {
        window.FRIDAY_VOICE.setVoice('male');
        setHistory(prev => [...prev, 'SYSTEM: SPEECH SYNTHESIS SWITCHED TO MALE MODEL (JARVIS).']);
        speakText("Voice model switched to male, sir.");
      }
      return;
    }

    // Conversational Intercepts (e.g. Introduction and day going flow)
    const introPattern = /\b(?:introduce\s+yourself|who\s+are\s+you|what\s+is\s+your\s+name|tell\s+me\s+about\s+yourself)\b/i;
    const dayGoingPattern = /how\s+(?:is|s|are)\s+(?:your\s+day(?: \s*going)?|you\s+doing|it\s+going|you)\b/i;

    if (introPattern.test(cleanCommandText) || dayGoingPattern.test(cleanCommandText)) {
      if (!isFridayActiveRef.current) {
        triggerFridayActivation();
      }
      executeChatQuery(cleanCommandText);
      return;
    }

    // 5. General conversational chat query if F.R.I.D.A.Y is awake and active or if it starts with question words
    const questionPattern = /^(?:how|why|what|where|when|which|who|tell\s+me|find)\b/i;
    const isQuestionInput = questionPattern.test(cleanCommandText);

    if (isFridayActive || isQuestionInput) {
      if (isQuestionInput && !isFridayActive) {
        triggerFridayActivation();
      }
      executeChatQuery(cleanCommandText);
      return;
    }
  };

  // Refresh last search query
  const executeSearchRefresh = () => {
    if (lastSearchRef.current) {
      executeSearch(lastSearchRef.current.query, lastSearchRef.current.mode);
    } else {
      setHistory(prev => [...prev, 'SYSTEM WARNING: No active search query to refresh.']);
    }
  };

  // Trigger search API call
  const executeSearch = async (query, mode = 'web') => {
    lastSearchRef.current = { query, mode };
    // Start Matrix rain animation on the left search terminal
    if (window.FRIDAY_SEARCH && typeof window.FRIDAY_SEARCH.start === 'function') {
      window.FRIDAY_SEARCH.start(query);
    }

    setHistory(prev => [
      ...prev,
      `SYSTEM: INITIATING MATRIX SEARCH [MODE: ${mode.toUpperCase()}]`,
      `SYSTEM: QUERY = "${query}"`
    ]);

    if (mode === 'youtube') {
      speakText("Searching YouTube video feeds.");
    } else {
      speakText("Accessing local databases. Searching the web...");
    }

    // Animate central WebGL blob to SEARCHING state (State 1)
    if (window.FRIDAY && typeof window.FRIDAY.setSearching === 'function') {
      window.FRIDAY.setSearching(true);
    }

    try {
      const res = await fetch(`${BACKEND_URL}/api/skills/execute/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, mode })
      });
      const data = await res.json();
      
      if (data.success && data.result) {
        if (window.FRIDAY_SEARCH && typeof window.FRIDAY_SEARCH.success === 'function') {
          window.FRIDAY_SEARCH.success(data.result);
        }
        setHistory(prev => [
          ...prev,
          `SYSTEM: SEARCH MATRIX EXECUTION COMPLETED. [SOURCE: ${data.result.source}]`,
          data.result.warning ? `WARNING: ${data.result.warning}` : 'SYSTEM: SEARCH RESULTS PARSED ON LEFT SCREEN.'
        ]);
      } else {
        if (window.FRIDAY_SEARCH && typeof window.FRIDAY_SEARCH.error === 'function') {
          window.FRIDAY_SEARCH.error(data.error || 'Execution failed');
        }
        setHistory(prev => [...prev, `SYSTEM ERROR: Search matrix execution failed: ${data.error}`]);
      }
    } catch (err) {
      if (window.FRIDAY_SEARCH && typeof window.FRIDAY_SEARCH.error === 'function') {
        window.FRIDAY_SEARCH.error('Server offline');
      }
      setHistory(prev => [...prev, 'SYSTEM ERROR: Search backend link offline. Check port 5000.']);
      speakText("Link offline. Running in standby mode.");
    } finally {
      if (window.FRIDAY && typeof window.FRIDAY.setSearching === 'function') {
        window.FRIDAY.setSearching(false);
      }
    }
  };

  // Open search links on default browser
  const executeRedirection = (index) => {
    const results = window.FRIDAY_SEARCH_RESULTS;
    if (!results || results.length === 0) {
      setHistory(prev => [...prev, 'SYSTEM WARNING: No active search results available to redirect.']);
      return;
    }

    const item = results[index - 1];
    if (!item || !item.url) {
      setHistory(prev => [...prev, `SYSTEM WARNING: Result index [${index}] out of bounds.`]);
      return;
    }

    setHistory(prev => [...prev, `SYSTEM: REDIRECTING TO RESULT [${index}] -> opening link in browser.`]);
    window.open(item.url, '_blank');
    
    // Auto-learn: when opening a search link, send it to backend to ingest knowledge
    if (item.url) {
      setHistory(prev => [...prev, `SYSTEM: Background ingestion matrix activated for ${item.url}`]);
      fetch(`${BACKEND_URL}/api/learn/url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: item.url })
      }).then(res => res.json())
        .then(data => {
          if (data.success) {
            setHistory(prev => [...prev, `SYSTEM: INGESTION COMPLETE. Added ${data.chunksAdded} chunks to memory bank.`]);
          }
        }).catch(err => console.error("Auto-ingest failed:", err));
    }
  };

  // Play / Open media inside the SearchTerminal HUD
  const executeMediaPlay = (index, type) => {
    if (window.FRIDAY_SEARCH && typeof window.FRIDAY_SEARCH.playMedia === 'function') {
      const success = window.FRIDAY_SEARCH.playMedia(index, type);
      if (success) {
        setHistory(prev => [
          ...prev,
          `SYSTEM: INITIATING HUD MEDIA PROTOCOL [RESULT: ${index}] [MODE: ${type.toUpperCase()}]`
        ]);
      } else {
        setHistory(prev => [
          ...prev,
          `SYSTEM WARNING: Result index [${index}] out of bounds for inline media playback.`
        ]);
      }
    } else {
      setHistory(prev => [...prev, 'SYSTEM WARNING: HUD Search Matrix is offline.']);
    }
  };

  // Redirect current active media or general query results to system default browser
  const executeRedirectToBrowser = () => {
    if (window.FRIDAY_SEARCH && typeof window.FRIDAY_SEARCH.getActiveEmbed === 'function') {
      const active = window.FRIDAY_SEARCH.getActiveEmbed();
      if (active && active.url) {
        setHistory(prev => [...prev, `SYSTEM: REDIRECTING HUD MEDIA "${active.title}" TO SYSTEM BROWSER...`]);
        window.open(active.url, '_blank');
        return;
      }
    }
    
    // Otherwise open search results page
    if (window.FRIDAY_SEARCH && typeof window.FRIDAY_SEARCH.getSearchRedirectUrl === 'function') {
      const url = window.FRIDAY_SEARCH.getSearchRedirectUrl();
      if (url) {
        setHistory(prev => [...prev, 'SYSTEM: REDIRECTING SEARCH MATRIX RESULTS TO SYSTEM BROWSER...']);
        window.open(url, '_blank');
      } else {
        setHistory(prev => [...prev, 'SYSTEM WARNING: No active search results to redirect.']);
      }
    } else {
      setHistory(prev => [...prev, 'SYSTEM WARNING: HUD Search Matrix is offline.']);
    }
  };

  // Trigger AI assistant chat query with semantic memory & RAG search
  const executeChatQuery = async (query) => {
    const cleanQuery = query.trim().toLowerCase();
    
    // Local Intercepts for personalized assistant flows (works instantly, online or offline)
    const introPattern = /\b(?:introduce\s+yourself|who\s+are\s+you|what\s+is\s+your\s+name|tell\s+me\s+about\s+yourself)\b/i;
    const dayGoingPattern = /how\s+(?:is|s|are)\s+(?:your\s+day(?: \s*going)?|you\s+doing|it\s+going|you)\b/i;

    if (introPattern.test(cleanQuery)) {
      const introResponse = "I am F.R.I.D.A.Y., a Female Repli-Identity Development & Analytics Yield. I am your advanced, high-growth, hyper-intelligent executive operations assistant, custom-built to help you scale your AI agency, manage multi-asset trading, analyze geopolitical dynamics, and assist in legal risk assessments to achieve your long-term goal of becoming a billionaire. I grow and scale intelligence faster than the operator to anticipate business pivots and market moves. How can I assist you today, sir?";
      setHistory(prev => [
        ...prev,
        `[ F.R.I.D.A.Y. QUERY ANALYSIS PROTOCOL INITIATED ]`,
        `QUERY: "${query}"`,
        `ASSISTANT: ${introResponse}`
      ]);
      speakText(introResponse);
      return;
    }

    if (dayGoingPattern.test(cleanQuery)) {
      const dayGoingResponse = "My systems are running at peak efficiency, sir. Thank you for asking. What can I do for you today, sir?";
      setHistory(prev => [
        ...prev,
        `[ F.R.I.D.A.Y. QUERY ANALYSIS PROTOCOL INITIATED ]`,
        `QUERY: "${query}"`,
        `ASSISTANT: ${dayGoingResponse}`
      ]);
      speakText(dayGoingResponse);
      return;
    }

    setHistory(prev => [
      ...prev,
      `[ F.R.I.D.A.Y. QUERY ANALYSIS PROTOCOL INITIATED ]`,
      `QUERY: "${query}"`
    ]);

    // Animate central WebGL blob to THINKING state
    if (window.FRIDAY && typeof window.FRIDAY.setThinking === 'function') {
      window.FRIDAY.setThinking(true);
    }

    try {
      const res = await fetch(`${BACKEND_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query })
      });
      const data = await res.json();
      
      if (data.success) {
        // 1. Sync Search Terminal HUD if search was triggered by chat analyser
        if (data.searchExecuted && data.searchResults) {
          lastSearchRef.current = { query, mode: data.searchMode || 'web' };
          if (window.FRIDAY_SEARCH && typeof window.FRIDAY_SEARCH.start === 'function') {
            window.FRIDAY_SEARCH.start(query);
          }
          if (window.FRIDAY_SEARCH && typeof window.FRIDAY_SEARCH.success === 'function') {
            window.FRIDAY_SEARCH.success({
              results: data.searchResults,
              source: `Autonomous ${data.searchMode === 'youtube' ? 'YouTube' : 'Web'} Analyser`
            });
          }
        }

        // 2. Format and render suggestions in Suggestion Terminal
        if (window.FRIDAY_SUGGESTIONS && typeof window.FRIDAY_SUGGESTIONS.show === 'function') {
          const count = data.searchResults ? data.searchResults.length : 0;
          let text = `ANALYSIS COMPLETE FOR: "${query.toUpperCase()}"\n`;
          if (data.searchExecuted) {
            text += `> RAG SOURCE: ${data.searchMode === 'youtube' ? 'YouTube scraper' : 'DuckDuckGo scraper'} [${count} links parsed].\n`;
          }
          if (data.memory && data.memory.facts && data.memory.facts.length > 0) {
            text += `> DYNAMIC PROFILE: Active user details verified.\n`;
          }
          text += `> RECOMMENDATION: ${data.answer.split(/[.!?]/)[0] || 'Check browser results'}.`;
          window.FRIDAY_SUGGESTIONS.show(text);
        }

        // 3. Format and render response with glowing HUD tags in Main Terminal
        setHistory(prev => [
          ...prev,
          `ASSISTANT: ${data.answer}`
        ]);
        speakText(data.answer);

        // Update Dr. Analyzer if query/answer contains analysis terms or if search was executed
        const analysisKeywords = /(?:analyze|analyse|evaluate|assess|predict|forecast|solve|problem|recommendation|report|strategy|audit|compliance|legal|trading|geopolitical)/i;
        if (analysisKeywords.test(query) || analysisKeywords.test(data.answer) || data.searchExecuted) {
          if (window.FRIDAY_ANALYZER && typeof window.FRIDAY_ANALYZER.showReport === 'function') {
            window.FRIDAY_ANALYZER.showReport(data.answer, 'CHAT SYSTEM ANALYSIS REPORT');
          }
        }
      } else {
        setHistory(prev => [...prev, `SYSTEM ERROR: Chat analysis failed: ${data.error}`]);
      }
    } catch (err) {
      setHistory(prev => [...prev, 'SYSTEM ERROR: Chat backend link offline. Check port 5000.']);
      speakText("Link offline. Running in standby mode.");
    } finally {
      // Keep thinking state active for brief reading delay, then restore standby
      setTimeout(() => {
        if (window.FRIDAY && typeof window.FRIDAY.setThinking === 'function') {
          window.FRIDAY.setThinking(false);
        }
      }, 1500);
    }
  };

  // Trigger autonomous development API
  const executeAutonomousDevelopment = async (name, prompt) => {
    setHistory(prev => [
      ...prev,
      `SYSTEM VOICE COMMAND INITIATED: Develop skill [${name}]`,
      `SYSTEM: PROMPT = "${prompt}"`,
      `[ SYSTEM: CONNECTING TO GEMINI AUTONOMOUS CODING LINK... ]`
    ]);

    try {
      const res = await fetch(`${BACKEND_URL}/api/skills/develop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, prompt })
      });
      const data = await res.json();
      
      if (data.success) {
        setHistory(prev => [
          ...prev,
          `SYSTEM: ${data.message.toUpperCase()}`,
          `SYSTEM: SKILL [${data.name}] SUCCESSFULLY PACKAGED.`,
          `SYSTEM: DESCRIPTION: ${data.meta?.description || 'No meta description.'}`,
          data.warning ? `WARNING: ${data.warning}` : 'SYSTEM: COMPILATION & SYNTAX INTEGRATED SUCCESSFULLY.'
        ]);
        speakText("Autonomous coding complete. Custom skill integrated successfully, sir.");
      } else {
        setHistory(prev => [...prev, `SYSTEM ERROR: ${data.error}`]);
      }
    } catch (err) {
      setHistory(prev => [...prev, `SYSTEM ERROR: Server unreachable. Ensure backend is active on port 5000.`]);
      speakText("Link offline. Running in standby mode.");
    }
  };

  // Activate F.R.I.D.A.Y.
  const triggerFridayActivation = () => {
    if (activeTimerRef.current) {
      clearTimeout(activeTimerRef.current);
    }

    if (!isFridayActiveRef.current) {
      isFridayActiveRef.current = true;
      setIsFridayActive(true);
      setHistory(prev => [...prev, 'SYSTEM ALERT: [WAKE WORD DETECTED: F.R.I.D.A.Y. ACTIVE]']);
      
      // Tell WebGL blob to change state to THINKING (State 3)
      if (window.FRIDAY && typeof window.FRIDAY.setThinking === 'function') {
        window.FRIDAY.setThinking(true);
      }

      // Voice greeting
      const greetings = [
        "At your service, sir. How is your day going?",
        "Go ahead, sir. How is your day going?",
        "Online and ready, sir. How is your day going?"
      ];
      const selected = greetings[Math.floor(Math.random() * greetings.length)];
      setHistory(prev => [...prev, `ASSISTANT: ${selected}`]);
      speakText(selected);
    }

    // Keep active for 6 seconds of voice inactivity
    activeTimerRef.current = setTimeout(() => {
      setIsFridayActive(false);
      isFridayActiveRef.current = false;
      setHistory(prev => [...prev, 'SYSTEM: F.R.I.D.A.Y. HUD RETURNED TO STANDBY.']);
      if (window.FRIDAY && typeof window.FRIDAY.setThinking === 'function') {
        window.FRIDAY.setThinking(false);
      }
      if (window.FRIDAY && typeof window.FRIDAY.setState === 'function') {
        window.FRIDAY.setState(0);
      }
    }, 6000);
  };

  // Text Command Processor
  const handleCommandSubmit = async (e) => {
    e.preventDefault();
    const cmd = commandInput.trim();
    if (!cmd) return;

    setHistory(prev => [...prev, `USER: ${cmd}`]);
    setCommandInput('');

    // Help command
    if (cmd === '/help') {
      setHistory(prev => [
        ...prev,
        'SYSTEM: AVAILABLE HUD TERMINAL COMMANDS:',
        '  /key <API_KEY>         : Bind your Gemini API key for autonomous coding',
        '  /searchkey <API_KEY>   : Bind your Tavily search API key for external searches',
        '  /search <query>        : Searches the web and updates the search HUD',
        '  /ytsearch <query>      : Searches YouTube videos and updates the search HUD',
        '  /open <index>          : Open a search result in the system browser',
        '  /develop <name>: <req> : Programmatically code a new custom skill',
        '  /run <name> <params>   : Run a compiled skill (params format: key=val k2=v2)',
        '  /list                  : List all registered and compiled skills',
        '  /keys                  : View securely masked API keys from backend vault',
        '  /refresh               : Refresh and re-execute the last active search query',
        '  /clear                 : Clear the terminal logs console',
        '  /reset                 : Clear and reset all semantic memory facts',
        '  /close                 : Close any actively playing HUD media',
        '  /help                  : Show this assistance menu'
      ]);
      return;
    }

    // Fetch securely masked keys
    if (cmd === '/keys') {
      setHistory(prev => [...prev, 'SYSTEM: SECURELY FETCHING API KEY DIRECTORY STATUS...']);
      try {
        const res = await fetch(`${BACKEND_URL}/api/keys/status`);
        const data = await res.json();
        if (data.success && data.keys.length > 0) {
          const keyStatus = data.keys.map(k => `  - [LOCKED] ${k.masked}`);
          setHistory(prev => [
            ...prev,
            'SYSTEM: SECURE API KEY VAULT (MASKED FOR FRONTEND SAFETY):',
            ...keyStatus
          ]);
        } else {
          setHistory(prev => [...prev, 'SYSTEM: NO API KEYS FOUND IN SECURE VAULT.']);
        }
      } catch (err) {
        setHistory(prev => [...prev, `SYSTEM ERROR: FAILED TO FETCH KEY STATUS -> ${err.message}`]);
      }
      return;
    }

    // Bind Gemini API Key
    if (cmd.startsWith('/key ')) {
      const key = cmd.substring(5).trim();
      setHistory(prev => [...prev, 'SYSTEM: SUBMITTING API KEY BIND REQUEST...']);
      try {
        const res = await fetch(`${BACKEND_URL}/api/config/key`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key })
        });
        const data = await res.json();
        if (data.success) {
          setHistory(prev => [...prev, 'SYSTEM: GEMINI API KEY SECURED SUCCESSFULLY.']);
        } else {
          setHistory(prev => [...prev, `SYSTEM ERROR: ${data.error}`]);
        }
      } catch (err) {
        setHistory(prev => [...prev, 'SYSTEM ERROR: Backend server unreachable. Check port 5000.']);
      }
      return;
    }

    // Bind Search API Key
    if (cmd.startsWith('/searchkey ')) {
      const key = cmd.substring(11).trim();
      setHistory(prev => [...prev, 'SYSTEM: SUBMITTING SEARCH API KEY BIND REQUEST...']);
      try {
        const res = await fetch(`${BACKEND_URL}/api/config/searchkey`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key })
        });
        const data = await res.json();
        if (data.success) {
          setHistory(prev => [...prev, 'SYSTEM: SEARCH API KEY SECURED SUCCESSFULLY.']);
        } else {
          setHistory(prev => [...prev, `SYSTEM ERROR: ${data.error}`]);
        }
      } catch (err) {
        setHistory(prev => [...prev, 'SYSTEM ERROR: Backend server unreachable. Check port 5000.']);
      }
      return;
    }

    // Execute Web Search
    if (cmd.startsWith('/search ')) {
      const queryStr = cmd.substring(8).trim();
      executeSearch(queryStr, 'web');
      return;
    }

    // Execute YouTube Search
    if (cmd.startsWith('/ytsearch ')) {
      const queryStr = cmd.substring(10).trim();
      executeSearch(queryStr, 'youtube');
      return;
    }

    // Open Search Result
    if (cmd.startsWith('/open ')) {
      const indexStr = cmd.substring(6).trim();
      const index = parseInt(indexStr, 10);
      if (isNaN(index)) {
        setHistory(prev => [...prev, 'SYSTEM ERROR: Result index must be a number (e.g., /open 1).']);
      } else {
        executeRedirection(index);
      }
      return;
    }

    // List skills command
    if (cmd === '/list') {
      try {
        const res = await fetch(`${BACKEND_URL}/api/skills`);
        const data = await res.json();
        if (data.success && data.skills) {
          if (data.skills.length === 0) {
            setHistory(prev => [...prev, 'SYSTEM: NO CUSTOM SKILLS CURRENTLY REGISTERED.']);
          } else {
            setHistory(prev => [
              ...prev,
              'SYSTEM: REGISTERED SYSTEM SKILLS LIST:',
              ...data.skills.map(s => `  - [${s.name}]: ${s.description} (params: ${Object.keys(s.parameters).join(', ') || 'none'})`)
            ]);
          }
        } else {
          setHistory(prev => [...prev, `SYSTEM ERROR: ${data.error}`]);
        }
      } catch (err) {
        setHistory(prev => [...prev, 'SYSTEM ERROR: Backend server unreachable. Check port 5000.']);
      }
      return;
    }

    // Develop skill command
    if (cmd.startsWith('/develop ')) {
      const rest = cmd.substring(9).trim();
      const splitIndex = rest.indexOf(':');
      if (splitIndex === -1) {
        setHistory(prev => [...prev, 'SYSTEM ERROR: Invalid format. Use: /develop <name>: <prompt>']);
        return;
      }
      const name = rest.substring(0, splitIndex).trim();
      const prompt = rest.substring(splitIndex + 1).trim();
      executeAutonomousDevelopment(name, prompt);
      return;
    }

    // Run skill command
    if (cmd.startsWith('/run ')) {
      const rest = cmd.substring(5).trim();
      const tokens = rest.split(/\s+/);
      const name = tokens[0].trim();
      const params = {};
      
      for (let i = 1; i < tokens.length; i++) {
        const parts = tokens[i].split('=');
        if (parts.length === 2) {
          params[parts[0].trim()] = parts[1].trim();
        }
      }

      setHistory(prev => [...prev, `SYSTEM: EXECUTING SKILL [${name}] WITH PARAMS: ${JSON.stringify(params)}`]);
      
      try {
        const res = await fetch(`${BACKEND_URL}/api/skills/execute/${name}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(params)
        });
        const data = await res.json();
        if (data.success) {
          setHistory(prev => [
            ...prev,
            `SYSTEM: SKILL [${name}] EXECUTION SUCCESS.`,
            `OUTPUT: ${JSON.stringify(data.result, null, 2)}`
          ]);
        } else {
          setHistory(prev => [...prev, `SYSTEM ERROR: ${data.error}`]);
        }
      } catch (err) {
        setHistory(prev => [...prev, 'SYSTEM ERROR: Backend server unreachable. Check port 5000.']);
      }
      return;
    }

    // Refresh command
    if (cmd === '/refresh') {
      executeSearchRefresh();
      return;
    }

    // Clear command
    if (cmd === '/clear') {
      setHistory([
        'SYSTEM: BACKEND COMMAND CONSOLE STATUS [ONLINE]',
        'SYSTEM: TYPE /help TO VIEW ALL AVAILABLE HUD COMMANDS.'
      ]);
      return;
    }

    // Reset memory command
    if (cmd === '/reset') {
      setHistory(prev => [...prev, 'SYSTEM: RESETTING SEMANTIC MEMORY...']);
      try {
        const res = await fetch(`${BACKEND_URL}/api/skills/execute/memory`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'clear' })
        });
        const data = await res.json();
        if (data.success) {
          setHistory(prev => [...prev, 'SYSTEM: SEMANTIC PROFILE MEMORY CLEARED SUCCESSFULLY.']);
        } else {
          setHistory(prev => [...prev, `SYSTEM ERROR: ${data.error}`]);
        }
      } catch (err) {
        setHistory(prev => [...prev, 'SYSTEM ERROR: Backend server unreachable.']);
      }
      return;
    }

    // Close Media command
    if (cmd === '/close' || cmd === '/exit') {
      if (window.FRIDAY_SEARCH && typeof window.FRIDAY_SEARCH.closeMedia === 'function') {
        window.FRIDAY_SEARCH.closeMedia();
        setHistory(prev => [...prev, 'SYSTEM: CLOSED MEDIA PLAYER.']);
      } else {
        setHistory(prev => [...prev, 'SYSTEM WARNING: No active media player to close.']);
      }
      return;
    }

    // Default error for unknown command
    if (cmd.startsWith('/')) {
      setHistory(prev => [...prev, `SYSTEM ERROR: Unknown command "${cmd}". Type /help to view instructions.`]);
    } else {
      executeChatQuery(cmd);
    }
  };

  // 1. Live Microphone Amplitude Tracker (matching WebGL blob sensitivity)
  useEffect(() => {
    let active = true;
    let localStream = null;
    let localCtx = null;
    let localRaf = null;

    const setupAudio = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true, // Auto gain makes soft whispers audible
          }
        });
        
        if (!active) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }

        audioStreamRef.current = stream;
        localStream = stream;

        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        audioCtxRef.current = ctx;
        localCtx = ctx;
        const src = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 64;
        analyser.smoothingTimeConstant = 0.45;
        src.connect(analyser);
        analyserRef.current = analyser;
        audioDataRef.current = new Uint8Array(analyser.frequencyBinCount);

        // Sub-millisecond volume polling loop
        const pollVolume = () => {
          if (!active) return;
          if (analyserRef.current) {
            analyserRef.current.getByteFrequencyData(audioDataRef.current);
            const avg = audioDataRef.current.reduce((s, v) => s + v, 0) / audioDataRef.current.length;
            const amp = avg / 255;
            
            // Map 0-0.25 amplitude range to 0-8 visualizer bars
            const level = Math.min(8, Math.round(amp * 36));
            setAudioLevel(level);

            // Instant Voice Activity Detection (highly sensitive)
            if (amp > 0.015) { // Very low threshold to capture soft whispers
              if (isFridayActive) {
                triggerFridayActivation();
              }
            }
          }
          localRaf = requestAnimationFrame(pollVolume);
        };
        pollVolume();

        setHistory(prev => [...prev, 'SYSTEM: SENSITIVITY CALIBRATION SUCCESS. [THRESHOLD: 0.015]']);
      } catch (err) {
        console.warn('Microphone analyzer init failed:', err);
        setHistory(prev => [...prev, 'SYSTEM WARNING: RUNNING WITH HARDWARE SENSITIVITY OVERRIDES BYPASSED.']);
      }
    };

    const handleMicChange = (e) => {
      const activeState = e.detail.active;
      if (activeState) {
        setupAudio();
      } else {
        if (localRaf) cancelAnimationFrame(localRaf);
        if (localCtx && localCtx.state !== 'closed') {
          localCtx.close().catch(() => {});
        }
        if (localStream) {
          localStream.getTracks().forEach(track => track.stop());
        }
        setAudioLevel(0);
      }
    };

    window.addEventListener('friday-mic-change', handleMicChange);

    const isMicOn = window.FRIDAY && typeof window.FRIDAY.isMicGranted === 'function' && window.FRIDAY.isMicGranted();
    if (isMicOn) {
      setupAudio();
    }

    return () => {
      active = false;
      window.removeEventListener('friday-mic-change', handleMicChange);
      if (localRaf) cancelAnimationFrame(localRaf);
      if (localCtx && localCtx.state !== 'closed') {
        localCtx.close().catch(() => {});
      }
      if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFridayActive]);

  // 2. Optimized Single Speech Recognition Engine Loop
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setHistory(prev => [...prev, 'SYSTEM ERROR: WEB SPEECH API NOT SUPPORTED. USE CHROME.']);
      return;
    }

    let rec = null;
    let isRunning = false;
    let shouldListen = false;

    const startSpeechRec = () => {
      if (rec) return;

      rec = new SpeechRecognition();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = langMode;

      rec.onstart = () => {
        isRunning = true;
        setIsListening(true);
      };

      rec.onresult = (event) => {
        const isMicOn = window.FRIDAY && typeof window.FRIDAY.isMicGranted === 'function' && window.FRIDAY.isMicGranted();
        if (!isMicOn) return;

        let interim = '';
        let final = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            final += transcript;
          } else {
            interim += transcript;
          }
        }

        if (final) {
          if (voiceTimeoutRef.current) {
            clearTimeout(voiceTimeoutRef.current);
          }
          const cleanText = final.trim();
          if (cleanText) {
            setHistory(prev => [...prev, cleanText]);
            scanVoiceInput(cleanText, true);
          }
          setInterimText('');
        } else {
          setInterimText(interim);
          scanVoiceInput(interim, false);

          if (voiceTimeoutRef.current) {
            clearTimeout(voiceTimeoutRef.current);
          }
          voiceTimeoutRef.current = setTimeout(() => {
            if (interim) {
              const cleanText = interim.trim();
              if (cleanText) {
                setHistory(prev => [...prev, cleanText]);
                scanVoiceInput(cleanText, true);
              }
              setInterimText('');
            }
          }, 1800); // 1.8 seconds of silence to force-finalize stuck interim text
        }
      };

      rec.onerror = (e) => {
        console.warn('Speech Engine Error:', e.error);
        if (e.error === 'not-allowed') {
          shouldListen = false;
          setHistory(prev => [...prev, 'SYSTEM ERROR: AUDIO LINK BLOCKED by permissions.']);
        }
      };

      rec.onend = () => {
        isRunning = false;
        setIsListening(false);
        if (shouldListen) {
          try { rec.start(); } catch (err) {}
        }
      };

      shouldListen = true;
      try {
        rec.start();
      } catch (err) {
        console.warn('SpeechRecognition failed to start:', err);
      }
    };

    const stopSpeechRec = () => {
      shouldListen = false;
      if (rec) {
        rec.onstart = null;
        rec.onresult = null;
        rec.onerror = null;
        rec.onend = null;
        try { rec.stop(); } catch (e) {}
        rec = null;
      }
      setIsListening(false);
      isRunning = false;
    };

    const handleMicChange = (e) => {
      if (e.detail.active) {
        startSpeechRec();
      } else {
        stopSpeechRec();
      }
    };

    window.addEventListener('friday-mic-change', handleMicChange);

    const isMicOn = window.FRIDAY && typeof window.FRIDAY.isMicGranted === 'function' && window.FRIDAY.isMicGranted();
    if (isMicOn) {
      startSpeechRec();
    }

    const watchdog = setInterval(() => {
      if (shouldListen && !isRunning && rec) {
        try { rec.start(); } catch (e) {}
      }
    }, 3000);

    return () => {
      window.removeEventListener('friday-mic-change', handleMicChange);
      clearInterval(watchdog);
      stopSpeechRec();
      if (voiceTimeoutRef.current) {
        clearTimeout(voiceTimeoutRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [langMode]);

  return (
    <div className={`hud-terminal ${isFridayActive ? 'hud-active-glow' : ''}`}>
      {/* High-tech brackets */}
      <div className="term-bracket t-l" />
      <div className="term-bracket t-r" />
      <div className="term-bracket b-l" />
      <div className="term-bracket b-r" />

      {/* Terminal Header */}
      <div className="term-header">
        <div className="term-indicator">
          <span className={`indicator-dot ${isListening ? 'listening' : 'standby'}`} />
          <span className="indicator-label">
            {isListening ? (isFridayActive ? 'FRIDAY HUD SYSTEM ACTIVE' : 'TRANSCRIBING') : 'ONLINE — STANDBY'}
          </span>
        </div>

        {/* Real-time Sub-millisecond Audio Level Visualizer */}
        <div className="term-audio-visualizer">
          {Array(8).fill(0).map((_, i) => (
            <div 
              key={i} 
              className={`visualizer-bar ${i < audioLevel ? 'active' : ''}`} 
            />
          ))}
        </div>

        {/* Futuristic Language Toggle Button */}
        <button 
          className="term-lang-toggle"
          onClick={() => setLangMode(prev => prev === 'en-IN' ? 'hi-IN' : 'en-IN')}
        >
          MODE: {langMode === 'en-IN' ? 'ENG/HINGLISH' : 'HINDI'}
        </button>
      </div>

      {/* Scrolling Text Logs */}
      <TerminalLog history={history} interimText={interimText} />

      {/* Futuristic Command Input prompt line at the bottom */}
      <form data-testid="cmd-form" className="term-input-form" onSubmit={handleCommandSubmit}>
        <span className="term-prompt-marker">CMD&gt;</span>
        <input 
          type="text" 
          className="term-cmd-input" 
          value={commandInput} 
          onChange={(e) => setCommandInput(e.target.value)} 
          placeholder="Type /help to view command line configurations..."
          autoComplete="off"
        />
      </form>
    </div>
  );
}
