import time
import requests

def check_status_and_send():
    for _ in range(12):
        try:
            resp = requests.get("http://localhost:5000/api/whatsapp/status").json()
            # print(resp)
            for session in resp:
                if session.get("id") == "8287592505" and session.get("ready") == True:
                    print("8287592505 is READY!")
                    # Send message
                    payload = {
                        "to": "me",
                        "message": "Hello from F.R.I.D.A.Y.! I'm officially linked to your 8287592505 session.",
                        "accountId": "8287592505-session"
                    }
                    post_resp = requests.post("http://localhost:5000/api/whatsapp/reply", json=payload)
                    print("Sent test message:", post_resp.status_code, post_resp.text)
                    return True
                elif session.get("id") == "Primary" and session.get("ready") == True:
                    print("Primary is READY!")
                    payload = {
                        "to": "me",
                        "message": "Hello from F.R.I.D.A.Y.! I'm officially linked to your Primary session.",
                        "accountId": "friday-session"
                    }
                    post_resp = requests.post("http://localhost:5000/api/whatsapp/reply", json=payload)
                    print("Sent test message:", post_resp.status_code, post_resp.text)
                    return True
            print("Still awaiting QR...")
            time.sleep(5)
        except Exception as e:
            print("Error", e)
            time.sleep(5)
    return False

check_status_and_send()
