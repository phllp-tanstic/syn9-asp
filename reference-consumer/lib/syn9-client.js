import { execSync } from 'node:child_process';

const BASE_URL = process.env.SYN9_BASE_URL ?? 'https://syn9-asp-production.up.railway.app';

/**
 * Shared client for the reference-consumer pipeline.
 *
 * Real HTTP calls against a real deployed Syn9 instance — no mocking,
 * no simulated responses. Payment-gated calls (WEAVE, RECALL) are
 * handled by actually shelling out to `onchainos payment pay` to
 * produce a real TEE-signed x402 authorization, exactly as a genuine
 * external caller would have to.
 *
 * All three simulated agents share one underlying OKX wallet for
 * payment signing (a CLI/TEE constraint — one logged-in wallet session
 * at a time), while using three genuinely distinct Syn9 identities for
 * permission-gating. This mirrors a realistic pattern: one operator
 * running a multi-agent pipeline under one account, same as most real
 * internal multi-agent systems.
 */

async function registerIdentity(walletAddress) {
  const response = await fetch(`${BASE_URL}/v1/identities`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ walletAddress }),
  });

  if (!response.ok) {
    const body = await response.json();
    // Wallet already registered is fine on repeat runs — not fatal,
    // but we can't recover the API key, so this will fail loudly
    // downstream if that happens. Callers should use fresh wallet
    // addresses per pipeline run.
    throw new Error(`Identity registration failed: ${JSON.stringify(body)}`);
  }

  return response.json();
}

/**
 * Signs an x402 challenge using the CLI's TEE-backed wallet. This is a
 * real subprocess call, not a simulation — shells out exactly the way
 * we did manually during payment testing.
 */
function signPaymentChallenge(challengeBase64) {
  const result = execSync(
    `onchainos payment pay --payload "${challengeBase64}" --chain xlayer`,
    { encoding: 'utf8' }
  );
  const parsed = JSON.parse(result);
  if (!parsed.ok) {
    throw new Error(`Payment signing failed: ${JSON.stringify(parsed)}`);
  }
  return parsed.data;
}

/**
 * Makes a payment-gated call: attempts the request, and if a 402 comes
 * back, signs the real challenge and retries with the authorization
 * header attached. Two real HTTP round-trips for the first call in
 * any session — this is genuine x402 behavior, not shortcut-ed.
 */
async function callWithPayment({ method, path, headers = {}, body }) {
  const url = `${BASE_URL}${path}`;
  const bodyString = body ? JSON.stringify(body) : undefined;

  let response = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    ...(bodyString && { body: bodyString }),
  });

  if (response.status === 402) {
    const challengeBase64 = response.headers.get('payment-required');
    if (!challengeBase64) {
      throw new Error('Received 402 but no PAYMENT-REQUIRED header present');
    }

    const { authorization_header: authHeader, header_name: headerName } =
      signPaymentChallenge(challengeBase64);

    response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
        [headerName]: authHeader,
      },
      ...(bodyString && { body: bodyString }),
    });
  }

  const responseBody = await response.json();
  return { status: response.status, body: responseBody };
}

/**
 * Represents one simulated agent's identity within the pipeline —
 * a real registered Syn9 identity with its own real API key.
 */
export class Syn9Agent {
  constructor({ name, walletAddress, apiKey }) {
    this.name = name;
    this.walletAddress = walletAddress;
    this.apiKey = apiKey;
  }

  static async register(name, walletAddress) {
    const { apiKey } = await registerIdentity(walletAddress);
    return new Syn9Agent({ name, walletAddress, apiKey });
  }

  _authHeaders() {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      'X-Agent-Wallet': this.walletAddress,
    };
  }

  async weave(threadId, { payload, permissions, scope }) {
    return callWithPayment({
      method: 'POST',
      path: `/v1/threads/${threadId}/weave`,
      headers: this._authHeaders(),
      body: { payload, permissions, scope },
    });
  }

  async recall(threadId, { intent, synthesis = false, minSimilarity = 0.3, topK = 3 }) {
    return callWithPayment({
      method: 'POST',
      path: `/v1/threads/${threadId}/recall`,
      headers: this._authHeaders(),
      body: { intent, synthesis, min_similarity: minSimilarity, top_k: topK },
    });
  }

  async grant(threadId, entryId, wallet) {
    const response = await fetch(`${BASE_URL}/v1/threads/${threadId}/entries/${entryId}/grant`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this._authHeaders() },
      body: JSON.stringify({ wallet }),
    });
    return { status: response.status, body: await response.json() };
  }
}

export { BASE_URL };