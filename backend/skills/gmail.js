const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const imaps = require('imap-simple');
const simpleParser = require('mailparser').simpleParser;
const gmailOAuth = require('./gmail-oauth');

const GMAIL_INBOX_PATH    = path.join(__dirname, 'gmail_inbox.json');
const EMAIL_ACCOUNTS_PATH = path.join(__dirname, 'email_accounts.json');

// Load configured email accounts
function getAccounts(maskPasswords = true) {
  let accounts = [];
  try {
    if (fs.existsSync(EMAIL_ACCOUNTS_PATH)) {
      accounts = JSON.parse(fs.readFileSync(EMAIL_ACCOUNTS_PATH, 'utf8'));
    }
  } catch (e) {
    console.error('Failed to read email accounts file:', e.message);
  }

  // If empty, migrate credentials from environment variables if present
  if (accounts.length === 0) {
    const defaultUser = process.env.GMAIL_USER;
    const defaultPass = process.env.GMAIL_APP_PASSWORD;
    if (defaultUser && defaultPass) {
      const primaryAcc = {
        id: 'primary',
        name: 'Primary Gmail',
        email: defaultUser,
        password: defaultPass,
        provider: 'gmail',
        imapHost: 'imap.gmail.com',
        imapPort: 993,
        smtpHost: 'smtp.gmail.com',
        smtpPort: 465
      };
      accounts.push(primaryAcc);
      try {
        fs.writeFileSync(EMAIL_ACCOUNTS_PATH, JSON.stringify(accounts, null, 2), 'utf8');
      } catch (e) {
        console.error('Failed to save default migrated email account:', e.message);
      }
    }
  }

  if (maskPasswords) {
    return accounts.map(({ password, ...acc }) => ({
      ...acc,
      ready: true // connection status indicator for UI
    }));
  }
  return accounts;
}

// Create a new email account
function createAccount(accountData) {
  const accounts = getAccounts(false);
  const newAccount = {
    id: 'email-' + Date.now(),
    name: accountData.name || 'Custom Mail',
    email: accountData.email,
    password: accountData.password,
    provider: accountData.provider || 'custom',
    imapHost: accountData.imapHost || (accountData.provider === 'gmail' ? 'imap.gmail.com' : ''),
    imapPort: parseInt(accountData.imapPort) || 993,
    smtpHost: accountData.smtpHost || (accountData.provider === 'gmail' ? 'smtp.gmail.com' : ''),
    smtpPort: parseInt(accountData.smtpPort) || 465
  };

  accounts.push(newAccount);
  fs.writeFileSync(EMAIL_ACCOUNTS_PATH, JSON.stringify(accounts, null, 2), 'utf8');
  return { success: true, account: { ...newAccount, password: undefined } };
}

// Delete an email account
function deleteAccount(id) {
  const accounts = getAccounts(false);
  const filtered = accounts.filter(acc => acc.id !== id);
  if (accounts.length === filtered.length) {
    return { success: false, error: 'Account not found.' };
  }
  fs.writeFileSync(EMAIL_ACCOUNTS_PATH, JSON.stringify(filtered, null, 2), 'utf8');
  return { success: true };
}

// Helper to load fallback local inbox cache
function loadLocalInbox() {
  try {
    if (fs.existsSync(GMAIL_INBOX_PATH)) {
      return JSON.parse(fs.readFileSync(GMAIL_INBOX_PATH, 'utf8'));
    }
  } catch (e) {
    console.error('Failed to read local email inbox cache:', e.message);
  }
  return [];
}

/**
 * Determine if an account should use OAuth2:
 *   – explicitly flagged as authType='oauth2', OR
 *   – provider='gmail' AND a stored refresh token exists.
 */
function shouldUseOAuth2(acc) {
  if (acc.authType === 'oauth2') return true;
  if (acc.provider === 'gmail' && gmailOAuth.hasToken(acc.id)) return true;
  return false;
}

