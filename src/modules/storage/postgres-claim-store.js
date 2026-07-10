import { ClaimStore } from '../../core/ports/claim-store.js';
import { Claim } from '../../core/domain/claim.js';
import { Conflict } from '../../core/domain/conflict.js';
import { NotFoundError } from '../../core/domain/errors.js';

/**
 * PostgresClaimStore — concrete ClaimStore backed by Postgres + pgvector.
 *
 * KNOWN GAP: the schema's `payload` column is documented as
 * "encrypted at rest (AES-256)" but no encryption module exists yet.
 * Payloads are stored as plaintext JSON for now. This is a tracked gap
 * against the blueprint's stated design, not a silent omission — must
 * be closed before this handles anything sensitive. Encryption should
 * land as its own concern (e.g. wrapping payload in/out at the edges
 * of this class) rather than being bolted on ad hoc later.
 */
export class PostgresClaimStore extends ClaimStore {
  /** @param {import('pg').Pool} pool */
  constructor(pool) {
    super();
    this.pool = pool;
  }

  _rowToClaim(row) {
    return new Claim({
      claimId: row.claim_id,
      threadId: row.thread_id,
      writerIdentityId: row.writer_identity_id,
      payload: JSON.parse(row.payload),
      payloadHash: row.payload_hash,
      permission: {
        mode: row.permission_mode,
        allow: row.allowed_wallets ?? undefined,
        taskId: row.task_id ?? undefined,
      },
      scope: row.scope,
      chainHash: row.chain_hash,
      prevHash: row.prev_hash,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      revoked: row.revoked,
      revokedAt: row.revoked_at,
    });
  }

  async append(claim) {
    const embeddingLiteral = claim.embedding
      ? `[${claim.embedding.join(',')}]`
      : null;

    const result = await this.pool.query(
      `INSERT INTO claims (
         thread_id, claim_id, writer_identity_id,
         payload, payload_hash, embedding, permission_mode,
         allowed_wallets, task_id, scope, chain_hash, prev_hash,
         expires_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [
        claim.threadId,
        claim.claimId,
        claim.writerIdentityId,
        JSON.stringify(claim.payload),
        claim.payloadHash,
        embeddingLiteral,
        claim.permission.mode,
        claim.permission.allow ?? null,
        claim.permission.taskId ?? null,
        claim.scope,
        claim.chainHash,
        claim.prevHash,
        claim.expiresAt,
      ]
    );

    return this._rowToClaim(result.rows[0]);
  }
  
  async getById(claimId) {
    const result = await this.pool.query(
      'SELECT * FROM claims WHERE claim_id = $1',
      [claimId]
    );
    return result.rows.length > 0 ? this._rowToClaim(result.rows[0]) : null;
  }

  async getLatestInThread(threadId) {
    const result = await this.pool.query(
      `SELECT * FROM claims
       WHERE thread_id = $1 AND revoked = FALSE
       ORDER BY created_at DESC
       LIMIT 1`,
      [threadId]
    );
    return result.rows.length > 0 ? this._rowToClaim(result.rows[0]) : null;
  }

  async searchBySimilarity({ threadId, queryEmbedding, topK, minSimilarity }) {
    const embeddingLiteral = `[${queryEmbedding.join(',')}]`;

    const result = await this.pool.query(
      `SELECT *, 1 - (embedding <=> $1) AS similarity_score
       FROM claims
       WHERE thread_id = $2
         AND revoked = FALSE
         AND (expires_at IS NULL OR expires_at > NOW())
         AND embedding IS NOT NULL
       ORDER BY embedding <=> $1
       LIMIT $3`,
      [embeddingLiteral, threadId, topK]
    );

    return result.rows
      .filter((row) => row.similarity_score >= minSimilarity)
      .map((row) => ({
        claim: this._rowToClaim(row),
        similarityScore: row.similarity_score,
      }));
  }

  async getRecentInThread(threadId, limit) {
    const result = await this.pool.query(
      `SELECT * FROM claims
       WHERE thread_id = $1 AND revoked = FALSE
       ORDER BY created_at DESC
       LIMIT $2`,
      [threadId, limit]
    );
    return result.rows.map((row) => this._rowToClaim(row));
  }

  async revoke(claimId) {
    const result = await this.pool.query(
      `UPDATE claims
       SET revoked = TRUE, revoked_at = NOW()
       WHERE claim_id = $1 AND revoked = FALSE
       RETURNING claim_id, revoked_at, chain_hash`,
      [claimId]
    );

    if (result.rows.length === 0) {
      throw new NotFoundError(
        `Claim ${claimId} not found or already revoked`
      );
    }

    const row = result.rows[0];
    return {
      claimId: row.claim_id,
      revokedAt: row.revoked_at,
      chainHashFinal: row.chain_hash,
    };
  }

  async recordConflict(conflict) {
    const result = await this.pool.query(
      `INSERT INTO conflicts (
         conflict_id, thread_id, claim_id, conflicts_with_claim_id,
         similarity_score, summary, status
       ) VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [
        conflict.conflictId,
        conflict.threadId,
        conflict.claimId,
        conflict.conflictsWithClaimId,
        conflict.similarityScore,
        conflict.summary,
        conflict.status,
      ]
    );

    const row = result.rows[0];
    return new Conflict({
      conflictId: row.conflict_id,
      threadId: row.thread_id,
      claimId: row.claim_id,
      conflictsWithClaimId: row.conflicts_with_claim_id,
      similarityScore: row.similarity_score,
      summary: row.summary,
      status: row.status,
      detectedAt: row.detected_at,
    });
  }
}