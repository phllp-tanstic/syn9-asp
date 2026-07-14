import { createHmac } from 'node:crypto';
import { config } from '../../src/config/index.js';

const API_BASE = 'https://web3.okx.com';

/**
 * XLayerDataClient — real on-chain address data for Agent 1's research
 * step, via OKX's own XLayer on-chain data API.
 *
 * Reuses the exact same OKX Payment API credentials (api_key/secret/
 * passphrase/project) already configured — this endpoint lives under
 * the same web3.okx.com onchainOS project scope, not a separate
 * product requiring its own registration. If this fails with an auth
 * error, that assumption is wrong and a genuinely separate OKLink
 * signup is needed instead.
 */
export class XLayerDataClient {
  constructor({
    apiKey = config.payment.apiKey,
    secretKey = config.payment.secretKey,
    passphrase = config.payment.passphrase,
    projectId = config.payment.projectId,
  } = {}) {
    this.apiKey = apiKey;
    this.secretKey = secretKey;
    this.passphrase = passphrase;
    this.projectId = projectId;
  }

  _sign(timestamp, method, requestPath) {
    const message = timestamp + method + requestPath;
    return createHmac('sha256', this.secretKey).update(message).digest('base64');
  }

  async getAddressInfo(address) {
    const requestPath = `/api/v5/xlayer/address/information-evm?address=${address}&chainShortName=xlayer`;
    const timestamp = new Date().toISOString();
    const signature = this._sign(timestamp, 'GET', requestPath);

    const response = await fetch(`${API_BASE}${requestPath}`, {
      method: 'GET',
      headers: {
        'OK-ACCESS-KEY': this.apiKey,
        'OK-ACCESS-SIGN': signature,
        'OK-ACCESS-TIMESTAMP': timestamp,
        'OK-ACCESS-PASSPHRASE': this.passphrase,
        'OK-ACCESS-PROJECT': this.projectId,
      },
    });

    const data = await response.json();
    return { httpStatus: response.status, ...data };
  }
}