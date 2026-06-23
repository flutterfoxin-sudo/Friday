import React, { useState, useEffect, useRef } from 'react';
import './OfficeHUD.css';
import { BACKEND_URL } from '../config';

export default function OfficeHUD() {
  const [isMinimized, setIsMinimized] = useState(true);
  const [activeTab, setActiveTab] = useState('schedule'); // email, schedule, comms, phone
  const [events, setEvents] = useState([]);
  const [chats, setChats] = useState([]);
  const [calls, setCalls] = useState([]);
  
  // Multi-WhatsApp states
  const [waAccounts, setWaAccounts] = useState([]);
  const [selectedAccId, setSelectedAccId] = useState('friday-session');
  const [waStatus, setWaStatus] = useState({ ready: false, qr: null });
  const [showAddAccount, setShowAddAccount] = useState(false);
  const [newAccountName, setNewAccountName] = useState('');
  const qrPollRef = useRef(null);

  // Multi-Email states
  const [emailAccounts, setEmailAccounts] = useState([]);
  const [selectedEmailAccId, setSelectedEmailAccId] = useState('');
  const [emails, setEmails] = useState([]);
  const [showAddEmailAccount, setShowAddEmailAccount] = useState(false);
  const [newEmailAccName, setNewEmailAccName] = useState('');
  const [newEmailAccEmail, setNewEmailAccEmail] = useState('');
  const [newEmailAccPassword, setNewEmailAccPassword] = useState('');
  const [newEmailAccProvider, setNewEmailAccProvider] = useState('gmail');
  const [newEmailAccImapHost, setNewEmailAccImapHost] = useState('');
  const [newEmailAccImapPort, setNewEmailAccImapPort] = useState('993');
  const [newEmailAccSmtpHost, setNewEmailAccSmtpHost] = useState('');
  const [newEmailAccSmtpPort, setNewEmailAccSmtpPort] = useState('465');

  // Compose Email states
  const [emailTo, setEmailTo] = useState('');
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [interceptNumber, setInterceptNumber] = useState('');
  const [newInterceptNumber, setNewInterceptNumber] = useState('');

  // Form states
  const [meetTitle, setMeetTitle] = useState('');
  const [meetStart, setMeetStart] = useState('');
  const [meetAttendee, setMeetAttendee] = useState('');
  const [waRecipient, setWaRecipient] = useState('');
  const [waMessage, setWaMessage] = useState('');

  // Voice Intercom State
  const [isIntercomActive, setIsIntercomActive] = useState(false);
  const [intercomStatus, setIntercomStatus] = useState('');
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);

  const backendUrl = BACKEND_URL;

  // Listen for global HUD trigger events for smooth popups and briefings
  useEffect(() => {
    const handleMaximize = (e) => {
      if (e.detail.name === 'office') {
        setIsMinimized(false);
      }
    };
    const handleMinimize = (e) => {
      if (e.detail.name === 'office') {
        setIsMinimized(true);
      }
    };
    const handleSetTab = (e) => {
      setActiveTab(e.detail.tab);
    };

    window.addEventListener('friday-hud-maximize', handleMaximize);
    window.addEventListener('friday-hud-minimize', handleMinimize);
    window.addEventListener('friday-office-tab', handleSetTab);

    return () => {
      window.removeEventListener('friday-hud-maximize', handleMaximize);
      window.removeEventListener('friday-hud-minimize', handleMinimize);
      window.removeEventListener('friday-office-tab', handleSetTab);
    };
  }, []);

  // Fetch email list when selected email account changes
  useEffect(() => {
    if (selectedEmailAccId) {
      fetchEmails(selectedEmailAccId);
    }
  }, [selectedEmailAccId]);

  // Load status and data
  useEffect(() => {
    window.FRIDAY_OFFICE_ACTIVE = true;
    fetchStatus();
    fetchCalendar();
    fetchCalls();
    fetchWhatsAppChats(selectedAccId);
    fetchEmailAccounts();
    fetchTelephonyConfig();

    const interval = setInterval(() => {
      fetchStatus();
      fetchWhatsAppChats(selectedAccId);
      fetchTelephonyConfig();
      if (selectedEmailAccId) {
        fetchEmails(selectedEmailAccId);
      }
    }, 10000);

    return () => {
      clearInterval(interval);
      if (qrPollRef.current) clearInterval(qrPollRef.current);
      delete window.FRIDAY_OFFICE_ACTIVE;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAccId, selectedEmailAccId]);

  const fetchStatus = async () => {
    try {
      const res = await fetch(`${backendUrl}/api/whatsapp/status`);
      const data = await res.json();
      if (data.success) {
        setWaAccounts(data.accounts || []);
        // Find state of selected account
        const current = (data.accounts || []).find(acc => acc.id === selectedAccId);
        setWaStatus({
          ready: current ? current.ready : false,
          qr: current ? current.qr : null,
          authenticating: current ? current.authenticating : false,
          loadingPercent: current ? current.loadingPercent : null,
          loadingMessage: current ? current.loadingMessage : null,
          initStartedAt: current ? current.initStartedAt : null,
          awaitingQR: current ? (current.awaitingQR || false) : false,
          sessionExists: current ? (current.sessionExists !== false) : true
        });

        // Fast polling fallback during authenticating or client initialization phase
        if (current && (current.authenticating || (!current.ready && !current.qr))) {
          setTimeout(fetchStatus, 3000);
        }
      }
    } catch (e) {}
  };

  const fetchCalendar = async () => {
    try {
      const res = await fetch(`${backendUrl}/api/calendar`);
      const data = await res.json();
      if (data.success) {
        setEvents(data.events || []);
      }
    } catch (e) {}
  };

  const fetchWhatsAppChats = async (accountId = selectedAccId) => {
    try {
      const res = await fetch(`${backendUrl}/api/whatsapp/chats?accountId=${accountId}`);
      const data = await res.json();
      if (data.success) {
        setChats(data.chats || []);
      }
    } catch (e) {}
  };

  const fetchCalls = async () => {
    try {
      const res = await fetch(`${backendUrl}/api/calls/logs`);
      const data = await res.json();
      if (data.success) {
        setCalls(data.logs || []);
      }
    } catch (e) {}
  };

  const fetchEmailAccounts = async () => {
    try {
      const res = await fetch(`${backendUrl}/api/email/accounts`);
      const data = await res.json();
      if (data.success && data.accounts) {
        setEmailAccounts(data.accounts);
        if (data.accounts.length > 0 && !selectedEmailAccId) {
          setSelectedEmailAccId(data.accounts[0].id);
        }
      }
    } catch (e) {}
  };

  const fetchEmails = async (accountId) => {
    try {
      const res = await fetch(`${backendUrl}/api/email/emails?accountId=${accountId}`);
      const data = await res.json();
      if (data.success) {
        setEmails(data.emails || []);
      }
    } catch (e) {}
  };

  const fetchTelephonyConfig = async () => {
    try {
      const res = await fetch(`${backendUrl}/api/telephony/config`);
      const data = await res.json();
      if (data.success && data.config) {
        setInterceptNumber(data.config.interceptNumber || '');
        setNewInterceptNumber(data.config.interceptNumber || '');
      }
    } catch (e) {}
  };

  const handleSetInterceptNumber = async (e) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg('');
    try {
      const res = await fetch(`${backendUrl}/api/telephony/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ interceptNumber: newInterceptNumber })
      });
      const data = await res.json();
      if (data.success && data.config) {
        setInterceptNumber(data.config.interceptNumber || '');
        alert('Telephony intercept number successfully configured!');
      } else {
        setErrorMsg(data.error || 'Failed to update telephony config.');
      }
    } catch (err) {
      setErrorMsg('Failed to update telephony config.');
    } finally {
      setLoading(false);
    }
  };

  const handleSync = async () => {
    setLoading(true);
    setErrorMsg('');
    try {
      await fetch(`${backendUrl}/api/calendar/sync`, { method: 'POST' });
      await fetchCalendar();
      await fetchCalls();
      await fetchWhatsAppChats(selectedAccId);
      if (selectedEmailAccId) {
        await fetchEmails(selectedEmailAccId);
      }
    } catch (err) {
      setErrorMsg('Sync request failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleAddMeeting = async (e) => {
    e.preventDefault();
    if (!meetTitle || !meetStart) return;
    setLoading(true);
    
    // Set duration: default to 30 mins later
    const startDate = new Date(meetStart);
    const endDate = new Date(startDate.getTime() + 30 * 60 * 1000);

    try {
      const payload = {
        title: meetTitle,
        start: startDate.toISOString(),
        end: endDate.toISOString(),
        attendees: meetAttendee ? [meetAttendee] : [],
        description: 'Meeting generated automatically by F.R.I.D.A.Y. Assistant.'
      };

      const res = await fetch(`${backendUrl}/api/calendar/add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.success) {
        setMeetTitle('');
        setMeetStart('');
        setMeetAttendee('');
        fetchCalendar();
        
        // If attendee listed, auto compose an email invite
        if (meetAttendee) {
          const emailBody = `Hi, Vansh sir has scheduled a Google Meet with you.\n\nMeeting: ${meetTitle}\nTime: ${meetStart}\nJoin Link: ${data.event.meetLink}\n\nF.R.I.D.A.Y. Personal Assistant`;
          await fetch(`${backendUrl}/api/email/send`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ accountId: selectedEmailAccId, to: meetAttendee, subject: `Invitation: ${meetTitle}`, body: emailBody })
          });
        }
      }
    } catch (err) {
      setErrorMsg('Failed to schedule meeting.');
    } finally {
      setLoading(false);
    }
  };

  const handleSendWhatsApp = async (e) => {
    e.preventDefault();
    if (!waRecipient || !waMessage) return;
    setLoading(true);
    try {
      const res = await fetch(`${backendUrl}/api/whatsapp/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: waRecipient, message: waMessage, accountId: selectedAccId })
      });
      const data = await res.json();
      if (data.success) {
        setWaMessage('');
        fetchWhatsAppChats(selectedAccId);
      }
    } catch (err) {
      setErrorMsg('Failed to send WhatsApp message.');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateEmailAccount = async (e) => {
    e.preventDefault();
    if (!newEmailAccEmail || !newEmailAccPassword) return;
    setLoading(true);
    setErrorMsg('');
    try {
      const payload = {
        name: newEmailAccName || 'Custom Mail',
        email: newEmailAccEmail,
        password: newEmailAccPassword,
        provider: newEmailAccProvider,
        imapHost: newEmailAccImapHost,
        imapPort: parseInt(newEmailAccImapPort) || 993,
        smtpHost: newEmailAccSmtpHost,
        smtpPort: parseInt(newEmailAccSmtpPort) || 465
      };
      const res = await fetch(`${backendUrl}/api/email/accounts/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.success) {
        setNewEmailAccName('');
        setNewEmailAccEmail('');
        setNewEmailAccPassword('');
        setNewEmailAccImapHost('');
        setNewEmailAccSmtpHost('');
        setShowAddEmailAccount(false);
        fetchEmailAccounts();
        if (data.account) {
          setSelectedEmailAccId(data.account.id);
        }
      } else {
        setErrorMsg(data.error || 'Failed to link email account.');
      }
    } catch (err) {
      setErrorMsg('Failed to link email account.');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteEmailAccount = async (accId) => {
    if (accId === 'primary') return;
    if (!window.confirm('Are you sure you want to disconnect this email account?')) return;
    setLoading(true);
    setErrorMsg('');
    try {
      const res = await fetch(`${backendUrl}/api/email/accounts/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: accId })
      });
      const data = await res.json();
      if (data.success) {
        setSelectedEmailAccId('primary');
        fetchEmailAccounts();
      } else {
        setErrorMsg(data.error || 'Failed to delete email account.');
      }
    } catch (err) {
      setErrorMsg('Failed to delete email account.');
    } finally {
      setLoading(false);
    }
  };

  const handleSendEmail = async (e) => {
    e.preventDefault();
    if (!emailTo || !emailSubject || !emailBody) return;
    setLoading(true);
    setErrorMsg('');
    try {
      const res = await fetch(`${backendUrl}/api/email/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId: selectedEmailAccId,
          to: emailTo,
          subject: emailSubject,
          body: emailBody
        })
      });
      const data = await res.json();
      if (data.success) {
        setEmailTo('');
        setEmailSubject('');
        setEmailBody('');
        alert(data.sent ? 'Email transmission sent successfully!' : data.warning || 'Email compose fallback opened.');
      } else {
        setErrorMsg(data.error || 'Failed to send email.');
      }
    } catch (err) {
      setErrorMsg('Failed to send email.');
    } finally {
      setLoading(false);
    }
  };

  // Add WhatsApp Account
  const handleCreateAccount = async (e) => {
    e.preventDefault();
    if (!newAccountName.trim()) return;
    setLoading(true);
    setErrorMsg('');
    try {
      const res = await fetch(`${backendUrl}/api/whatsapp/accounts/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newAccountName.trim() })
      });
      const data = await res.json();
      if (data.success) {
        setNewAccountName('');
        setShowAddAccount(false);
        setSelectedAccId(data.account.id);
        // Start rapid polling (every 2s) to catch QR as soon as Puppeteer generates it
        if (qrPollRef.current) clearInterval(qrPollRef.current);
        qrPollRef.current = setInterval(() => {
          fetchStatus();
        }, 2000);
        // Safety: stop rapid polling after 2 minutes regardless
        setTimeout(() => {
          if (qrPollRef.current) {
            clearInterval(qrPollRef.current);
            qrPollRef.current = null;
          }
        }, 120000);
        fetchStatus();
      } else {
        setErrorMsg(data.error || 'Failed to create account.');
      }
    } catch (err) {
      setErrorMsg('Failed to create account.');
    } finally {
      setLoading(false);
    }
  };

  // Delete WhatsApp Account
  const handleDeleteAccount = async (accountId) => {
    if (accountId === 'friday-session') return;
    if (!window.confirm('Are you sure you want to disconnect and delete this account?')) return;
    setLoading(true);
    setErrorMsg('');
    try {
      const res = await fetch(`${backendUrl}/api/whatsapp/accounts/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: accountId })
      });
      const data = await res.json();
      if (data.success) {
        setSelectedAccId('friday-session');
        fetchStatus();
      } else {
        setErrorMsg(data.error || 'Failed to delete account.');
      }
    } catch (err) {
      setErrorMsg('Failed to delete account.');
    } finally {
      setLoading(false);
    }
  };

  // WebRTC/Voice Intercom simulation
  const startIntercom = async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert('Microphone recording not supported in this browser.');
      return;
    }
    setIsIntercomActive(true);
    setIntercomStatus('DIALING F.R.I.D.A.Y...');
    
    // Play assistant voice prompt vocally
    if (window.speechSynthesis) {
      const utterance = new SpeechSynthesisUtterance("Vansh sir is currently unavailable. I am his personal assistant, Friday. Please leave your message now.");
      utterance.onend = () => {
        startRecording();
      };
      window.speechSynthesis.speak(utterance);
    } else {
      startRecording();
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorderRef.current = new MediaRecorder(stream);
      audioChunksRef.current = [];

      mediaRecorderRef.current.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };

      mediaRecorderRef.current.onstop = async () => {
        setIntercomStatus('TRANSCRIBING...');
        
        // Simulating transcription and adding to call log
        setTimeout(async () => {
          try {
            const sampleMessages = [
              "Wants to discuss AI integration project roadmap.",
              "Asking to review terms on seed round draft.",
              "Need follow-up call regarding design system specifications."
            ];
            const randomMsg = sampleMessages[Math.floor(Math.random() * sampleMessages.length)];

            await fetch(`${backendUrl}/api/calls/log`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                source: 'Browser Intercom',
                caller: 'Guest Visitor',
                status: 'Message Recorded',
                transcript: `Caller spoke: "${randomMsg}"`
              })
            });
            fetchCalls();
          } catch (e) {}
          setIsIntercomActive(false);
        }, 1500);
      };

      mediaRecorderRef.current.start();
      setIntercomStatus('RECORDING MESSAGE...');
      
      // Auto stop after 5 seconds
      setTimeout(() => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
          mediaRecorderRef.current.stop();
          stream.getTracks().forEach(track => track.stop());
        }
      }, 5000);

    } catch (e) {
      setIsIntercomActive(false);
    }
  };

  return (
    <div className={`office-hud-terminal ${isMinimized ? 'minimized' : ''}`}>
      {/* Visual Sci-Fi Brackets */}
      <div className="office-bracket o-t-l" />
      <div className="office-bracket o-t-r" />
      <div className="office-bracket o-b-l" />
      <div className="office-bracket o-b-r" />

      {/* Header */}
      <div className="office-header" onClick={() => {
        const nextState = !isMinimized;
        setIsMinimized(nextState);
        if (nextState === false) {
          window.dispatchEvent(new CustomEvent('friday-hud-minimize', { detail: { name: 'trading' } }));
        }
      }}>
        <div className="office-indicator">
          <span className={`office-dot ${(waAccounts.some(acc => acc.ready) || emailAccounts.length > 0) ? 'ready' : 'offline'}`} />
          <span className="office-label">FRIDAY OFFICE MATRIX</span>
        </div>
        <div className="office-sec-label">
          {isMinimized ? '[EXPAND]' : '[COLLAPSE]'}
        </div>
      </div>

      {!isMinimized && (
        <div className="office-inner">
          {/* Tab Selector */}
          <div className="office-tabs">
            <button className={activeTab === 'email' ? 'active' : ''} onClick={() => setActiveTab('email')}>EMAIL</button>
            <button className={activeTab === 'schedule' ? 'active' : ''} onClick={() => setActiveTab('schedule')}>SCHEDULE</button>
            <button className={activeTab === 'comms' ? 'active' : ''} onClick={() => setActiveTab('comms')}>COMMS</button>
            <button className={activeTab === 'phone' ? 'active' : ''} onClick={() => setActiveTab('phone')}>TELEPHONY</button>
          </div>

          <div className="office-body">
            {errorMsg && <div className="office-error">{errorMsg}</div>}

            {/* TAB 0: EMAIL */}
            {activeTab === 'email' && (
              <div className="tab-content scrollable">
                {/* Horizontal Email Account Tabs */}
                <div className="email-accounts-tabs">
                  {emailAccounts.map(acc => (
                    <button 
                      key={acc.id}
                      type="button" 
                      className={`email-acc-tab ${selectedEmailAccId === acc.id ? 'active' : ''}`}
                      onClick={() => setSelectedEmailAccId(acc.id)}
                    >
                      {acc.name}
                      <span 
                        className="email-status-dot" 
                        style={{ background: acc.oauthLinked ? '#00ffcc' : (acc.needsOAuth ? '#ff9900' : '#00ffcc') }}
                        title={acc.needsOAuth ? 'Gmail not authorized — click to connect' : 'Connected'}
                      />
                    </button>
                  ))}
                  <button 
                    type="button" 
                    className={`email-acc-tab add-btn ${showAddEmailAccount ? 'active' : ''}`}
                    onClick={() => setShowAddEmailAccount(!showAddEmailAccount)}
                  >
                    + ADD
                  </button>
                </div>

                {/* Add Email Account Form */}
                {showAddEmailAccount && (
                  <form className="email-add-account-form" onSubmit={handleCreateEmailAccount}>
                    <div className="add-acc-inputs">
                      <input 
                        type="text" 
                        placeholder="Acc Name (e.g. Work)..." 
                        value={newEmailAccName}
                        onChange={(e) => setNewEmailAccName(e.target.value)}
                        required
                      />
                      <input 
                        type="email" 
                        placeholder="Email Address..." 
                        value={newEmailAccEmail}
                        onChange={(e) => setNewEmailAccEmail(e.target.value)}
                        required
                      />
                      <input 
                        type="password" 
                        placeholder="App Password..." 
                        value={newEmailAccPassword}
                        onChange={(e) => setNewEmailAccPassword(e.target.value)}
                        required
                      />
                      <select 
                        value={newEmailAccProvider}
                        onChange={(e) => setNewEmailAccProvider(e.target.value)}
                      >
                        <option value="gmail">Gmail</option>
                        <option value="custom">Custom IMAP/SMTP</option>
                      </select>
                    </div>

                    {newEmailAccProvider === 'custom' && (
                      <div className="add-acc-custom-settings">
                        <input type="text" placeholder="IMAP Host" value={newEmailAccImapHost} onChange={(e) => setNewEmailAccImapHost(e.target.value)} required />
                        <input type="text" placeholder="IMAP Port" value={newEmailAccImapPort} onChange={(e) => setNewEmailAccImapPort(e.target.value)} required />
                        <input type="text" placeholder="SMTP Host" value={newEmailAccSmtpHost} onChange={(e) => setNewEmailAccSmtpHost(e.target.value)} required />
                        <input type="text" placeholder="SMTP Port" value={newEmailAccSmtpPort} onChange={(e) => setNewEmailAccSmtpPort(e.target.value)} required />
                      </div>
                    )}

                    <button type="submit" disabled={loading}>LINK ACCOUNT</button>
                  </form>
                )}

                {/* Account Details & Email list */}
                {selectedEmailAccId && (
                  <div className="email-active-section">
                    {/* Header row */}
                    <div className="email-header-row">
                      {(() => {
                        const selAcc = emailAccounts.find(a => a.id === selectedEmailAccId);
                        return selAcc?.needsOAuth
                          ? <div className="section-title" style={{ color: '#ff9900' }}>⚠ GMAIL NOT AUTHORIZED</div>
                          : <div className="section-title">INBOX STATUS // CONNECTED</div>;
                      })()}
                      {selectedEmailAccId !== 'primary' && (
                        <button 
                          type="button" 
                          className="email-delete-acc-btn" 
                          onClick={() => handleDeleteEmailAccount(selectedEmailAccId)}
                        >
                          DISCONNECT
                        </button>
                      )}
                    </div>

                    {/* OAuth2 Setup Panel — shown when Gmail account needs authorization */}
                    {(() => {
                      const selAcc = emailAccounts.find(a => a.id === selectedEmailAccId);
                      if (!selAcc?.needsOAuth) return null;
                      return (
                        <div style={{
                          background: 'rgba(255,153,0,0.07)',
                          border: '1px solid rgba(255,153,0,0.3)',
                          borderRadius: '4px',
                          padding: '12px',
                          marginBottom: '8px',
                          textAlign: 'center'
                        }}>
                          <div style={{ fontSize: '9px', color: '#ff9900', fontWeight: 'bold', letterSpacing: '1px', marginBottom: '6px' }}>
                            GMAIL OAUTH2 AUTHORIZATION REQUIRED
                          </div>
                          <div style={{ fontSize: '8px', color: '#aaa', marginBottom: '10px', lineHeight: 1.5 }}>
                            Google blocked basic password auth in 2022.<br/>
                            Click below to authorize F.R.I.D.A.Y. via your Google Account.
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              // Step 1: Check if credentials file is present
                              fetch(`${backendUrl}/api/email/auth/gmail/url?accountId=${selectedEmailAccId}`)
                                .then(r => r.json())
                                .then(d => {
                                  if (d.success && d.url) {
                                    // Open Google consent URL in a new window
                                    window.open(d.url, '_blank', 'width=500,height=600');
                                  } else {
                                    // Credentials file missing — show instructions
                                    alert(
                                      'Gmail OAuth2 credentials not configured.\n\n' +
                                      'To set up:\n' +
                                      '1. Go to console.cloud.google.com\n' +
                                      '2. Create a project → Enable Gmail API\n' +
                                      '3. Create OAuth2 credentials (Web app type)\n' +
                                      '4. Download JSON → save as:\n' +
                                      '   backend/skills/gmail_oauth_credentials.json\n' +
                                      '5. Add redirect URI: http://localhost:5000/api/email/auth/gmail/callback\n' +
                                      '6. Restart F.R.I.D.A.Y. backend and click Connect again.'
                                    );
                                  }
                                })
                                .catch(() => alert('Backend unreachable. Is F.R.I.D.A.Y. running?'));
                            }}
                            style={{
                              background: 'linear-gradient(135deg, #ff9900, #ff6600)',
                              border: 'none',
                              borderRadius: '3px',
                              color: '#000',
                              fontWeight: 'bold',
                              fontSize: '8px',
                              letterSpacing: '1px',
                              padding: '6px 14px',
                              cursor: 'pointer',
                              textTransform: 'uppercase'
                            }}
                          >
                            🔗 CONNECT GMAIL ACCOUNT
                          </button>
                          <div style={{ fontSize: '7px', color: '#555', marginTop: '6px' }}>
                            Requires gmail_oauth_credentials.json in backend/skills/
                          </div>
                        </div>
                      );
                    })()}
                    <div className="email-list">
                      {emails.length === 0 ? (
                        <div className="no-data">No unread emails found in the last 24 hours.</div>
                      ) : (
                        emails.map((m, idx) => (
                          <div key={idx} className="email-item">
                            <div className="email-meta">
                              <span className="email-sender">{m.from.substring(0, 30)}</span>
                              <span className="email-date">
                                {new Date(m.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            </div>
                            <div className="email-subject">{m.subject}</div>
                            <div className="email-snippet">{m.body}</div>
                          </div>
                        ))
                      )}
                    </div>

                    {/* Compose Email inline form */}
                    <form className="email-compose-form" onSubmit={handleSendEmail}>
                      <div className="section-title" style={{ marginTop: '10px' }}>COMPOSE TRANSMISSION</div>
                      <input type="email" placeholder="Recipient To Address" value={emailTo} onChange={(e) => setEmailTo(e.target.value)} required />
                      <input type="text" placeholder="Subject Line" value={emailSubject} onChange={(e) => setEmailSubject(e.target.value)} required />
                      <textarea placeholder="Write secure message body..." value={emailBody} onChange={(e) => setEmailBody(e.target.value)} required />
                      <button type="submit" disabled={loading}>SEND TRANSMISSION</button>
                    </form>
                  </div>
                )}
              </div>
            )}

            {/* TAB 1: SCHEDULE */}
            {activeTab === 'schedule' && (
              <div className="tab-content scrollable">
                <div className="section-title">CALENDAR MATRIX</div>
                <div className="event-list">
                  {events.length === 0 ? (
                    <div className="no-data">No meetings scheduled.</div>
                  ) : (
                    events.map(evt => (
                      <div key={evt.id} className="event-item">
                        <div className="event-time">
                          {new Date(evt.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </div>
                        <div className="event-details">
                          <div className="event-title-text">{evt.title}</div>
                          {evt.meetLink && (
                            <a href={evt.meetLink} target="_blank" rel="noreferrer" className="meet-join-btn">
                              JOIN GOOGLE MEET
                            </a>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>

                <form className="add-meet-form" onSubmit={handleAddMeeting}>
                  <div className="section-title" style={{ marginTop: '10px' }}>SCHEDULE MEET</div>
                  <input type="text" placeholder="Title" value={meetTitle} onChange={(e) => setMeetTitle(e.target.value)} required />
                  <input type="datetime-local" value={meetStart} onChange={(e) => setMeetStart(e.target.value)} required />
                  <input type="email" placeholder="Invitee Email (optional)" value={meetAttendee} onChange={(e) => setMeetAttendee(e.target.value)} />
                  <button type="submit" disabled={loading}>CREATE INVITE & LINK</button>
                </form>
              </div>
            )}

            {/* TAB 2: COMMUNICATIONS */}
            {activeTab === 'comms' && (
              <div className="tab-content scrollable">
                {/* Dynamic Horizontal Accounts Tabs */}
                <div className="wa-accounts-tabs">
                  {waAccounts.map(acc => (
                    <button 
                      key={acc.id}
                      type="button" 
                      className={`wa-acc-tab ${selectedAccId === acc.id ? 'active' : ''}`}
                      onClick={() => setSelectedAccId(acc.id)}
                    >
                      {acc.name}
                      <span className={`wa-status-dot ${acc.ready ? 'ready' : 'offline'}`} />
                    </button>
                  ))}
                  <button 
                    type="button" 
                    className={`wa-acc-tab add-btn ${showAddAccount ? 'active' : ''}`}
                    onClick={() => setShowAddAccount(!showAddAccount)}
                  >
                    + ADD
                  </button>
                </div>

                {/* Add Account Inline Form */}
                {showAddAccount && (
                  <form className="wa-add-account-form" onSubmit={handleCreateAccount} style={{ marginBottom: '8px', display: 'flex', gap: '4px' }}>
                    <input 
                      type="text" 
                      placeholder="Account Name..." 
                      value={newAccountName}
                      onChange={(e) => setNewAccountName(e.target.value)}
                      required
                      style={{ flexGrow: 1, padding: '4px 6px', fontSize: '10px' }}
                    />
                    <button type="submit" disabled={loading} style={{ fontSize: '8px', padding: '4px 8px' }}>LINK</button>
                  </form>
                )}

                {!waStatus.ready ? (
                  <div className="wa-qr-portal">
                    {waStatus.authenticating ? (
                      <div className="wa-qr-loading wa-sync-portal">
                        <div className="qr-spinner sync-spinner" />
                        <div className="wa-sync-title" style={{ color: '#00ffcc', fontWeight: 'bold', letterSpacing: '1px', fontSize: '9px', marginTop: '6px' }}>
                          AUTHENTICATED // DEVICE SYNCING
                        </div>
                        <div className="wa-sync-progress" style={{ fontSize: '20px', color: '#00ffcc', fontWeight: 'bold', margin: '10px 0' }}>
                          {waStatus.loadingPercent !== null ? `${waStatus.loadingPercent}%` : 'CONNECTED'}
                        </div>
                        <div className="wa-sync-msg" style={{ fontSize: '8px', opacity: 0.7, maxWidth: '200px', margin: '0 auto', textAlign: 'center' }}>
                          {waStatus.loadingMessage || 'Syncing messages and contact data from phone...'}
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="wa-qr-title">SCAN WHATSAPP QR PORTAL</div>
                        {waStatus.qr ? (
                          <div className="qr-container">
                            <img src={waStatus.qr} alt="Scan QR code" className="qr-image" />
                          </div>
                        ) : (
                          <div className="wa-qr-loading">
                            <div className="qr-spinner" />
                            {waStatus.awaitingQR
                              ? <><span style={{ color: '#00ffcc', fontWeight: 'bold', fontSize: '9px', letterSpacing: '1px' }}>AWAITING QR SCAN</span><br/></>                              
                              : <>Resuming session{waStatus.initStartedAt ? ` (${Math.round((Date.now() - waStatus.initStartedAt) / 1000)}s)` : ''}...</>}
                            <div style={{ fontSize: '7px', marginTop: '4px', opacity: 0.5 }}>
                              {waStatus.awaitingQR
                                ? 'Open WhatsApp → Linked Devices → Link a Device to generate QR'
                                : 'Reconnecting to saved session — QR will only appear if re-auth is needed'}
                            </div>
                          </div>
                        )}
                        <div className="wa-qr-instructions">Go to WhatsApp Settings &gt; Linked Devices to sync F.R.I.D.A.Y.</div>
                        
                        {selectedAccId !== 'friday-session' && (
                          <button 
                            type="button"
                            className="wa-delete-acc-btn" 
                            onClick={() => handleDeleteAccount(selectedAccId)}
                            style={{ marginTop: '8px', padding: '4px 8px', fontSize: '8px', color: '#ff4444', border: '1px solid rgba(255, 68, 68, 0.4)', borderRadius: '3px', background: 'none', cursor: 'pointer' }}
                          >
                            REMOVE ACCOUNT
                          </button>
                        )}
                      </>
                    )}
                  </div>
                ) : (
                  <div className="wa-chats-active">
                    <div className="wa-header-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                      <div className="section-title">WHATSAPP SYNC</div>
                      {selectedAccId !== 'friday-session' && (
                        <button 
                          type="button" 
                          className="wa-delete-acc-btn" 
                          onClick={() => handleDeleteAccount(selectedAccId)}
                          style={{ color: '#ff4444', border: '1px solid rgba(255, 68, 68, 0.4)', background: 'none', borderRadius: '3px', fontSize: '7px', padding: '2px 6px', cursor: 'pointer' }}
                        >
                          REMOVE
                        </button>
                      )}
                    </div>
                    <div className="chats-list">
                      {chats.length === 0 ? (
                        <div className="no-data">No active chats found.</div>
                      ) : (
                        chats.map((c, idx) => (
                          <div key={idx} className="chat-item" onClick={() => setWaRecipient(c.number)}>
                            <div className="chat-name">
                              {c.contact} {c.unreadCount > 0 && <span className="chat-badge">{c.unreadCount}</span>}
                            </div>
                            <div className="chat-last-msg">
                              {c.chat[c.chat.length - 1]?.text || 'No messages'}
                            </div>
                          </div>
                        ))
                      )}
                    </div>

                    <form className="whatsapp-quick-reply" onSubmit={handleSendWhatsApp}>
                      <input type="text" placeholder="Number (e.g. 9198765...)" value={waRecipient} onChange={(e) => setWaRecipient(e.target.value)} required />
                      <textarea placeholder="Write text message..." value={waMessage} onChange={(e) => setWaMessage(e.target.value)} required />
                      <button type="submit" disabled={loading}>SEND TEXT</button>
                    </form>
                  </div>
                )}
              </div>
            )}

            {/* TAB 3: TELEPHONY */}
            {activeTab === 'phone' && (
              <div className="tab-content scrollable">
                <div className="section-title">INTERCEPTOR PHONE LINE</div>
                <form className="telephony-config-form" onSubmit={handleSetInterceptNumber} style={{ marginBottom: '12px' }}>
                  <div className="telephony-config-row" style={{ display: 'flex', gap: '4px', marginBottom: '4px' }}>
                    <input 
                      type="text" 
                      placeholder="e.g. +91 82875 92505..." 
                      value={newInterceptNumber} 
                      onChange={(e) => setNewInterceptNumber(e.target.value)} 
                      style={{ flexGrow: 1, padding: '4px 6px', fontSize: '10px', background: 'rgba(0, 0, 0, 0.4)', border: '1px solid rgba(0, 255, 204, 0.2)', borderRadius: '3px', color: '#fff' }}
                    />
                    <button type="submit" disabled={loading} style={{ fontSize: '8px', padding: '4px 8px', background: 'rgba(0, 255, 204, 0.15)', border: '1px solid #00ffcc', borderRadius: '3px', color: '#00ffcc', cursor: 'pointer' }}>SET LINE</button>
                  </div>
                  <div className="telephony-active-line" style={{ fontSize: '8px', opacity: 0.8 }}>
                    {interceptNumber ? (
                      <span className="active-line-badge" style={{ color: '#00ffcc' }}>
                        ACTIVE INTERCEPTING: <strong>{interceptNumber}</strong>
                      </span>
                    ) : (
                      <span className="inactive-line-badge" style={{ color: '#ffcc00', opacity: 0.7 }}>
                        MONITORING ALL INCOMING CALL WEBHOOKS
                      </span>
                    )}
                  </div>
                </form>

                <div className="section-title">INTERCOM PORTAL</div>
                <button 
                  className={`intercom-dial-btn ${isIntercomActive ? 'ringing' : ''}`} 
                  onClick={startIntercom} 
                  disabled={isIntercomActive}
                >
                  {isIntercomActive ? intercomStatus : 'CALL F.R.I.D.A.Y. ASSISTANT'}
                </button>

                <div className="section-title" style={{ marginTop: '14px' }}>CALL TRANSCRIPT RECORDS</div>
                <div className="call-logs-list">
                  {calls.length === 0 ? (
                    <div className="no-data">No calls on record.</div>
                  ) : (
                    calls.map(c => (
                      <div key={c.id} className="call-log-item">
                        <div className="call-log-meta">
                          <span className="call-log-source">{c.source}</span>
                          <span className="call-log-time">
                            {new Date(c.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        <div className="call-log-caller">{c.caller}</div>
                        <div className="call-log-status">{c.status}</div>
                        <div className="call-log-transcript">{c.transcript}</div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Sync Button */}
          <div className="office-footer">
            <button className="sync-all-btn" onClick={handleSync} disabled={loading}>
              {loading ? 'SYNCHRONIZING...' : 'SYNC ALL SYSTEMS'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
