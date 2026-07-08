/**
 * Domain-level error taxonomy.
 *
 * Modules throw these; the API layer (src/api) is the only place that
 * translates them into HTTP status codes. This keeps core/ and modules/
 * transport-agnostic — they know nothing about Fastify or HTTP.
 */

export class Syn9Error extends Error {
  constructor(message, { code, cause } = {}) {
    super(message, { cause });
    this.name = this.constructor.name;
    this.code = code ?? 'SYN9_ERROR';
  }
}

/** Requesting identity is not authorized to read/write/revoke this claim. */
export class PermissionDeniedError extends Syn9Error {
  constructor(message, { entryExists = false, reason = 'DENIED' } = {}) {
    super(message, { code: 'PERMISSION_DENIED' });
    this.entryExists = entryExists;
    this.reason = reason;
  }
}

/** Referenced claim, thread, or receipt does not exist. */
export class NotFoundError extends Syn9Error {
  constructor(message) {
    super(message, { code: 'NOT_FOUND' });
  }
}

/** Request failed schema or business-rule validation. */
export class ValidationError extends Syn9Error {
  constructor(message, { details } = {}) {
    super(message, { code: 'VALIDATION_ERROR' });
    this.details = details;
  }
}

/** Identity could not be authenticated (bad/missing API key or wallet header). */
export class AuthenticationError extends Syn9Error {
  constructor(message) {
    super(message, { code: 'AUTHENTICATION_ERROR' });
  }
}

/** A module method was called that its concrete implementation hasn't landed yet. */
export class NotImplementedError extends Syn9Error {
  constructor(portName, methodName) {
    super(`${portName}.${methodName} is not implemented`, { code: 'NOT_IMPLEMENTED' });
  }
}

/** The provenance chain failed verification (tamper detected or broken link). */
export class ChainIntegrityError extends Syn9Error {
  constructor(message) {
    super(message, { code: 'CHAIN_INTEGRITY_ERROR' });
  }
}