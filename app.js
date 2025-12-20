'use strict';

const Homey = require('homey');
const axios = require('axios');

module.exports = class WebProxyApp extends Homey.App {

  /**
   * onInit is called when the app is initialized.
   */
  async onInit() {
    this.log('Web Proxy App has been initialized');
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

};