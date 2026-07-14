import { createHmac } from 'node:crypto';
import { config } from '../../config/index.js';

const API_BASE = 'https://web3.okx.com';

/**
 * OkxPaymentClient — signed REST client for OKX's onchainOS Payment API
 * (x402 settlement endpoints).
 *
 * Signing scheme per OKX's own docs: HMAC-SHA256 over
 * timestamp + method + requestPath + body, base64-encoded. Timestamp
 * is ISO 8601 with milliseconds, trailing 'Z'. Five headers required:
 * OK-ACCESS-KEY / SIGN / TIMESTAMP / PASSPHRASE / PROJECT — the last
 * one specific to onchainOS-scoped APIs (not present in OKX's general
 * exchange API auth).
 */
export class OkxPaymentClient {
  constructor({
    apiKey = config.payment.apiKey,
    secretKey = config.payment.secretKey,
    passphrase = config.payment.passphrase,
    projectId = config.payment.projectId,
  } = {}) {
    if (!apiKey || !secretKey || !passphrase || !projectId) {
      throw new Error(
        'OKX Payment API credentials incomplete. Requires OKX_PAYMENT_API_KEY, OKX_PAYMENT_SECRET_KEY, OKX_PAYMENT_PASSPHRASE, OKX_PAYMENT_PROJECT_ID.'
      );
    }
    this.apiKey = apiKey;
    this.secretKey = secretKey;
    this.passphrase = passphrase;
    this.projectId = projectId;
  }

  _sign(timestamp, method, requestPath, bodyString) {
    const message = timestamp + method + requestPath + bodyString;
    return createHmac('sha256', this.secretKey).update(message).digest('base64');
  }

  async _request(method, requestPath, body = null) {
    const timestamp = new Date().toISOString();
    const bodyString = body ? JSON.stringify(body) : '';
    const signature = this._sign(timestamp, method, requestPath, bodyString);

    let response;
    try {
      response = await fetch(`${API_BASE}${requestPath}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'OK-ACCESS-KEY': this.apiKey,
          'OK-ACCESS-SIGN': signature,
          'OK-ACCESS-TIMESTAMP': timestamp,
          'OK-ACCESS-PASSPHRASE': this.passphrase,
          'OK-ACCESS-PROJECT': this.projectId,
        },
        ...(body && { body: bodyString }),
      });
    } catch (err) {
      throw new Error(`Network error calling OKX Payment API at ${API_BASE}${requestPath}: ${err.name}: ${err.message}${err.cause ? ' | cause: ' + err.cause : ''}`);
    }

    const data = await response.json();
    // OKX returns code as a number (0 = success), not a string —
    // strict string comparison here previously treated every
    // successful response as an error.
    if (data.code !== 0) {
      throw new Error(`OKX Payment API error (${data.code}): ${data.msg || data.error_message}`);
    }
    return data.data;
  }

  /** Verifies a buyer's payment authorization before settling. */
  async verify({ paymentPayload, paymentRequirements }) {
    return this._request('POST', '/api/v6/pay/x402/verify', {
      x402Version: 2,
      paymentPayload,
      paymentRequirements,
    });
  }

  /** Settles a verified authorization on-chain (async, batched). */
  async settle({ paymentPayload, paymentRequirements }) {
    return this._request('POST', '/api/v6/pay/x402/settle', {
      x402Version: 2,
      paymentPayload,
      paymentRequirements,
    });
  }

  /** Checks on-chain settlement status for a previously-settled batch. */
  async settleStatus(txHash) {
    return this._request('GET', `/api/v6/pay/x402/settle/status?txHash=${txHash}`);
  }
}