import React, { useState, useEffect, useRef } from 'react';
import './terminal.css';
import { getGreeting, speakGreeting } from './friday_greetings';
import LearningHUD from './LearningHUD';
import TradingHUD from './TradingHUD';
import { BACKEND_URL } from '../config';

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
  const [history, rawSetHistory] = useState([
    'SYSTEM: INITIATING MULTI-LINGUAL VOICE MATRIX...',
    'SYSTEM: LANG CONFIG READY. SELECT MODE BELOW.',
    'SYSTEM: BACKEND COMMAND CONSOLE STATUS [ONLINE]',
    'SYSTEM: TYPE /help TO VIEW ALL AVAILABLE HUD COMMANDS.'
  ]);

  const setHistory = (val) => {
    rawSetHistory(prev => {
      let nextHistory = typeof val === 'function' ? val(prev) : val;
      if (nextHistory.length > 100) {
        nextHistory = nextHistory.slice(-100);
      }
      return nextHistory;
    });
  };
  const [interimText, setInterimText] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [isFridayActive, setIsFridayActive] = useState(false);
  const [langMode, setLangMode] = useState('en-IN'); // en-IN default
  // audioLevel state REMOVED — direct DOM manipulation via vizRef avoids 60fps re-renders
  const [commandInput, setCommandInput] = useState(''); // Text prompt command input
  const [voiceModel, setVoiceModel] = useState('female'); // voice model selector: 'male' or 'female'
  const [awaitingCallDecision, setAwaitingCallDecision] = useState(null);
  const awaitingCallDecisionRef = useRef(null);
  const [pendingCall, setPendingCall] = useState(null);

  const activeTimerRef = useRef(null);
  const lastSearchRef = useRef(null); // { query, mode }
  const isFridayActiveRef = useRef(false); // Guard for duplicate voice activations
  const voiceTimeoutRef = useRef(null); // Force finalization timeout for stuck voice input
  const vizRef = useRef(null); // Ref to the visualizer bar container for direct DOM updates
  const cachedVoicesRef = useRef(null); // Cache TTS voices to avoid repeated getVoices() calls
  const voiceModelRef = useRef('female'); // Ref mirror of voiceModel state for use in non-reactive closures
  const currentAudioRef = useRef(null);
  const speakingWatchdogRef = useRef(null);

  const resetSpeakingState = () => {
    if (speakingWatchdogRef.current) {
      clearTimeout(speakingWatchdogRef.current);
      speakingWatchdogRef.current = null;
    }
    if (window.FRIDAY && typeof window.FRIDAY.setSpeaking === 'function') {
      window.FRIDAY.setSpeaking(false);
    }
    window.FRIDAY_IS_SPEAKING = false;
    window.FRIDAY_LAST_SPOKE_TIME = Date.now();
  };

  const handleCallDecisionInput = (inputText) => {
    if (!awaitingCallDecisionRef.current) return false;
    
    const cleanInput = inputText.toLowerCase().trim();
    const isRespond = /(?:auto[- ]?respond|respond|yes|go\s+ahead|send|reply|reply\s+with\s+message)/i.test(cleanInput);
    const isLeave = /(?:leave|ignore|no|skip|leave\s+it|do\s+nothing)/i.test(cleanInput);
    
    const callId = awaitingCallDecisionRef.current;
    
    if (isRespond) {
      setAwaitingCallDecision(null);
      awaitingCallDecisionRef.current = null;
      setPendingCall(null);
      
      setHistory(prev => [...prev, `ASSISTANT: Understood, sir. Auto-responding to the call with the custom message.`]);
      speakText("Understood, sir. Auto-responding to the call with the custom message.");
      
      fetch(`${BACKEND_URL}/api/calls/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: callId, action: 'respond' })
      }).catch(e => console.error("Failed to submit call decision:", e));
      
      return true;
    } else if (isLeave) {
      setAwaitingCallDecision(null);
      awaitingCallDecisionRef.current = null;
      setPendingCall(null);
      
      setHistory(prev => [...prev, `ASSISTANT: Understood, sir. Leaving the call.`]);
      speakText("Understood, sir. Leaving the call.");
      
      fetch(`${BACKEND_URL}/api/calls/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: callId, action: 'leave' })
      }).catch(e => console.error("Failed to submit call decision:", e));
      
      return true;
    } else {
      setHistory(prev => [...prev, `ASSISTANT: I didn't catch that, sir. Should I auto-respond to the call or leave it?`]);
      speakText("I didn't catch that, sir. Should I auto-respond to the call or leave it?");
      return true;
    }
  };

  useEffect(() => {
    let interval = null;
    
    const checkPendingCalls = async () => {
      if (awaitingCallDecisionRef.current) return;
      
      try {
        const res = await fetch(`${BACKEND_URL}/api/calls/pending`);
        const data = await res.json();
        if (data.success && data.pending && data.pending.length > 0) {
          const nextCall = data.pending[0];
          
          setAwaitingCallDecision(nextCall.id);
          awaitingCallDecisionRef.current = nextCall.id;
          setPendingCall(nextCall);
          
          // Maximize analyzer to show details
          ensureTerminalsActive(['analyzer']);
          
          const speakPhrase = `Sir, you have an incoming call from ${nextCall.caller} on ${nextCall.source}. Should I auto-respond or just leave it?`;
          
          setHistory(prev => [
            ...prev,
            `⚠️ INCOMING CALL INTERCEPTED: [${nextCall.caller}] on [${nextCall.source}]`,
            `ASSISTANT: ${speakPhrase}`
          ]);
          
          speakText(speakPhrase);
        }
      } catch (e) {}
    };
    
    interval = setInterval(checkPendingCalls, 4000);
    return () => clearInterval(interval);
  }, []);

  const activeTerminalsRef = useRef({
    search: false,
    analyzer: false,
    trading: false,
    learning: false
  });

  const ensureTerminalsActive = (names) => {
    let intros = [];
    
    names.forEach(name => {
      let fullName = '';
      if (name === 'search') fullName = 'Cyber Search Matrix';
      else if (name === 'analyzer') fullName = 'Doctor Analyzer';
      else if (name === 'trading') fullName = 'Hedge Core';
      else if (name === 'learning') fullName = 'Cognitive Core';
      else if (name === 'office') fullName = 'Friday Office Terminal';

      if (fullName && !activeTerminalsRef.current[name]) {
        activeTerminalsRef.current[name] = true;
        intros.push(fullName);
        
        // Dispatch maximize event with speak: false, since we will speak it here
        window.dispatchEvent(new CustomEvent('friday-hud-maximize', { detail: { name, speak: false } }));
        
        // Minimize other terminal in the same column
        let otherName = '';
        if (name === 'search') otherName = 'analyzer';
        else if (name === 'analyzer') otherName = 'search';
        else if (name === 'trading') otherName = 'learning';
        else if (name === 'learning') otherName = 'trading';

        if (otherName) {
          activeTerminalsRef.current[otherName] = false;
          window.dispatchEvent(new CustomEvent('friday-hud-minimize', { detail: { name: otherName } }));
        }
      }
    });

    if (intros.length > 0) {
      if (intros.length === 1) {
        return `Initializing the ${intros[0]} terminal. `;
      } else {
        return `Initializing the ${intros.join(' and ')} terminals. `;
      }
    }
    return '';
  };

  const triggerTerminalMaximize = (name) => {
    let fullName = '';
    if (name === 'search') fullName = 'Cyber Search Matrix';
    else if (name === 'analyzer') fullName = 'Doctor Analyzer';
    else if (name === 'trading') fullName = 'Hedge Core';
    else if (name === 'learning') fullName = 'Cognitive Core';

    if (fullName) {
      const intro = ensureTerminalsActive([name]);
      if (intro) {
        speakText(intro);
      }
    }
  };

  const checkAndMaximizeTerminal = (commandString, isVoice = false) => {
    const text = commandString.toLowerCase().trim();
    
    // We only speak immediately for direct activation commands
    const isDirectActivation = 
      text.startsWith('/trading') || text.startsWith('/portfolio') || text.startsWith('/positions') ||
      text.startsWith('/search-terminal') || text.startsWith('/search-matrix') ||
      text.startsWith('/analyzer') || text.startsWith('/scanner') ||
      text.startsWith('/cognitive') || text.startsWith('/learning') ||
      /^(?:activate|open|show|start|maximize)\s+(?:the\s+)?(?:trading|portfolio|positions|ledger|search|matrix|analyzer|scanner|cognitive|learning|telemetry)/i.test(text);

    let targets = [];
    if (
      text.includes('portfolio') ||
      text.includes('position') ||
      text.includes('ledger') ||
      text.includes('net equity') ||
      text.includes('pnl') ||
      text.includes('/trading') ||
      text.includes('/positions') ||
      text.includes('/portfolio') ||
      text.startsWith('/run trading') ||
      (isVoice && (text.includes('trade') || text.includes('trading') || text.includes('market')))
    ) {
      targets.push('trading');
    }
    if (
      text.includes('cognitive') ||
      text.includes('intelligence') ||
      text.includes('learned') ||
      text.includes('learn') ||
      text.includes('telemetry') ||
      text.includes('/run auto-learn') ||
      text.startsWith('/develop') ||
      text.startsWith('/reset')
    ) {
      targets.push('learning');
    }
    if (
      text.startsWith('/search') ||
      text.startsWith('/ytsearch') ||
      text.startsWith('/refresh') ||
      text.includes('search youtube') ||
      text.includes('youtube search') ||
      text.includes('search the web') ||
      text.includes('google search') ||
      (isVoice && (text.includes('search') || text.includes('find') || text.includes('google') || text.includes('youtube')))
    ) {
      targets.push('search');
    }
    if (
      text.includes('diagnose') ||
      text.includes('check system') ||
      text.includes('recon') ||
      text.includes('audit') ||
      text.includes('report') ||
      text.startsWith('/run analyst') ||
      text.startsWith('/run geopolitics') ||
      text.startsWith('/run legal') ||
      text.startsWith('/run cyber-defense')
    ) {
      targets.push('analyzer');
    }

    if (targets.length > 0) {
      const speech = ensureTerminalsActive(targets);
      if (speech && isDirectActivation) {
        speakText(speech);
      }
    }
  };

  useEffect(() => {
    const handleMaximize = (e) => {
      const { name, speak } = e.detail;
      let fullName = '';
      if (name === 'search') fullName = 'Cyber Search Matrix';
      else if (name === 'analyzer') fullName = 'Doctor Analyzer';
      else if (name === 'trading') fullName = 'Hedge Core';
      else if (name === 'learning') fullName = 'Cognitive Core';

      if (fullName) {
        if (speak && !activeTerminalsRef.current[name]) {
          speakText(`Initializing the ${fullName} terminal.`);
        }
        activeTerminalsRef.current[name] = true;
        
        // Ensure column exclusion
        let otherName = '';
        if (name === 'search') otherName = 'analyzer';
        else if (name === 'analyzer') otherName = 'search';
        else if (name === 'trading') otherName = 'learning';
        else if (name === 'learning') otherName = 'trading';

        if (otherName) {
          activeTerminalsRef.current[otherName] = false;
        }
      }
    };
    const handleMinimize = (e) => {
      activeTerminalsRef.current[e.detail.name] = false;
    };
    window.addEventListener('friday-hud-maximize', handleMaximize);
    window.addEventListener('friday-hud-minimize', handleMinimize);
    return () => {
      window.removeEventListener('friday-hud-maximize', handleMaximize);
      window.removeEventListener('friday-hud-minimize', handleMinimize);
    };
  }, []);

  // F.R.I.D.A.Y. Boot Sequence and Diagnostics Wake Up Engine
  useEffect(() => {
    const isTestEnv = process.env.NODE_ENV === 'test' || 
                      (typeof window !== 'undefined' && window.navigator && window.navigator.userAgent && window.navigator.userAgent.includes('jsdom')) || 
                      (typeof global !== 'undefined' && global.jest);
    if (isTestEnv) {
      return;
    }
    const runWakeUpDiagnostics = async () => {
      setHistory(prev => [
        ...prev,
        `[ F.R.I.D.A.Y. SYSTEM WAKE-UP INTERFACE INITIATED ]`,
        `SYSTEM: Running network and subsystem diagnostics...`
      ]);

      let backendOnline = false;
      try {
        const res = await fetch(`${BACKEND_URL}/api/engine/status`);
        if (res.ok) backendOnline = true;
      } catch (e) {}

      let whatsappOnline = false;
      try {
        const waRes = await fetch(`${BACKEND_URL}/api/whatsapp/status`);
        const waData = await waRes.json();
        if (waData.success) {
          whatsappOnline = waData.accounts ? waData.accounts.some(acc => acc.ready) : waData.ready;
        }
      } catch (e) {}

      const terminals = {
        search: !!window.FRIDAY_SEARCH,
        analyzer: !!window.FRIDAY_ANALYZER,
        trading: !!window.FRIDAY_TRADING_ACTIVE,
        learning: !!window.FRIDAY_LEARNING_ACTIVE,
        office: !!window.FRIDAY_OFFICE_ACTIVE
      };

      const reports = [];
      reports.push(`SYSTEM: Backend server link is ${backendOnline ? 'NOMINAL' : 'OFFLINE'}.`);
      reports.push(`SYSTEM: Cyber Search Matrix is ${terminals.search ? 'ONLINE' : 'STANDBY'}.`);
      reports.push(`SYSTEM: Doctor Analyzer is ${terminals.analyzer ? 'ONLINE' : 'STANDBY'}.`);
      reports.push(`SYSTEM: Hedge Core Ledger is ${terminals.trading ? 'ONLINE' : 'STANDBY'}.`);
      reports.push(`SYSTEM: Cognitive Core Matrix is ${terminals.learning ? 'ONLINE' : 'STANDBY'}.`);
      reports.push(`SYSTEM: Friday Office Terminal is ${terminals.office ? 'ONLINE' : 'STANDBY'}.`);
      reports.push(`SYSTEM: WhatsApp Link is ${whatsappOnline ? 'NOMINAL' : 'OFFLINE'}.`);

      setHistory(prev => [...prev, ...reports]);

      // Construct voice report speech
      let voiceReport = '';
      if (backendOnline) {
        const activeCount = Object.values(terminals).filter(Boolean).length;
        const totalChecked = Object.keys(terminals).length;
        
        const onlineTerms = [];
        if (terminals.search) onlineTerms.push("Cyber Search");
        if (terminals.analyzer) onlineTerms.push("Doctor Analyzer");
        if (terminals.trading) onlineTerms.push("Hedge Core");
        if (terminals.learning) onlineTerms.push("Cognitive Core");
        if (terminals.office) onlineTerms.push("Friday Office");
        
        let waStatusSpeech = whatsappOnline ? "WhatsApp link is nominal." : "WhatsApp link is offline.";

        if (activeCount === totalChecked && whatsappOnline) {
          voiceReport = `Friday wake up sequence complete, sir. Backend network connection online. Frontend system interface active. Cyber Search, Doctor Analyzer, Hedge Core, Cognitive Core, and Friday Office terminals are online and fully operational. WhatsApp link is nominal. All systems nominal. Friday is ready. How can I assist you today, sir?`;
        } else {
          voiceReport = `Friday wake up sequence complete, sir. Backend connection is online, but some subsystems require attention. ${onlineTerms.join(', ')} terminals are online. ${waStatusSpeech} How can I assist you?`;
        }
      } else {
        voiceReport = "Friday wake up sequence complete, sir. Warning: Connection to backend is offline. Local system interface running in standby mode. Terminals are in standby. How can I assist you?";
      }

      speakGreeting(voiceReport);
      setHistory(prev => [...prev, `Friday: ${voiceReport}`]);
    };

    setTimeout(runWakeUpDiagnostics, 1500); // 1.5 seconds delay to allow components to register on window

    // Pre-load and cache TTS voices once on mount (avoids repeated getVoices() calls)
    const loadVoices = () => {
      const voices = window.speechSynthesis?.getVoices?.() || [];
      if (voices.length > 0) {
        cachedVoicesRef.current = voices;
      }
    };
    loadVoices();
    if (window.speechSynthesis && typeof window.speechSynthesis.addEventListener === 'function') {
      window.speechSynthesis.addEventListener('voiceschanged', loadVoices);
    }
    return () => {
      if (window.speechSynthesis && typeof window.speechSynthesis.removeEventListener === 'function') {
        window.speechSynthesis.removeEventListener('voiceschanged', loadVoices);
      }
    };
  }, []);

  // Backend Health-Check Heartbeat — auto-detect offline/online transitions
  useEffect(() => {
    let wasOnline = true; // assume online at start
    let heartbeatInterval = null;

    const pingBackend = async () => {
      try {
        const res = await fetch(`${BACKEND_URL}/api/engine/status`, { signal: AbortSignal.timeout(4000) });
        if (res.ok) {
          if (!wasOnline) {
            // Was offline, now back online
            wasOnline = true;
            setHistory(prev => [...prev,
              '✅ SYSTEM: F.R.I.D.A.Y. BACKEND RECONNECTED — ALL SYSTEMS NOMINAL.',
            ]);
            // Announce it with voice
            if (window.FRIDAY_VOICE) {
              // Re-sync voice settings after reconnect
              try {
                const vData = await (await fetch(`${BACKEND_URL}/api/voice`)).json();
                if (vData.success && vData.settings?.current) setVoiceModel(vData.settings.current);
              } catch {}
            }
          }
        } else {
          throw new Error(`HTTP ${res.status}`);
        }
      } catch (err) {
        if (wasOnline) {
          // Was online, just went offline
          wasOnline = false;
          setHistory(prev => [...prev,
            '⚠️ SYSTEM: BACKEND SIGNAL LOST. AUTO-RESTART IN PROGRESS...',
            '⚠️ SYSTEM: VOICE ENGINE OFFLINE. USING BROWSER TTS FALLBACK.',
            '⚠️ SYSTEM: MONITORING FOR BACKEND RECONNECTION...',
          ]);
        }
      }
    };

    // First ping after 5 seconds (give the backend time to boot)
    const firstPing = setTimeout(() => {
      pingBackend();
      heartbeatInterval = setInterval(pingBackend, 10000); // then every 10s
    }, 5000);

    return () => {
      clearTimeout(firstPing);
      if (heartbeatInterval) clearInterval(heartbeatInterval);
    };
  }, []);

  // Synchronize voice configuration with backend global settings.json
  useEffect(() => {
    const fetchVoiceSetting = async () => {
      try {
        const res = await fetch(`${BACKEND_URL}/api/voice`);
        const data = await res.json();
        if (data.success && data.settings && data.settings.current) {
          setVoiceModel(data.settings.current);
          voiceModelRef.current = data.settings.current;
        }
      } catch (err) {
        console.warn('Failed to fetch voice settings:', err);
      }
    };
    fetchVoiceSetting();

    // Expose setter globally so navbar dropdown or external commands can update terminal's local voice state
    window.FRIDAY_VOICE = {
      getVoice: () => voiceModelRef.current,
      setVoice: async (newVoice) => {
        setVoiceModel(newVoice);
        voiceModelRef.current = newVoice;
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

    // Expose the speech engine globally for other components to announce events (e.g. trading alerts)
    window.FRIDAY_SPEAK = speakText;

    return () => {
      delete window.FRIDAY_VOICE;
      delete window.FRIDAY_SPEAK;
    };
  }, [voiceModel]);

  // Native TTS Speech Synthesis function for F.R.I.D.A.Y. voice output
  const speakText = (text) => {
    return new Promise(async (resolve) => {
      // Strip markers, citations, markdown, and punctuation formatting that introduce pauses
      const cleanText = text
        .replace(/\[\d+\]/g, '') // remove citation brackets like [1], [2]
        .replace(/\[.*?\]/g, '') // remove any other bracketed text/system tags
        .replace(/F\s*\.\s*R\s*\.\s*I\s*\.\s*D\s*\.\s*A\s*\.\s*Y\.?/gi, 'Friday') // Pronounce as "Friday" rather than spelling it out
        .replace(/SYSTEM:|ASSISTANT:|WARNING:|ERROR:/gi, '')
        .replace(/[*_`#~]/g, '') // remove markdown indicators
        .replace(/[-/\\|]/g, ' ') // replace hyphens, slashes, bars with spaces to prevent breaks
        .replace(/[:;]/g, ',') // turn colons/semicolons into soft comma pauses
        .replace(/\s+/g, ' ') // collapse duplicate spaces
        .trim();

      if (!cleanText) {
        resolve();
        return;
      }

      // Stop and clean up any currently playing ElevenLabs/custom TTS audio
      if (currentAudioRef.current) {
        try {
          currentAudioRef.current.pause();
          currentAudioRef.current.currentTime = 0;
        } catch (e) {}
        currentAudioRef.current = null;
      }

      // Cancel native speechSynthesis as well
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }

      // Initialize speaking states
      const isTestEnv = process.env.NODE_ENV === 'test' || 
                        (typeof window !== 'undefined' && window.navigator && window.navigator.userAgent && window.navigator.userAgent.includes('jsdom')) || 
                        (typeof global !== 'undefined' && global.jest);
      window.FRIDAY_IS_SPEAKING = isTestEnv ? false : true;
      if (window.FRIDAY && typeof window.FRIDAY.setSpeaking === 'function') {
        window.FRIDAY.setSpeaking(true);
      }

      // Set timed watchdog failsafe: 12 chars per second, min 6s, max 25s
      if (speakingWatchdogRef.current) {
        clearTimeout(speakingWatchdogRef.current);
      }
      const watchdogDuration = Math.min(25000, Math.max(6000, (cleanText.length / 12) * 1000 + 3000));
      
      const customResetSpeakingState = () => {
        resetSpeakingState();
        resolve();
      };

      speakingWatchdogRef.current = setTimeout(() => {
        console.warn("[FRIDAY-WATCHDOG] Speaking watchdog timed out. Forcing reset.");
        customResetSpeakingState();
      }, watchdogDuration);

      try {
        // Attempt to hit the Custom Colab TTS proxy
        const res = await fetch(`${BACKEND_URL}/api/tts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: cleanText })
        });

        if (res.ok) {
          const audioBlob = await res.blob();
          const audioUrl = URL.createObjectURL(audioBlob);
          const audio = new Audio(audioUrl);
          audio.crossOrigin = "anonymous";
          currentAudioRef.current = audio;
          
          // Connect to Friday's visualizer AudioContext
          if (window.FRIDAY && typeof window.FRIDAY.connectAudio === 'function') {
            window.FRIDAY.connectAudio(audio);
          }
          
          audio.onended = () => {
            if (currentAudioRef.current === audio) {
              currentAudioRef.current = null;
            }
            customResetSpeakingState();
          };
          audio.onerror = () => {
            if (currentAudioRef.current === audio) {
              currentAudioRef.current = null;
            }
            fallbackSpeechSynthesis(cleanText, resolve);
          };
          
          await audio.play();
          return;
        }
      } catch (e) {
        console.warn("Custom TTS engine unreachable, falling back to browser TTS.", e);
      }

      fallbackSpeechSynthesis(cleanText, resolve);
    });
  };

  const fallbackSpeechSynthesis = (cleanText, resolve) => {
    if (!('speechSynthesis' in window)) {
      console.warn('SpeechSynthesis not supported.');
      resetSpeakingState();
      resolve();
      return;
    }

    // Stop ElevenLabs audio if playing
    if (currentAudioRef.current) {
      try {
        currentAudioRef.current.pause();
        currentAudioRef.current.currentTime = 0;
      } catch (e) {}
      currentAudioRef.current = null;
    }

    window.speechSynthesis.cancel(); // Cancel active speech

    const utterance = new SpeechSynthesisUtterance(cleanText);

    // Use cached voices — pre-loaded on mount to avoid repeated getVoices() calls
    const voices = cachedVoicesRef.current || (window.speechSynthesis?.getVoices?.() ?? []);
    
    let selectedVoice = null;

    // Use ref instead of state to always get the current voice model in this closure
    const currentVoiceModel = voiceModelRef.current;

    const isFemale = ['female', 'bella', 'rachel', 'glinda'].includes(currentVoiceModel);

    if (isFemale) {
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
      const isFemale = ['female', 'bella', 'rachel', 'glinda'].includes(currentVoiceModel);
      if (isFemale) {
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

    if (currentVoiceModel === 'female') {
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
      const isTestEnv = process.env.NODE_ENV === 'test' || 
                        (typeof window !== 'undefined' && window.navigator && window.navigator.userAgent && window.navigator.userAgent.includes('jsdom')) || 
                        (typeof global !== 'undefined' && global.jest);
      window.FRIDAY_IS_SPEAKING = isTestEnv ? false : true;
    };

    utterance.onend = () => {
      resetSpeakingState();
      resolve();
    };

    utterance.onerror = () => {
      resetSpeakingState();
      resolve();
    };

    window.speechSynthesis.speak(utterance);
  };

  // Run dynamic cognitive system skill via backend API
  const runSkill = async (name, params) => {
    let targets = ['analyzer'];
    if (name === 'trading') {
      targets.push('trading');
    }
    const intro = ensureTerminalsActive(targets);
    if (intro) {
      speakText(intro);
    }

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

  // Helper to parse and send WhatsApp messages via voice or typed command
  const handleWhatsAppSendCommand = (cmdText) => {
    const cleanCmd = cmdText.trim().toLowerCase();
    
    // Check if it is a WhatsApp send command
    let isWaCommand = false;
    
    // Case A: message <name> on whatsapp ...
    if (cleanCmd.startsWith('message ') && cleanCmd.includes(' on whatsapp')) {
      isWaCommand = true;
    } else {
      const prefixes = [
        'send whatsapp message to ',
        'send whatsapp message ',
        'send whatsapp to ',
        'send whatsapp ',
        'whatsapp message to ',
        'whatsapp message ',
        'whatsapp to ',
        'whatsapp '
      ];
      for (const prefix of prefixes) {
        if (cleanCmd.startsWith(prefix)) {
          isWaCommand = true;
          break;
        }
      }
    }

    if (!isWaCommand) return false;

    // Run async processing
    processWhatsAppSend(cmdText);
    return true;
  };

  const processWhatsAppSend = async (cmdText) => {
    const cleanCmd = cmdText.trim().toLowerCase();
    let name = '';
    let message = '';
    let fromAccount = '';

    // Let's parse the optional "from [account name]"
    let remainingText = cmdText;
    
    // Clean up typical prefixes
    const prefixes = [
      'send whatsapp message to ',
      'send whatsapp message ',
      'send whatsapp to ',
      'send whatsapp ',
      'whatsapp message to ',
      'whatsapp message ',
      'whatsapp to ',
      'whatsapp '
    ];

    let matchedPrefix = '';
    for (const prefix of prefixes) {
      if (cleanCmd.startsWith(prefix)) {
        matchedPrefix = prefix;
        break;
      }
    }

    if (matchedPrefix) {
      remainingText = cmdText.substring(matchedPrefix.length).trim();
    }
    
    // Let's parse "from [account name] to [contact]" or similar
    const cleanRemaining = remainingText.trim().toLowerCase();
    if (cleanRemaining.startsWith('from ')) {
      const toIndex = cleanRemaining.indexOf(' to ');
      if (toIndex !== -1) {
        fromAccount = remainingText.substring(5, toIndex).trim();
        remainingText = remainingText.substring(toIndex + 4).trim();
      }
    }

    // Check if remainingText contains keyword: saying/that/says/message/text
    const keywordRegex = /\b(saying|that|says|message|text)\b/i;
    const keyMatch = remainingText.match(keywordRegex);
    if (keyMatch) {
      const keyword = keyMatch[0];
      const index = remainingText.toLowerCase().indexOf(keyword.toLowerCase());
      name = remainingText.substring(0, index).trim();
      message = remainingText.substring(index + keyword.length).trim();
    } else {
      // No keyword. Match name and message word-by-word
      try {
        const statusRes = await fetch(`${BACKEND_URL}/api/whatsapp/status`);
        const statusData = await statusRes.json();
        const accounts = statusData.success ? statusData.accounts : [];
        
        let targetAccId = 'friday-session';
        if (fromAccount) {
          const cleanFrom = fromAccount.toLowerCase().replace(/[^a-z0-9]/g, '');
          const matchedAcc = accounts.find(a => a.name.toLowerCase().replace(/[^a-z0-9]/g, '') === cleanFrom) ||
                             accounts.find(a => a.id.toLowerCase().replace(/[^a-z0-9]/g, '') === cleanFrom);
          if (matchedAcc) {
            targetAccId = matchedAcc.id;
          }
        } else {
          const readyAcc = accounts.find(a => a.ready);
          if (readyAcc) {
            targetAccId = readyAcc.id;
          }
        }

        const chatsRes = await fetch(`${BACKEND_URL}/api/whatsapp/chats?accountId=${targetAccId}`);
        const chatsData = await chatsRes.json();
        const chats = chatsData.success ? chatsData.chats : [];
        
        const words = remainingText.split(/\s+/);
        let matched = null;
        // Try combining 1 to 4 words from the start of remainingText as the contact name
        for (let len = Math.min(words.length - 1, 4); len >= 1; len--) {
          const candidateName = words.slice(0, len).join(' ');
          const cleanCandidate = candidateName.toLowerCase().replace(/[^a-z0-9]/g, '');
          if (!cleanCandidate) continue;
          
          matched = chats.find(c => c.contact.toLowerCase().replace(/[^a-z0-9]/g, '') === cleanCandidate) ||
                    chats.find(c => c.contact.toLowerCase().replace(/[^a-z0-9]/g, '').startsWith(cleanCandidate));
          if (matched) {
            name = matched.contact;
            message = words.slice(len).join(' ');
            break;
          }
        }
        
        if (!matched && words.length > 1) {
          const firstWord = words[0];
          const cleanFirst = firstWord.toLowerCase().replace(/[^a-z0-9]/g, '');
          matched = chats.find(c => c.contact.toLowerCase().replace(/[^a-z0-9]/g, '').includes(cleanFirst));
          if (matched) {
            name = matched.contact;
            message = words.slice(1).join(' ');
          } else if (/^\+?\d+$/.test(firstWord)) {
            name = firstWord;
            message = words.slice(1).join(' ');
          }
        }
      } catch (e) {
        console.error("Failed to parse words via chats:", e);
      }
    }

    if (!name || !message) {
      setHistory(prev => [...prev, 'SYSTEM WARNING: Could not parse contact name and message from input.']);
      speakText("I couldn't parse the contact name or message, sir.");
      return;
    }

    // Resolve account
    let resolvedAccId = 'friday-session';
    let resolvedAccName = 'Primary';
    try {
      const statusRes = await fetch(`${BACKEND_URL}/api/whatsapp/status`);
      const statusData = await statusRes.json();
      if (statusData.success && statusData.accounts && statusData.accounts.length > 0) {
        if (fromAccount) {
          const cleanFrom = fromAccount.toLowerCase().replace(/[^a-z0-9]/g, '');
          const matchedAcc = statusData.accounts.find(a => a.name.toLowerCase().replace(/[^a-z0-9]/g, '') === cleanFrom) ||
                             statusData.accounts.find(a => a.id.toLowerCase().replace(/[^a-z0-9]/g, '') === cleanFrom);
          if (matchedAcc) {
            resolvedAccId = matchedAcc.id;
            resolvedAccName = matchedAcc.name;
          } else {
            setHistory(prev => [...prev, `SYSTEM WARNING: WhatsApp account "${fromAccount}" not found.`]);
            speakText(`WhatsApp account ${fromAccount} not found, sir.`);
            return;
          }
        } else {
          const readyAcc = statusData.accounts.find(a => a.ready);
          if (readyAcc) {
            resolvedAccId = readyAcc.id;
            resolvedAccName = readyAcc.name;
          } else {
            resolvedAccId = statusData.accounts[0].id;
            resolvedAccName = statusData.accounts[0].name;
          }
        }
      }
    } catch (err) {
      console.error("Failed to resolve sender account:", err);
    }

    // Resolve name to number in the context of the resolved account
    let resolvedNumber = null;
    let resolvedName = name;

    try {
      const chatsRes = await fetch(`${BACKEND_URL}/api/whatsapp/chats?accountId=${resolvedAccId}`);
      const chatsData = await chatsRes.json();
      const chats = chatsData.success ? chatsData.chats : [];
      
      const cleanTarget = name.toLowerCase().replace(/[^a-z0-9]/g, '');
      const matched = chats.find(c => c.contact.toLowerCase().replace(/[^a-z0-9]/g, '') === cleanTarget) ||
                      chats.find(c => c.contact.toLowerCase().replace(/[^a-z0-9]/g, '').startsWith(cleanTarget)) ||
                      chats.find(c => c.contact.toLowerCase().replace(/[^a-z0-9]/g, '').includes(cleanTarget));
      if (matched) {
        resolvedNumber = matched.number;
        resolvedName = matched.contact;
      }
    } catch (err) {
      console.error("Failed to fetch chats for resolving name:", err);
    }

    if (!resolvedNumber && /^\+?\d+$/.test(name.replace(/[\s+-]/g, ''))) {
      resolvedNumber = name.replace(/[\s+-]/g, '');
    }

    if (!resolvedNumber) {
      setHistory(prev => [...prev, `SYSTEM WARNING: Contact "${name}" not found in active chats.`]);
      speakText(`I couldn't find a contact named ${name} in your active chats for account ${resolvedAccName}, sir.`);
      return;
    }

    // Send the message
    setHistory(prev => [...prev, `SYSTEM: Sending WhatsApp from ${resolvedAccName} to ${resolvedName}...`]);
    try {
      const replyRes = await fetch(`${BACKEND_URL}/api/whatsapp/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: resolvedNumber, message: message, accountId: resolvedAccId })
      });
      const data = await replyRes.json();
      if (data.success) {
        setHistory(prev => [...prev, `SYSTEM: WhatsApp message sent from ${resolvedAccName} to ${resolvedName} (${resolvedNumber}): "${message}"`]);
        speakText(`WhatsApp message sent from ${resolvedAccName} to ${resolvedName}, sir.`);
      } else {
        setHistory(prev => [...prev, `SYSTEM ERROR: Failed to send WhatsApp message -> ${data.error}`]);
        speakText(`Failed to send WhatsApp message to ${resolvedName}, sir.`);
      }
    } catch (err) {
      setHistory(prev => [...prev, `SYSTEM ERROR: Network error while sending WhatsApp message.`]);
      speakText(`Failed to send WhatsApp message due to a network error, sir.`);
    }
  };

  // Wake word & voice command scanner
  const scanVoiceInput = (text, isFinal = true) => {
    const now = Date.now();
    const isSpeaking = window.FRIDAY_IS_SPEAKING || (window.FRIDAY_LAST_SPOKE_TIME && (now - window.FRIDAY_LAST_SPOKE_TIME) < 1500);
    if (isSpeaking) {
      return;
    }

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

    // Check if we are waiting for a call decision
    const handledDecision = handleCallDecisionInput(cleanCommandText);
    if (handledDecision) return;

    // Intercept WhatsApp Send command
    const handledWa = handleWhatsAppSendCommand(cleanCommandText);
    if (handledWa) return;

    checkAndMaximizeTerminal(cleanCommandText, true);

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

    // E. Autonomous Web Learn Trigger
    const learnPattern = /^(?:learn|deep learn|start learning)\s+(?:about\s+)?(.+)/i;
    if (learnPattern.test(cleanCommandText)) {
      const match = cleanCommandText.match(learnPattern);
      const topic = match[1].trim();
      executeLearnSweep(topic);
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
    const timeQueryPattern = /\b(?:what\s+(?:is\s+the\s+)?time|tell\s+me\s+the\s+time|current\s+time|atomic\s+time|what\s+time\s+is\s+it)\b/i;

    if (timeQueryPattern.test(cleanCommandText)) {
      const timeStr = (window.FRIDAY_ATOMIC_TIME && typeof window.FRIDAY_ATOMIC_TIME === 'function') 
        ? window.FRIDAY_ATOMIC_TIME() 
        : new Date().toLocaleTimeString();
      const response = `The F.R.I.D.A.Y. network atomic clock is synced, sir. The current exact time is ${timeStr}.`;
      setHistory(prev => [
        ...prev,
        `[ F.R.I.D.A.Y. ATOMIC TIME SYNC PROTOCOL ]`,
        `QUERY: "${cleanCommandText}"`,
        `ASSISTANT: ${response}`
      ]);
      speakText(response);
      return;
    }

    if (introPattern.test(cleanCommandText) || dayGoingPattern.test(cleanCommandText)) {
      if (!isFridayActiveRef.current) {
        triggerFridayActivation();
      }
      executeChatQuery(cleanCommandText);
      return;
    }

    // 5. General conversational catch-all: send unmatched input to chat API
    if (!isFridayActiveRef.current) {
      triggerFridayActivation();
    }
    executeChatQuery(cleanCommandText);
    return;
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
    const intro = ensureTerminalsActive(['search']);

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
      speakText(intro + "Searching YouTube video feeds.");
    } else {
      speakText(intro + "Accessing local databases. Searching the web...");
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

  // Autonomous Learn Sweep
  const executeLearnSweep = async (topic) => {
    const intro = ensureTerminalsActive(['learning']);
    setHistory(prev => [
      ...prev,
      `SYSTEM: INITIATING AUTONOMOUS WEB-SWEEP FOR [${topic.toUpperCase()}]`,
      `SYSTEM: SEARCHING WEB AND YOUTUBE FOR FACTS AND MYTHS...`
    ]);
    speakText(intro + `Initiating autonomous deep web sweep for ${topic}, sir. This may take a moment.`);
    
    if (window.FRIDAY && typeof window.FRIDAY.setThinking === 'function') {
      window.FRIDAY.setThinking(true);
    }
    
    try {
      const res = await fetch(`${BACKEND_URL}/api/skills/execute/auto-learn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic })
      });
      const data = await res.json();
      
      if (data.success && data.result && data.result.success) {
        setHistory(prev => [
          ...prev,
          `SYSTEM: DEEP LEARNING COMPLETE FOR [${topic.toUpperCase()}]`,
          `> ${data.result.report}`
        ]);
        speakText(`Deep learning complete. ${data.result.report}`);
      } else {
        setHistory(prev => [...prev, `SYSTEM ERROR: Autonomous learning failed: ${data.error || data.result?.error || 'Unknown error'}`]);
        speakText("Autonomous learning failed to complete, sir.");
      }
    } catch (err) {
      setHistory(prev => [...prev, `SYSTEM ERROR: Connection to Cognitive Matrix failed.`]);
      speakText("Connection to Cognitive Matrix failed, sir.");
    } finally {
      if (window.FRIDAY && typeof window.FRIDAY.setThinking === 'function') {
        window.FRIDAY.setThinking(false);
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
    const timeQueryPattern = /\b(?:what\s+(?:is\s+the\s+)?time|tell\s+me\s+the\s+time|current\s+time|atomic\s+time|what\s+time\s+is\s+it)\b/i;
    const briefingPattern = /\b(?:morning\s+briefing|brief\s+me|daily\s+report|give\s+me\s+my\s+briefing|briefing)\b/i;

    if (briefingPattern.test(cleanQuery)) {
      setHistory(prev => [
        ...prev,
        `[ F.R.I.D.A.Y. QUERY ANALYSIS PROTOCOL INITIATED ]`,
        `QUERY: "${query}"`,
        `SYSTEM: FETCHING DAILY EXECUTIVE BRIEFING...`
      ]);
      if (window.FRIDAY && typeof window.FRIDAY.setThinking === 'function') {
        window.FRIDAY.setThinking(true);
      }
      try {
        const res = await fetch(`${BACKEND_URL}/api/assistant/briefing`);
        const data = await res.json();
        if (data.success && data.briefing) {
          setHistory(prev => [...prev, `ASSISTANT: ${data.briefing}`]);
          
          if (data.segments && data.segments.length > 0) {
            // Smoothly maximize the Office HUD pop-up
            window.dispatchEvent(new CustomEvent('friday-hud-maximize', { detail: { name: 'office' } }));
            
            // Execute speech segments sequentially, switching tabs
            for (const segment of data.segments) {
              window.dispatchEvent(new CustomEvent('friday-office-tab', { detail: { tab: segment.type } }));
              await speakText(segment.text);
              // Small pacing pause between sections
              await new Promise(r => setTimeout(r, 600));
            }
            
            // Smoothly minimize/close the Office HUD when finished
            window.dispatchEvent(new CustomEvent('friday-hud-minimize', { detail: { name: 'office' } }));
          } else {
            await speakText(data.briefing);
          }
        } else {
          const errorMsg = data.error || "Failed to retrieve briefing.";
          setHistory(prev => [...prev, `SYSTEM ERROR: ${errorMsg}`]);
          await speakText("I was unable to retrieve your daily briefing, sir.");
        }
      } catch (err) {
        setHistory(prev => [...prev, `SYSTEM ERROR: Briefing endpoint offline.`]);
        await speakText("I cannot connect to the briefing service, sir.");
      } finally {
        if (window.FRIDAY && typeof window.FRIDAY.setThinking === 'function') {
          window.FRIDAY.setThinking(false);
        }
      }
      return;
    }

    if (timeQueryPattern.test(cleanQuery)) {
      const timeStr = (window.FRIDAY_ATOMIC_TIME && typeof window.FRIDAY_ATOMIC_TIME === 'function') 
        ? window.FRIDAY_ATOMIC_TIME() 
        : new Date().toLocaleTimeString();
      const response = `The F.R.I.D.A.Y. network atomic clock is synced, sir. The current exact time is ${timeStr}.`;
      setHistory(prev => [
        ...prev,
        `[ F.R.I.D.A.Y. QUERY ANALYSIS PROTOCOL INITIATED ]`,
        `QUERY: "${query}"`,
        `ASSISTANT: ${response}`
      ]);
      speakText(response);
      return;
    }

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
    const intro = ensureTerminalsActive(['learning']);
    if (intro) {
      speakText(intro);
    }

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

    // Keep active for 30 seconds of voice inactivity
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
    }, 30000);
  };

  // Text Command Processor
  const handleCommandSubmit = async (e) => {
    e.preventDefault();
    const cmd = commandInput.trim();
    if (!cmd) return;

    setHistory(prev => [...prev, `USER: ${cmd}`]);
    setCommandInput('');

    // Check if we are waiting for a call decision
    const handledDecision = handleCallDecisionInput(cmd);
    if (handledDecision) return;

    // Intercept WhatsApp Send command
    const handledWa = handleWhatsAppSendCommand(cmd);
    if (handledWa) return;

    checkAndMaximizeTerminal(cmd, false);

    // Custom HUD toggle slash commands
    if (cmd === '/trading' || cmd === '/portfolio' || cmd === '/positions') {
      triggerTerminalMaximize('trading');
      setHistory(prev => [...prev, 'SYSTEM: MAXIMIZING HEDGE CORE TERMINAL.']);
      return;
    }
    if (cmd === '/search-matrix' || cmd === '/search-terminal') {
      triggerTerminalMaximize('search');
      setHistory(prev => [...prev, 'SYSTEM: MAXIMIZING CYBER SEARCH MATRIX TERMINAL.']);
      return;
    }
    if (cmd === '/analyzer' || cmd === '/scanner') {
      triggerTerminalMaximize('analyzer');
      setHistory(prev => [...prev, 'SYSTEM: MAXIMIZING DOCTOR ANALYZER TERMINAL.']);
      return;
    }
    if (cmd === '/cognitive' || cmd === '/learning') {
      triggerTerminalMaximize('learning');
      setHistory(prev => [...prev, 'SYSTEM: MAXIMIZING COGNITIVE CORE TERMINAL.']);
      return;
    }
    if (cmd === '/minimize') {
      window.dispatchEvent(new CustomEvent('friday-hud-minimize', { detail: { name: 'search' } }));
      window.dispatchEvent(new CustomEvent('friday-hud-minimize', { detail: { name: 'analyzer' } }));
      window.dispatchEvent(new CustomEvent('friday-hud-minimize', { detail: { name: 'trading' } }));
      window.dispatchEvent(new CustomEvent('friday-hud-minimize', { detail: { name: 'learning' } }));
      setHistory(prev => [...prev, 'SYSTEM: ALL TERMINALS MINIMIZED.']);
      return;
    }

    // Help command
    if (cmd === '/help') {
      setHistory(prev => [
        ...prev,
        'SYSTEM: AVAILABLE HUD TERMINAL COMMANDS:',
        '  /key <API_KEY>         : Bind your Gemini API key for autonomous coding',
        '  /searchkey <API_KEY>   : Bind your Tavily search API key for external searches',
        '  /elevenkey <API_KEY>   : Bind your ElevenLabs API key for cloud voice cloning',
        '  /voice-engine <URL>    : Bind Colab or Local GPU voice engine URL (e.g. https://xxx.loca.lt)',
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
        '  /trading               : Maximize the Hedge Core terminal',
        '  /positions             : Maximize the Hedge Core terminal',
        '  /search-terminal       : Maximize the Cyber Search Matrix terminal',
        '  /analyzer              : Maximize the Doctor Analyzer terminal',
        '  /cognitive             : Maximize the Cognitive Core terminal',
        '  /minimize              : Minimize all peripheral terminals',
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

    // Bind ElevenLabs API Key
    if (cmd.startsWith('/elevenkey ')) {
      const key = cmd.substring(11).trim();
      setHistory(prev => [...prev, 'SYSTEM: SUBMITTING ELEVENLABS API KEY BIND REQUEST...']);
      try {
        const res = await fetch(`${BACKEND_URL}/api/config/elevenkey`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key })
        });
        const data = await res.json();
        if (data.success) {
          setHistory(prev => [...prev, 'SYSTEM: ELEVENLABS API KEY SECURED SUCCESSFULLY.']);
          speakText("ElevenLabs voice link secured, sir.");
        } else {
          setHistory(prev => [...prev, `SYSTEM ERROR: ${data.error}`]);
        }
      } catch (err) {
        setHistory(prev => [...prev, 'SYSTEM ERROR: Backend server unreachable. Check port 5000.']);
      }
      return;
    }

    // Bind Custom Voice Engine URL (Colab / Local GPU)
    if (cmd.startsWith('/voice-engine ')) {
      const url = cmd.substring(14).trim();
      if (!url.startsWith('http')) {
        setHistory(prev => [...prev, 'SYSTEM ERROR: URL must start with http:// or https://']);
        return;
      }
      setHistory(prev => [...prev, `SYSTEM: BINDING VOICE ENGINE TO [${url}]...`]);
      try {
        const res = await fetch(`${BACKEND_URL}/api/voice-engine/url`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url })
        });
        const data = await res.json();
        if (data.success) {
          setHistory(prev => [...prev,
            'SYSTEM: CUSTOM VOICE ENGINE URL SECURED.',
            `SYSTEM: F.R.I.D.A.Y. VOICE MATRIX UPGRADED → GPU STREAMING ACTIVE.`
          ]);
          speakText("Voice engine upgraded. Custom voice matrix is now active, sir.");
        } else {
          setHistory(prev => [...prev, `SYSTEM ERROR: ${data.error}`]);
        }
      } catch (err) {
        setHistory(prev => [...prev, 'SYSTEM ERROR: Backend unreachable. Check port 5000.']);
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

  // 1. Live Microphone Amplitude Tracker — uses direct DOM manipulation, NO React state updates
  useEffect(() => {
    let active = true;
    let localRaf = null;
    let frameSkip = 0;

    // Direct DOM update helper — bypasses React entirely for sub-millisecond updates
    const updateVisualizerBars = (level) => {
      if (!vizRef.current) return;
      const bars = vizRef.current.children;
      for (let i = 0; i < bars.length; i++) {
        const shouldBeActive = i < level;
        const isActive = bars[i].classList.contains('active');
        if (shouldBeActive !== isActive) {
          if (shouldBeActive) {
            bars[i].classList.add('active');
          } else {
            bars[i].classList.remove('active');
          }
        }
      }
    };

    const pollVolume = () => {
      if (!active) return;
      // Only process every 2nd frame (~30hz) for the visualizer — human eye can't detect the difference
      frameSkip = (frameSkip + 1) % 2;
      if (frameSkip === 0 && window.FRIDAY && typeof window.FRIDAY.getAudioAmp === 'function') {
        const amp = window.FRIDAY.getAudioAmp() || 0;
        
        // Map 0-0.25 amplitude range to 0-8 visualizer bars
        const level = Math.min(8, Math.round(amp * 36));
        updateVisualizerBars(level);

        // Instant Voice Activity Detection (highly sensitive)
        if (amp > 0.015) { // Very low threshold to capture soft whispers
          if (isFridayActiveRef.current) {
            triggerFridayActivation();
          }
        }
      }
      localRaf = requestAnimationFrame(pollVolume);
    };

    const handleMicChange = (e) => {
      const activeState = e.detail.active;
      if (activeState) {
        if (!localRaf) {
          pollVolume();
        }
      } else {
        if (localRaf) {
          cancelAnimationFrame(localRaf);
          localRaf = null;
        }
        updateVisualizerBars(0); // Clear bars directly via DOM
      }
    };

    window.addEventListener('friday-mic-change', handleMicChange);

    const isMicOn = window.FRIDAY && typeof window.FRIDAY.isMicGranted === 'function' && window.FRIDAY.isMicGranted();
    if (isMicOn) {
      pollVolume();
    }

    return () => {
      active = false;
      window.removeEventListener('friday-mic-change', handleMicChange);
      if (localRaf) cancelAnimationFrame(localRaf);
      updateVisualizerBars(0);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

        // Prevent feedback loop: ignore speech recognition while Friday is speaking or just finished speaking
        const now = Date.now();
        const isSpeaking = window.FRIDAY_IS_SPEAKING || (window.FRIDAY_LAST_SPOKE_TIME && (now - window.FRIDAY_LAST_SPOKE_TIME) < 1500);
        if (isSpeaking) {
          setInterimText('');
          if (voiceTimeoutRef.current) {
            clearTimeout(voiceTimeoutRef.current);
          }
          return;
        }

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
    <>
      <LearningHUD />
      <TradingHUD />
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

        {/* Real-time Sub-millisecond Audio Level Visualizer — bars updated via direct DOM, no React re-renders */}
        <div className="term-audio-visualizer" ref={vizRef}>
          {Array(8).fill(0).map((_, i) => (
            <div key={i} className="visualizer-bar" />
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
    </>
  );
}
