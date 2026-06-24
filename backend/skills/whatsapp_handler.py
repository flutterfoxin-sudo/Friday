import json
import os
import time
import datetime
from pathlib import Path
from loguru import logger
import requests

INBOX_PATH = Path(__file__).resolve().parent / "whatsapp_inbox.txt"
OUTBOX_PATH = Path(__file__).resolve().parent / "whatsapp_outbox.txt"
PORTFOLIO_PATH = Path(__file__).resolve().parent / "paper_portfolio.json"

def send_whatsapp_proposal(trade_dict):
    """
    Formulates a detailed trade proposal, sends the research details,
    and then sends a poll to the F.R.I.D.A.Y. Alerts group for instant authorization.
    """
    ticker = trade_dict['ticker']
    action = trade_dict['action']
    entry = trade_dict['entry_price']
    target = trade_dict['target']
    sl = trade_dict['stop_loss']
    qty = trade_dict['quantity']
    score = trade_dict['confidence_score']
    rr = trade_dict['rr_ratio']
    
    # Mathematical calculation
    if action == "BUY":
        gain_per_unit = target - entry
        loss_per_unit = entry - sl
    else:  # SELL / SHORT
        gain_per_unit = entry - target
        loss_per_unit = sl - entry
        
    total_gain = qty * gain_per_unit
    total_loss = qty * loss_per_unit
    
    # Expected value (EV) calculation using confidence score as probability
    ev = (score * total_gain) - ((1.0 - score) * total_loss)
    
    msg = f"""
🤖 *[F.R.I.D.A.Y. Autonomous Trade Proposal]*

📊 *Asset Details:*
* Asset: {ticker}
* Action: {action} (Autonomous Order)
* Entry Target: ${entry:.2f}
* Profit Target: ${target:.2f}
* Stop Loss Limit: ${sl:.2f}

📈 *Technical Chart Patterns (Live):*
* RSI (14): {trade_dict['technical_snapshot'].get('rsi_value', 0):.2f} ({trade_dict['technical_snapshot'].get('rsi_signal', 'N/A')})
* MACD Signal: {trade_dict['technical_snapshot'].get('macd_signal', 'N/A')}
* Trend: {trade_dict['technical_snapshot'].get('trend', 'N/A')}
* Bollinger Bands: {trade_dict['technical_snapshot'].get('bollinger_position', 'N/A')}

🎯 *Mathematical Projections:*
* Allocation: {qty:.4f} units (~${(qty*entry):.2f} capital)
* Expected Profit: +${total_gain:.2f} (+{(gain_per_unit/entry)*100:.1f}%)
* Maximum Risk: -${total_loss:.2f} (-{(loss_per_unit/entry)*100:.1f}%)
* Risk-Reward Ratio (R:R): {rr:.2f}
* Win Probability (Confidence): {score*100:.1f}%
* Expected Value (EV) of Trade: +${ev:.2f}

📰 *Algorithmic Research & Analysis:*
{trade_dict['reasoning_summary']}
=========================================
"""
    try:
        # 1. Send the detailed text analysis message
        payload_msg = {
            "to": "120363427554589491@g.us",
            "message": msg.strip(),
            "accountId": "8287592505-session"
        }
        requests.post(f"{os.getenv('FRIDAY_API_URL', 'http://localhost:5000')}/api/whatsapp/reply", json=payload_msg, timeout=5)
        
        # 2. Send the interactive poll message right after
        poll_question = f"Authorize Trade: {action} {ticker}"
        payload_poll = {
            "to": "120363427554589491@g.us",
            "message": poll_question,
            "accountId": "8287592505-session",
            "pollOptions": ["Approve", "Reject"]
        }
        resp = requests.post(f"{os.getenv('FRIDAY_API_URL', 'http://localhost:5000')}/api/whatsapp/reply", json=payload_poll, timeout=5)
        
        if resp.status_code == 200:
            logger.info(f"[WHATSAPP] Trade proposal and poll sent successfully to Alerts Group.")
        else:
            logger.error(f"[WHATSAPP] Node.js backend returned error {resp.status_code}: {resp.text}")
    except Exception as e:
        logger.error(f"[WHATSAPP] Failed to connect to Node.js backend to send WhatsApp message: {e}")

