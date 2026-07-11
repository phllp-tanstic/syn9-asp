import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { EncryptionProvider } from '../../core/ports/encryption-provider.js';
import { config } from '../../config/index.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits, standard for GCM

/**
 * AesGcmEncryptionProvider — concrete EncryptionProvider using
 * AES-256-GCM (authenticated encryption: tampering with ciphertext is
 * detectable on decrypt, not just confidentiality).
 *
 * Stored format: base64(iv) + ':' + base64(authTag) + ':' + base64(ciphertext)
 * — packed into one string so no schema changes were needed; the
 * existing `payload TEXT` column holds this directly.
 *
 * IV is freshly randomized on every encrypt() call — reusing an IV with
 * the same key under GCM breaks its security guarantees entirely, so
 * this is not optional/cosmetic randomness.
 */
export class AesGcmEncryptionProvider extends EncryptionProvider {
  constructor({ key = config.encryption.key } = {}) {
    super();
    if (!key) {
      throw new Error('SYN9_ENCRYPTION_KEY is not set. Cannot initialize AesGcmEncryptionProvider.');
    }
    this.key = Buffer.from(key, 'hex');
    if (this.key.length !== 32) {
      throw new Error(
        `SYN9_ENCRYPTION_KEY must be 32 bytes (64 hex chars) for AES-256; got ${this.key.length} bytes.`
      );
    }
  }

  async encrypt(plaintext) {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    return [
      iv.toString('base64'),
      authTag.toString('base64'),
      ciphertext.toString('base64'),
    ].join(':');
  }

  async decrypt(stored) {
    const [ivB64, authTagB64, ciphertextB64] = stored.split(':');
    if (!ivB64 || !authTagB64 || !ciphertextB64) {
      throw new Error('Malformed encrypted payload: expected iv:authTag:ciphertext');
    }

    const iv = Buffer.from(ivB64, 'base64');
    const authTag = Buffer.from(authTagB64, 'base64');
    const ciphertext = Buffer.from(ciphertextB64, 'base64');

    const decipher = createDecipheriv(ALGORITHM, this.key, iv);
    decipher.setAuthTag(authTag);

    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);

    return plaintext.toString('utf8');
  }
}