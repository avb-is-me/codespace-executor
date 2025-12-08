import https from 'https';
import http from 'http';
import { URL } from 'url';
import { KeyboardApiProxyRequest, KeyboardApiProxyResponse, KeyboardApiProxyConfig } from '../types/index.js';

export interface KeyboardApiClientOptions {
  baseUrl?: string;
  timeout?: number;
  userJwt?: string;
}

export class KeyboardApiClient {
  private baseUrl: string;
  private timeout: number;
  private userJwt?: string;

  constructor(options: KeyboardApiClientOptions = {}) {
    this.baseUrl = options.baseUrl || process.env.KEYBOARD_API_BASE_URL || 'https://api.keyboard.dev';
    this.timeout = options.timeout || 30000;
    this.userJwt = options.userJwt;
  }

  /**
   * Execute a Pipedream proxy request through keyboard.dev API
   */
  async executePipedreamProxy(config: KeyboardApiProxyConfig): Promise<KeyboardApiProxyResponse> {
    const proxyRequest: KeyboardApiProxyRequest = {
      service: config.service,
      externalUserId: config.externalUserId,
      accountId: config.accountId,
      url: config.url,
      method: config.method || 'GET',
      headers: config.headers || {},
      body: config.body
    };

    const endpoint = '/api/pipedream/execute';
    return this.makeRequest(endpoint, proxyRequest, config.timeout);
  }

  /**
   * Make HTTP request to keyboard.dev API
   */
  private async makeRequest(
    endpoint: string, 
    data: any, 
    requestTimeout?: number
  ): Promise<KeyboardApiProxyResponse> {
    return new Promise((resolve, reject) => {
      const url = new URL(endpoint, this.baseUrl);
      const isHttps = url.protocol === 'https:';
      const client = isHttps ? https : http;
      
      const requestBody = JSON.stringify(data);
      const timeout = requestTimeout || this.timeout;

      const requestOptions = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(requestBody),
          ...(this.userJwt && { 'Authorization': `Bearer ${this.userJwt}` })
        }
      };

      const req = client.request(requestOptions, (res) => {
        let responseData = '';

        res.on('data', (chunk) => {
          responseData += chunk;
        });

        res.on('end', () => {
          try {
            const response = JSON.parse(responseData);
            
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              resolve(response as KeyboardApiProxyResponse);
            } else {
              resolve({
                success: false,
                error: {
                  message: response.error || `HTTP ${res.statusCode}`,
                  type: 'http_error',
                  code: res.statusCode?.toString()
                }
              });
            }
          } catch (parseError: any) {
            resolve({
              success: false,
              error: {
                message: 'Failed to parse API response',
                type: 'parse_error',
                code: parseError.message
              }
            });
          }
        });
      });

      req.on('error', (error: any) => {
        resolve({
          success: false,
          error: {
            message: error.message || 'Request failed',
            type: 'request_error',
            code: error.code
          }
        });
      });

      // Set request timeout
      req.setTimeout(timeout, () => {
        req.destroy();
        resolve({
          success: false,
          error: {
            message: `Request timeout after ${timeout}ms`,
            type: 'timeout_error',
            code: 'TIMEOUT'
          }
        });
      });

      // Write request body and end
      req.write(requestBody);
      req.end();
    });
  }

  /**
   * Set JWT for authenticated requests
   */
  setUserJwt(jwt: string): void {
    this.userJwt = jwt;
  }

  /**
   * Clear JWT
   */
  clearUserJwt(): void {
    this.userJwt = undefined;
  }
}

/**
 * Create a keyboard API client instance with optional JWT
 */
export function createKeyboardApiClient(userJwt?: string): KeyboardApiClient {
  return new KeyboardApiClient({ userJwt });
}

/**
 * Standalone function for making a single Pipedream proxy request
 */
export async function executeKeyboardApiProxy(
  config: KeyboardApiProxyConfig, 
  userJwt?: string
): Promise<KeyboardApiProxyResponse> {
  const client = createKeyboardApiClient(userJwt);
  return client.executePipedreamProxy(config);
}