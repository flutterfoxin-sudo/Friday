const fs = require('fs');
const path = require('path');
const { Client, LocalAuth } = require('whatsapp-web.js');
const QRCode = require('qrcode');

const MESSAGE_DB_PATH = path.join(__dirname, 'whatsapp_messages.json');
const CALL_LOG_PATH   = path.join(__dirname, 'call_logs.json');
const SESSION_DIR     = path.join(__dirname, 'whatsapp_session');

// Initialize global variables to support hot-reloading and multi-accounts
global.whatsappAccounts    = global.whatsappAccounts    || {};
global.whatsappPendingCalls = global.whatsappPendingCalls || [];

/**
 * Check whether a saved, authenticated session exists for the given accountId.
 * whatsapp-web.js LocalAuth writes:
 *   <SESSION_DIR>/session-<accountId>/Default/Local Storage/leveldb/
 * and at least one *.ldb or MANIFEST file when properly authenticated.
 * An empty or Chromium-only folder (no WhatsApp auth data) is treated as
 * "no session" → triggers a fresh QR scan.
 */
function hasValidSession(accountId) {
  const sessionPath = path.join(SESSION_DIR, `session-${accountId}`);
  if (!fs.existsSync(sessionPath)) return false;

  // Look for Local Storage leveldb files — these are written by WA after login
  const lsPath = path.join(sessionPath, 'Default', 'Local Storage', 'leveldb');
  if (!fs.existsSync(lsPath)) return false;

  try {
    const files = fs.readdirSync(lsPath);
    // A valid session has at least one .ldb, .log, or MANIFEST file
    const hasData = files.some(f =>
      f.endsWith('.ldb') || f.endsWith('.log') || f.startsWith('MANIFEST')
    );
    return hasData;
  } catch (e) {
    return false;
  }
}

function getPendingCalls() {
  return global.whatsappPendingCalls;
}

function addPendingCall(callObj) {
  // Prevent duplicate pending calls for the same number
  if (global.whatsappPendingCalls.some(c => c.number === callObj.number)) {
    return;
  }
  global.whatsappPendingCalls.push({
    id: callObj.id || 'call-' + Date.now(),
    source: callObj.source,
    caller: callObj.caller,
    number: callObj.number,
    jid: callObj.jid,
    timestamp: new Date().toISOString()
  });
  console.log(`[WHATSAPP-PENDING] Registered pending call from ${callObj.caller} (${callObj.source})`);
}

async function handleCallDecision(id, action) {
  const callIdx = global.whatsappPendingCalls.findIndex(c => c.id === id);
  if (callIdx === -1) {
    return { success: false, error: 'Call not found.' };
  }
  const call = global.whatsappPendingCalls[callIdx];
  global.whatsappPendingCalls.splice(callIdx, 1);

  if (action === 'respond') {
    const autoReplyMessage = "vansh sir is currently unavailable I am his personal assistant Friday I will notify hiim that you called";
    try {
      // Find a ready account, preferring primary 'friday-session'
      let readyAcc = global.whatsappAccounts['friday-session'];
      if (!readyAcc || !readyAcc.ready) {
        readyAcc = Object.values(global.whatsappAccounts).find(a => a.ready);
      }

      if (readyAcc && readyAcc.ready && readyAcc.client) {
        await readyAcc.client.sendMessage(call.jid, autoReplyMessage);
        console.log(`[WHATSAPP-DECISION] Auto-responded to ${call.caller} via account ${readyAcc.name} per user choice.`);
      } else {
        console.log(`[WHATSAPP-DECISION] [SIMULATION] Auto-reply message: "${autoReplyMessage}" (logged to console, no client connected)`);
      }
      
      logCall({
        source: call.source,
        caller: `${call.caller} (${call.number})`,
        timestamp: new Date().toISOString(),
        status: "Auto-Responded",
        transcript: `Incoming call intercepted. User authorized F.R.I.D.A.Y. to auto-respond via WhatsApp.`
      });
      return { success: true, action: 'respond' };
    } catch (err) {
      console.error('[WHATSAPP-DECISION] Failed to send auto-reply:', err.message);
      return { success: false, error: err.message };
    }
  } else {
    console.log(`[WHATSAPP-DECISION] Ignored/left call from ${call.caller} per user choice.`);
    logCall({
      source: call.source,
      caller: `${call.caller} (${call.number})`,
      timestamp: new Date().toISOString(),
      status: "Ignored",
      transcript: `Incoming call intercepted. User chose to ignore/leave the call.`
    });
    return { success: true, action: 'leave' };
  }
}

// Helper to log calls
function logCall(callObj) {
  try {
    let logs = [];
    if (fs.existsSync(CALL_LOG_PATH)) {
      logs = JSON.parse(fs.readFileSync(CALL_LOG_PATH, 'utf8'));
    }
    const newLog = {
      id: 'call-' + Date.now(),
      ...callObj
    };
    logs.unshift(newLog); // prepend
    fs.writeFileSync(CALL_LOG_PATH, JSON.stringify(logs, null, 2), 'utf8');
    console.log(`[CALL-LOGGER] New call registered: ${callObj.caller} (${callObj.source})`);
  } catch (err) {
    console.error('Failed to log call:', err.message);
  }
}

