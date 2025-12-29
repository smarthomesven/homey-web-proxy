'use strict';

const Homey = require('homey');
const axios = require('axios');
const WebSocket = require('ws');

module.exports = class WebProxyApp extends Homey.App {

  /**
   * onInit is called when the app is initialized.
   */
  async onInit() {
    this.log('Web Proxy App has been initialized');
    this.websockets = new Map();
  }

  async webRequest(body) {
    try {
      const { type, url, method = 'GET', headers = {}, data } = body;
      
      if (!url) {
        this.error('No URL provided in request');
        return {
          success: false,
          status: 400,
          error: 'URL is required'
        };
      }

      this.log(`Proxying ${method} request to: ${url}`);

      // Configure axios request
      const config = {
        method: method,
        url: url,
        headers: {
          ...headers,
          // Remove headers that might cause issues
          'host': undefined,
          'origin': undefined,
        },
        responseType: 'arraybuffer', // Get binary data
        validateStatus: () => true, // Don't throw on any status
        maxRedirects: 5,
        timeout: 30000
      };

      if (data && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
        config.data = data;
      }

      const response = await axios(config);

      // Convert arraybuffer to base64
      const base64Data = Buffer.from(response.data).toString('base64');

      this.log(`Response received: status=${response.status}, contentType=${response.headers['content-type']}, dataSize=${response.data.byteLength} bytes`);

      return {
        success: true,
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
        data: base64Data,
        contentType: response.headers['content-type'] || 'text/html'
      };

    } catch (error) {
      this.error('Error during web request:', error.message);
      return {
        success: false,
        status: error.response ? error.response.status : 500,
        error: error.message,
        data: ''
      };
    }
  }

  async wsConnect(url, wsId, homey) {
    try {
      if (this.websockets.has(wsId)) {
        throw new Error('WebSocket ID already in use');
      }

      const ws = new WebSocket(url);

      ws.on('open', () => {
        this.log(`WebSocket ${wsId} connected to ${url}`);
        if (homey) {
          this.homey.api.realtime(`ws:${wsId}:open`, {});
        }
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

        this.homey.api.realtime(`ws:${wsId}:message`, {
          data: base64Data,
          isBinary: Buffer.isBuffer(data)
        });
      });

      ws.on('error', (error) => {
        this.error(`WebSocket ${wsId} error:`, error);
        this.homey.api.realtime(`ws:${wsId}:error`, {
          error: error.message
        });
      });

      ws.on('close', (code, reason) => {
        this.log(`WebSocket ${wsId} closed:`, code, reason);
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

      // Data comes as base64, decode it before sending
      const buffer = Buffer.from(data, 'base64');
      ws.send(buffer);

      return {
        success: true
      };
    } catch (error) {
      this.error('WebSocket send error:', error);
      throw error;
    }
  }

  async wsClose(wsId) {
    try {
      const ws = this.websockets.get(wsId);
      if (!ws) {
        throw new Error('WebSocket not found');
      }

      ws.close();
      this.websockets.delete(wsId);

      return {
        success: true
      };
    } catch (error) {
      this.error('WebSocket close error:', error);
      throw error;
    }
  }

    async onUninit() {
    // Close all WebSocket connections when app is uninitialized
    for (const [wsId, ws] of this.websockets.entries()) {
      try {
        ws.close();
      } catch (error) {
        this.error(`Error closing WebSocket ${wsId}:`, error);
      }
    }
    this.websockets.clear();
  }

};