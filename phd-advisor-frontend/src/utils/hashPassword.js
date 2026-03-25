/**
 * Hash a password client-side before sending to the backend,
 * so the server never receives plaintext credentials.
 *
 * @param {string} password - The user's plaintext password
 * @returns {Promise<string>} 64-character lowercase SHA-256 hex digest
 */
export async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}
