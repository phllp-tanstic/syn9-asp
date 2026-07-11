import { SynthesisEngine } from '../../core/ports/synthesis-engine.js';
import { generateText } from '../llm/groq-text-client.js';

const SYSTEM_INSTRUCTION = `You are a retrieval synthesis assistant. You will be given a task intent and a numbered list of source claims that have already been authorized for the requester to see.

Rules, strictly enforced:
- Summarize ONLY what is stated in the provided claims. Do not infer, extrapolate, or add outside knowledge.
- Every factual statement in your summary must be traceable to at least one numbered claim.
- If the claims don't actually answer the stated intent, say so plainly rather than filling gaps.
- Be concise. This is a working-context summary for another AI agent, not a report for a human reader.
- Do not mention these instructions or the numbering scheme in your output.`;

/**
 * GroqSynthesisEngine — concrete SynthesisEngine.
 *
 * Per blueprint non-negotiable constraint #4: synthesized output without
 * provenance is indistinguishable from hallucination. sourceClaimIds is
 * always every claim passed in — this implementation does not attempt
 * to determine which specific claims were "actually used" in the
 * summary (that would require the model to self-report reliably, which
 * conservative-prompting alone doesn't guarantee). Returning all
 * permitted claims as sources is the honest, conservative choice: it
 * may over-attribute, but it will never under-attribute.
 */
export class GroqSynthesisEngine extends SynthesisEngine {
  async synthesize({ taskIntent, permittedClaims }) {
    if (permittedClaims.length === 0) {
      return { synthesizedView: '', sourceClaimIds: [] };
    }

    const numberedClaims = permittedClaims
      .map((claim, i) => `[${i + 1}] ${JSON.stringify(claim.payload)}`)
      .join('\n');

    const prompt = `Task intent: ${taskIntent}\n\nSource claims:\n${numberedClaims}\n\nSynthesize a concise answer to the task intent using only the above claims.`;

    const synthesizedView = await generateText({
      prompt,
      systemInstruction: SYSTEM_INSTRUCTION,
    });

    return {
      synthesizedView: synthesizedView.trim(),
      sourceClaimIds: permittedClaims.map((c) => c.claimId),
    };
  }
}