def process_whatsapp_replies():
    """
    Reads whatsapp_inbox.txt and processes replies.
    Format of inbox file:
    CONFIRM <ticker>
    SKIP <ticker>
    STOP
    RESUME
    """
    if not INBOX_PATH.exists():
        # Create empty inbox file to make it easy for user to type into
        with open(INBOX_PATH, "w", encoding="utf-8") as f:
            f.write("# Type replies here, one per line (e.g., CONFIRM BTC-USD, SKIP SOL-USD, STOP, RESUME)\n")
        return
        
    try:
        with open(INBOX_PATH, "r", encoding="utf-8") as f:
            lines = f.readlines()
            
        if not lines or all(line.strip() == "" or line.startswith("#") for line in lines):
            return
            
        with open(PORTFOLIO_PATH, "r") as f:
            port = json.load(f)
            
        modified = False
        unprocessed_lines = []
        
        for line in lines:
            line = line.strip()
            if not line or line.startswith("#"):
                unprocessed_lines.append(line)
                continue
                
            parts = line.upper().split()
            command = parts[0]
            
            if command == "STOP":
                port["trading_active"] = False
                logger.warning("[WHATSAPP] Trading globally PAUSED via STOP command.")
                modified = True
            elif command == "RESUME":
                port["trading_active"] = True
                logger.info("[WHATSAPP] Trading globally RESUMED via RESUME command.")
                modified = True
            elif command in ["CONFIRM", "SKIP"]:
                if len(parts) < 2:
                    logger.error(f"[WHATSAPP] Invalid command format: {line}. Need ticker.")
                    continue
                ticker = parts[1]
                
                # Find the proposed trade
                found = False
                for pos in port["positions"]:
                    if pos["ticker"] == ticker and pos["status"] == "proposed":
                        found = True
                        if command == "CONFIRM":
                            pos["status"] = "open"
                            logger.info(f"[WHATSAPP] Trade {ticker} CONFIRMED and is now OPEN.")
                            try:
                                requests.post(f"{os.getenv('FRIDAY_API_URL', 'http://localhost:5000')}/api/whatsapp/reply", json={
                                    "to": "120363427554589491@g.us",
                                    "message": f"✅ Trade {ticker} has been placed and is now OPEN.",
                                    "accountId": "8287592505-session"
                                }, timeout=5)
                            except Exception as e:
                                logger.error(f"[WHATSAPP] Failed to send CONFIRM message: {e}")
                        else:
                            pos["status"] = "skipped"
                            # Refund the cash
                            trade_val = pos["entry_price"] * pos["quantity"]
                            port["cash"] += trade_val
                            logger.info(f"[WHATSAPP] Trade {ticker} SKIPPED. Cash refunded.")
                            try:
                                requests.post(f"{os.getenv('FRIDAY_API_URL', 'http://localhost:5000')}/api/whatsapp/reply", json={
                                    "to": "120363427554589491@g.us",
                                    "message": f"❌ Trade {ticker} has been REJECTED. Cash refunded.",
                                    "accountId": "8287592505-session"
                                }, timeout=5)
                            except Exception as e:
                                logger.error(f"[WHATSAPP] Failed to send REJECT message: {e}")
                        modified = True
                        break
                if not found:
                    logger.warning(f"[WHATSAPP] No 'proposed' trade found for {ticker} to {command}.")
            else:
                logger.warning(f"[WHATSAPP] Unknown command: {line}")
                
        if modified:
            with open(PORTFOLIO_PATH, "w") as f:
                json.dump(port, f, indent=2)
                
        # Clear inbox after processing to avoid reprocessing
        with open(INBOX_PATH, "w", encoding="utf-8") as f:
            f.write("# Type replies here, one per line (e.g., CONFIRM BTC-USD, SKIP SOL-USD, STOP, RESUME)\n")
            
    except Exception as e:
        logger.error(f"Error processing WhatsApp inbox: {e}")