// Clean and normalize phone numbers
function cleanNumber(num) {
  if (num.endsWith('@g.us') || num.endsWith('@c.us')) {
    return num;
  }
  let cleaned = num.replace(/[^\d]/g, ''); // keep only digits
  if (cleaned.startsWith('0') && cleaned.length === 11) {
    // If Indian number starting with 0, replace with 91
    cleaned = '91' + cleaned.substring(1);
  } else if (cleaned.length === 10) {
    // Default country code: 91 (India)
    cleaned = '91' + cleaned;
  }
  
  if (!cleaned.endsWith('@c.us')) {
    cleaned = cleaned + '@c.us';
  }
  return cleaned;
}

// Initialize a specific WhatsApp client
function initWhatsApp(accountId = 'friday-session', friendlyName = 'Primary') {
  if (global.whatsappAccounts[accountId]) {
    return global.whatsappAccounts[accountId];
  }

  // ── PRE-FLIGHT: Check if a saved session exists ─────────────────────
  const sessionExists = hasValidSession(accountId);
  if (!sessionExists) {
    console.log(`[WHATSAPP-${accountId.toUpperCase()}] ══ AWAITING QR SCAN ══ No saved auth session found for "${friendlyName}". A fresh QR code will be generated.`);
  } else {
    console.log(`[WHATSAPP-${accountId.toUpperCase()}] Saved session found for "${friendlyName}". Resuming authenticated client...`);
  }
  // ────────────────────────────────────────────────────────────────────

  console.log(`[WHATSAPP-${accountId.toUpperCase()}] Initializing client "${friendlyName}"...`);
  
  const client = new Client({
    authStrategy: new LocalAuth({
      clientId: accountId,
      dataPath: SESSION_DIR
    }),
    puppeteer: {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage']
    }
  });

  const accountState = {
    id: accountId,
    name: friendlyName,
    client: client,
    qr: null,
    ready: false,
    authenticating: false,
    loadingPercent: null,
    loadingMessage: null,
    isReinitializing: false,
    initTimeout: null,
    initStartedAt: Date.now(),
    qrGeneratedAt: null,
    awaitingQR: !sessionExists   // true when we know upfront a QR scan is needed
  };

  global.whatsappAccounts[accountId] = accountState;

  // Modals Auto-Dismiss & Ready-Forcing Polling Interval
  const autoDismissInterval = setInterval(async () => {
    const acc = global.whatsappAccounts[accountId];
    if (!acc || acc.ready) {
      clearInterval(autoDismissInterval);
      return;
    }
    if (acc.client && acc.client.pupPage) {
      try {
        const clicked = await acc.client.pupPage.evaluate(() => {
          const titleEl = Array.from(document.querySelectorAll('*')).find(el => 
            el.textContent && el.textContent.includes("What’s new on WhatsApp Web")
          );
          if (!titleEl) return false;
          
          let container = titleEl;
          while (container && container !== document.body) {
            const role = container.getAttribute('role');
            if (role === 'dialog' || container.classList.contains('modal') || (container.tagName === 'DIV' && container.clientHeight > 300)) {
              break;
            }
            container = container.parentElement;
          }
          if (!container) container = document.body;
          
          const closeBtn = Array.from(container.querySelectorAll('div, button, span')).find(el => {
            const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
            const role = el.getAttribute('role');
            if (ariaLabel === 'close' || ariaLabel.includes('close')) return true;
            if (role === 'button' && el.querySelector('svg')) {
              const rect = el.getBoundingClientRect();
              const modalRect = container.getBoundingClientRect();
              if (rect.top < modalRect.top + 80 && rect.right > modalRect.right - 80) return true;
            }
            return false;
          });
          
          if (closeBtn) {
            closeBtn.click();
            return true;
          }
          return false;
        });
        if (clicked) {
          console.log(`[WHATSAPP-${accountId.toUpperCase()}] Auto-dismissed "What's new" modal popup.`);
          setTimeout(async () => {
            if (!global.whatsappAccounts[accountId]) return;
            const isPageReady = await acc.client.pupPage.evaluate(() => {
              return !!document.querySelector('div[contenteditable="true"]') || !!document.querySelector('span[data-icon="chat"]');
            });
            if (isPageReady && !acc.ready) {
              console.log(`[WHATSAPP-${accountId.toUpperCase()}] Chat list detected. Forcing ready state.`);
              acc.ready = true;
              acc.awaitingQR = false;
              acc.qr = null;
              acc.authenticating = false;
              acc.loadingPercent = null;
              acc.loadingMessage = null;
              syncChatsToLocal(accountId).catch(() => {});
            }
          }, 3000);
        } else {
          // If no modal, check if chats list is visible anyway (ready event missed)
          const isPageReady = await acc.client.pupPage.evaluate(() => {
            return !!document.querySelector('div[contenteditable="true"]') || !!document.querySelector('span[data-icon="chat"]');
          });
          if (isPageReady && !acc.ready && !acc.qr) {
            console.log(`[WHATSAPP-${accountId.toUpperCase()}] Chat list detected (no modal). Forcing ready state.`);
            acc.ready = true;
            acc.awaitingQR = false;
            acc.qr = null;
            acc.authenticating = false;
            acc.loadingPercent = null;
            acc.loadingMessage = null;
            syncChatsToLocal(accountId).catch(() => {});
          }
        }
      } catch (e) {
        // Puppeteer not fully loaded, ignore
      }
    }
  }, 5000);

  // ── WATCHDOG: 180s timeout (extended from 120s for slow machines) ───
  // Only fires if no QR and not ready — i.e. Puppeteer stalled completely.
  accountState.initTimeout = setTimeout(() => {
    const acc = global.whatsappAccounts[accountId];
    if (acc && !acc.ready && !acc.qr) {
      console.warn(`[WHATSAPP-${accountId.toUpperCase()}] Watchdog: No QR or Ready event in 180s. Re-initializing...`);
      destroyAndReinit(accountId);
    }
  }, 180000);

  client.on('qr', (qr) => {
    const acc = global.whatsappAccounts[accountId];
    if (!acc) return;
    if (acc.initTimeout) {
      clearTimeout(acc.initTimeout);
      acc.initTimeout = null;
    }
    QRCode.toDataURL(qr, (err, url) => {
      if (!err) {
        acc.qr = url;
        acc.qrGeneratedAt = Date.now();
        acc.ready = false;
        acc.authenticating = false;
        acc.awaitingQR = true;  // confirm QR is actively waiting for scan
        console.log(`[WHATSAPP-${accountId.toUpperCase()}] ══ QR CODE READY ══ Scan now in the Office Matrix HUD → COMMS tab.`);
      } else {
        console.error(`[WHATSAPP-${accountId.toUpperCase()}] QR code data URL generation failed:`, err.message);
      }
    });
  });

  client.on('authenticated', () => {
    const acc = global.whatsappAccounts[accountId];
    if (!acc) return;
    acc.qr = null;
    acc.ready = false;
    acc.authenticating = true;
    console.log(`[WHATSAPP-${accountId.toUpperCase()}] Authenticated successfully. Session sync in progress...`);
  });

  client.on('loading_screen', (percent, message) => {
    const acc = global.whatsappAccounts[accountId];
    if (!acc) return;
    acc.qr = null;
    acc.ready = false;
    acc.authenticating = true;
    acc.loadingPercent = percent;
    acc.loadingMessage = message;
    console.log(`[WHATSAPP-${accountId.toUpperCase()}] Loading: ${percent}% - ${message}`);
  });

  client.on('ready', async () => {
    const acc = global.whatsappAccounts[accountId];
    if (!acc) return;
    if (acc.initTimeout) {
      clearTimeout(acc.initTimeout);
      acc.initTimeout = null;
    }
    acc.ready = true;
    acc.qr = null;
    acc.awaitingQR = false;
    acc.authenticating = false;
    acc.loadingPercent = null;
    acc.loadingMessage = null;
    console.log(`[WHATSAPP-${accountId.toUpperCase()}] ══ CONNECTED ══ Client "${friendlyName}" is fully operational.`);

    if (accountId === '8287592505-session' || accountId === 'friday-session') {
      try {
        const chats = await client.getChats();
        const diagGroup = chats.find(c => c.isGroup && c.name === 'F.R.I.D.A.Y. Diagnostics');
        if (!diagGroup) {
          console.log('[WHATSAPP-DIAGNOSTICS] Creating F.R.I.D.A.Y. Diagnostics group...');
          const alertGroup = chats.find(c => c.isGroup && c.name === 'F.R.I.D.A.Y. Alerts');
          let p = [];
          if (alertGroup && alertGroup.participants) {
             p = alertGroup.participants.map(x => x.id._serialized);
             p = p.filter(x => !x.includes('21852827156681') && x !== client.info.wid._serialized);
          }
          if (p.length === 0) p = ['918287592505@c.us']; // fallback
          
          const newGroup = await client.createGroup('F.R.I.D.A.Y. Diagnostics', p);
          global.diagnosticsGroupId = newGroup.gid._serialized;
          console.log('[WHATSAPP-DIAGNOSTICS] Group created:', global.diagnosticsGroupId);
        } else {
          global.diagnosticsGroupId = diagGroup.id._serialized;
        }
      } catch (e) {
        console.error('[WHATSAPP-DIAGNOSTICS] Error initializing group:', e.message);
      }
    }

    syncChatsToLocal(accountId).catch(() => {});
  });

  client.on('auth_failure', (msg) => {
    console.error(`[WHATSAPP-${accountId.toUpperCase()}] Auth failure:`, msg);
    destroyAndReinit(accountId);
  });

  client.on('disconnected', (reason) => {
    console.log(`[WHATSAPP-${accountId.toUpperCase()}] Disconnected:`, reason);
    destroyAndReinit(accountId);
  });

  // Incoming Call Interceptor
  client.on('call', async (call) => {
    console.log(`[WHATSAPP-CALL-${accountId.toUpperCase()}] Intercepted call from: ${call.from}`);
    try {
      await call.reject();
      console.log(`[WHATSAPP-CALL-${accountId.toUpperCase()}] Rejected call.`);

      // F.R.I.D.A.Y. Auto-Responder Templates
      const templates = [
        "🤖 *F.R.I.D.A.Y.*: Sir is not available at the moment. I am his personal assistant, F.R.I.D.A.Y. Please drop your message and I will convey it to him.",
        "🤖 *F.R.I.D.A.Y.*: Hello! Sir is currently occupied. I am F.R.I.D.A.Y., his digital assistant. Kindly leave a message and I'll ensure he gets it.",
        "🤖 *F.R.I.D.A.Y.*: Sir cannot take calls right now. I'm F.R.I.D.A.Y., his AI assistant. Please leave your message here.",
        "🤖 *F.R.I.D.A.Y.*: You've reached Sir's personal assistant, F.R.I.D.A.Y. He is away from his device. Drop your text and I will notify him immediately."
      ];
      const autoReply = templates[Math.floor(Math.random() * templates.length)];
      
      // Send the auto-reply message
      try {
        await client.sendMessage(call.from, autoReply);
        console.log(`[WHATSAPP-CALL-${accountId.toUpperCase()}] Auto-reply sent to ${call.from}.`);
      } catch (sendErr) {
        console.error(`[WHATSAPP-CALL-${accountId.toUpperCase()}] Failed to send auto-reply:`, sendErr.message);
      }

      const callId = 'call-' + Date.now();
      const callerNumber = call.from.split('@')[0];
      
      let callerName = callerNumber;
      try {
        const contact = await call.getContact();
        if (contact && contact.name) {
          callerName = contact.name;
        }
      } catch (e) {}

      addPendingCall({
        id: callId,
        source: `WhatsApp Call (${friendlyName})`,
        caller: callerName,
        number: callerNumber,
        jid: call.from
      });

      // Notify Soul CNS
      try {
        const soul = require('./soul');
        soul.notify('whatsapp', { type: 'incoming_call', from: callerName, number: callerNumber });
      } catch (e) {}

    } catch (err) {
      console.error(`[WHATSAPP-CALL-${accountId.toUpperCase()}] Error handling incoming call:`, err.message);
    }
  });

  // Sync chats on incoming messages
  client.on('message', async (msg) => {
    try {
      const text = msg.body.trim().toLowerCase();
      if (text === '/diagnose' || text === '/heal') {
        const { exec } = require('child_process');
        const scriptPath = path.join(__dirname, 'self_healing.py');
        const cmd = text === '/diagnose' ? 'diagnose' : 'heal';
        
        if (text === '/heal') {
           await client.sendMessage(msg.from, "🤖 *F.R.I.D.A.Y.* Initiating Self-Healing Protocol...");
        }
        
        exec(`python "${scriptPath}" ${cmd}`, (error, stdout, stderr) => {
            const report = stdout || stderr || (error ? error.message : "Done.");
            client.sendMessage(msg.from, `🤖 *F.R.I.D.A.Y. ${cmd === 'diagnose' ? 'Diagnostics Report' : 'Healing Result'}*\n\`\`\`\n${report}\n\`\`\``);
        });
        return;
      }

      await syncChatsToLocal(accountId);
      // Notify Soul CNS
      try {
        const soul = require('./soul');
        soul.notify('whatsapp', { type: 'incoming_message', from: msg.from, body: msg.body });
      } catch (e) {}
    } catch (err) {}
  });

  // Intercept F.R.I.D.A.Y. daemon commands
  client.on('message_create', async (msg) => {
    try {
      const myId = client.info && client.info.wid ? client.info.wid._serialized : null;
      const isGroupAlert = msg.to === '120363427554589491@g.us';
      // Process if message is sent to ourselves ("You" chat) OR sent by us in the group alert chat
      if ((myId && msg.to === myId) || (isGroupAlert && msg.fromMe)) {
        const text = msg.body.trim().toUpperCase();
        if (text === "STOP" || text === "RESUME" || text.startsWith("CONFIRM ") || text.startsWith("SKIP ")) {
          const fs = require('fs');
          const path = require('path');
          const inboxPath = path.join(__dirname, 'whatsapp_inbox.txt');
          fs.appendFileSync(inboxPath, msg.body.trim() + "\n", 'utf-8');
          console.log(`[WHATSAPP-DAEMON] Intercepted command: ${msg.body.trim()}`);
        }
      }
    } catch (err) {
      console.error("[WHATSAPP-DAEMON] Error intercepting command:", err);
    }
  });

  client.on('vote_update', async (vote) => {
    try {
      let parentMessage = vote.parentMessage;
      if (!parentMessage && vote.parentMsgKey) {
        try {
          const msgId = vote.parentMsgKey._serialized || vote.parentMsgKey.id;
          if (msgId) {
            parentMessage = await client.getMessageById(msgId);
            console.log(`[WHATSAPP-POLL] Successfully fetched parent message by ID: ${msgId}`);
          }
        } catch (err) {
          console.error(`[WHATSAPP-POLL] Failed to fetch parent message by ID:`, err.message);
        }
      }

      if (!parentMessage) {
        console.warn(`[WHATSAPP-POLL] Vote update received, but parentMessage could not be resolved. Vote details:`, JSON.stringify({
          voter: vote.voter,
          parentMsgKey: vote.parentMsgKey,
          selectedOptions: vote.selectedOptions
        }));
        return;
      }
      
      const question = parentMessage.pollName || parentMessage.body || '';
      console.log(`[WHATSAPP-POLL] Vote update received. Voter: ${vote.voter}, Question: "${question}"`);
      
      // Only process votes from the owner (Vansh or the bot itself)
      const myId = client.info && client.info.wid ? client.info.wid._serialized : null;
      if (vote.voter !== myId && !vote.voter.includes('8287592505') && !vote.voter.includes('21852827156681')) {
        console.log(`[WHATSAPP-POLL] Ignored vote from non-owner: ${vote.voter}`);
        return;
      }
      
      // Parse question to see if it is a F.R.I.D.A.Y trade authorization poll
      const match = question.match(/(?:Authorize Trade|Autonomous Trade|Trade Proposal):\s*(BUY|SELL)\s*([A-Z0-9.\-_]+)/i);
      if (!match) {
        return;
      }
      
      const action = match[1].toUpperCase();
      const ticker = match[2].toUpperCase();
      
      const selected = vote.selectedOptions || [];
      if (selected.length === 0) {
        console.log(`[WHATSAPP-POLL] User deselected all options for ${ticker}`);
        return;
      }
      
      const selectedNames = selected.map(o => o.name ? o.name.toUpperCase().trim() : '');
      console.log(`[WHATSAPP-POLL] User selected options: ${JSON.stringify(selectedNames)}`);
      
      if (selectedNames.includes('APPROVE') || selectedNames.includes('CONFIRM')) {
        const fs = require('fs');
        const path = require('path');
        const inboxPath = path.join(__dirname, 'whatsapp_inbox.txt');
        fs.appendFileSync(inboxPath, `CONFIRM ${ticker}\n`, 'utf-8');
        console.log(`[WHATSAPP-POLL-CONFIRM] Appended CONFIRM command for ${ticker} from poll vote.`);
        
        await client.sendMessage(vote.parentMsgKey.remote, `✅ Trade authorization received for *${ticker}*. This trade has been placed!`);
      } else if (selectedNames.includes('REJECT') || selectedNames.includes('SKIP')) {
        const fs = require('fs');
        const path = require('path');
        const inboxPath = path.join(__dirname, 'whatsapp_inbox.txt');
        fs.appendFileSync(inboxPath, `SKIP ${ticker}\n`, 'utf-8');
        console.log(`[WHATSAPP-POLL-REJECT] Appended SKIP command for ${ticker} from poll vote.`);
        
        await client.sendMessage(vote.parentMsgKey.remote, `❌ Trade authorization declined for *${ticker}*. This trade has been rejected.`);
      }
    } catch (err) {
      console.error("[WHATSAPP-POLL-ERROR]", err);
    }
  });

  client.initialize().catch(err => {
    console.error(`[WHATSAPP-${accountId.toUpperCase()} INIT FATAL]`, err.message);
    destroyAndReinit(accountId);
  });

  return accountState;
}

