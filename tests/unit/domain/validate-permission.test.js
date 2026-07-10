import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { validatePermission } from '../../../src/core/domain/validate-permission.js';
import { ValidationError } from '../../../src/core/domain/errors.js';

describe('validatePermission — open mode', () => {
  test('accepts open mode with no allow list', () => {
    const result = validatePermission({ mode: 'open' }, undefined);
    assert.equal(result.mode, 'open');
    assert.equal(result.taskId, undefined);
  });
});

describe('validatePermission — explicit mode', () => {
  test('accepts explicit mode with a non-empty allow list', () => {
    const result = validatePermission(
      { mode: 'explicit', allow: ['0xabc'] },
      undefined
    );
    assert.equal(result.mode, 'explicit');
    assert.deepEqual(result.allow, ['0xabc']);
  });

  test('rejects explicit mode with no allow list', () => {
    assert.throws(
      () => validatePermission({ mode: 'explicit' }, undefined),
      ValidationError
    );
  });

  test('rejects explicit mode with an empty allow array', () => {
    assert.throws(
      () => validatePermission({ mode: 'explicit', allow: [] }, undefined),
      ValidationError
    );
  });
});

describe('validatePermission — task_chain mode', () => {
  test('accepts task_chain mode when task_id is provided', () => {
    const result = validatePermission({ mode: 'task_chain' }, 'okx_task_123');
    assert.equal(result.mode, 'task_chain');
    assert.equal(result.taskId, 'okx_task_123');
  });

  test('rejects task_chain mode with no task_id', () => {
    assert.throws(
      () => validatePermission({ mode: 'task_chain' }, undefined),
      ValidationError
    );
  });

  test('does not carry taskId through for non-task_chain modes', () => {
    const result = validatePermission(
      { mode: 'open' },
      'okx_task_123' // supplied but irrelevant for open mode
    );
    assert.equal(result.taskId, undefined);
  });
});

describe('validatePermission — invalid input', () => {
  test('rejects missing permissions object', () => {
    assert.throws(
      () => validatePermission(undefined, undefined),
      ValidationError
    );
  });

  test('rejects an unrecognized mode', () => {
    assert.throws(
      () => validatePermission({ mode: 'not_a_real_mode' }, undefined),
      ValidationError
    );
  });

  test('rejects a missing mode field', () => {
    assert.throws(
      () => validatePermission({}, undefined),
      ValidationError
    );
  });
});