// Auth-hardening tests. Pure middleware/helper logic only - no Mongo, no network.
//
// The holes these lock down:
//   1. POST /refresh-token minted a 7-day token for any email that was posted,
//      with no proof of anything.
//   2. POST /setprofile had no auth at all; the profile email came from the body.
//   3. POST /api/clients/register was fully public, so anyone could create the
//      account that Google login then legitimately accepted.
//   4. Password login signed with JWT_SECRET_KEY while LocalTokenValidator
//      verified with JWT_SECRET, so those tokens never validated.

import assert from 'node:assert/strict';
import test from 'node:test';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'test-primary-secret';
process.env.JWT_SECRET_KEY = 'test-legacy-secret';
process.env.ADMIN_REGISTRATION_KEY = 'test-admin-key';

const { signAuthToken, verifyAuthToken, extractToken, normalizeEmail } =
    await import('../AuthToken.js');
const { default: LocalTokenValidator } = await import('../../Middlewares/LocalTokenValidator.js');
const { default: AdminKeyVerify } = await import('../../Middlewares/AdminKeyVerify.js');

// Minimal express-ish doubles.
const makeRes = () => {
    const res = { statusCode: null, body: null };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (payload) => { res.body = payload; return res; };
    return res;
};
const makeReq = ({ headers = {}, body = {} } = {}) => ({ headers, body });

test('normalizeEmail trims and lowercases', () => {
    assert.equal(normalizeEmail('  John@Example.COM '), 'john@example.com');
    assert.equal(normalizeEmail(undefined), '');
});

test('verifyAuthToken accepts tokens signed with the primary secret', () => {
    const token = signAuthToken({ email: 'a@b.com' });
    assert.equal(verifyAuthToken(token).email, 'a@b.com');
});

test('verifyAuthToken still accepts pre-existing legacy-secret sessions', () => {
    const legacy = jwt.sign({ email: 'a@b.com' }, 'test-legacy-secret', { expiresIn: '7d' });
    assert.equal(verifyAuthToken(legacy).email, 'a@b.com');
});

test('verifyAuthToken rejects a foreign secret, garbage, and expired tokens', () => {
    assert.equal(verifyAuthToken(jwt.sign({ email: 'a@b.com' }, 'attacker-secret')), null);
    assert.equal(verifyAuthToken('not-a-jwt'), null);
    assert.equal(verifyAuthToken(undefined), null);
    const expired = jwt.sign({ email: 'a@b.com' }, 'test-primary-secret', { expiresIn: -10 });
    assert.equal(verifyAuthToken(expired), null);
});

test('extractToken reads the bearer header, then falls back to the body', () => {
    assert.equal(extractToken(makeReq({ headers: { authorization: 'Bearer abc' } })), 'abc');
    assert.equal(extractToken(makeReq({ body: { token: 'xyz' } })), 'xyz');
    assert.equal(extractToken(makeReq()), null);
});

test('LocalTokenValidator rejects a request with no token', async () => {
    const res = makeRes();
    let called = false;
    await LocalTokenValidator(makeReq({ body: { userDetails: { email: 'a@b.com' } } }), res, () => { called = true; });
    assert.equal(called, false);
    assert.equal(res.statusCode, 401);
});

test('LocalTokenValidator rejects a token signed with an attacker secret', async () => {
    const forged = jwt.sign({ email: 'victim@x.com' }, 'attacker-secret', { expiresIn: '7d' });
    const res = makeRes();
    let called = false;
    await LocalTokenValidator(
        makeReq({ headers: { authorization: `Bearer ${forged}` }, body: { userDetails: { email: 'victim@x.com' } } }),
        res,
        () => { called = true; },
    );
    assert.equal(called, false);
    assert.equal(res.statusCode, 403);
});

test('LocalTokenValidator refuses to act on another account', async () => {
    const token = signAuthToken({ email: 'attacker@x.com' });
    const res = makeRes();
    let called = false;
    await LocalTokenValidator(
        makeReq({ headers: { authorization: `Bearer ${token}` }, body: { userDetails: { email: 'victim@x.com' } } }),
        res,
        () => { called = true; },
    );
    assert.equal(called, false);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.code, 'EMAIL_MISMATCH');
});

test('LocalTokenValidator pins the identity to the token, case-insensitively', async () => {
    const token = signAuthToken({ email: 'User@Example.com' });
    const req = makeReq({
        headers: { authorization: `Bearer ${token}` },
        body: { userDetails: { email: 'user@example.COM', name: 'User' } },
    });
    const res = makeRes();
    let called = false;
    await LocalTokenValidator(req, res, () => { called = true; });
    assert.equal(called, true);
    // Normalized for comparisons, canonical for queries: GetProfile and
    // Add_Update_Profile match email exactly.
    assert.equal(req.authEmail, 'user@example.com');
    assert.equal(req.authEmailCanonical, 'User@Example.com');
    assert.equal(req.userDetails.email, 'User@Example.com');
    assert.equal(req.userDetails.name, 'User');
});

test('LocalTokenValidator ignores body.email - that is the contact email, not the identity', async () => {
    const token = signAuthToken({ email: 'owner@work.com' });
    const req = makeReq({
        headers: { authorization: `Bearer ${token}` },
        body: { email: 'owner@personal.com', userDetails: { email: 'owner@work.com' } },
    });
    const res = makeRes();
    let called = false;
    await LocalTokenValidator(req, res, () => { called = true; });
    assert.equal(called, true);
    assert.equal(req.body.email, 'owner@personal.com', 'contact email must be left alone');
});

test('LocalTokenValidator accepts a header-only request with no body userDetails', async () => {
    const token = signAuthToken({ email: 'a@b.com' });
    const req = makeReq({ headers: { authorization: `Bearer ${token}` } });
    const res = makeRes();
    let called = false;
    await LocalTokenValidator(req, res, () => { called = true; });
    assert.equal(called, true);
    assert.equal(req.authEmail, 'a@b.com');
});

test('AdminKeyVerify rejects a request with no key', () => {
    const res = makeRes();
    let called = false;
    AdminKeyVerify(makeReq({ body: { email: 'new@x.com' } }), res, () => { called = true; });
    assert.equal(called, false);
    assert.equal(res.statusCode, 403);
});

test('AdminKeyVerify rejects a wrong key of the same and of different length', () => {
    for (const key of ['test-admin-kex', 'short']) {
        const res = makeRes();
        let called = false;
        AdminKeyVerify(makeReq({ headers: { 'x-admin-key': key } }), res, () => { called = true; });
        assert.equal(called, false, `expected rejection for ${key}`);
        assert.equal(res.statusCode, 403);
    }
});

test('AdminKeyVerify accepts the key via header or Authorization: Admin', () => {
    for (const req of [
        makeReq({ headers: { 'x-admin-key': 'test-admin-key' } }),
        makeReq({ headers: { authorization: 'Admin test-admin-key' } }),
    ]) {
        let called = false;
        AdminKeyVerify(req, makeRes(), () => { called = true; });
        assert.equal(called, true);
    }
});

test('AdminKeyVerify fails closed when the key is not configured', () => {
    // Blanked rather than deleted: the middleware calls dotenv.config(), which
    // would repopulate a deleted var from the real .env.
    process.env.ADMIN_REGISTRATION_KEY = '';
    const res = makeRes();
    let called = false;
    AdminKeyVerify(makeReq({ headers: { 'x-admin-key': 'anything' } }), res, () => { called = true; });
    assert.equal(called, false);
    assert.equal(res.statusCode, 503);
    process.env.ADMIN_REGISTRATION_KEY = 'test-admin-key';
});
