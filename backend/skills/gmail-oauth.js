/**
 * gmail-oauth.js — Gmail OAuth2 client for F.R.I.D.A.Y.
 *
 * Flow:
 *  1. Admin calls GET /api/email/auth/gmail?accountId=<id>  → returns a Google consent URL
 *  2. User opens the URL, grants access, is redirected to the callback
 *  3. Callback POST /api/email/auth/gmail/callback exchanges the code → stores tokens
 *  4. fetchGmailOAuth(accountId) now works without any further user action
 *
 * Token storage: backend/skills/gmail_tokens/<accountId>.json
 * Credentials:   backend/skills/gmail_oauth_credentials.json  (Google Cloud OAuth2 Client)
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const { google } = require('googleapis');

const CREDENTIALS_PATH = path.join(__dirname, 'gmail_oauth_credentials.json');
const TOKENS_DIR       = path.join(__dirname, 'gmail_tokens');
const SCOPES           = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
];

// ── Credentials management ──────────────────────────────────────────────────

function loadCredentials() {
  if (!fs.existsSync(CREDENTIALS_PATH)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
    // Google Cloud Console produces {web:{...}} or {installed:{...}}
    return raw.web || raw.installed || null;
  } catch (e) {
    console.error('[GMAIL-OAUTH] Failed to load credentials:', e.message);
    return null;
  }
}

function saveCredentials(creds) {
  fs.writeFileSync(CREDENTIALS_PATH, JSON.stringify({ web: creds }, null, 2), 'utf8');
}

// ── Token management ────────────────────────────────────────────────────────

function tokenPath(accountId) {
  if (!fs.existsSync(TOKENS_DIR)) fs.mkdirSync(TOKENS_DIR, { recursive: true });
  return path.join(TOKENS_DIR, `${accountId}.json`);
}

function loadToken(accountId) {
  const p = tokenPath(accountId);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    return null;
  }
}

function saveToken(accountId, token) {
  fs.writeFileSync(tokenPath(accountId), JSON.stringify(token, null, 2), 'utf8');
}

function hasToken(accountId) {
  const t = loadToken(accountId);
  return !!(t && (t.refresh_token || t.access_token));
}

// ── OAuth2 client factory ────────────────────────────────────────────────────

function makeClient(creds, redirectUri) {
  return new google.auth.OAuth2(
    creds.client_id,
    creds.client_secret,
    redirectUri || creds.redirect_uris?.[0] || 'http://localhost:5000/api/email/auth/gmail/callback'
  );
}

/**
 * Build an authorized OAuth2 client for an account.
 * Automatically refreshes access tokens when expired.
 * Returns null if no token is stored yet.
 */
async function getAuthorizedClient(accountId) {
  const creds = loadCredentials();
  if (!creds) return null;

  const token = loadToken(accountId);
  if (!token) return null;

  const oauth2Client = makeClient(creds);
  oauth2Client.setCredentials(token);

  // Persist new tokens if googleapis auto-refreshes them
  oauth2Client.on('tokens', (newTokens) => {
    const merged = { ...token, ...newTokens };
    saveToken(accountId, merged);
  });

  return oauth2Client;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Generate a Google OAuth2 consent URL for an account.
 * The user must open this URL in a browser and grant access.
 */
function getAuthUrl(accountId, redirectUri) {
  const creds = loadCredentials();
  if (!creds) {
    return { success: false, error: 'gmail_oauth_credentials.json not found. Please add your Google OAuth2 client credentials file.' };
  }
  const oauth2Client = makeClient(creds, redirectUri);
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',          // force refresh_token on every consent
    scope: SCOPES,
    state: accountId,           // carry accountId through the redirect
  });
  return { success: true, url, accountId };
}

/**
 * Exchange an authorization code (from the consent redirect) for tokens.
 * Stores refresh_token locally so future calls work without user interaction.
 */