// Tear down and recreate client session
async function destroyAndReinit(accountId) {
  const acc = global.whatsappAccounts[accountId];
  if (!acc) return;
  if (acc.isReinitializing) return;
  acc.isReinitializing = true;

  console.log(`[WHATSAPP-${accountId.toUpperCase()}] Commencing client teardown and scheduled re-initialization...`);
  if (acc.initTimeout) {
    clearTimeout(acc.initTimeout);
    acc.initTimeout = null;
  }

  if (acc.client) {
    try {
      // Try to kill the underlying Puppeteer browser process directly first
      if (acc.client.pupBrowser) {
        try {
          const browserProcess = acc.client.pupBrowser.process();
          if (browserProcess && !browserProcess.killed) {
            browserProcess.kill('SIGKILL');
            console.log(`[WHATSAPP-${accountId.toUpperCase()}] Force-killed Puppeteer browser process (PID: ${browserProcess.pid}).`);
          }
        } catch (killErr) {
          // Browser process may not be accessible, ignore
        }
      }
      await acc.client.destroy();
    } catch (err) {
      console.error(`[WHATSAPP-${accountId.toUpperCase()}] Error during client destroy:`, err.message);
      // Last resort: try to close the browser directly
      try {
        if (acc.client.pupBrowser) {
          await acc.client.pupBrowser.close();
        }
      } catch (closeErr) {}
    }
  }

  acc.ready = false;
  acc.qr = null;
  acc.authenticating = false;
  acc.loadingPercent = null;
  acc.loadingMessage = null;
  acc.isReinitializing = false;

  // Re-initialize in 10 seconds (allow Chromium cleanup time)
  setTimeout(() => {
    // Only reinit if account was not deleted in the interim
    if (global.whatsappAccounts[accountId]) {
      const friendlyName = acc.name;
      delete global.whatsappAccounts[accountId];
      initWhatsApp(accountId, friendlyName);
    }
  }, 10000);
}

