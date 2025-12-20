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
};