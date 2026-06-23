/**
 * Centralized API Configuration for local development and cloud deployments.
 */
const getBackendUrl = () => {
  // Allow overriding via environment variables
  if (process.env.REACT_APP_API_URL) {
    return process.env.REACT_APP_API_URL;
  }

  // Detect local environments (localhost, loopback, or local LAN IP)
  const isLocal = 
    window.location.hostname === 'localhost' || 
    window.location.hostname === '127.0.0.1' || 
    window.location.hostname.startsWith('192.168.');

  if (!isLocal) {
    // Production/Cloud hosting:
    // When hosted on a cloud domain, the frontend reverse-proxies /api/ requests to the backend.
    // Return empty string to enable relative paths (e.g. /api/trading/portfolio),
    // which prevents port leakages and CORS issues.
    return '';
  }

  // Fallback for local development
  return 'http://localhost:5000';
};

export const BACKEND_URL = getBackendUrl();
export default BACKEND_URL;