// Dynamic Account Creation
function createAccount(name) {
  if (!name) return { success: false, error: 'Account name is required.' };
  const accountId = name.toLowerCase().replace(/[^a-z0-9]/g, '-') + '-session';
  if (global.whatsappAccounts[accountId]) {
    return { success: false, error: 'An account with a similar name already exists.' };
  }
  
  initWhatsApp(accountId, name);
  return {
    success: true,
    account: {
      id: accountId,
      name: name,
      ready: false,
      qr: null
    }
  };
}

// Dynamic Account Deletion
async function deleteAccount(accountId) {
  const acc = global.whatsappAccounts[accountId];
  if (!acc) return { success: false, error: 'Account not found.' };

  console.log(`[WHATSAPP-${accountId.toUpperCase()}] Deleting and unlinking account...`);
  if (acc.initTimeout) {
    clearTimeout(acc.initTimeout);
  }

  if (acc.client) {
    try {
      if (acc.client.pupBrowser) {
        try {
          const browserProcess = acc.client.pupBrowser.process();
          if (browserProcess && !browserProcess.killed) {
            browserProcess.kill('SIGKILL');
          }
        } catch (killErr) {}
      }
      await acc.client.destroy();
    } catch (err) {
      console.error(`[WHATSAPP-${accountId.toUpperCase()}] Error destroying client:`, err.message);
      try {
        if (acc.client.pupBrowser) await acc.client.pupBrowser.close();
      } catch (closeErr) {}
    }
  }

  delete global.whatsappAccounts[accountId];

  // Recursively remove session directory
  const sessionDir = path.join(__dirname, 'whatsapp_session', `session-${accountId}`);
  try {
    if (fs.existsSync(sessionDir)) {
      fs.rmSync(sessionDir, { recursive: true, force: true });
      console.log(`[WHATSAPP-${accountId.toUpperCase()}] Session directory deleted.`);
    }
  } catch (err) {
    console.error(`[WHATSAPP-${accountId.toUpperCase()}] Failed to delete session directory:`, err.message);
  }

  // Remove local cached chats file
  const dbPath = path.join(__dirname, `whatsapp_messages_${accountId}.json`);
  try {
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
  } catch (err) {}

  return { success: true };
}

