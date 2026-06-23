import sys
import uuid
import datetime
from pathlib import Path

# Add backend/skills directory to path so we can import handler and daemon
sys.path.append(str(Path(__file__).resolve().parent))

from whatsapp_handler import send_whatsapp_proposal
from autohedge_daemon import load_paper_portfolio, save_paper_portfolio

def create_test_proposal(ticker="BTC-USD", action="BUY"):
    port = load_paper_portfolio()
    
    # Check if there is already a proposed or open position for this ticker
    # and remove it so we can re-test cleanly
    port['positions'] = [p for p in port['positions'] if p['ticker'] != ticker]
    
    entry = 62000.00
    target = 65500.00
    stop_loss = 60000.00
    qty = 0.005  # Buy 0.005 BTC units
    score = 0.80  # 80% confidence
    rr_ratio = (target - entry) / (entry - stop_loss)
    
    reasoning = """- *RSI Rebound indicator:* BTC-USD 14-day RSI is hovering at 32.1, showing strong support defense near the psychological $61,500 level.
- *On-Chain Activity:* Exchange reserve outflow has accelerated over the last 48 hours, indicating institutional accumulation and reducing immediate sell pressure.
- *Favorable Risk-to-Reward:* R:R ratio stands at 1.75, which meets our algorithm's strict confirmation gate requirements."""

    pos = {
        'id': str(uuid.uuid4()),
        'ticker': ticker,
        'full_name': ticker,
        'action': action,
        'quantity': float(qty),
        'entry_price': float(entry),
        'current_price': float(entry),
        'stop_loss': float(stop_loss),
        'target': float(target),
        'support_14d': 122.50,
        'resistance_14d': 148.00,
        'atr': 4.70,
        'rr_ratio': float(rr_ratio),
        'entry_timestamp': datetime.datetime.utcnow().isoformat() + 'Z',
        'status': 'proposed',
        'exit_price': None,
        'exit_timestamp': None,
        'pnl': None,
        'pnl_pct': None,
        'reasoning_summary': reasoning.strip(),
        'confidence_score': score,
    }
    
    # Deduct cash for proposal
    trade_val = entry * qty
    if port['cash'] < trade_val:
        # Give some mock cash if cash is low
        port['cash'] += (trade_val * 2)
        port['total_value'] += (trade_val * 2)
        
    port['cash'] -= trade_val
    port['positions'].append(pos)
    save_paper_portfolio(port)
    
    print(f"Logged proposed trade for {ticker} into paper_portfolio.json.")
    
    # Send the WhatsApp message
    send_whatsapp_proposal(pos)
    print("WhatsApp trade proposal sent successfully.")

if __name__ == "__main__":
    create_test_proposal()
