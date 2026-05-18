/**
 * Authentication and Security module for BlurtForum
 * Handles PIN-based encryption/decryption of private keys
 */

const AuthService = {
  // Hash PIN with PBKDF2 to create a strong encryption key
  deriveKey(pin, salt) {
    return CryptoJS.PBKDF2(pin, salt, {
      keySize: 256 / 32,
      iterations: 200000
    });
  },

  // Encrypt posting key using a 6-digit PIN
  encryptKey(postingKey, pin) {
    const salt = CryptoJS.lib.WordArray.random(128 / 8).toString(CryptoJS.enc.Hex);
    const derivedKey = this.deriveKey(pin, salt);
    const ciphertext = CryptoJS.AES.encrypt(postingKey, derivedKey.toString()).toString();
    
    return JSON.stringify({
      salt: salt,
      ciphertext: ciphertext,
      v: 1
    });
  },

  // Decrypt posting key using the PIN
  decryptKey(encryptedPackage, pin) {
    try {
      const data = JSON.parse(encryptedPackage);
      if (!data.salt || !data.ciphertext) return null;
      
      const derivedKey = this.deriveKey(pin, data.salt);
      const bytes = CryptoJS.AES.decrypt(data.ciphertext, derivedKey.toString());
      const decrypted = bytes.toString(CryptoJS.enc.Utf8);
      
      // Basic Blurt/Steem private key validation (starts with 5)
      return (decrypted && decrypted.startsWith('5')) ? decrypted : null;
    } catch (e) {
      console.error('Decryption failed:', e);
      return null;
    }
  },

  // Check if the stored key is encrypted (new format) or plain text (old format)
  isEncrypted(key) {
    if (!key) return false;
    return key.startsWith('{') && key.includes('ciphertext');
  }
};