// Scan directories to autoload accounts
function autoLoadAccounts() {
  const sessionDir = path.join(__dirname, 'whatsapp_session');
  console.log('[WHATSAPP-AUTOLOAD] Scanning for saved sessions in:', sessionDir);
  try {
    if (fs.existsSync(sessionDir)) {
      const files = fs.readdirSync(sessionDir);
      for (const file of files) {
        const fullPath = path.join(sessionDir, file);
        if (file.startsWith('session-') && fs.statSync(fullPath).isDirectory()) {
          const accountId = file.replace(/^session-/, '');
          let name = accountId.replace(/-session$/, '');
          // Capitalize name
          name = name.charAt(0).toUpperCase() + name.slice(1);
          if (name === 'Friday') name = 'Primary';

          console.log(`[WHATSAPP-AUTOLOAD] Loading session "${name}" (${accountId})`);
          initWhatsApp(accountId, name);
        }
      }
    }
  } catch (err) {
    console.error('[WHATSAPP-AUTOLOAD] Scan failed:', err.message);
  }

  // Guarantee at least the primary account is active
  if (!global.whatsappAccounts['friday-session']) {
    initWhatsApp('friday-session', 'Primary');
  }
}

// Sync active WhatsApp chats to local database
async function syncChatsToLocal(accountId = 'friday-session') {
  const acc = global.whatsappAccounts[accountId];
  if (!acc || !acc.ready || !acc.client) return;

  try {
    const chats = await acc.client.getChats();
    const formattedChats = [];
    
    // Get top 8 active chats
    for (const chat of chats.slice(0, 8)) {
      const messages = await chat.fetchMessages({ limit: 10 });
      const history = messages.map(m => ({
        sender: m.fromMe ? 'Me' : chat.name,
        text: m.body,
        timestamp: new Date(m.timestamp * 1000).toISOString()
      }));

      formattedChats.push({
        contact: chat.name,
        number: chat.id.user,
        unreadCount: chat.unreadCount,
        chat: history
      });
    }

    const dbPath = path.join(__dirname, `whatsapp_messages_${accountId}.json`);
    fs.writeFileSync(dbPath, JSON.stringify(formattedChats, null, 2), 'utf8');
    
    // If it's the primary account, write to the default whatsapp_messages.json too for backup
    if (accountId === 'friday-session') {
      fs.writeFileSync(MESSAGE_DB_PATH, JSON.stringify(formattedChats, null, 2), 'utf8');
    }
  } catch (err) {
    console.error(`[WHATSAPP-${accountId.toUpperCase()}] Failed to sync chats:`, err.message);
  }
}

