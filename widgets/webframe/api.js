'use strict';

module.exports = {
  async webRequest({ homey, body }) {
    try {
      // Pass the request to the app's webRequest method
      const result = await homey.app.webRequest(body);
      return result;
    } catch (error) {
      homey.error('API error:', error);
      return {
        success: false,
        status: 500,
        error: error.message
      };
    }
  },

  async wsConnect({ homey, body }) {
    try {
      const { url, wsId } = body;
      const result = await homey.app.wsConnect(url, wsId, homey);
      return result;
    } catch (error) {
      homey.error('WebSocket connect error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  },

  async wsSend({ homey, body }) {
    try {
      const { wsId, data } = body;
      const result = await homey.app.wsSend(wsId, data);
      return result;
    } catch (error) {
      homey.error('WebSocket send error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  },

  async wsClose({ homey, body }) {
    try {
      const { wsId } = body;
      const result = await homey.app.wsClose(wsId);
      return result;
    } catch (error) {
      homey.error('WebSocket close error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
};