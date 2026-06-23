import React, { useEffect, useState } from 'react';
import './TradingHUD.css';
import { BACKEND_URL } from '../config';

export default function TradingHUD() {
  const [portfolio, setPortfolio] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [isMinimized, setIsMinimized] = useState(true);
  const [lastAnnouncedTradeId, setLastAnnouncedTradeId] = useState(null);

  useEffect(() => {
    const fetchPortfolio = () => {
      fetch(`${BACKEND_URL}/api/trading/portfolio`)
        .then(res => res.json())
        .then(data => {
          if (data && data.success) {
            setPortfolio(data.portfolio);
            setErrorMsg('');
          } else {
            setErrorMsg('Failed to load portfolio');
          }
        })
        .catch(err => {
          setErrorMsg('CORS/Network error');
          console.error("Failed to fetch trading portfolio:", err);
        });
    };

    fetchPortfolio();
    window.FRIDAY_TRADING_ACTIVE = true;
    const interval = setInterval(fetchPortfolio, 3000); // Polling every 3 seconds
    return () => {
      clearInterval(interval);
      delete window.FRIDAY_TRADING_ACTIVE;
    };
  }, []);

  // Monitor portfolio history and announce new trades aloud
  useEffect(() => {
    if (!portfolio || !portfolio.history || portfolio.history.length === 0) return;
    
    const sortedHistory = portfolio.history;
    const latestTrade = sortedHistory[sortedHistory.length - 1];
    
    if (!lastAnnouncedTradeId) {
      setLastAnnouncedTradeId(latestTrade.id);
      return;
    }
    
    if (latestTrade.id !== lastAnnouncedTradeId) {
      setLastAnnouncedTradeId(latestTrade.id);
      
      if (typeof window.FRIDAY_SPEAK === 'function') {
        const actionWord = latestTrade.type.includes('BUY') ? 'Buy order executed for' : 'Sell order executed for';
        const qtyFormatted = latestTrade.quantity ? latestTrade.quantity.toFixed(4) : '';
        const strategyText = latestTrade.strategy ? `using the ${latestTrade.strategy} strategy` : 'using autonomous agent analysis';
        
        const announcement = `Notice, sir: ${actionWord} ${qtyFormatted} ${latestTrade.symbol} at a price of ${latestTrade.price?.toFixed(2)} dollars, ${strategyText}.`;
        window.FRIDAY_SPEAK(announcement);
      }
    }
  }, [portfolio, lastAnnouncedTradeId]);

  useEffect(() => {
    const handleMaximize = (e) => {
      if (e.detail.name === 'trading') {
        setIsMinimized(false);
      }
    };
    const handleMinimize = (e) => {
      if (e.detail.name === 'trading') {
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
      window.dispatchEvent(new CustomEvent('friday-hud-maximize', { detail: { name: 'trading', speak: false } }));
      window.dispatchEvent(new CustomEvent('friday-hud-minimize', { detail: { name: 'learning' } }));
      window.dispatchEvent(new CustomEvent('friday-hud-minimize', { detail: { name: 'office' } }));
    } else {
      window.dispatchEvent(new CustomEvent('friday-hud-minimize', { detail: { name: 'trading' } }));
    }
  };

  const isStockMarketOpen = () => {
    try {
      const now = new Date();
      const estString = now.toLocaleString("en-US", { timeZone: "America/New_York" });
      const estDate = new Date(estString);
      const day = estDate.getDay(); // 0 is Sun, 6 is Sat
      const hour = estDate.getHours();
      const minute = estDate.getMinutes();
      
      if (day === 0 || day === 6) return false;
      const timeInMinutes = hour * 60 + minute;
      const startInMinutes = 9 * 60 + 30; // 9:30 AM
      const endInMinutes = 16 * 60; // 4:00 PM
      return timeInMinutes >= startInMinutes && timeInMinutes <= endInMinutes;
    } catch (e) {
      return false;
    }
  };

  if (!portfolio) {
    return (
      <div className={`trading-hud-overlay initializing ${isMinimized ? 'minimized' : ''}`}>
        <div className="hud-header" onClick={toggleMinimize} style={{ cursor: 'pointer' }}>
          <h2>Hedge Core</h2>
          <button className="hud-toggle-btn" style={{ background: 'transparent', border: 'none', color: '#00f0ff', cursor: 'pointer', fontFamily: 'Orbitron', fontSize: '9px', outline: 'none' }}>
            {isMinimized ? '[ + ]' : '[ ─ ]'}
          </button>
        </div>
        {!isMinimized && <div className="hud-loading">Initializing Ledger...</div>}
        {!isMinimized && errorMsg && <div className="hud-error">ERR: {errorMsg}</div>}
      </div>
    );
  }

  const active = portfolio.trading_active;
  const stockOpen = isStockMarketOpen();
  
  let statusText = 'STOPPED';
  let statusClass = 'status-stopped';
  if (active) {
    if (stockOpen) {
      statusText = 'ACTIVE (STOCK+CRYPTO)';
      statusClass = 'status-active-both';
    } else {
      statusText = 'ACTIVE (CRYPTO ONLY)';
      statusClass = 'status-active-crypto';
    }
  }

  const totalValue = portfolio.total_value || (portfolio.balance_usd + (portfolio.balance_sol * 150));
  const todayPnL = portfolio.today_pnl || 0;
  const todayPnLPct = portfolio.today_pnl_pct || 0;
  const isProfit = todayPnL >= 0;

  const positionsList = Object.entries(portfolio.positions || {});

  return (
    <div className={`trading-hud-overlay ${isMinimized ? 'minimized' : ''}`}>
      <div className="hud-header" onClick={toggleMinimize} style={{ cursor: 'pointer' }}>
        <h2>Hedge Core</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {!isMinimized && <span className={`status-badge ${statusClass}`}>{statusText}</span>}
          <button className="hud-toggle-btn" style={{ background: 'transparent', border: 'none', color: '#00f0ff', cursor: 'pointer', fontFamily: 'Orbitron', fontSize: '9px', outline: 'none' }}>
            {isMinimized ? '[ + ]' : '[ ─ ]'}
          </button>
        </div>
      </div>

      {!isMinimized && (
        <div className="hud-scroll-container">
          <div className="market-hours-section">
            <div className="metric-label">Market Windows (EST)</div>
            <div className="market-hours-row">
              <span>Stocks (US):</span>
              <span style={{ color: stockOpen ? '#39ff14' : '#ff3131' }}>
                {stockOpen ? '● OPEN' : '○ CLOSED'} (09:30 - 16:00)
              </span>
            </div>
            <div className="market-hours-row">
              <span>Crypto:</span>
              <span style={{ color: '#39ff14' }}>● 24/7 ACTIVE</span>
            </div>
            <div className="market-hours-row" style={{ borderTop: '1px dashed rgba(0, 240, 255, 0.15)', paddingTop: '4px', marginTop: '4px' }}>
              <span>Next Trade Scan:</span>
              <span style={{ color: '#00f0ff', fontWeight: 'bold' }}>
                {portfolio.next_trade_at ? new Date(portfolio.next_trade_at).toLocaleTimeString() : 'In Progress...'}
              </span>
            </div>
          </div>

          <div className="equity-section">
            <div className="metric-label">Net Equity (USD)</div>
            <div className="equity-value">${(totalValue ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          </div>

          <div className="pnl-section">
            <div className="metric-label">Today's P&L</div>
            <div className={`pnl-value ${isProfit ? 'profit' : 'loss'}`}>
              {isProfit ? '▲' : '▼'} ${(Math.abs(todayPnL ?? 0)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ({ (todayPnLPct ?? 0).toFixed(2)}%)
            </div>
          </div>

          <div className="balances-section">
            <div className="balance-row">
              <span>USD Cash:</span>
              <span>${(portfolio.balance_usd ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
            <div className="balance-row">
              <span>SOL Wallet:</span>
              <span>{(portfolio.balance_sol ?? 0).toFixed(2)} SOL</span>
            </div>
          </div>

          <div className="positions-section">
            <div className="section-title">Active Positions ({positionsList.length})</div>
            {positionsList.length === 0 ? (
              <div className="no-positions">No open positions. Scanning market...</div>
            ) : (
              <div className="positions-list">
                {positionsList.map(([symbol, pos]) => {
                  const currentPrice = pos.current_price || pos.avg_price;
                  const currentValue = pos.current_value || (pos.quantity * currentPrice);
                  const posPnL = (currentPrice - pos.avg_price) * pos.quantity;
                  const posProfit = posPnL >= 0;

                  return (
                    <div className="position-item" key={symbol}>
                      <div className="pos-main">
                        <span className="pos-ticker">{symbol}</span>
                        <span className={`pos-pnl ${posProfit ? 'profit' : 'loss'}`}>
                          {posProfit ? '+' : ''}{(posPnL ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      </div>
                      <div className="pos-details">
                        <span>Qty: {(pos.quantity ?? 0).toFixed(4)}</span>
                        <span>Val: ${(currentValue ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      </div>
                      <div className="pos-extra">
                        <span>Avg: ${(pos.avg_price ?? 0).toFixed(2)}</span>
                        <span className="pos-sl-badge">SL: {pos.stop_loss ? pos.stop_loss.toFixed(2) : 'N/A'}</span>
                      </div>
                      {pos.strategy && (
                        <div style={{ color: '#00f0ff', fontSize: '0.75em', marginTop: '3px', opacity: 0.85, fontStyle: 'italic', borderTop: '1px dashed rgba(0, 240, 255, 0.15)', paddingTop: '3px' }}>
                          Strat: {pos.strategy}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="trade-history-section" style={{ marginTop: '15px', borderTop: '1px dashed rgba(0, 240, 255, 0.3)', paddingTop: '12px' }}>
            <div className="section-title">Trade History ({portfolio.history ? portfolio.history.length : 0})</div>
            {!portfolio.history || portfolio.history.length === 0 ? (
              <div className="no-positions">No trades recorded today.</div>
            ) : (
              <div className="history-list" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {portfolio.history.slice().reverse().map((trade, i) => (
                  <div className="history-item" key={trade.id || i} style={{ background: 'rgba(0, 240, 255, 0.02)', border: '1px solid rgba(0, 240, 255, 0.1)', padding: '6px', borderRadius: '4px', fontSize: '0.8em' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold' }}>
                      <span style={{ color: trade.type.startsWith('BUY') ? '#39ff14' : '#ff3131' }}>{trade.type} {trade.symbol}</span>
                      <span>${trade.total_usd?.toFixed(2)}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: '#888', fontSize: '0.9em', marginTop: '2px' }}>
                      <span>Qty: {trade.quantity?.toFixed(4)} @ ${trade.price?.toFixed(2)}</span>
                      <span>{trade.timestamp ? new Date(trade.timestamp).toLocaleTimeString() : ''}</span>
                    </div>
                    {trade.strategy && (
                      <div style={{ color: '#00f0ff', fontSize: '0.85em', marginTop: '4px', fontStyle: 'italic', opacity: 0.85, borderTop: '1px dotted rgba(0, 240, 255, 0.1)', paddingTop: '2px' }}>
                        Strategy: {trade.strategy}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
