const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

const CALENDAR_DB_PATH = path.join(__dirname, 'calendar_events.json');

// Helper to load local database events
function loadLocalEvents() {
  try {
    if (fs.existsSync(CALENDAR_DB_PATH)) {
      return JSON.parse(fs.readFileSync(CALENDAR_DB_PATH, 'utf8'));
    }
  } catch (e) {
    console.error('Failed to read local calendar database:', e.message);
  }
  return [];
}

// Helper to save local database events
function saveLocalEvents(events) {
  try {
    fs.writeFileSync(CALENDAR_DB_PATH, JSON.stringify(events, null, 2), 'utf8');
  } catch (e) {
    console.error('Failed to save to local calendar database:', e.message);
  }
}

// Generate random mock Google Meet link
function generateMeetLink() {
  const chars = 'abcdefghijklmnopqrstuvwxyz';
  const part1 = Array(3).fill(0).map(() => chars[Math.floor(Math.random() * 26)]).join('');
  const part2 = Array(4).fill(0).map(() => chars[Math.floor(Math.random() * 26)]).join('');
  const part3 = Array(3).fill(0).map(() => chars[Math.floor(Math.random() * 26)]).join('');
  return `https://meet.google.com/${part1}-${part2}-${part3}`;
}

// Connect to Google Calendar API
function getGoogleCalendarClient() {
  const saJsonStr = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!saJsonStr) return null;

  try {
    const credentials = JSON.parse(saJsonStr);
    const auth = new google.auth.JWT(
      credentials.client_email,
      null,
      credentials.private_key,
      ['https://www.googleapis.com/auth/calendar']
    );
    return google.calendar({ version: 'v3', auth });
  } catch (err) {
    console.error('[CALENDAR] Google API auth initialization failed:', err.message);
    return null;
  }
}

// Action: Fetch events
async function listEvents() {
  const calendar = getGoogleCalendarClient();
  const calendarId = process.env.GOOGLE_CALENDAR_ID || 'primary';

  if (!calendar) {
    console.warn('[CALENDAR] Google credentials not found. Loading local calendar database.');
    return { success: true, events: loadLocalEvents(), source: 'Local Event DB' };
  }

  try {
    const res = await calendar.events.list({
      calendarId: calendarId,
      timeMin: new Date().toISOString(),
      maxResults: 15,
      singleEvents: true,
      orderBy: 'startTime',
    });

    const googleEvents = (res.data.items || []).map(item => {
      // Find meet link if available
      let meetLink = '';
      if (item.conferenceData?.entryPoints) {
        const meetEP = item.conferenceData.entryPoints.find(ep => ep.entryPointType === 'video');
        if (meetEP) meetLink = meetEP.uri;
      }
      if (!meetLink && item.hangoutLink) meetLink = item.hangoutLink;

      return {
        id: item.id,
        title: item.summary || '(No Title)',
        start: item.start?.dateTime || item.start?.date,
        end: item.end?.dateTime || item.end?.date,
        attendees: (item.attendees || []).map(a => a.email),
        meetLink: meetLink || '',
        description: item.description || ''
      };
    });

    // Save to local cache database for quick retrieval
    saveLocalEvents(googleEvents);

    return { success: true, events: googleEvents, source: 'Google Calendar API' };
  } catch (err) {
    console.error('[GOOGLE CALENDAR LIST FAILED]', err.message);
    return { 
      success: true, 
      events: loadLocalEvents(), 
      source: 'Local Cache (API Call Failed)', 
      warning: `Google API error: ${err.message}. Reverted to local storage.` 
    };
  }
}

// Action: Add event
async function addEvent({ title, start, end, attendees = [], description = '' }) {
  const calendar = getGoogleCalendarClient();
  const calendarId = process.env.GOOGLE_CALENDAR_ID || 'primary';
  const meetLink = generateMeetLink();

  const eventData = {
    title: title,
    start: start,
    end: end,
    attendees: attendees,
    meetLink: meetLink,
    description: description
  };

  if (!calendar) {
    console.log('[CALENDAR] Adding event to local calendar database.');
    const localEvents = loadLocalEvents();
    const newEvent = {
      id: 'evt-' + Date.now(),
      ...eventData
    };
    localEvents.push(newEvent);
    // Sort local events by start date
    localEvents.sort((a, b) => new Date(a.start) - new Date(b.start));
    saveLocalEvents(localEvents);
    return { success: true, event: newEvent, source: 'Local Event DB (Added)' };
  }

  try {
    const resource = {
      summary: title,
      description: description,
      start: { dateTime: start },
      end: { dateTime: end },
      attendees: attendees.map(email => ({ email })),
      conferenceData: {
        createRequest: {
          requestId: 'meet-' + Date.now(),
          conferenceSolutionKey: { type: 'hangoutsMeet' }
        }
      }
    };

    const res = await calendar.events.insert({
      calendarId: calendarId,
      conferenceDataVersion: 1,
      requestBody: resource
    });

    const item = res.data;
    let actualMeetLink = item.hangoutLink || item.conferenceData?.entryPoints?.find(ep => ep.entryPointType === 'video')?.uri || meetLink;

    const addedEvent = {
      id: item.id,
      title: item.summary,
      start: item.start?.dateTime || item.start?.date,
      end: item.end?.dateTime || item.end?.date,
      attendees: (item.attendees || []).map(a => a.email),
      meetLink: actualMeetLink,
      description: item.description || ''
    };

    // Reload all live events to sync local database
    await listEvents();

    return { success: true, event: addedEvent, source: 'Google Calendar API (Added)' };
  } catch (err) {
    console.error('[GOOGLE CALENDAR INSERT FAILED]', err.message);
    // Fall back to writing locally
    const localEvents = loadLocalEvents();
    const newEvent = {
      id: 'evt-fail-' + Date.now(),
      ...eventData
    };
    localEvents.push(newEvent);
    localEvents.sort((a, b) => new Date(a.start) - new Date(b.start));
    saveLocalEvents(localEvents);

    return { 
      success: true, 
      event: newEvent, 
      source: 'Local Cache (API Insert Failed)', 
      warning: `Insert API error: ${err.message}. Saved to local DB instead.` 
    };
  }
}

module.exports = {
  description: "Calendar sync & event scheduler skill. Connects to Google Calendar API (via Service Account credentials) or falls back to local JSON events database.",
  
  parameters: {
    action: { type: "string", description: "Action: 'list' or 'add'" },
    title: { type: "string", description: "Event/meeting title" },
    start: { type: "string", description: "Start time ISO string (e.g. 2026-06-13T14:00:00Z)" },
    end: { type: "string", description: "End time ISO string" },
    attendees: { type: "array", description: "List of attendee emails" },
    description: { type: "string", description: "Meeting description" }
  },

  async execute({ action = 'list', title, start, end, attendees, description }) {
    if (action === 'list') {
      return await listEvents();
    } else if (action === 'add') {
      if (!title || !start || !end) {
        return { success: false, error: 'Title, start time, and end time are required to schedule an event.' };
      }
      return await addEvent({ title, start, end, attendees, description });
    } else {
      return { success: false, error: `Invalid action "${action}". Supported actions: 'list', 'add'` };
    }
  }
};
