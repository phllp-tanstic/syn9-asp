import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Sha256Chain } from '../../../src/modules/provenance/sha256-chain.js';
import { Claim } from '../../../src/core/domain/claim.js';

const chain = new Sha256Chain();

function makeClaim(overrides = {}) {
  return new Claim({
    claimId: 'syn9_claim_001',
    threadId: 'thread-1',
    writerIdentityId: 'identity-abc',
    payload: { note: 'hello' },
    payloadHash: 'payloadhash1',
    permission: { mode: 'open' },
    scope: 'session',
    chainHash: '0xplaceholder',
    prevHash: null,
    createdAt: new Date('2026-07-09T00:00:00.000Z'),
    ...overrides,
  });
}

describe('Sha256Chain.computeHash', () => {
  test('is deterministic for identical inputs', () => {
    const input = {
      prevHash: null,
      claimId: 'c1',
      payloadHash: 'ph1',
      timestamp: '2026-07-09T00:00:00.000Z',
      writerIdentityId: 'id1',
    };
    assert.equal(chain.computeHash(input), chain.computeHash(input));
  });

  test('changes when prevHash changes', () => {
    const base = {
      claimId: 'c1',
      payloadHash: 'ph1',
      timestamp: '2026-07-09T00:00:00.000Z',
      writerIdentityId: 'id1',
    };
    const a = chain.computeHash({ ...base, prevHash: null });
    const b = chain.computeHash({ ...base, prevHash: '0xsomethingelse' });
    assert.notEqual(a, b);
  });

  test('changes when payloadHash changes', () => {
    const base = {
      prevHash: null,
      claimId: 'c1',
      timestamp: '2026-07-09T00:00:00.000Z',
      writerIdentityId: 'id1',
    };
    const a = chain.computeHash({ ...base, payloadHash: 'ph1' });
    const b = chain.computeHash({ ...base, payloadHash: 'ph2' });
    assert.notEqual(a, b);
  });

  test('defaults prevHash to the zero hash when null', () => {
    const withNull = chain.computeHash({
      prevHash: null,
      claimId: 'c1',
      payloadHash: 'ph1',
      timestamp: '2026-07-09T00:00:00.000Z',
      writerIdentityId: 'id1',
    });
    const withZero = chain.computeHash({
      prevHash:
        '0x0000000000000000000000000000000000000000000000000000000000000000',
      claimId: 'c1',
      payloadHash: 'ph1',
      timestamp: '2026-07-09T00:00:00.000Z',
      writerIdentityId: 'id1',
    });
    assert.equal(withNull, withZero);
  });

  test('output is a 0x-prefixed 64-char hex string', () => {
    const result = chain.computeHash({
      prevHash: null,
      claimId: 'c1',
      payloadHash: 'ph1',
      timestamp: '2026-07-09T00:00:00.000Z',
      writerIdentityId: 'id1',
    });
    assert.match(result, /^0x[0-9a-f]{64}$/);
  });
});

describe('Sha256Chain.verifyChain', () => {
  test('validates a correctly chained sequence of claims', () => {
    const claim1Hash = chain.computeHash({
      prevHash: null,
      claimId: 'c1',
      payloadHash: 'ph1',
      timestamp: '2026-07-09T00:00:00.000Z',
      writerIdentityId: 'id1',
    });
    const claim1 = makeClaim({
      claimId: 'c1',
      payloadHash: 'ph1',
      writerIdentityId: 'id1',
      chainHash: claim1Hash,
      prevHash: null,
      createdAt: new Date('2026-07-09T00:00:00.000Z'),
    });

    const claim2Hash = chain.computeHash({
      prevHash: claim1Hash,
      claimId: 'c2',
      payloadHash: 'ph2',
      timestamp: '2026-07-09T00:01:00.000Z',
      writerIdentityId: 'id1',
    });
    const claim2 = makeClaim({
      claimId: 'c2',
      payloadHash: 'ph2',
      writerIdentityId: 'id1',
      chainHash: claim2Hash,
      prevHash: claim1Hash,
      createdAt: new Date('2026-07-09T00:01:00.000Z'),
    });

    const result = chain.verifyChain([claim1, claim2]);
    assert.equal(result.valid, true);
    assert.equal(result.brokenAtClaimId, null);
  });

  test('detects tampering when a chainHash is altered', () => {
    const claim1Hash = chain.computeHash({
      prevHash: null,
      claimId: 'c1',
      payloadHash: 'ph1',
      timestamp: '2026-07-09T00:00:00.000Z',
      writerIdentityId: 'id1',
    });
    const claim1 = makeClaim({
      claimId: 'c1',
      payloadHash: 'ph1',
      writerIdentityId: 'id1',
      chainHash: claim1Hash,
      prevHash: null,
      createdAt: new Date('2026-07-09T00:00:00.000Z'),
    });

    const tamperedClaim = makeClaim({
      claimId: 'c2',
      payloadHash: 'ph2-tampered',
      writerIdentityId: 'id1',
      chainHash: '0xdeadbeef',
      prevHash: claim1Hash,
      createdAt: new Date('2026-07-09T00:01:00.000Z'),
    });

    const result = chain.verifyChain([claim1, tamperedClaim]);
    assert.equal(result.valid, false);
    assert.equal(result.brokenAtClaimId, 'c2');
  });

  test('detects a broken prevHash link', () => {
    const claim1Hash = chain.computeHash({
      prevHash: null,
      claimId: 'c1',
      payloadHash: 'ph1',
      timestamp: '2026-07-09T00:00:00.000Z',
      writerIdentityId: 'id1',
    });
    const claim1 = makeClaim({
      claimId: 'c1',
      payloadHash: 'ph1',
      writerIdentityId: 'id1',
      chainHash: claim1Hash,
      prevHash: null,
      createdAt: new Date('2026-07-09T00:00:00.000Z'),
    });

    const claim2 = makeClaim({
      claimId: 'c2',
      payloadHash: 'ph2',
      writerIdentityId: 'id1',
      chainHash: '0xirrelevant',
      prevHash: '0xwrong',
      createdAt: new Date('2026-07-09T00:01:00.000Z'),
    });

    const result = chain.verifyChain([claim1, claim2]);
    assert.equal(result.valid, false);
    assert.equal(result.brokenAtClaimId, 'c2');
  });
});

describe('Sha256Chain.hashPayload', () => {
  test('is deterministic for the same object', () => {
    const payload = { note: 'hello', n: 1 };
    assert.equal(chain.hashPayload(payload), chain.hashPayload(payload));
  });

  test('differs for different payloads', () => {
    assert.notEqual(
      chain.hashPayload({ note: 'a' }),
      chain.hashPayload({ note: 'b' })
    );
  });
});