async function exchangeCode(code, accountId, redirectUri) {
  const creds = loadCredentials();
  if (!creds) return { success: false, error: 'Gmail OAuth credentials not configured.' };

  const oauth2Client = makeClient(creds, redirectUri);
  try {
    const { tokens } = await oauth2Client.getToken(code);
    saveToken(accountId, tokens);
    console.log(`[GMAIL-OAUTH] ✅ Tokens saved for account "${accountId}"`);
    return { success: true, message: `Gmail OAuth2 authorized for account "${accountId}". Emails will now be fetched live.` };
  } catch (e) {
    console.error('[GMAIL-OAUTH] Token exchange failed:', e.message);
    return { success: false, error: `Token exchange failed: ${e.message}` };
  }
}

/**
 * Fetch unread emails from the last 24h for an OAuth2 account using the Gmail REST API.
 * Returns an array of normalized email objects (same schema as the IMAP path).
 */
async function fetchGmailOAuth(accountId, accountName, maxResults = 20) {
  const oauth2Client = await getAuthorizedClient(accountId);
  if (!oauth2Client) {
    return {
      success: false,
      error: `No OAuth2 token for account "${accountId}". Visit /api/email/auth/gmail?accountId=${accountId} to authorize.`,
      needsAuth: true
    };
  }

  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  // Build a query: unread messages from the last 24h
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const afterEpoch = Math.floor(since.getTime() / 1000);
  const q = `is:unread after:${afterEpoch}`;

  try {
    const listRes = await gmail.users.messages.list({
      userId: 'me',
      q,
      maxResults,
    });

    const messages = listRes.data.messages || [];
    if (messages.length === 0) {
      return { success: true, emails: [], source: 'Gmail API (no unread in last 24h)' };
    }

    const emails = [];
    for (const { id } of messages) {
      try {
        const msgRes = await gmail.users.messages.get({
          userId: 'me',
          id,
          format: 'full',
        });
        const msg = msgRes.data;
        const headers = msg.payload?.headers || [];
        const get = (name) => headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';

        // Extract body: prefer text/plain, fallback to text/html stripped
        let body = '';
        function extractBody(part) {
          if (!part) return;
          if (part.mimeType === 'text/plain' && part.body?.data) {
            body = Buffer.from(part.body.data, 'base64').toString('utf8').substring(0, 600);
          } else if (part.mimeType === 'text/html' && !body && part.body?.data) {
            body = Buffer.from(part.body.data, 'base64').toString('utf8')
              .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 600);
          } else if (part.parts) {
            part.parts.forEach(extractBody);
          }
        }
        extractBody(msg.payload);

        // Fallback: snippet
        if (!body && msg.snippet) body = msg.snippet;

        emails.push({
          id: `${accountId}-${id}`,
          accountId,
          accountName: accountName || 'Gmail',
          from: get('From'),
          subject: get('Subject') || '(No Subject)',
          body: body || '(No body content)',
          date: get('Date') || new Date().toISOString(),
          unread: true,
          gmailId: id,
        });
      } catch (msgErr) {
        console.warn(`[GMAIL-OAUTH] Failed to fetch message ${id}:`, msgErr.message);
      }
    }

    console.log(`[GMAIL-OAUTH] ✅ Fetched ${emails.length} unread emails for "${accountId}"`);
    return { success: true, emails, source: 'Gmail API (OAuth2 Live)' };

  } catch (e) {
    console.error(`[GMAIL-OAUTH] fetch failed for "${accountId}":`, e.message);

    // If it's a 401, the token is revoked — clear it so the UI shows the re-auth link
    if (e.status === 401 || e.code === 401) {
      const p = tokenPath(accountId);
      if (fs.existsSync(p)) fs.unlinkSync(p);
      return { success: false, error: 'Gmail token revoked. Re-authorization required.', needsAuth: true };
    }

    return { success: false, error: e.message };
  }
}

module.exports = {
  hasToken,
  getAuthUrl,
  exchangeCode,
  fetchGmailOAuth,
  loadCredentials,
  saveCredentials,
};
