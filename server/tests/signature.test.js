const crypto = require('crypto');
const { verifyStripeSignature, verifySha256Signature } = require('../../shared/signature');

describe('shared signature verification', () => {
  const secret = 'whsec_test_secret'; const body = '{"id":"evt_123"}'; const timestamp = 1_700_000_000;
  const stripe = crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  const generic = crypto.createHmac('sha256', secret).update(body).digest('hex');
  test('verifies known Stripe-style HMAC', async () => expect(await verifyStripeSignature({ header: `t=${timestamp},v1=${stripe}`, secret, rawBody: body, now: timestamp * 1000 })).toEqual({ valid: true, reason: null }));
  test('rejects modified body and incorrect secret', async () => { expect((await verifyStripeSignature({ header: `t=${timestamp},v1=${stripe}`, secret, rawBody: '{}', now: timestamp * 1000 })).valid).toBe(false); expect((await verifyStripeSignature({ header: `t=${timestamp},v1=${stripe}`, secret: 'wrong', rawBody: body, now: timestamp * 1000 })).valid).toBe(false); });
  test('rejects stale and malformed Stripe headers', async () => { expect((await verifyStripeSignature({ header: `t=${timestamp},v1=${stripe}`, secret, rawBody: body, now: (timestamp + 301) * 1000 })).reason).toMatch(/tolerance/); expect((await verifyStripeSignature({ header: 'not-a-signature', secret, rawBody: body })).reason).toMatch(/malformed/); });
  test('accepts any valid signature when header contains multiple v1 values', async () => expect((await verifyStripeSignature({ header: `t=${timestamp},v1=${'0'.repeat(64)},v1=${stripe}`, secret, rawBody: body, now: timestamp * 1000 })).valid).toBe(true));
  test('verifies generic sha256= HMAC and rejects malformed input', async () => { expect((await verifySha256Signature({ header: `sha256=${generic}`, secret, rawBody: body })).valid).toBe(true); expect((await verifySha256Signature({ header: 'sha256=nope', secret, rawBody: body })).reason).toMatch(/malformed/); });
});
