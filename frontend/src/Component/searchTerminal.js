import React, { useState, useEffect, useRef } from 'react';
import './searchTerminal.css';

export default function SearchTerminal() {
  // States: 'IDLE' | 'SEARCHING' | 'SUCCESS' | 'ERROR'
  const [searchState, setSearchState] = useState('IDLE');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [source, setSource] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [activeEmbed, setActiveEmbed] = useState(null);
  const [isMinimized, setIsMinimized] = useState(true);

  const canvasRef = useRef(null);
  
  // Refs to prevent closure stale states in global controllers
  const queryRef = useRef('');
  queryRef.current = query;

  const resultsRef = useRef([]);
  resultsRef.current = results;

  const activeEmbedRef = useRef(null);
  activeEmbedRef.current = activeEmbed;

  // Helper to convert standard YouTube watch link to embed link
  const getYouTubeEmbedUrl = (url) => {
    if (!url) return '';
    // Extract video ID from common YouTube URL formats
    // eslint-disable-next-line no-useless-escape
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
    const match = url.match(regExp);
    if (match && match[2].length === 11) {
      const videoId = match[2];
      return `https://www.youtube.com/embed/${videoId}?autoplay=1&enablejsapi=1`;
    }
    return url;
  };

  // Expose global controller to allow terminal.js to communicate search status & media triggers
  useEffect(() => {
    window.FRIDAY_SEARCH = {
      start: (searchQuery) => {
        setSearchState('SEARCHING');
        setQuery(searchQuery);
        setResults([]);
        setErrorMsg('');
        setActiveEmbed(null);
        // Auto-maximize search terminal
        window.dispatchEvent(new CustomEvent('friday-hud-maximize', { detail: { name: 'search' } }));
      },
      success: (data) => {
        setSearchState('SUCCESS');
        setResults(data.results || []);
        setSource(data.source || 'Search Engine');
        setActiveEmbed(null);
        
        // Store results globally for voice-triggered redirect lookup
        window.FRIDAY_SEARCH_RESULTS = data.results || [];
      },
      error: (msg) => {
        setSearchState('ERROR');
        setErrorMsg(msg);
        setActiveEmbed(null);
      },
      playMedia: (index, type) => {
        const items = window.FRIDAY_SEARCH_RESULTS || [];
        const item = items[index - 1];
        if (item && item.url) {
          setActiveEmbed({
            type,
            url: item.url,
            title: item.title,
            index
          });
          return true;
        }
        return false;
      },
      closeMedia: () => {
        setActiveEmbed(null);
      },
      getActiveEmbed: () => {
        return activeEmbedRef.current;
      },
      getSearchRedirectUrl: () => {
        if (activeEmbedRef.current) {
          return activeEmbedRef.current.url;
        }
        if (!queryRef.current) return '';
        const isYoutube = resultsRef.current.some(r => r.url && r.url.includes('youtube.com'));
        if (isYoutube) {
          return `https://www.youtube.com/results?search_query=${encodeURIComponent(queryRef.current)}`;
        } else {
          return `https://duckduckgo.com/?q=${encodeURIComponent(queryRef.current)}`;
        }
      }
    };

    const handleMaximize = (e) => {
      if (e.detail.name === 'search') {
        setIsMinimized(false);
      }
    };
    const handleMinimize = (e) => {
      if (e.detail.name === 'search') {
        setIsMinimized(true);
      }
    };

    window.addEventListener('friday-hud-maximize', handleMaximize);
    window.addEventListener('friday-hud-minimize', handleMinimize);

    return () => {
      delete window.FRIDAY_SEARCH;
      delete window.FRIDAY_SEARCH_RESULTS;
      window.removeEventListener('friday-hud-maximize', handleMaximize);
      window.removeEventListener('friday-hud-minimize', handleMinimize);
    };
  }, []);

  const toggleMinimize = () => {
    if (isMinimized) {
      setIsMinimized(false);
      window.dispatchEvent(new CustomEvent('friday-hud-minimize', { detail: { name: 'analyzer' } }));
    } else {
      setIsMinimized(true);
    }
  };

  // 1. Matrix Rain Animation Loop (Green code running animation)
  useEffect(() => {
    if (searchState !== 'SEARCHING') return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const parent = canvas.parentElement;

    canvas.width = parent.clientWidth;
    canvas.height = parent.clientHeight - 10; // offset padding

    const fontSize = 10;
    const columns = Math.floor(canvas.width / fontSize) + 1;
    const drops = Array(columns).fill(0).map(() => Math.floor(Math.random() * -30)); // randomized start offsets

    const chars = "01010101ABCDEFGHJKLMNOPQRSTUVWXYZ@#$*&%".split("");
    let animationId;

    const draw = () => {
      ctx.fillStyle = "rgba(4, 2, 10, 0.12)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.fillStyle = "#00ffbb";
      ctx.font = `bold ${fontSize}px monospace`;

      for (let i = 0; i < drops.length; i++) {
        const char = chars[Math.floor(Math.random() * chars.length)];
        ctx.fillText(char, i * fontSize, drops[i] * fontSize);

        if (drops[i] * fontSize > canvas.height && Math.random() > 0.975) {
          drops[i] = 0;
        }
        drops[i]++;
      }
      animationId = requestAnimationFrame(draw);
    };

    draw();

    const handleResize = () => {
      if (canvas && parent) {
        canvas.width = parent.clientWidth;
        canvas.height = parent.clientHeight - 10;
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener('resize', handleResize);
    };
  }, [searchState]);

  return (
    <div className={`search-terminal ${searchState === 'SEARCHING' ? 'searching-glow' : ''} ${activeEmbed ? 'playing-glow' : ''} ${isMinimized ? 'minimized' : ''}`}>
      {/* HUD Brackets */}
      <div className="term-bracket t-l" />
      <div className="term-bracket t-r" />
      <div className="term-bracket b-l" />
      <div className="term-bracket b-r" />

      {/* Header */}
      <div className="search-term-header" onClick={toggleMinimize} style={{ cursor: 'pointer' }}>
        <div className="search-term-indicator">
          <span className={`search-dot ${activeEmbed ? 'playing' : searchState.toLowerCase()}`} />
          <span className="search-label">
            {activeEmbed ? `PLAYING MEDIA [${activeEmbed.index}]` : (
              <>
                {searchState === 'IDLE' && 'CYBER SEARCH MATRIX: STANDBY'}
                {searchState === 'SEARCHING' && `SEARCHING: "${query.toUpperCase()}"`}
                {searchState === 'SUCCESS' && 'SEARCH PROTOCOL: SUCCESS'}
                {searchState === 'ERROR' && 'SEARCH MATRIX: INTERRUPTED'}
              </>
            )}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div className="search-sec-label">MATRIX_RUN_v1.0</div>
          <button className="hud-toggle-btn" style={{ background: 'transparent', border: 'none', color: '#00ffaa', cursor: 'pointer', fontFamily: 'Orbitron', fontSize: '9px', outline: 'none' }}>
            {isMinimized ? '[ + ]' : '[ ─ ]'}
          </button>
        </div>
      </div>

      {/* Body panel */}
      <div className="search-term-body" style={{ display: isMinimized ? 'none' : 'flex' }}>
        {searchState === 'IDLE' && !activeEmbed && (
          <div className="search-idle-message">
            <span className="matrix-prompt">&gt;</span> SYSTEM SEARCH CHANNELS STANDBY...<br />
            <span className="matrix-prompt">&gt;</span> WAITING FOR VOICE / CONSOLE QUERY TRIGGER.
          </div>
        )}

        {searchState === 'SEARCHING' && !activeEmbed && (
          <canvas ref={canvasRef} className="matrix-canvas" />
        )}

        {searchState === 'ERROR' && !activeEmbed && (
          <div className="search-error-message">
            <span className="matrix-prompt">&gt;</span> SEARCH INTERRUPTED.<br />
            <span className="matrix-prompt">&gt;</span> ERROR LOG: {errorMsg}<br />
            <span className="matrix-prompt">&gt;</span> STANDBY FOR RE-TRIGGER PROTOCOL...
          </div>
        )}

        {searchState === 'SUCCESS' && !activeEmbed && (
          <div className="search-results-log">
            <div className="search-results-meta">
              <span className="matrix-prompt">&gt;</span> SOURCE: {source}<br />
              <span className="matrix-prompt">&gt;</span> TARGETS: {results.length} ENTRIES FOUND FOR "{query}"
            </div>
            
            {results.map((item, idx) => (
              <div key={idx} className="search-result-item">
                <div className="result-item-title">
                  <span className="result-index">[{idx + 1}]</span>
                  <a 
                    href={item.url} 
                    target="_blank" 
                    rel="noopener noreferrer" 
                    className="result-link"
                  >
                    {item.title}
                  </a>
                </div>
                {item.snippet && <div className="result-item-snippet">{item.snippet}</div>}
                <div className="result-item-url">{item.url}</div>
              </div>
            ))}
          </div>
        )}

        {/* Inline Media Embed Panel Overlay */}
        {activeEmbed && (
          <div className="search-embed-panel">
            <div className="embed-panel-header">
              <span className="matrix-prompt">&gt;</span> HUD MEDIA PLAYER [MODE: {activeEmbed.type.toUpperCase()}]
              <button className="embed-close-btn" onClick={() => setActiveEmbed(null)}>
                [ CLOSE MEDIA ]
              </button>
            </div>
            <div className="embed-panel-title" title={activeEmbed.title}>
              <span className="result-index">[{activeEmbed.index}]</span> {activeEmbed.title}
            </div>
            <div className="embed-iframe-wrapper">
              <iframe
                src={activeEmbed.type === 'video' ? getYouTubeEmbedUrl(activeEmbed.url) : activeEmbed.url}
                title={activeEmbed.title}
                className="embed-iframe"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
              />
            </div>
            <div className="embed-panel-controls">
              <button 
                className="embed-action-btn"
                onClick={() => {
                  window.open(activeEmbed.url, '_blank');
                }}
              >
                [ REDIRECT TO SYSTEM BROWSER ]
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
