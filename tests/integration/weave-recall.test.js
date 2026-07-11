import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { buildServer } from '../../src/api/server.js';
import { closePool } from '../../src/modules/storage/postgres-client.js';

/**
 * WEAVE -> RECALL integration test.
 *
 * KNOWN GAP: runs against the real configured Postgres (Railway) and
 * real Gemini embeddings API — not an isolated test database. Each run
 * uses a fresh random threadId to avoid colliding with manual testing
 * data, but nothing cleans up written claims afterward. Acceptable for
 * hackathon timeline; a production test suite would use a disposable/
 * seeded database and a mocked or recorded EmbeddingProvider instead.
 *
 * Uses Fastify's inject() rather than binding a real port — exercises
 * full route + plugin logic in-process, avoids the EADDRINUSE/orphan-
 * process failure mode entirely for tests.
 */
describe('WEAVE -> RECALL integration', () => {
  let fastify;
  let apiKey;
  let walletAddress;
  const threadId = randomUUID();

  before(async () => {
    fastify = await buildServer();

    walletAddress = '0x' + randomUUID().replace(/-/g, '').slice(0, 40);
    const registerResponse = await fastify.inject({
      method: 'POST',
      url: '/v1/identities',
      payload: { walletAddress },
    });
    assert.equal(registerResponse.statusCode, 201);
    apiKey = registerResponse.json().apiKey;
  });

  after(async () => {
    // Cheap cleanup, not full isolation — deletes exactly what this
    // test run created, scoped by threadId, to stop unbounded
    // accumulation in the shared Postgres instance. Full isolation
    // (separate test database) is tracked as deferred debt, not solved
    // here — see this file's header comment.
    const { getPool } = await import('../../src/modules/storage/postgres-client.js');
    await getPool().query(
      `DELETE FROM audit_events WHERE thread_id = ANY($1::uuid[])`,
      [[threadId]]
    );
    await getPool().query(
      `DELETE FROM claims WHERE thread_id = ANY($1::uuid[])`,
      [[threadId]]
    );

    await fastify.close();
    await closePool();
  });

  function authHeaders() {
    return {
      authorization: `Bearer ${apiKey}`,
      'x-agent-wallet': walletAddress,
    };
  }

  test('WEAVE returns a chain_hash and RECALL finds the claim by semantic intent', async () => {
    const weaveResponse = await fastify.inject({
      method: 'POST',
      url: `/v1/threads/${threadId}/weave`,
      headers: authHeaders(),
      payload: {
        payload: { note: 'integration test: wallet 0xTEST has a low risk score' },
        permissions: { mode: 'open' },
        scope: 'session',
      },
    });

    assert.equal(weaveResponse.statusCode, 201);
    const weaveBody = weaveResponse.json();
    assert.ok(weaveBody.entry_id.startsWith('syn9_claim_'));
    assert.match(weaveBody.chain_hash, /^0x[0-9a-f]{64}$/);
    assert.equal(weaveBody.anomaly_flag, null);

    const recallResponse = await fastify.inject({
      method: 'POST',
      url: `/v1/threads/${threadId}/recall`,
      headers: authHeaders(),
      payload: {
        intent: 'risk score for wallet 0xTEST',
        min_similarity: 0.5,
      },
    });

    assert.equal(recallResponse.statusCode, 200);
    const recallBody = recallResponse.json();
    assert.equal(recallBody.results.length, 1);
    assert.equal(recallBody.results[0].entry_id, weaveBody.entry_id);
    assert.equal(recallBody.results[0].chain_hash, weaveBody.chain_hash);
    assert.ok(recallBody.read_receipt_id.startsWith('rcpt_'));
    assert.deepEqual(recallBody.source_entry_ids, [weaveBody.entry_id]);
  });

  test('RECALL returns PERMISSION_DENIED when the only match is unauthorized', async () => {
    const otherThreadId = randomUUID();

    const weaveResponse = await fastify.inject({
      method: 'POST',
      url: `/v1/threads/${otherThreadId}/weave`,
      headers: authHeaders(),
      payload: {
        payload: { note: 'integration test: confidential finding for another agent only' },
        permissions: { mode: 'explicit', allow: ['0xSomeoneElsesWallet'] },
        scope: 'session',
      },
    });
    assert.equal(weaveResponse.statusCode, 201);

    const recallResponse = await fastify.inject({
      method: 'POST',
      url: `/v1/threads/${otherThreadId}/recall`,
      headers: authHeaders(),
      payload: {
        intent: 'confidential finding',
        min_similarity: 0.01,
        top_k: 1,
      },
    });

    assert.equal(recallResponse.statusCode, 403);
    const body = recallResponse.json();
    assert.equal(body.error, 'PERMISSION_DENIED');
    assert.equal(body.entryExists, true);
    // No payload content should leak in the denial response.
    assert.equal(JSON.stringify(body).includes('confidential finding'), false);
  });

  test('REVOKE prevents a claim from appearing in future RECALL results', async () => {
    const revokeThreadId = randomUUID();

    const weaveResponse = await fastify.inject({
      method: 'POST',
      url: `/v1/threads/${revokeThreadId}/weave`,
      headers: authHeaders(),
      payload: {
        payload: { note: 'integration test: claim to be revoked immediately' },
        permissions: { mode: 'open' },
        scope: 'session',
      },
    });
    const entryId = weaveResponse.json().entry_id;

    const revokeResponse = await fastify.inject({
      method: 'DELETE',
      url: `/v1/threads/${revokeThreadId}/entries/${entryId}`,
      headers: authHeaders(),
    });
    assert.equal(revokeResponse.statusCode, 200);
    assert.equal(revokeResponse.json().revoked, true);

    const recallResponse = await fastify.inject({
      method: 'POST',
      url: `/v1/threads/${revokeThreadId}/recall`,
      headers: authHeaders(),
      payload: {
        intent: 'claim to be revoked immediately',
        min_similarity: 0.01,
        top_k: 5,
      },
    });

    assert.equal(recallResponse.statusCode, 200);
    assert.equal(recallResponse.json().results.length, 0);
  });
});