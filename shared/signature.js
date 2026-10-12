(function exposeSignatureVerifier(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.HookScopeSignature = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const encoder = new TextEncoder();
  const cryptoApi = () => globalThis.crypto?.subtle;

  function bytes(value) { return value instanceof Uint8Array ? value : encoder.encode(String(value)); }
  function joinBytes(left, right) { const result = new Uint8Array(left.length + right.length); result.set(left); result.set(right, left.length); return result; }
  function hexToBytes(value) {
    if (!/^[a-fA-F0-9]{64}$/.test(value)) return null;
    return Uint8Array.from(value.match(/../g).map((pair) => parseInt(pair, 16)));
  }
  function equal(left, right) {
    if (!left || !right || left.length !== right.length) return false;
    let different = 0; for (let i = 0; i < left.length; i += 1) different |= left[i] ^ right[i];
    return different === 0;
  }
  async function hmac(secret, payload) {
    const subtle = cryptoApi();
    if (!subtle) throw new Error('Web Crypto is unavailable');
    const key = await subtle.importKey('raw', bytes(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return new Uint8Array(await subtle.sign('HMAC', key, bytes(payload)));
  }
  function parseStripeHeader(header) {
    if (typeof header !== 'string' || !header.trim()) return { error: 'Signature header is malformed' };
    let timestamp; const signatures = [];
    for (const part of header.split(',')) {
      const [key, value, extra] = part.trim().split('=');
      if (extra || !key || !value) return { error: 'Signature header is malformed' };
      if (key === 't') { if (timestamp !== undefined || !/^\d+$/.test(value)) return { error: 'Signature header is malformed' }; timestamp = Number(value); }
      if (key === 'v1') { const parsed = hexToBytes(value); if (!parsed) return { error: 'Signature header is malformed' }; signatures.push(parsed); }
    }
    if (!Number.isSafeInteger(timestamp) || signatures.length === 0) return { error: 'Signature header is malformed' };
    return { timestamp, signatures };
  }
  async function verifyStripeSignature({ header, secret, rawBody, toleranceSeconds = 300, now = Date.now() }) {
    const parsed = parseStripeHeader(header);
    if (parsed.error) return { valid: false, reason: parsed.error };
    if (typeof secret !== 'string' || !secret) return { valid: false, reason: 'Signing secret is required' };
    if (!Number.isFinite(toleranceSeconds) || toleranceSeconds < 0) return { valid: false, reason: 'Tolerance is invalid' };
    if (Math.abs(Math.floor(now / 1000) - parsed.timestamp) > toleranceSeconds) return { valid: false, reason: 'Signature timestamp is outside the allowed tolerance' };
    const expected = await hmac(secret, joinBytes(encoder.encode(`${parsed.timestamp}.`), bytes(rawBody)));
    return parsed.signatures.some((signature) => equal(expected, signature)) ? { valid: true, reason: null } : { valid: false, reason: 'Signature does not match' };
  }
  async function verifySha256Signature({ header, secret, rawBody }) {
    if (typeof header !== 'string' || !header.startsWith('sha256=')) return { valid: false, reason: 'Signature header is malformed' };
    if (typeof secret !== 'string' || !secret) return { valid: false, reason: 'Signing secret is required' };
    const supplied = hexToBytes(header.slice(7));
    if (!supplied) return { valid: false, reason: 'Signature header is malformed' };
    return equal(await hmac(secret, rawBody), supplied) ? { valid: true, reason: null } : { valid: false, reason: 'Signature does not match' };
  }
  return { parseStripeHeader, verifyStripeSignature, verifySha256Signature };
}));
