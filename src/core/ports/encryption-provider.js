import { NotImplementedError } from '../domain/errors.js';

/**
 * EncryptionProvider — encrypts/decrypts claim payloads at rest.
 *
 * Added retroactively to close a real gap: the schema documented
 * payloads as "encrypted at rest (AES-256)" since Day 2, but no
 * encryption module existed until now — payloads were stored as
 * plaintext JSON. This port makes payload confidentiality a first-class
 * concern PostgresClaimStore depends on, rather than an inline detail.
 *
 * @interface
 */
export class EncryptionProvider {
  /**
   * @param {string} plaintext
   * @returns {Promise<string>} a single opaque string safe to store in
   *   a TEXT column — implementations pack whatever they need (IV, auth
   *   tag, ciphertext) into this one string.
   */
  async encrypt(_plaintext) {
    throw new NotImplementedError('EncryptionProvider', 'encrypt');
  }

  /**
   * @param {string} ciphertext - value previously returned by encrypt()
   * @returns {Promise<string>} plaintext
   */
  async decrypt(_ciphertext) {
    throw new NotImplementedError('EncryptionProvider', 'decrypt');
  }
}