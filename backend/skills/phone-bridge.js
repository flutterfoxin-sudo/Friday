const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const whatsapp = require('./whatsapp');

// Inject Android SDK platform-tools into PATH automatically if available
try {
  const homeDir = process.env.USERPROFILE || process.env.HOME || 'C:\\Users\\hp';
  const potentialSdkPaths = [
    process.env.ANDROID_SDK_ROOT,
    process.env.ANDROID_HOME,
    path.join(homeDir, 'AppData', 'Local', 'Android', 'Sdk')
  ];

  for (const sdkPath of potentialSdkPaths) {
    if (sdkPath) {
      const platformTools = path.join(sdkPath, 'platform-tools');
      const adbFile = path.join(platformTools, process.platform === 'win32' ? 'adb.exe' : 'adb');
      if (fs.existsSync(adbFile)) {
        const separator = process.platform === 'win32' ? ';' : ':';
        if (!process.env.PATH.split(separator).includes(platformTools)) {
          process.env.PATH = platformTools + separator + process.env.PATH;
          console.log(`[PHONE-BRIDGE] Successfully auto-injected platform-tools to PATH: ${platformTools}`);
        }
        break;
      }
    }
  }
} catch (e) {
  console.error('[PHONE-BRIDGE] Failed to auto-resolve Android SDK PATH:', e.message);
}

let lastCallNumber = null;
let lastCallState = 0; // 0=idle, 1=ringing, 2=offhook
let pollingInterval = null;

// Clean number parsed from adb
function cleanAdbNumber(num) {
  if (!num) return null;
  return num.replace(/[^\d+]/g, '').trim();
}

// Check ADB connection and poll call registers
function startAdbMonitor() {
  if (pollingInterval) clearInterval(pollingInterval);

  console.log('[PHONE-BRIDGE] Launching Android ADB Call Monitor...');

  pollingInterval = setInterval(() => {
    // 1. Check if adb is on path and a device is connected
    exec('adb devices', (err, stdout, stderr) => {
      if (err) {
        console.debug('[PHONE-BRIDGE-DEBUG] adb command failed. Verify Android SDK is on PATH.', err.message);
        return;
      }

      const lines = stdout.trim().split('\n');
      const devices = lines.slice(1).filter(line => line.includes('\tdevice'));

      if (devices.length === 0) {
        // No devices online, wait quietly
        return;
      }

      // 2. Poll registry state
      exec('adb shell dumpsys telephony.registry', (regErr, regStdout) => {
        if (regErr) return;

        // Extract call state: mCallState or mCallState[0]
        let callState = 0;
        const stateMatch = regStdout.match(/mCallState=(\d+)/i) || regStdout.match(/mCallState\d+=(\d+)/i);
        if (stateMatch) {
          callState = parseInt(stateMatch[1], 10);
        }

        // Extract incoming number: mIncomingCallNumber
        let incomingNumber = '';
        const numMatch = regStdout.match(/mIncomingCallNumber=(\+?[\d\- ]+)/i) || regStdout.match(/mIncomingCallNumber\d+=(\+?[\d\- ]+)/i);
        if (numMatch) {
          incomingNumber = cleanAdbNumber(numMatch[1]);
        }

        // 3. Process Ringing state transitions
        if (callState === 1 && lastCallState !== 1 && incomingNumber) {
          console.log(`[PHONE-BRIDGE] 🚨 Cellular Call detected! Ringing: ${incomingNumber}`);
          
          if (incomingNumber !== lastCallNumber) {
            lastCallNumber = incomingNumber;
            
            // Trigger WhatsApp lookup & reply
            whatsapp.lookupAndReply(incomingNumber)
              .then(res => {
                console.log(`[PHONE-BRIDGE] Call intercept handled for ${incomingNumber}:`, res);
              })
              .catch(ex => {
                console.error('[PHONE-BRIDGE] Failed to handle call intercept:', ex.message);
              });
          }
        }

        // Reset tracking on idle transition
        if (callState === 0 && lastCallState !== 0) {
          lastCallNumber = null;
        }

        lastCallState = callState;
      });
    });
  }, 3000); // Poll every 3 seconds
}

module.exports = {
  description: "Android phone bridge background monitor. Polling adb telephony logs to link cellular calls with WhatsApp auto-replies.",
  
  parameters: {},

  async execute() {
    startAdbMonitor();
    return { success: true, message: 'Android ADB Monitor started in background.' };
  },

  startAdbMonitor,
  stopAdbMonitor: () => {
    if (pollingInterval) {
      clearInterval(pollingInterval);
      pollingInterval = null;
    }
  }
};
