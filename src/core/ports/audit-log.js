import { NotImplementedError } from '../domain/errors.js';

/**
 * AuditLog — records every significant operation as a chained, append-only
 * event: writes, reads (including denials), permission grants, and
 * revocations.
 *
 * This is a separate port from ClaimStore on purpose. Claims are the
 * *data*; audit events are the *trust trail over access to that data*.
 * Conflating them would make it impossible to evolve audit retention,
 * anchoring cadence, or event schema independently of claim storage.
 *
 * Every AuditEvent produced here is a candidate for the next anchor
 * batch (see AnchorService).
 *
 * @interface
 */
export class AuditLog {
  /**
   * @param {AuditEvent} event
   * @returns {Promise<AuditEvent>} the persisted event, including its chainHash
   */
  async record(_event) {
    throw new NotImplementedError('AuditLog', 'record');
  }

  /**
   * @param {{since: Date|null, limit: number}} params
   * @returns {Promise<AuditEvent[]>} events not yet included in an anchored batch
   */
  async getUnanchored(_params) {
    throw new NotImplementedError('AuditLog', 'getUnanchored');
  }

  /**
   * @param {{eventIds: string[], batchId: string}} params
   */
  async markAnchored(_params) {
    throw new NotImplementedError('AuditLog', 'markAnchored');
  }
}

/**
 * @typedef {object} AuditEvent
 * @property {string} eventId
 * @property {'weave'|'recall'|'revoke'|'permission_grant'|'permission_denied'} type
 * @property {string} threadId
 * @property {string} actorIdentityId
 * @property {object} detail       - type-specific payload (e.g. claimIds touched)
 * @property {Date} occurredAt
 */