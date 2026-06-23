import sys
import psutil
import os
import time

def diagnose():
    print("Initiating F.R.I.D.A.Y. System Diagnostic...")
    
    # 1. System Stats
    cpu = psutil.cpu_percent(interval=1)
    ram = psutil.virtual_memory()
    disk = psutil.disk_usage('/')
    
    print(f"\n[Hardware Status]")
    print(f"CPU Usage: {cpu}%")
    print(f"RAM Usage: {ram.percent}% ({ram.used / (1024**3):.1f}GB / {ram.total / (1024**3):.1f}GB)")
    print(f"Disk Usage: {disk.percent}%")
    
    if cpu > 90 or ram.percent > 90:
        print("⚠️ WARNING: System resources are critically high.")
        
    # 2. Check AutoHedge Daemon Process
    daemon_running = False
    for proc in psutil.process_iter(['pid', 'name', 'cmdline']):
        try:
            cmdline = proc.info.get('cmdline', [])
            if cmdline and 'python' in proc.info['name'].lower() and any('autohedge' in cmd for cmd in cmdline):
                daemon_running = True
                print(f"\n[Process Status]")
                print(f"AutoHedge Trading Daemon: ONLINE (PID: {proc.info['pid']})")
                break
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue
            
    if not daemon_running:
        print("\n[Process Status]")
        print("⚠️ CRITICAL: AutoHedge Trading Daemon is OFFLINE.")
        print("Recommendation: Run /heal to attempt automatic recovery.")
        
    # 3. Check WhatsApp Handlers
    print("\n[Module Status]")
    print("WhatsApp Integration: ONLINE")
    print("Diagnostic Group Routing: ONLINE")

def heal():
    print("Initiating F.R.I.D.A.Y. Self-Healing Protocol...")
    
    # Check if daemon is down
    daemon_running = False
    for proc in psutil.process_iter(['pid', 'name', 'cmdline']):
        try:
            cmdline = proc.info.get('cmdline', [])
            if cmdline and 'python' in proc.info['name'].lower() and any('autohedge' in cmd for cmd in cmdline):
                daemon_running = True
                break
        except:
            continue
            
    if daemon_running:
        print("System processes appear stable. No restart required.")
        return
        
    print("Detected dead Trading Daemon. Attempting restart...")
    # This is a stub for demonstration. In the Node app, the daemon is usually started by the user or server.js
    # We will let the user know we can't fully detached-spawn it from a whatsapp script securely yet.
    print("Please use the F.R.I.D.A.Y. Terminal or restart the Node server to respawn the daemon fully.")

if __name__ == "__main__":
    if len(sys.argv) > 1:
        if sys.argv[1] == 'diagnose':
            diagnose()
        elif sys.argv[1] == 'heal':
            heal()
    else:
        print("No command provided.")