// Fetch unread emails from one or all accounts.
// ─ Gmail accounts with OAuth2 tokens  → Gmail REST API (no IMAP, no password)
// ─ All other accounts                  → IMAP basic-auth (existing path)
async function fetchUnreadEmails(accountId) {
  const accounts = getAccounts(false);
  
  if (accounts.length === 0) {
    console.warn('[EMAIL] No credentials configured. Loading cache/mock emails.');
    return { success: true, emails: loadLocalInbox(), source: 'Local Cache / Sandbox' };
  }

  const targets = accountId 
    ? accounts.filter(acc => acc.id === accountId)
    : accounts;

  if (targets.length === 0) {
    return { success: false, error: `Account with ID "${accountId}" not found.` };
  }

  let allEmails    = [];
  let successCount = 0;
  let errorMessages = [];
  let authNeeded   = [];

  for (const acc of targets) {
    // ── Path A: Gmail OAuth2 ─────────────────────────────────────────
    if (shouldUseOAuth2(acc)) {
      console.log(`[EMAIL] Account "${acc.name}" → using Gmail OAuth2 API`);
      const result = await gmailOAuth.fetchGmailOAuth(acc.id, acc.name);
      if (result.success) {
        allEmails = allEmails.concat(result.emails);
        successCount++;
        console.log(`[EMAIL-OAUTH2] ✅ ${result.emails.length} emails from "${acc.name}" (${result.source})`);
      } else if (result.needsAuth) {
        authNeeded.push(acc.name);
        console.warn(`[EMAIL-OAUTH2] ⚠️  "${acc.name}" needs re-authorization at /api/email/auth/gmail?accountId=${acc.id}`);
      } else {
        errorMessages.push(`${acc.name} (OAuth2): ${result.error}`);
        console.error(`[EMAIL-OAUTH2] ❌ "${acc.name}": ${result.error}`);
      }
      continue; // skip IMAP for this account
    }

    // ── Path B: IMAP basic-auth (non-Gmail accounts) ─────────────────
    const config = {
      imap: {
        user: acc.email,
        password: acc.password,
        host: acc.imapHost || 'imap.gmail.com',
        port: acc.imapPort || 993,
        tls: true,
        authTimeout: 5000,
        connTimeout: 8000,
        tlsOptions: { rejectUnauthorized: false }
      }
    };

    try {
      const connection = await imaps.connect(config);
      await connection.openBox('INBOX');
      
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      const messages = await connection.search(
        ['UNSEEN', ['SINCE', yesterday]],
        { bodies: [''], markSeen: false }
      );

      const parsedEmails = [];
      for (const item of messages) {
        const all = item.parts.find(p => p.which === '');
        if (all) {
          const parsed = await simpleParser(all.body);
          parsedEmails.push({
            id: `${acc.id}-${item.attributes.uid}`,
            accountId: acc.id,
            accountName: acc.name,
            from: parsed.from?.text || 'Unknown Sender',
            subject: parsed.subject || '(No Subject)',
            body: parsed.text || parsed.html?.replace(/<[^>]+>/g, '').substring(0, 500) || '(No Body Text)',
            date: parsed.date || new Date().toISOString(),
            unread: true
          });
        }
      }

      connection.end();
      allEmails = allEmails.concat(parsedEmails);
      successCount++;
      console.log(`[EMAIL-IMAP] ✅ ${parsedEmails.length} emails from "${acc.name}"`);
    } catch (err) {
      console.error(`[EMAIL IMAP FAILED] Account: ${acc.email} | Error:`, err.message);
      errorMessages.push(`${acc.name}: ${err.message}`);
    }
  }

  if (successCount > 0) {
    // Persist to local cache
    try { fs.writeFileSync(GMAIL_INBOX_PATH, JSON.stringify(allEmails, null, 2), 'utf8'); } catch (e) {}
    return {
      success: true,
      emails: allEmails,
      source: 'Live (OAuth2 + IMAP)',
      warnings: errorMessages.length > 0 ? errorMessages : undefined,
      authNeeded: authNeeded.length > 0 ? authNeeded : undefined
    };
  } else {
    // All paths failed → return local cache
    const fallback = loadLocalInbox();
    const msgs = [
      ...(errorMessages.length ? [`IMAP/OAuth errors: ${errorMessages.join('; ')}`] : []),
      ...(authNeeded.length   ? [`Need OAuth2 re-auth: ${authNeeded.join(', ')}`]    : [])
    ];
    return {
      success: true,
      emails: fallback,
      source: 'Local Cache (all connections failed)',
      warning: msgs.join(' | '),
      authNeeded: authNeeded.length > 0 ? authNeeded : undefined
    };
  }
}

