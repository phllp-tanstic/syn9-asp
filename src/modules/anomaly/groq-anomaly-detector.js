import { AnomalyDetector } from '../../core/ports/anomaly-detector.js';
import { Conflict } from '../../core/domain/conflict.js';
import { generateId } from '../../core/domain/id.js';
import { generateText } from '../llm/groq-text-client.js';

const SIMILARITY_PREFILTER_THRESHOLD = 0.88; // matches blueprint's anomaly.js reference value

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
    if (!newClaim.embedding || recentClaims.length === 0) return null;

    const candidates = recentClaims
      .filter((claim) => claim.embedding && claim.claimId !== newClaim.claimId)
      .map((claim) => ({
        claim,
        score: cosineSimilarity(newClaim.embedding, claim.embedding),
      }))
      .filter((c) => c.score >= SIMILARITY_PREFILTER_THRESHOLD)
      .sort((a, b) => b.score - a.score);

    if (candidates.length === 0) return null;

    const topCandidate = candidates[0];

    const prompt = `Claim A: ${JSON.stringify(newClaim.payload)}\nClaim B: ${JSON.stringify(topCandidate.claim.payload)}`;

    const response = await generateText({
      prompt,
      systemInstruction: CONTRADICTION_SYSTEM_INSTRUCTION,
    });

    const { contradicts, summary } = parseContradictionResponse(response);
    if (!contradicts) return null;

    return new Conflict({
      conflictId: generateId('syn9_conflict'),
      threadId: newClaim.threadId,
      claimId: newClaim.claimId,
      conflictsWithClaimId: topCandidate.claim.claimId,
      similarityScore: topCandidate.score,
      summary: summary ?? 'Contradiction detected (no summary provided by model).',
      detectedAt: new Date(),
    });
  }
}