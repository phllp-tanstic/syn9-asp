import { NotImplementedError } from '../domain/errors.js';

/**
 * SynthesisEngine — produces a task-scoped view over a set of claims
 * that have already passed authorization.
 *
 * Important framing: this is not "summarize these chat messages." The
 * input is a requesting agent's stated task intent plus a set of claims
 * it is permitted to see; the output must be traceable back to specific
 * source claim IDs. Synthesis without provenance is indistinguishable
 * from hallucination (blueprint non-negotiable constraint #4) — so this
 * interface makes sourceClaimIds a required part of the return shape,
 * not an afterthought.
 *
 * Authorization filtering happens strictly before this port is called.
 * SynthesisEngine implementations must never be given claims the
 * requester isn't permitted to see.
 *
 * @interface
 */
export class SynthesisEngine {
  /**
   * @param {{taskIntent: string, permittedClaims: import('../domain/claim.js').Claim[]}} params
   * @returns {Promise<SynthesisResult>}
   */
  async synthesize(_params) {
    throw new NotImplementedError('SynthesisEngine', 'synthesize');
  }
}

/**
 * @typedef {object} SynthesisResult
 * @property {string} synthesizedView
 * @property {string[]} sourceClaimIds - must cover every claim referenced in synthesizedView
 */