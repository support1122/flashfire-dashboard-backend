// HTTP-level checks of the auth middleware chain over a real express app.
// No Mongo and no network: the protected handler is a stub, so what is under
// test is purely "does an unauthenticated request ever reach it".

import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'test-primary-secret';
process.env.JWT_SECRET_KEY = 'test-legacy-secret';
process.env.ADMIN_REGISTRATION_KEY = 'test-admin-key';

const { signAuthToken } = await import('../AuthToken.js');
const { default: LocalTokenValidator } = await import('../../Middlewares/LocalTokenValidator.js');
const { default: AdminKeyVerify } = await import('../../Middlewares/AdminKeyVerify.js');

const app = express();
app.use(express.json());

// Same middleware order as Routes.js. The stub stands in for
// ProfileCheck + Add_Update_Profile and reports what they would receive.
app.post('/setprofile', LocalTokenValidator, (req, res) =>
    res.status(200).json({
        reached: true,
        email: req.authEmail,
        canonical: req.authEmailCanonical,
        contactEmail: req.body.email,
    }));
app.post('/api/clients/register', AdminKeyVerify, (_req, res) =>
    res.status(200).json({ reached: true }));

const server = app.listen(0);
await new Promise((resolve) => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

const post = (path, { body = {}, headers = {} } = {}) =>
    fetch(`${base}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
    }).then(async (r) => ({ status: r.status, body: await r.json() }));

test.after(() => server.close());

test('/setprofile rejects an unauthenticated request', async () => {
    const res = await post('/setprofile', { body: { email: 'victim@x.com', name: 'Mallory' } });
    assert.equal(res.status, 401);
    assert.equal(res.body.reached, undefined);
});

test('/setprofile rejects a forged token', async () => {
    const forged = jwt.sign({ email: 'victim@x.com' }, 'attacker-secret', { expiresIn: '7d' });
    const res = await post('/setprofile', {
        headers: { Authorization: `Bearer ${forged}` },
        body: { email: 'victim@x.com', userDetails: { email: 'victim@x.com' } },
    });
    assert.equal(res.status, 403);
    assert.equal(res.body.reached, undefined);
});

test('/setprofile refuses to write another account\'s profile', async () => {
    const token = signAuthToken({ email: 'attacker@x.com' });
    const res = await post('/setprofile', {
        headers: { Authorization: `Bearer ${token}` },
        body: { email: 'victim@x.com', userDetails: { email: 'victim@x.com' } },
    });
    assert.equal(res.status, 403);
    assert.equal(res.body.code, 'EMAIL_MISMATCH');
});

test('/setprofile lets the real owner through', async () => {
    const token = signAuthToken({ email: 'owner@x.com' });
    const res = await post('/setprofile', {
        headers: { Authorization: `Bearer ${token}` },
        body: { email: 'owner@x.com', token, userDetails: { email: 'owner@x.com' } },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.email, 'owner@x.com');
});

test('/setprofile accepts the body-token form the older frontend sends', async () => {
    const token = signAuthToken({ email: 'owner@x.com' });
    const res = await post('/setprofile', {
        body: { email: 'owner@x.com', token, userDetails: { email: 'owner@x.com' } },
    });
    assert.equal(res.status, 200);
});

// body.email is the CONTACT email (stored as contactEmail); userDetails.email is
// the account identity Add_Update_Profile keys the profile on. Guarding on the
// contact email would lock out every user whose contact address differs from
// their login, and pinning it would overwrite what they typed.
test('/setprofile allows a contact email that differs from the login', async () => {
    const token = signAuthToken({ email: 'owner@work.com' });
    const res = await post('/setprofile', {
        headers: { Authorization: `Bearer ${token}` },
        body: { email: 'owner@personal.com', userDetails: { email: 'owner@work.com' } },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.contactEmail, 'owner@personal.com', 'contact email must not be rewritten');
    assert.equal(res.body.email, 'owner@work.com');
});

test('/setprofile hands downstream the canonical spelling, not a lowercased one', async () => {
    // GetProfile matches email exactly, so a profile keyed on a lowercased
    // address would be invisible to the frontend's own lookup.
    const token = signAuthToken({ email: 'John.Doe@Example.com' });
    const res = await post('/setprofile', {
        headers: { Authorization: `Bearer ${token}` },
        body: { email: 'John.Doe@Example.com', userDetails: { email: 'john.doe@example.com' } },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.canonical, 'John.Doe@Example.com');
    assert.equal(res.body.email, 'john.doe@example.com');
});

test('/api/clients/register rejects a request with no admin key', async () => {
    const res = await post('/api/clients/register', {
        body: { email: 'new@x.com', firstName: 'A', lastName: 'B', password: 'p' },
    });
    assert.equal(res.status, 403);
    assert.equal(res.body.reached, undefined);
});

test('/api/clients/register accepts the admin key', async () => {
    const res = await post('/api/clients/register', {
        headers: { 'x-admin-key': 'test-admin-key' },
        body: { email: 'new@x.com', firstName: 'A', lastName: 'B', password: 'p' },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.reached, true);
});
