import sys
import time
sys.path.append('C:\\Users\\hp\\OneDrive\\Desktop\\J.A.R.V.I.S\\backend\\skills')
import autohedge_daemon
import threading
from whatsapp_handler import process_whatsapp_replies

# Start polling
def whatsapp_poll_loop():
    while True:
        try:
            process_whatsapp_replies()
        except Exception as e:
            pass
        time.sleep(1)
        
t = threading.Thread(target=whatsapp_poll_loop, daemon=True)
t.start()

# Let loop process
time.sleep(2)

# Simulate User replying
with open('C:\\Users\\hp\\OneDrive\\Desktop\\J.A.R.V.I.S\\backend\\skills\\whatsapp_inbox.txt', 'w') as f:
    f.write("CONFIRM BTC-USD\n")
    f.write("SKIP SOL-USD\n")
    
print("Sent CONFIRM BTC-USD and SKIP SOL-USD. Waiting 3 seconds...")
time.sleep(3)

port = autohedge_daemon.load_paper_portfolio()
print(f"Trading Active: {port.get('trading_active')}")
for p in port['positions']:
    print(f"Position {p['ticker']}: {p['status']}")