// Check number registered, check previous chats, send auto-reply
async function lookupAndReply(rawNumber, simulate = false) {
  let readyAcc = global.whatsappAccounts['friday-session'];
  if (!readyAcc || !readyAcc.ready) {
    readyAcc = Object.values(global.whatsappAccounts).find(a => a.ready);
  }

  if ((!readyAcc || !readyAcc.ready) && !simulate) {
    console.warn('[WHATSAPP] Lookup requested but no client is linked.');
    return { success: false, error: 'No WhatsApp account is linked.' };
  }

  const cleanedJid = cleanNumber(rawNumber);
  
  try {
    let isRegistered = false;
    let hasChatted = false;

    if (simulate) {
      isRegistered = true;
      hasChatted = false;
      console.log(`[WHATSAPP-LOOKUP] [SIMULATION] Simulating registered user with no chat history for: ${rawNumber}`);
    } else {
      isRegistered = await readyAcc.client.isRegisteredUser(cleanedJid);
      if (isRegistered) {
        const chats = await readyAcc.client.getChats();
        const existingChat = chats.find(c => c.id._serialized === cleanedJid);
        if (existingChat) {
          const msgs = await existingChat.fetchMessages({ limit: 1 });
          if (msgs && msgs.length > 0) {
            hasChatted = true;
          }
        }
      }
    }

    if (!isRegistered) {
      console.log(`[WHATSAPP-LOOKUP] Number ${rawNumber} is not registered on WhatsApp.`);
      logCall({
        source: "Cellular",
        caller: rawNumber,
        timestamp: new Date().toISOString(),
        status: "Log Only (No WhatsApp)",
        transcript: `Cellular call intercepted on phone. Checked WhatsApp: Not Registered. No auto-reply sent.`
      });
      return { success: true, registered: false, sent: false };
    }

    if (hasChatted) {
      console.log(`[WHATSAPP-LOOKUP] Previous chat history exists with ${rawNumber}. Skipping auto-reply to avoid spam.`);
      logCall({
        source: "Cellular",
        caller: rawNumber,
        timestamp: new Date().toISOString(),
        status: "Log Only (Active Chat)",
        transcript: `Cellular call intercepted. Active chat history exists with contact. Skipped auto-reply.`
      });
      return { success: true, registered: true, sent: false, reason: 'Active chat history exists' };
    }

    // No recent chats -> register as pending call to ask user
    addPendingCall({
      id: 'call-' + Date.now(),
      source: "Cellular",
      caller: rawNumber,
      number: rawNumber,
      jid: cleanedJid
    });

    return { success: true, registered: true, pending: true };
  } catch (err) {
    console.error('[WHATSAPP-LOOKUP FAILED]', err.message);
    return { success: false, error: err.message };
  }
}