// Send email via Nodemailer SMTP for a specific account
async function sendEmail({ accountId, to, subject, body }) {
  const accounts = getAccounts(false);
  
  if (accounts.length === 0) {
    return { success: false, error: 'No email accounts configured to send mail.' };
  }

  // Fallback to primary/first account if no accountId specified
  const acc = accountId 
    ? accounts.find(a => a.id === accountId)
    : accounts[0];

  if (!acc) {
    return { success: false, error: `Account ID "${accountId}" not found.` };
  }

  const transporterConfig = {
    host: acc.smtpHost || 'smtp.gmail.com',
    port: acc.smtpPort || 465,
    secure: acc.smtpPort === 465,
    auth: {
      user: acc.email,
      pass: acc.password
    }
  };

  const transporter = nodemailer.createTransport(transporterConfig);

  try {
    const info = await transporter.sendMail({
      from: `"${acc.name}" <${acc.email}>`,
      to,
      subject,
      text: body
    });

    console.log(`[EMAIL SMTP SENT] From: ${acc.email} | MsgId: ${info.messageId}`);
    return { success: true, sent: true, messageId: info.messageId, source: `${acc.name} SMTP Server` };
  } catch (err) {
    console.error(`[EMAIL SMTP FAILED] From: ${acc.email} | Error:`, err.message);
    const composeUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    
    // On local Windows hosts, trigger fallback browser composition
    try {
      const { exec } = require('child_process');
      exec(`start "" "${composeUrl}"`);
    } catch (e) {}

    return { 
      success: true, 
      sent: false,
      composeUrl,
      source: 'Browser Fallback (SMTP Error)',
      warning: `SMTP failed for ${acc.email}: ${err.message}. Opened browser composer instead.` 
    };
  }
}

module.exports = {
  description: "Unified multiple-account Email client. Gmail accounts use OAuth2 via Gmail REST API; other providers fall back to IMAP.",

  parameters: {
    action:    { type: 'string', description: "'fetch' | 'send' | 'listAccounts' | 'createAccount' | 'deleteAccount'" },
    accountId: { type: 'string', description: 'Target email account configuration ID' },
    to:        { type: 'string', description: 'Recipient email (send action)' },
    subject:   { type: 'string', description: 'Email subject (send action)' },
    body:      { type: 'string', description: 'Email text body (send action)' }
  },

  // Named exports consumed by server.js and gmail-oauth routes
  getAccounts,
  createAccount,
  deleteAccount,
  fetchUnreadEmails,
  sendEmail,
  shouldUseOAuth2,
  gmailOAuth,       // expose the oauth module for route handlers

  async execute({ action = 'fetch', accountId, to, subject, body }) {
    if (action === 'fetch') {
      return await fetchUnreadEmails(accountId);
    } else if (action === 'send') {
      if (!to || !subject || !body)
        return { success: false, error: 'Recipient (to), subject, and body are required.' };
      return await sendEmail({ accountId, to, subject, body });
    } else if (action === 'listAccounts') {
      const accounts = getAccounts(true).map(acc => ({
        ...acc,
        oauthLinked: gmailOAuth.hasToken(acc.id),
        needsOAuth:  acc.provider === 'gmail' && !gmailOAuth.hasToken(acc.id)
      }));
      return { success: true, accounts };
    } else {
      return { success: false, error: `Unknown action "${action}".` };
    }
  }
};
