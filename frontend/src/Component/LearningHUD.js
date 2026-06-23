import React, { useEffect, useState } from 'react';
import './LearningHUD.css';
import { BACKEND_URL } from '../config';

export default function LearningHUD() {
  const [stats, setStats] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [isMinimized, setIsMinimized] = useState(true);

  useEffect(() => {
    const fetchStats = () => {
      fetch(`${BACKEND_URL}/api/learning-progress`)
        .then(res => res.json())
        .then(data => {
          if (data && data.success) {
            setStats(data.stats);
            setErrorMsg('');
          } else {
            setErrorMsg('API returned false success');
          }
        })
        .catch(err => {
          setErrorMsg(err.message || 'Network/CORS error');
          console.error("Failed to fetch learning stats:", err);
        });
    };

    fetchStats();
    window.FRIDAY_LEARNING_ACTIVE = true;
    const interval = setInterval(fetchStats, 3000); // Real-time polling every 3 seconds
    return () => {
      clearInterval(interval);
      delete window.FRIDAY_LEARNING_ACTIVE;
    };
  }, []);

  useEffect(() => {
    const handleMaximize = (e) => {
      if (e.detail.name === 'learning') {
        setIsMinimized(false);
      }
    };
    const handleMinimize = (e) => {
      if (e.detail.name === 'learning') {
        setIsMinimized(true);
      }
    };

    window.addEventListener('friday-hud-maximize', handleMaximize);
    window.addEventListener('friday-hud-minimize', handleMinimize);

    return () => {
      window.removeEventListener('friday-hud-maximize', handleMaximize);
      window.removeEventListener('friday-hud-minimize', handleMinimize);
    };
  }, []);

  const toggleMinimize = () => {
    if (isMinimized) {
      window.dispatchEvent(new CustomEvent('friday-hud-maximize', { detail: { name: 'learning', speak: false } }));
      window.dispatchEvent(new CustomEvent('friday-hud-minimize', { detail: { name: 'trading' } }));
    } else {
      window.dispatchEvent(new CustomEvent('friday-hud-minimize', { detail: { name: 'learning' } }));
    }
  };

  if (!stats) {
    return (
      <div className={`learning-hud-overlay initializing ${isMinimized ? 'minimized' : ''}`} style={{ borderColor: errorMsg ? 'red' : undefined }}>
        <div className="hud-header" onClick={toggleMinimize} style={{ cursor: 'pointer' }}>
          <h2>Cognitive Core</h2>
          <button className="hud-toggle-btn" style={{ background: 'transparent', border: 'none', color: '#00f0ff', cursor: 'pointer', fontFamily: 'Orbitron', fontSize: '9px', outline: 'none' }}>
            {isMinimized ? '[ + ]' : '[ ─ ]'}
          </button>
        </div>
        {!isMinimized && <div>Initializing Telemetry Stream...</div>}
        {!isMinimized && errorMsg && <div style={{ color: '#ff4444', marginTop: '10px', fontSize: '0.8em' }}>ERR: {errorMsg}</div>}
      </div>
    );
  }

  const getIntelligenceTier = (scale) => {
    if (scale < 0.2) return "Level 1: Basic Reactive Matrices";
    if (scale < 0.4) return "Level 2: Syntactic Knowledge Assembly";
    if (scale < 0.6) return "Level 3: Contextual Reasoning & Logic";
    if (scale < 0.8) return "Level 4: Human-Equivalent Cognitive Synthesis";
    return "Level 5: Super-Turing Autonomy";
  };

  const selfReliancePct = stats.totalQueries > 0 
    ? Math.round((stats.localSuccesses / stats.totalQueries) * 100) 
    : 0;

  return (
    <div className={`learning-hud-overlay ${isMinimized ? 'minimized' : ''}`}>
      <div className="hud-header" onClick={toggleMinimize} style={{ cursor: 'pointer' }}>
        <h2>Cognitive Core</h2>
        <button className="hud-toggle-btn" style={{ background: 'transparent', border: 'none', color: '#00f0ff', cursor: 'pointer', fontFamily: 'Orbitron', fontSize: '9px', outline: 'none' }}>
          {isMinimized ? '[ + ]' : '[ ─ ]'}
        </button>
      </div>
      
      {!isMinimized && (
        <>
          <div className="metric-group">
            <div className="metric-label">Local Self-Reliance Ratio</div>
            <div className="progress-bar-container">
              <div className="progress-bar-fill" style={{ width: `${selfReliancePct}%` }}></div>
              <div className="metric-value">{selfReliancePct}% INDEPENDENT</div>
            </div>
          </div>

          <div className="stats-grid">
            <div className="stat-box">
              <div className="stat-number">{stats.syntheticPairsExtracted}</div>
              <div className="metric-label">High-Quality Synthetic Pairs Logged</div>
            </div>
            <div className="stat-box">
              <div className="stat-number">{stats.cloudFallbacks}</div>
              <div className="metric-label">Cloud API Interventions</div>
            </div>
          </div>

          <div className="intelligence-scale">
            <h3>Current Cognitive Tier</h3>
            <div className="scale-tier">
              {getIntelligenceTier(stats.intelligenceScale)}
            </div>
            <div style={{ fontSize: '0.8em', color: '#888', marginTop: '10px' }}>
              Preparing dataset for future Unsloth/PyTorch model bake...
            </div>
          </div>
        </>
      )}
    </div>
  );
}
