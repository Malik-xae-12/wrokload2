/**
 * Fabric Authentication Service
 *
 * Acquires the Fabric user bearer token directly using:
 * 1. Microsoft Fabric Workload session (via postMessage)
 * 2. Interactive Microsoft Entra ID MSAL Popup (direct user login to Fabric APIs)
 */

import { PublicClientApplication, Configuration, LogLevel } from '@azure/msal-browser';

let _cachedToken: string | null = null;
let _tokenExpiresAt: number = 0;
let _pendingRequest: Promise<string> | null = null;
let _onErrorCallback: ((msg: string) => void) | null = null;

const TENANT_ID = 'f45de27c-093c-413b-be2d-a2a92f98cf24';
const CLIENT_ID = '4189ca4a-19be-41ca-9d9e-e8a4e383569a'; // Org.Accelerator App ID

const msalConfig: Configuration = {
  auth: {
    clientId: CLIENT_ID,
    authority: `https://login.microsoftonline.com/${TENANT_ID}`,
    redirectUri: window.location.origin,
  },
  cache: {
    cacheLocation: 'localStorage',
  },
  system: {
    loggerOptions: {
      logLevel: LogLevel.Warning,
    },
  },
};

let msalInstance: PublicClientApplication | null = null;

async function getMsalInstance(): Promise<PublicClientApplication> {
  if (!msalInstance) {
    msalInstance = new PublicClientApplication(msalConfig);
    await msalInstance.initialize();
  }
  return msalInstance;
}

function decodeJwtPayload(token: string): Record<string, any> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = parts[1];
    const decoded = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

export function isFabricTokenExpired(): boolean {
  if (!_cachedToken || !_tokenExpiresAt) return true;
  const nowSec = Math.floor(Date.now() / 1000);
  return nowSec >= _tokenExpiresAt - 60;
}

export function getFabricTokenUserInfo(): { name: string; email: string; oid: string } | null {
  if (!_cachedToken) return null;
  const claims = decodeJwtPayload(_cachedToken);
  if (!claims) return null;
  return {
    name: claims.name || claims.preferred_username || 'Fabric User',
    email: claims.preferred_username || claims.upn || claims.email || '',
    oid: claims.oid || '',
  };
}

/**
 * Acquire token via MSAL browser popup directly from Microsoft Entra ID.
 */
export async function acquireTokenViaMsalPopup(): Promise<string> {
  const msal = await getMsalInstance();
  const loginRequest = {
    scopes: [
      'https://api.fabric.microsoft.com/Workspace.ReadWrite.All',
      'https://api.fabric.microsoft.com/Item.ReadWrite.All',
      'https://api.fabric.microsoft.com/Capacity.ReadWrite.All',
      'openid',
      'profile',
      'email',
    ],
  };

  try {
    // 1. Try silent token acquisition first
    const accounts = msal.getAllAccounts();
    if (accounts.length > 0) {
      try {
        const silentResult = await msal.acquireTokenSilent({
          ...loginRequest,
          account: accounts[0],
        });
        if (silentResult?.accessToken) {
          const claims = decodeJwtPayload(silentResult.accessToken);
          _tokenExpiresAt = claims?.exp || Math.floor(Date.now() / 1000) + 3600;
          _cachedToken = silentResult.accessToken;
          return silentResult.accessToken;
        }
      } catch {
        // Fall back to popup
      }
    }

    // 2. Interactive Popup
    const result = await msal.loginPopup(loginRequest);
    if (result?.accessToken) {
      const claims = decodeJwtPayload(result.accessToken);
      _tokenExpiresAt = claims?.exp || Math.floor(Date.now() / 1000) + 3600;
      _cachedToken = result.accessToken;
      return result.accessToken;
    }
  } catch (err: any) {
    console.error('MSAL loginPopup error:', err);
    throw err;
  }

  throw new Error('Failed to acquire token via Microsoft login');
}

export function requestFabricToken(): Promise<string> {
  if (_pendingRequest) return _pendingRequest;

  _pendingRequest = new Promise<string>(async (resolve, reject) => {
    let completed = false;

    const cleanup = () => {
      window.removeEventListener('message', handler);
      clearTimeout(timer);
      _pendingRequest = null;
    };

    const handler = (event: MessageEvent) => {
      if (event.data?.type === 'FABRIC_SIGN_IN_RESPONSE' && event.data.token) {
        completed = true;
        const token = event.data.token as string;
        const claims = decodeJwtPayload(token);
        _tokenExpiresAt = claims?.exp || Math.floor(Date.now() / 1000) + 3600;
        _cachedToken = token;
        cleanup();
        resolve(token);
      }
    };

    window.addEventListener('message', handler);

    // 1. Post request to parent Fabric iframe
    if (window.parent && window.parent !== window) {
      try {
        window.parent.postMessage({ type: 'FABRIC_SIGN_IN_REQUEST' }, '*');
      } catch {
        // ignore
      }
    }

    // 2. If iframe doesn't respond within 2.5s, launch MSAL popup
    const timer = setTimeout(async () => {
      if (completed) return;
      try {
        console.log('Fabric iframe postMessage timed out, opening MSAL login popup...');
        const token = await acquireTokenViaMsalPopup();
        cleanup();
        resolve(token);
      } catch (err: any) {
        cleanup();
        const msg = err?.message || 'Login cancelled or failed';
        _onErrorCallback?.(msg);
        reject(new Error(msg));
      }
    }, 2500);
  });

  return _pendingRequest;
}

export async function getFabricToken(): Promise<string> {
  if (_cachedToken && !isFabricTokenExpired()) {
    return _cachedToken;
  }
  return requestFabricToken();
}

export function clearFabricToken(): void {
  _cachedToken = null;
  _tokenExpiresAt = 0;
  _pendingRequest = null;
}

export function onTokenError(callback: (msg: string) => void): void {
  _onErrorCallback = callback;
}

export function isInsideFabricWorkload(): boolean {
  try {
    return window.parent !== window;
  } catch {
    return false;
  }
}

export function getCachedFabricToken(): string | null {
  return _cachedToken;
}
