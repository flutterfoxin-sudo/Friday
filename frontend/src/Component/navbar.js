import { useState, useEffect } from 'react';
import './navbar.css';
import { BACKEND_URL } from '../config';

export default function Navbar() {
  const [time, setTime] = useState('');
  const [load, setLoad] = useState('98.4%');
  const [isMicActive, setIsMicActive] = useState(false);
  const [showVoiceDropdown, setShowVoiceDropdown] = useState(false);
  const [currentVoice, setCurrentVoice] = useState('female');
  const [atomicOffset, setAtomicOffset] = useState(0);
  const [isAtomicSynced, setIsAtomicSynced] = useState(false);
  const [targetTimezone, setTargetTimezone] = useState(null);
  const [locationLabel, setLocationLabel] = useState('');

  // Sync mic state with blob.js notifications
  useEffect(() => {
    const handleMicChange = (e) => {
      setIsMicActive(e.detail.active);
    };
    window.addEventListener('friday-mic-change', handleMicChange);

    // Initial check in case window.FRIDAY is already mounted
    if (window.FRIDAY && typeof window.FRIDAY.isMicGranted === 'function') {
      setIsMicActive(window.FRIDAY.isMicGranted());
    }

    return () => window.removeEventListener('friday-mic-change', handleMicChange);
  }, []);

  // Sync voice settings with backend config on load and trigger updates
  useEffect(() => {
    const fetchVoiceSetting = async () => {
      try {
        const res = await fetch(`${BACKEND_URL}/api/voice`);
        const data = await res.json();
        if (data.success && data.settings && data.settings.current) {
          setCurrentVoice(data.settings.current);
        }
      } catch (err) {
        console.warn('Navbar failed to fetch voice settings:', err);
      }
    };
    fetchVoiceSetting();

    const handleVoiceChange = (e) => {
      setCurrentVoice(e.detail.voice);
    };
    window.addEventListener('friday-voice-changed', handleVoiceChange);

    return () => window.removeEventListener('friday-voice-changed', handleVoiceChange);
  }, []);

  const handleVoiceChangeSelect = (voice) => {
    setCurrentVoice(voice);
    if (window.FRIDAY_VOICE && typeof window.FRIDAY_VOICE.setVoice === 'function') {
      window.FRIDAY_VOICE.setVoice(voice);
    }
  };

  const handleMicToggle = () => {
    if (window.FRIDAY) {
      if (isMicActive) {
        if (typeof window.FRIDAY.stopMic === 'function') {
          window.FRIDAY.stopMic();
        }
      } else {
        if (typeof window.FRIDAY.startMic === 'function') {
          window.FRIDAY.startMic();
        }
      }
    }
  };

  // Sync with backend atomic NTP offset
  useEffect(() => {
    const syncAtomicClock = async () => {
      try {
        const start = Date.now();
        const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const res = await fetch(`${BACKEND_URL}/api/time/atomic?timezone=${encodeURIComponent(browserTz)}`);
        const data = await res.json();
        if (data.success) {
          const latency = (Date.now() - start) / 2;
          const targetTime = data.unixtime + latency;
          const offset = targetTime - Date.now();
          setAtomicOffset(offset);
          setIsAtomicSynced(true);
          setTargetTimezone(data.timezone);
          setLocationLabel(data.location || '');
          console.log(`[ATOMIC CLOCK] Synced. Offset: ${offset}ms, Timezone: ${data.timezone}, Location: ${data.location}, Source: ${data.source}`);
          
          window.FRIDAY_ATOMIC_TIME = () => {
            const currentAtomic = new Date(Date.now() + offset);
            try {
              return currentAtomic.toLocaleTimeString('en-US', {
                timeZone: data.timezone,
                hour12: true,
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
              });
            } catch (e) {
              return currentAtomic.toLocaleTimeString();
            }
          };

          window.dispatchEvent(new CustomEvent('friday-atomic-synced', { detail: { offset, source: data.source, timezone: data.timezone, location: data.location } }));
        }
      } catch (err) {
        console.warn('[ATOMIC CLOCK] Sync failed:', err);
      }
    };

    syncAtomicClock();
    const syncInterval = setInterval(syncAtomicClock, 120000); // Re-sync every 2 minutes
    return () => {
      clearInterval(syncInterval);
    };
  }, []);

  // Live clock — update every second with atomic offset and timezone
  useEffect(() => {
    const tick = () => {
      const d = new Date(Date.now() + atomicOffset);
      if (targetTimezone) {
        try {
          const timeStr = d.toLocaleTimeString('en-US', {
            timeZone: targetTimezone,
            hour12: false,
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
          });
          setTime(timeStr);
        } catch (e) {
          setTime(`${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`);
        }
      } else {
        setTime(`${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`);
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [atomicOffset, targetTimezone]);

  // Simulated system load fluctuation every 4 s
  useEffect(() => {
    const id = setInterval(
      () => setLoad(`${(97.5 + Math.random() * 2).toFixed(1)}%`),
      4000
    );
    return () => clearInterval(id);
  }, []);

  return (
    <nav className="cyber-nav">
      <div className="nav-bracket bracket-tl" />
      <div className="nav-bracket bracket-tr" />
      <div className="nav-bracket bracket-bl" />
      <div className="nav-bracket bracket-br" />

      {/* Brand */}
      <div className="nav-brand">
        <div className="brand-dot" />
        <span>F.R.I.D.A.Y.</span>
        <span className="brand-sub">OS v2.4</span>
      </div>

      {/* Nav links */}
      <div className="nav-menu">
        {['Core', 'Diagnostics', 'Network', 'Settings'].map((label, i) => (
          <span 
            key={label} 
            className={`nav-item${(label === 'Settings' && showVoiceDropdown) || (label !== 'Settings' && i === 0 && !showVoiceDropdown) ? ' active' : ''}`}
            onClick={() => {
              if (label === 'Settings') {
                setShowVoiceDropdown(prev => !prev);
              } else {
                setShowVoiceDropdown(false);
              }
            }}
          >
            {label}
          </span>
        ))}
        {/* Futuristic Mic Toggle Button inside the menu flow */}
        <button 
          className={`nav-mic-toggle ${isMicActive ? 'active' : ''}`}
          onClick={handleMicToggle}
        >
          <span className="mic-toggle-icon">🎙</span>
          <span className="mic-toggle-label">MIC: {isMicActive ? 'ON' : 'OFF'}</span>
          <span className="mic-toggle-led" />
        </button>
      </div>

      {showVoiceDropdown && (
        <div className="nav-settings-dropdown">
          <div className="dropdown-glow-bracket t-l" />
          <div className="dropdown-glow-bracket t-r" />
          <div className="dropdown-glow-bracket b-l" />
          <div className="dropdown-glow-bracket b-r" />
          <div className="dropdown-title">{'// TTS VOICE MODEL'}</div>
          
          <div className="voice-section">
            <div className="voice-section-title">FEMALE PROFILE</div>
            <div className="voice-options-grid">
              <button 
                className={`voice-btn ${currentVoice === 'female' || currentVoice === 'bella' ? 'active-voice' : ''}`}
                onClick={() => handleVoiceChangeSelect('bella')}
              >
                BELLA
              </button>
              <button 
                className={`voice-btn ${currentVoice === 'rachel' ? 'active-voice' : ''}`}
                onClick={() => handleVoiceChangeSelect('rachel')}
              >
                RACHEL
              </button>
              <button 
                className={`voice-btn ${currentVoice === 'glinda' ? 'active-voice' : ''}`}
                onClick={() => handleVoiceChangeSelect('glinda')}
              >
                GLINDA
              </button>
            </div>
          </div>

          <div className="voice-section" style={{ marginTop: '8px' }}>
            <div className="voice-section-title">MALE PROFILE</div>
            <div className="voice-options-grid">
              <button 
                className={`voice-btn ${currentVoice === 'male' || currentVoice === 'antoni' ? 'active-voice' : ''}`}
                onClick={() => handleVoiceChangeSelect('antoni')}
              >
                ANTONI
              </button>
              <button 
                className={`voice-btn ${currentVoice === 'adam' ? 'active-voice' : ''}`}
                onClick={() => handleVoiceChangeSelect('adam')}
              >
                ADAM
              </button>
              <button 
                className={`voice-btn ${currentVoice === 'arnold' ? 'active-voice' : ''}`}
                onClick={() => handleVoiceChangeSelect('arnold')}
              >
                ARNOLD
              </button>
            </div>
          </div>
        </div>
      )}

      {/* HUD stats */}
      <div className="nav-stats">
        <div className="stat-widget">
          <span className="stat-label">SYSTEM LOAD</span>
          <span className="stat-value">{load}</span>
        </div>
        <div className="stat-widget">
          <span className="stat-label">LINK SECURITY</span>
          <span className="secure-link"><span className="secure-dot" />SECURE</span>
        </div>
        <div className="stat-widget">
          <span className="stat-label" style={{ color: isAtomicSynced ? '#39ff14' : undefined }}>
            {isAtomicSynced ? `TIME ATOMIC [${locationLabel.toUpperCase() || 'SYNCED'}]` : 'TIME LOCAL'}
          </span>
          <span 
            className="stat-value clock" 
            style={{ 
              color: isAtomicSynced ? '#39ff14' : undefined,
              textShadow: isAtomicSynced ? '0 0 6px rgba(57, 255, 20, 0.4)' : undefined
            }}
          >
            {time} {isAtomicSynced && <span style={{ fontSize: '7px', verticalAlign: 'super', color: '#39ff14' }}>SYNC</span>}
          </span>
        </div>
      </div>
    </nav>
  );
}

const pad = n => String(n).padStart(2, '0');
