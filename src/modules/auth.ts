/**
 * Authentication and Security module for BlurtForum
 * Handles PIN-based encryption/decryption of private keys using PBKDF2
 */
import CryptoJS from 'crypto-js';

export const AuthService = {
  /** Derives a strong key from the PIN using PBKDF2 */
  deriveKey(pin: string, salt: string): CryptoJS.lib.WordArray {
    return CryptoJS.PBKDF2(pin, salt, {
      keySize: 256 / 32,
      iterations: 200000,
    });
  },

  /** Encrypts the posting key with a PIN-derived key */
  encryptKey(postingKey: string, pin: string): string {
    const salt = CryptoJS.lib.WordArray.random(128 / 8).toString(CryptoJS.enc.Hex);
    const derivedKey = this.deriveKey(pin, salt);
    const ciphertext = CryptoJS.AES.encrypt(postingKey, derivedKey.toString()).toString();
    return JSON.stringify({ salt, ciphertext, v: 1 });
  },

  /** Decrypts the posting key. Returns null on failure or invalid PIN. */
  decryptKey(encryptedPackage: string, pin: string): string | null {
    try {
      const data = JSON.parse(encryptedPackage) as { salt: string; ciphertext: string };
      if (!data.salt || !data.ciphertext) return null;
      const derivedKey = this.deriveKey(pin, data.salt);
      const bytes = CryptoJS.AES.decrypt(data.ciphertext, derivedKey.toString());
      const decrypted = bytes.toString(CryptoJS.enc.Utf8);
      return decrypted && decrypted.startsWith('5') ? decrypted : null;
    } catch (e) {
      console.error('Decryption failed:', e);
      return null;
    }
  },

  /** Returns true if the stored key is in the new encrypted format (v1 JSON) */
  isEncrypted(key: string | null): boolean {
    if (!key) return false;
    return key.startsWith('{') && key.includes('ciphertext');
  },
};
