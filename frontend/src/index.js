import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import reportWebVitals from './reportWebVitals';

import BACKEND_URL from './config';

// Global error catcher for F.R.I.D.A.Y. Diagnostics Group
window.onerror = function(message, source, lineno, colno, error) {
  try {
    fetch(`${BACKEND_URL}/api/diagnostics/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'Uncaught Exception',
        message: String(message),
        stack: error ? error.stack : `${source}:${lineno}:${colno}`
      })
    }).catch(() => {});
  } catch (e) {}
};

window.onunhandledrejection = function(event) {
  try {
    fetch(`${BACKEND_URL}/api/diagnostics/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'Unhandled Rejection',
        message: String(event.reason),
        stack: event.reason && event.reason.stack ? event.reason.stack : ''
      })
    }).catch(() => {});
  } catch (e) {}
};

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