module.exports = {
  description: "WhatsApp client skill. Integrates call handling, contact lookup, and chat logs syncing.",
  
  parameters: {
    action: { type: "string", description: "Action: 'status', 'send', 'lookup', 'sync', 'screenshot', 'create_group'" },
    to: { type: "string", description: "Recipient number for send action" },
    message: { type: "string", description: "Message body text" },
    number: { type: "string", description: "Phone number for lookup action" },
    simulate: { type: "boolean", description: "Bypass connection check and force simulate call lookup" },
    accountId: { type: "string", description: "Specific WhatsApp account ID to target" },
    groupName: { type: "string", description: "Name of group to create" },
    participants: { type: "array", description: "Array of participant phone numbers" },
    pollOptions: { type: "array", description: "Options array for sending a poll message" }
  },

  async execute({ action = 'status', to, message, number, simulate, accountId, groupName, participants, pollOptions }) {
    // Guarantee initialization
    if (Object.keys(global.whatsappAccounts).length === 0) {
      autoLoadAccounts();
    }

    if (action === 'status') {
      const statusList = Object.values(global.whatsappAccounts).map(acc => ({
        id: acc.id,
        name: acc.name,
        ready: acc.ready,
        qr: acc.qr,
        authenticating: acc.authenticating || false,
        loadingPercent: acc.loadingPercent || null,
        loadingMessage: acc.loadingMessage || null,
        initStartedAt: acc.initStartedAt || null,
        qrGeneratedAt: acc.qrGeneratedAt || null,
        awaitingQR: acc.awaitingQR || false,
        sessionExists: hasValidSession(acc.id)
      }));

      // Prefer the first ready account as the "primary" for backward-compat fields
      const primaryAcc = global.whatsappAccounts['friday-session']
        || Object.values(global.whatsappAccounts).find(a => a.ready)
        || Object.values(global.whatsappAccounts)[0]
        || {};

      return {
        success: true,
        accounts: statusList,
        // Backward-compat fields (use primary or first ready account)
        ready: primaryAcc.ready || false,
        qr: primaryAcc.qr || null,
        authenticating: primaryAcc.authenticating || false,
        loadingPercent: primaryAcc.loadingPercent || null,
        loadingMessage: primaryAcc.loadingMessage || null,
        awaitingQR: primaryAcc.awaitingQR || false,
        session: primaryAcc.id || 'friday-session'
      };
    } else if (action === 'send') {
      if (!to || (!message && !pollOptions)) return { success: false, error: 'Recipient (to) and message/pollOptions are required.' };
      
      const targetAccId = accountId || 'friday-session';
      let acc = global.whatsappAccounts[targetAccId];
      if (!acc || !acc.ready) {
        // Fallback to first ready account
        acc = Object.values(global.whatsappAccounts).find(a => a.ready);
      }
      
      if (!acc || !acc.ready || !acc.client) {
        console.log(`[WHATSAPP-SEND] [SIMULATION] No ready WhatsApp account found. Simulating send of: "${message}" to ${to} (from account: ${targetAccId})`);
        // Notify Soul CNS
        try {
          const soul = require('./soul');
          soul.notify('whatsapp', { type: 'outgoing_message_simulated', to: to, body: message });
        } catch (e) {}
        return { success: true, message: 'Message sent (simulation).' };
      }
      
      let jid;
      if (to.toLowerCase() === 'me' && acc.client.info && acc.client.info.wid) {
        jid = acc.client.info.wid._serialized;
      } else {
        jid = cleanNumber(to);
      }
      
      if (pollOptions && Array.isArray(pollOptions)) {
        const { Poll } = require('whatsapp-web.js');
        const pollQuestion = message;
        await acc.client.sendMessage(jid, new Poll(pollQuestion, pollOptions));
      } else {
        await acc.client.sendMessage(jid, message);
        await syncChatsToLocal(acc.id);
      }
      
      // Notify Soul CNS
      try {
        const soul = require('./soul');
        soul.notify('whatsapp', { type: 'outgoing_message', to: jid, body: message });
      } catch (e) {}

      return { success: true, message: 'Message sent.' };
    } else if (action === 'create_group') {
      if (!groupName || !participants) return { success: false, error: 'groupName and participants parameters are required.' };
      
      const targetAccId = accountId || 'friday-session';
      let acc = global.whatsappAccounts[targetAccId];
      if (!acc || !acc.ready) {
        acc = Object.values(global.whatsappAccounts).find(a => a.ready);
      }
      
      if (!acc || !acc.ready || !acc.client) {
        return { success: false, error: 'No ready WhatsApp account found.' };
      }

      try {
        const jids = (Array.isArray(participants) ? participants : [participants]).map(p => cleanNumber(p));
        const groupObj = await acc.client.createGroup(groupName, jids);
        return { success: true, groupId: groupObj.gid._serialized, message: `Group '${groupName}' created successfully.` };
      } catch (err) {
        return { success: false, error: err.message };
      }
    } else if (action === 'lookup') {
      if (!number) return { success: false, error: 'Number parameter is required for lookup.' };
      return await lookupAndReply(number, simulate);
    } else if (action === 'sync') {
      const targetAccId = accountId || 'friday-session';
      await syncChatsToLocal(targetAccId);
      return { success: true, message: 'Chats synchronized successfully.' };
    } else if (action === 'dismiss_modal') {
      const targetAccId = accountId || 'friday-session';
      const acc = global.whatsappAccounts[targetAccId];
      if (!acc || !acc.client || !acc.client.pupPage) return { success: false, error: 'Puppeteer page not available.' };
      
      try {
        const clicked = await acc.client.pupPage.evaluate(() => {
          // Find the modal title
          const titleEl = Array.from(document.querySelectorAll('*')).find(el => 
            el.textContent && el.textContent.includes("What’s new on WhatsApp Web")
          );
          if (!titleEl) return { found: false, reason: "Title not found" };
          
          // Go up to the modal container
          let container = titleEl;
          while (container && container !== document.body) {
            const role = container.getAttribute('role');
            if (role === 'dialog' || container.classList.contains('modal') || (container.tagName === 'DIV' && container.clientHeight > 300)) {
              break;
            }
            container = container.parentElement;
          }
          
          if (!container) container = document.body;
          
          // Find close button inside container
          const closeBtn = Array.from(container.querySelectorAll('div, button, span')).find(el => {
            const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
            const role = el.getAttribute('role');
            if (ariaLabel === 'close' || ariaLabel.includes('close')) return true;
            if (role === 'button' && el.querySelector('svg')) {
              const rect = el.getBoundingClientRect();
              const modalRect = container.getBoundingClientRect();
              if (rect.top < modalRect.top + 80 && rect.right > modalRect.right - 80) {
                return true;
              }
            }
            return false;
          });
          
          if (closeBtn) {
            closeBtn.click();
            return { found: true, tag: closeBtn.tagName, ariaLabel: closeBtn.getAttribute('aria-label') };
          }
          
          const svgBtn = Array.from(container.querySelectorAll('[role="button"]')).find(el => el.querySelector('svg'));
          if (svgBtn) {
            svgBtn.click();
            return { found: true, fallback: true, tag: svgBtn.tagName };
          }
          
          return { found: false, reason: "No close button found" };
        });
        
        return { success: true, result: clicked };
      } catch (err) {
        return { success: false, error: err.message };
      }
    } else if (action === 'force_ready') {
      const targetAccId = accountId || 'friday-session';
      const acc = global.whatsappAccounts[targetAccId];
      if (!acc) return { success: false, error: 'Account not found.' };
      acc.ready = true;
      acc.awaitingQR = false;
      acc.qr = null;
      return { success: true, message: `Account '${targetAccId}' forced to ready.` };
    } else if (action === 'screenshot') {
      const targetAccId = accountId || 'friday-session';
      const acc = global.whatsappAccounts[targetAccId];
      if (!acc || !acc.client || !acc.client.pupPage) return { success: false, error: 'Puppeteer page not available.' };
      const screenshotPath = path.join(__dirname, `whatsapp_page_${targetAccId}.png`);
      await acc.client.pupPage.screenshot({ path: screenshotPath });
      return { success: true, message: 'Screenshot captured.', path: screenshotPath };
    } else if (action === 'simulate_vote') {
      const targetAccId = accountId || '8287592505-session';
      const acc = global.whatsappAccounts[targetAccId];
      if (!acc || !acc.ready || !acc.client) return { success: false, error: 'Account not ready.' };
      
      const chats = await acc.client.getChats();
      let pollMsg = null;
      for (const chat of chats) {
        if (chat.name.includes("F.R.I.D.A.Y. Alerts") || chat.id._serialized.includes("120363427554589491")) {
          const msgs = await chat.fetchMessages({ limit: 20 });
          for (const m of [...msgs].reverse()) {
            if (m.type === 'poll_creation' || m.pollName || (m.body && m.body.includes("Authorize Trade"))) {
              pollMsg = m;
              break;
            }
          }
        }
        if (pollMsg) break;
      }
      
      if (!pollMsg) {
        return { success: false, error: 'No poll message found in Alerts group.' };
      }
      
      const optionName = message || 'Approve';
      const mockVote = {
        voter: '21852827156681@c.us',
        parentMessage: pollMsg,
        parentMsgKey: pollMsg.id,
        selectedOptions: [{ name: optionName }]
      };
      
      console.log(`[WHATSAPP-SIMULATE] Emitting mock vote_update for poll: "${pollMsg.pollName || pollMsg.body}" with option: "${optionName}"`);
      acc.client.emit('vote_update', mockVote);
      return { success: true, message: `Mock vote '${optionName}' emitted for poll message ID: ${pollMsg.id._serialized}` };
    } else {
      return { success: false, error: `Invalid action "${action}". Supported: 'status', 'send', 'lookup', 'sync', 'screenshot', 'create_group', 'force_ready', 'simulate_vote'` };
    }
  },

  // Export functions to call programmatically from server.js
  initWhatsApp: autoLoadAccounts,
  lookupAndReply,
  getQrCode: () => global.whatsappAccounts['friday-session'] ? global.whatsappAccounts['friday-session'].qr : null,
  isReady: () => global.whatsappAccounts['friday-session'] ? global.whatsappAccounts['friday-session'].ready : false,
  syncChatsToLocal,
  getPendingCalls,
  handleCallDecision,
  createAccount,
  deleteAccount
};
