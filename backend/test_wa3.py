import sys
sys.path.append('C:\\Users\\hp\\OneDrive\\Desktop\\J.A.R.V.I.S\\backend\\skills')
import whatsapp_handler

trade = {
    'ticker': 'ETH-USD',
    'action': 'BUY',
    'entry_price': 3000.0,
    'target': 3500.0,
    'stop_loss': 2800.0,
    'rr_ratio': 2.5,
    'confidence_score': 0.8,
    'reasoning_summary': 'Ethereum is looking bullish.\\nSolid support at 2800.'
}
whatsapp_handler.send_whatsapp_proposal(trade)
