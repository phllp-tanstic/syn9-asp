import { AuditLog } from '../../core/ports/audit-log.js';
import { generateId } from '../../core/domain/id.js';

/**
 * PostgresAuditLog — concrete AuditLog backed by the audit_events table.
 *
 * Reuses ProvenanceChain for hash chaining rather than a second hashing
 * implementation — an audit event chain has the identical structural
 * guarantee as a claim chain (each link's hash binds the previous
 * link), just applied to a different append-only sequence. Chained per
 * thread_id, mirroring how claims are chained per thread.
 */
export class PostgresAuditLog extends AuditLog {
  /**
   * @param {import('pg').Pool} pool
   * @param {import('../../core/ports/provenance-chain.js').ProvenanceChain} provenanceChain
   */
  constructor(pool, provenanceChain) {
    super();
    this.pool = pool;
    this.provenanceChain = provenanceChain;
  }

  async record(event) {
    const latest = await this.pool.query(
      `SELECT chain_hash FROM audit_events
       WHERE thread_id = $1
       ORDER BY occurred_at DESC
       LIMIT 1`,
      [event.threadId]
    );
    const prevEventHash = latest.rows.length > 0 ? latest.rows[0].chain_hash : null;

    const eventId = event.eventId ?? generateId('syn9_evt');
    const occurredAt = event.occurredAt ?? new Date();
    const detailHash = this.provenanceChain.hashPayload(event.detail ?? {});

    const chainHash = this.provenanceChain.computeHash({
      prevHash: prevEventHash,
      claimId: eventId, // reusing the generic field name; semantically "this event's id"
      payloadHash: detailHash,
      timestamp: occurredAt.toISOString(),
      writerIdentityId: event.actorIdentityId,
    });

    const result = await this.pool.query(
      `INSERT INTO audit_events (
         event_id, type, thread_id, actor_identity_id, detail,
         chain_hash, prev_event_hash, occurred_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [
        eventId,
        event.type,
        event.threadId,
        event.actorIdentityId,
        JSON.stringify(event.detail ?? {}),
        chainHash,
        prevEventHash,
        occurredAt,
      ]
    );

    const row = result.rows[0];
    return {
      eventId: row.event_id,
      type: row.type,
      threadId: row.thread_id,
      actorIdentityId: row.actor_identity_id,
      detail: row.detail,
      chainHash: row.chain_hash,
      occurredAt: row.occurred_at,
    };
  }

  async getUnanchored({ since, limit }) {
    const result = await this.pool.query(
      `SELECT * FROM audit_events
       WHERE anchored = FALSE
         AND ($1::timestamptz IS NULL OR occurred_at > $1)
       ORDER BY occurred_at ASC
       LIMIT $2`,
      [since, limit]
    );
    return result.rows.map((row) => ({
      eventId: row.event_id,
      type: row.type,
      threadId: row.thread_id,
      actorIdentityId: row.actor_identity_id,
      detail: row.detail,
      chainHash: row.chain_hash,
      occurredAt: row.occurred_at,
    }));
  }

  async markAnchored({ eventIds, batchId }) {
    await this.pool.query(
      `UPDATE audit_events
       SET anchored = TRUE, anchor_batch_id = $1
       WHERE event_id = ANY($2)`,
      [batchId, eventIds]
    );
  }
}