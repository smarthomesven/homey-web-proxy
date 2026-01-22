'use strict';

const Homey = require('homey');
const axios = require('axios');
const WebSocket = require('ws');

class WebProxyApp extends Homey.App {
  async onInit() {
    this.log('WebProxyApp is running...');

    // Initialize WebSocket storage
    this.websockets = new Map();

    this.cookieJar = new Map(); // Store cookies per domain

    // Simple incremental request counter
    this.requestCounter = 0;

    this.log('WebSocket manager initialized');
  }

  async webRequest(params) {
  const { url, method = 'GET', headers = {}, data = null, maxRedirects = 5 } = params;

  const requestId = ++this.requestCounter;
  const startTime = Date.now();

  this.log(`[HTTP ${requestId}] Request start`, {
    method,
    url,
    headers,
    hasBody: !!data,
    bodyLength: data ? (typeof data === 'string' ? Buffer.byteLength(data) : data.length) : 0
  });

  try {
    // Extract domain for cookie storage
    const urlObj = new URL(url);
    const domain = urlObj.hostname;

    // Get stored cookies for this domain
    const storedCookies = this.cookieJar.get(domain) || [];
    
    // Build Cookie header from stored cookies
    const validCookies = storedCookies.filter(cookie => {
      // Check if cookie is expired
      if (cookie.expires && new Date(cookie.expires) < new Date()) {
        return false;
      }
      // Check if path matches
      if (cookie.path && !urlObj.pathname.startsWith(cookie.path)) {
        return false;
      }
      return true;
    });

    if (validCookies.length > 0) {
      const cookieHeader = validCookies.map(c => `${c.name}=${c.value}`).join('; ');
      headers['cookie'] = cookieHeader;
      this.log(`[HTTP ${requestId}] Sending cookies:`, cookieHeader);
    }

    const response = await axios({
      url,
      method,
      headers,
      data,
      maxRedirects,
      responseType: 'arraybuffer',
      validateStatus: () => true,
      timeout: 30000
    });

    // Parse and store Set-Cookie headers
    const setCookieHeaders = response.headers['set-cookie'];
    if (setCookieHeaders && setCookieHeaders.length > 0) {
      this.log(`[HTTP ${requestId}] Received Set-Cookie headers:`, setCookieHeaders);
      
      const currentCookies = this.cookieJar.get(domain) || [];
      
      setCookieHeaders.forEach(cookieStr => {
        const parsed = this._parseCookie(cookieStr);
        if (parsed) {
          // Remove existing cookie with same name
          const index = currentCookies.findIndex(c => c.name === parsed.name);
          if (index !== -1) {
            currentCookies.splice(index, 1);
          }
          // Add new cookie
          currentCookies.push(parsed);
        }
      });
      
      this.cookieJar.set(domain, currentCookies);
      this.log(`[HTTP ${requestId}] Stored ${currentCookies.length} cookies for ${domain}`);
    }

    const buffer = Buffer.from(response.data);
    const base64Data = buffer.toString('base64');
    const durationMs = Date.now() - startTime;

    this.log(`[HTTP ${requestId}] Request completed`, {
      durationMs,
      statusCode: response.status,
      responseBytes: buffer.length,
      base64Length: base64Data.length
    });

    return {
      success: true,
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
      contentType: response.headers['content-type'],
      data: base64Data
    };

  } catch (error) {
    const durationMs = Date.now() - startTime;
    this.error(`[HTTP ${requestId}] Request error after ${durationMs} ms`, error.message);
    throw error;
  }
}

_parseCookie(cookieStr) {
  try {
    const parts = cookieStr.split(';').map(part => part.trim());
    const [nameValue, ...attributes] = parts;
    const [name, value] = nameValue.split('=');
    
    const cookie = {
      name: name.trim(),
      value: value || '',
      path: '/',
      expires: null,
      httpOnly: false,
      secure: false
    };
    
    attributes.forEach(attr => {
      const [key, val] = attr.split('=').map(s => s.trim());
      const lowerKey = key.toLowerCase();
      
      if (lowerKey === 'path') {
        cookie.path = val;
      } else if (lowerKey === 'expires') {
        cookie.expires = val;
      } else if (lowerKey === 'max-age') {
        const maxAge = parseInt(val, 10);
        if (!isNaN(maxAge)) {
          const expiryDate = new Date(Date.now() + maxAge * 1000);
          cookie.expires = expiryDate.toUTCString();
        }
      } else if (lowerKey === 'httponly') {
        cookie.httpOnly = true;
      } else if (lowerKey === 'secure') {
        cookie.secure = true;
      }
    });
    
    return cookie;
  } catch (error) {
    this.error('Failed to parse cookie:', cookieStr, error);
    return null;
  }
}

