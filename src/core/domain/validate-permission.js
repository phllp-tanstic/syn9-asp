import { PermissionMode } from './claim.js';
import { ValidationError } from './errors.js';

/**
 * Validates and normalizes a WEAVE request's permission block.
 *
 * Extracted as a pure function — no Fastify, no HTTP, no DB — so
 * permission policy rules are unit-testable in isolation. The route
 * handler (api/routes/weave.js) calls this and lets ValidationError
 * propagate to the error handler; it contains no validation logic of
 * its own for this concern.
 *
 * @param {{mode?: string, allow?: string[]}} permissions
 * @param {string|undefined} taskId
 * @returns {{mode: string, allow?: string[], taskId?: string}} normalized permission
 * @throws {ValidationError}
 */
export function validatePermission(permissions, taskId) {
  if (!permissions || !Object.values(PermissionMode).includes(permissions.mode)) {
    throw new ValidationError(
      `permissions.mode is required and must be one of: ${Object.values(PermissionMode).join(', ')}`
    );
  }

  if (permissions.mode === PermissionMode.TASK_CHAIN && !taskId) {
    throw new ValidationError(
      'task_id is required when permissions.mode is task_chain'
    );
  }

  if (permissions.mode === PermissionMode.EXPLICIT) {
    if (!Array.isArray(permissions.allow) || permissions.allow.length === 0) {
      throw new ValidationError(
        'permissions.allow must be a non-empty array when permissions.mode is explicit'
      );
    }
  }

  return {
    mode: permissions.mode,
    allow: permissions.allow,
    taskId: permissions.mode === PermissionMode.TASK_CHAIN ? taskId : undefined,
  };
}