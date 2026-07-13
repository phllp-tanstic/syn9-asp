import { AnomalyDetector } from '../../core/ports/anomaly-detector.js';
import { Conflict } from '../../core/domain/conflict.js';
import { generateId } from '../../core/domain/id.js';
import { generateText } from '../llm/groq-text-client.js';

const SIMILARITY_PREFILTER_THRESHOLD = 0.88; // matches blueprint's anomaly.js reference value
const MAX_CANDIDATES_TO_CHECK = 3; // avoid missing a real contradiction ranked below a near-duplicate

const CONTRADICTION_SYSTEM_INSTRUCTION = `You compare two short claims and determine if they factually contradict each other — not merely whether they're topically related.

Respond with EXACTLY this format, nothing else:
CONTRADICTS: yes|no
SUMMARY: <one sentence, only if yes, otherwise leave blank>

Two claims about the same topic are NOT a contradiction unless they assert incompatible facts (e.g. "risk is high" vs "risk is low" contradicts; "risk is high" vs "risk assessed by CertiK" does not).`;

function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function parseContradictionResponse(text) {
  const contradictsMatch = text.match(/CONTRADICTS:\s*(yes|no)/i);
  const summaryMatch = text.match(/SUMMARY:\s*(.*)/i);
  const contradicts = contradictsMatch?.[1]?.toLowerCase() === 'yes';
  const summary = summaryMatch?.[1]?.trim() || null;
  return { contradicts, summary };
}

/**
 * GroqAnomalyDetector — concrete AnomalyDetector.
 *
 * Stage 1 (cheap): embedding cosine similarity against recent claims in
 * the thread, threshold 0.88 (matches the blueprint's own reference
 * anomaly.js). Stage 2 (expensive, only runs if stage 1 finds a
 * candidate): Groq contradiction check with a structured, tightly
 * constrained response format — parsed with a regex rather than asking
 * for free-form JSON, since small/fast models are more reliably
 * consistent with a rigid line-based format than with JSON syntax.
 */
export class GroqAnomalyDetector extends AnomalyDetector {
  async detect({ newClaim, recentClaims }) {
    console.log('DETECT CALLED — newClaim.embedding present:', !!newClaim.embedding, '| recentClaims.length:', recentClaims.length);
    if (!newClaim.embedding || recentClaims.length === 0) return null;

    const candidates = recentClaims
      .filter((claim) => claim.embedding && claim.claimId !== newClaim.claimId)
      .map((claim) => ({
        claim,
        score: cosineSimilarity(newClaim.embedding, claim.embedding),
      }))
      .filter((c) => c.score >= SIMILARITY_PREFILTER_THRESHOLD)
      .sort((a, b) => b.score - a.score);

    console.log('CANDIDATES AFTER FILTER:', candidates.length, '| all recentClaims embeddings present:', recentClaims.map(c => !!c.embedding));

    if (candidates.length === 0) return null;

    // Check multiple top candidates, not just the single nearest
    // neighbor — a near-duplicate (non-contradicting) claim can
    // outrank a genuine contradiction that happens to score slightly
    // lower, causing real conflicts to be silently missed if only the
    // top-1 match were checked.
    for (const candidate of candidates.slice(0, MAX_CANDIDATES_TO_CHECK)) {
      const prompt = `Claim A: ${JSON.stringify(newClaim.payload)}\nClaim B: ${JSON.stringify(candidate.claim.payload)}`;

      const response = await generateText({
        prompt,
        systemInstruction: CONTRADICTION_SYSTEM_INSTRUCTION,
      });

      console.log('LOOP CHECK — candidate:', candidate.claim.payload, '| score:', candidate.score, '| response:', JSON.stringify(response));

      const { contradicts, summary } = parseContradictionResponse(response);
      if (contradicts) {
        return new Conflict({
          conflictId: generateId('syn9_conflict'),
          threadId: newClaim.threadId,
          claimId: newClaim.claimId,
          conflictsWithClaimId: candidate.claim.claimId,
          similarityScore: candidate.score,
          summary: summary ?? 'Contradiction detected (no summary provided by model).',
          detectedAt: new Date(),
        });
      }
    }

    return null;
  }
}