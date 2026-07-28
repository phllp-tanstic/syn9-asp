import { ValidationError, PermissionDeniedError } from '../domain/errors.js';
import { generateId } from '../domain/id.js';

const DEFAULT_TOP_K = 3;
const MAX_TOP_K = 10;
const DEFAULT_MIN_SIMILARITY = 0.75;

export async function performRecall(
  { claimStore, embeddingProvider, authorizationPolicy, auditLog, synthesisEngine },
  { threadId, intent, topK: topKRaw, minSimilarity: minSimilarityRaw, synthesis = false, requesterIdentity }
) {
  if (!intent || typeof intent !== 'string') {
    throw new ValidationError('intent is required and must be a string');
  }

  const topK = Math.min(topKRaw ?? DEFAULT_TOP_K, MAX_TOP_K);
  const minSimilarity = minSimilarityRaw ?? DEFAULT_MIN_SIMILARITY;

  const queryEmbedding = await embeddingProvider.embed({
    text: intent,
    taskType: 'query',
  });

  const matches = await claimStore.searchBySimilarity({
    threadId,
    queryEmbedding,
    topK,
    minSimilarity,
  });

  const allowed = [];
  const denied = [];

  for (const match of matches) {
    const decision = await authorizationPolicy.evaluate({
      claim: match.claim,
      requesterIdentity,
      action: 'read',
    });
    if (decision.allowed) {
      allowed.push(match);
    } else {
      denied.push(match);
    }
  }

  if (allowed.length === 0 && denied.length > 0) {
    const topDenied = denied[0];

    await auditLog.record({
      type: 'permission_denied',
      threadId,
      actorIdentityId: requesterIdentity.identityId,
      detail: { attempted_claim_id: topDenied.claim.claimId },
    });

    throw new PermissionDeniedError('Access denied for the matched claim', {
      entryExists: true,
      reason: 'NOT_AUTHORIZED',
    });
  }

  const results = allowed.map((match) => ({
    entry_id: match.claim.claimId,
    payload: match.claim.payload,
    similarity_score: match.similarityScore,
    writer_identity_id: match.claim.writerIdentityId,
    chain_hash: match.claim.chainHash,
    timestamp: match.claim.createdAt.toISOString(),
    permission_verified: true,
  }));

  const sourceEntryIds = results.map((r) => r.entry_id);
  const receiptId = generateId('rcpt');

  await auditLog.record({
    type: 'recall',
    threadId,
    actorIdentityId: requesterIdentity.identityId,
    detail: {
      receipt_id: receiptId,
      source_entry_ids: sourceEntryIds,
      synthesis_used: synthesis,
    },
  });

  let synthesizedContext = null;
  if (synthesis) {
    const synthesisResult = await synthesisEngine.synthesize({
      taskIntent: intent,
      permittedClaims: allowed.map((match) => match.claim),
    });
    synthesizedContext = synthesisResult.synthesizedView;
  }

  return {
    results,
    synthesized_context: synthesizedContext,
    source_entry_ids: sourceEntryIds,
    read_receipt_id: receiptId,
  };
}