  async wsConnect(url, wsId) {
    try {
      if (this.websockets.has(wsId)) {
        throw new Error('WebSocket ID already in use');
      }

      this.log(`Attempting to connect WebSocket ${wsId} to ${url}`);
      
      const ws = new WebSocket(url);
      
      // Log the initial state
      this.log(`WebSocket ${wsId} created, readyState: ${ws.readyState}`);

      ws.on('open', () => {
        this.log(`WebSocket ${wsId} OPENED successfully`);
        this.log(`WebSocket ${wsId} readyState after open: ${ws.readyState}`);
        this.homey.api.realtime(`ws:${wsId}:open`, {});
      });

      ws.on('message', (data) => {
        // Convert message to base64 for transmission
        let base64Data;
        if (Buffer.isBuffer(data)) {
          base64Data = data.toString('base64');
        } else if (typeof data === 'string') {
          base64Data = Buffer.from(data).toString('base64');
        } else {
          base64Data = Buffer.from(String(data)).toString('base64');
        }

        this.log(`WebSocket ${wsId} received message: ${data.length || data.byteLength || 0} bytes`);

        this.homey.api.realtime(`ws:${wsId}:message`, {
          data: base64Data,
          isBinary: Buffer.isBuffer(data)
        });
      });

      ws.on('error', (error) => {
        this.error(`WebSocket ${wsId} ERROR:`, error);
        this.error(`WebSocket ${wsId} readyState on error: ${ws.readyState}`);
        this.homey.api.realtime(`ws:${wsId}:error`, {
          error: error.message
        });
      });

      ws.on('close', (code, reason) => {
        this.log(`WebSocket ${wsId} CLOSED: code=${code}, reason=${reason.toString() || 'none'}`);
        this.log(`WebSocket ${wsId} readyState on close: ${ws.readyState}`);
        this.websockets.delete(wsId);
        this.homey.api.realtime(`ws:${wsId}:close`, {
          code,
          reason: reason.toString()
        });
      });

      this.websockets.set(wsId, ws);

      return {
        success: true,
        wsId
      };
    } catch (error) {
      this.error('WebSocket connection error:', error);
      throw error;
    }
  }

  async wsSend(wsId, data) {
    try {
      const ws = this.websockets.get(wsId);
      if (!ws) {
        throw new Error('WebSocket not found');
      }

      if (ws.readyState !== WebSocket.OPEN) {
        throw new Error('WebSocket is not open');
      }

      const buffer = Buffer.from(data, 'base64');

      this.log(`WebSocket ${wsId} sending message`, {
        bytes: buffer.length
      });

      ws.send(buffer);

      return { success: true };
    } catch (error) {
      this.error('WebSocket send error', error);
      throw error;
    }
  }

  async wsClose(wsId) {
    try {
      const ws = this.websockets.get(wsId);
      if (!ws) {
        this.log(`WebSocket ${wsId} already closed or not found`);
        return { success: true };
      }

      ws.close();
      this.websockets.delete(wsId);

      return { success: true };
    } catch (error) {
      this.error('WebSocket close error', error);
      throw error;
    }
  }

  async onUninit() {
    for (const [wsId, ws] of this.websockets.entries()) {
      try {
        ws.close();
      } catch (error) {
        this.error(`Error closing WebSocket ${wsId}`, error);
      }
    }
    this.websockets.clear();
  }
}

module.exports = WebProxyApp;