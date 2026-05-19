// We'll use dynamic import to avoid ESM issues
import { Google } from 'arctic';

// Helper function to get backend URL based on environment
const getBackendUrl = (): string => {
  if (process.env.NODE_ENV === 'production') {
    if (!process.env.BACKEND_URL) {
      throw new Error('BACKEND_URL environment variable must be set in production');
    }
    return process.env.BACKEND_URL;
  }
  // Development fallback
  return process.env.BACKEND_URL || 'http://localhost:8080';
};

// Create an async initialization function
async function initGoogle() {
  const arctic = await import('arctic');
  const redirectUri = `${getBackendUrl()}/api/auth/google/callback`;
  return new arctic.Google(
    process.env.GOOGLE_CLIENT_ID!,
    process.env.GOOGLE_CLIENT_SECRET!,
    redirectUri
  );
}

// Initialize Google object
let _google: any = null;

// Export a proxy object that forwards all calls to the real Google instance
export const google = new Proxy({} as any, {
  get: function (target, prop) {
    return async function (...args: any[]) {
      if (!_google) {
        _google = await initGoogle();
      }
      return (_google as any)[prop](...args);
    };
  },
});
