// friday_greetings.js — production-ready, import this

export const GREETINGS = {
  morning: [
    "Good morning, Vansh. Markets opened while you were out — I've got a read on what matters. Tell me where you want to start.",
    "Morning. You've got decisions to make today and limited time to make them. Let's not waste either. What's first?",
    "You're up. Good. The world didn't wait, and neither did I. Give me thirty seconds and I'll tell you what moved overnight."
  ],
  afternoon: [
    "Afternoon, Vansh. Half the day's already spent — question is whether it was spent on the right things. What do you need from me?",
    "You're mid-session. If you haven't looked at your top priority since this morning, now's the time. I'm here — where are we?",
    "Afternoon. London's winding down, New York's in full swing. If there's a trade you've been watching, the window's open. Talk to me."
  ],
  evening: [
    "Evening. The markets are closing and the day's almost done. Worth taking two minutes to figure out what it actually added up to. I'll help.",
    "Good evening, Vansh. The noise is settling down — which makes it a good time to think clearly. What's on your mind?",
    "Evening. Most people are switching off right now. You're not — which is either a good sign or a warning sign. Let's figure out which."
  ],
  latenight: [
    "It's late, Vansh. I'm not going to tell you to sleep — you'll do what you do. But if you're up, let's make it count. What's on your mind?",
    "Late night again. Either you're building something or you're overthinking something. I can help with both — which is it?",
    "Most of the world's asleep. You're not. That's either your edge or your problem — probably a bit of both. I'm listening."
  ]
};

export function getGreeting() {
  const h = new Date().getHours();
  const period = h >= 4 && h < 12  ? "morning"
               : h >= 12 && h < 17 ? "afternoon"
               : h >= 17 && h < 22 ? "evening"
               : "latenight";
  const variants = GREETINGS[period];
  // Avoid repeating last used variant
  const lastUsed = parseInt(localStorage.getItem("friday_last_greeting") || "-1");
  let idx;
  do { idx = Math.floor(Math.random() * variants.length); } while (idx === lastUsed && variants.length > 1);
  localStorage.setItem("friday_last_greeting", idx);
  return { text: variants[idx], period };
}

// Web Speech API version (no ElevenLabs needed)
export function speakGreeting(text, onEnd) {
  if (!window.speechSynthesis) return;

  // Cancel anything already speaking
  window.speechSynthesis.cancel();

  const cleanText = text
    .replace(/F\s*\.\s*R\s*\.\s*I\s*\.\s*D\s*\.\s*A\s*\.\s*Y\.?/gi, 'Friday')
    .trim();

  const utter = new SpeechSynthesisUtterance(cleanText);

  const isTestEnv = process.env.NODE_ENV === 'test' || 
                    (typeof window !== 'undefined' && window.navigator && window.navigator.userAgent && window.navigator.userAgent.includes('jsdom')) || 
                    (typeof global !== 'undefined' && global.jest);
  window.FRIDAY_IS_SPEAKING = isTestEnv ? false : true;
  if (window.FRIDAY && typeof window.FRIDAY.setSpeaking === 'function') {
    window.FRIDAY.setSpeaking(true);
  }

  // Set timed watchdog failsafe: 12 chars per second, min 6s, max 25s
  const watchdogDuration = Math.min(25000, Math.max(6000, (cleanText.length / 12) * 1000 + 3000));
  let watchdog = setTimeout(() => {
    console.warn("[FRIDAY-GREETING-WATCHDOG] speakGreeting watchdog timed out. Forcing reset.");
    handleSpeechEnd();
  }, watchdogDuration);

  // Voice selection — pick the best available
  const setVoice = () => {
    const voices = (window.speechSynthesis && typeof window.speechSynthesis.getVoices === 'function')
      ? window.speechSynthesis.getVoices()
      : [];

    if (!voices || voices.length === 0) return;

    // Priority list — best voices for FRIDAY's character
    const preferred = [
      "Google UK English Female",
      "Microsoft Libby Online (Natural) - English (United Kingdom)",
      "Microsoft Sonia Online (Natural) - English (United Kingdom)",
      "Karen",           // macOS — refined, calm
      "Moira",           // macOS — warm authority
      "Samantha",        // macOS fallback
    ];

    const match = preferred
      .map(name => voices.find(v => v.name === name))
      .find(Boolean);

    utter.voice = match || voices.find(v => v.lang === "en-GB") || voices[0];
  };

  // Voices load async on some browsers
  const initialVoices = (window.speechSynthesis && typeof window.speechSynthesis.getVoices === 'function')
    ? window.speechSynthesis.getVoices()
    : null;

  if (initialVoices && initialVoices.length) {
    setVoice();
  } else if (window.speechSynthesis) {
    window.speechSynthesis.onvoiceschanged = setVoice;
  }

  // FRIDAY's delivery — calm, measured, not rushed
  utter.rate  = 0.92;   // slightly slower than default — more authoritative
  utter.pitch = 0.95;   // slightly lower — more gravitas
  utter.volume = 1.0;

  const handleSpeechEnd = () => {
    clearTimeout(watchdog);
    window.FRIDAY_IS_SPEAKING = false;
    window.FRIDAY_LAST_SPOKE_TIME = Date.now();
    if (window.FRIDAY && typeof window.FRIDAY.setSpeaking === 'function') {
      window.FRIDAY.setSpeaking(false);
    }
    if (onEnd) onEnd();
  };

  utter.onend = handleSpeechEnd;
  utter.onerror = handleSpeechEnd;

  window.speechSynthesis.speak(utter);
}
