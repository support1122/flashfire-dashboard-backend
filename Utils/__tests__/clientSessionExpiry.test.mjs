// How long a session lasts, per kind of caller.
//
// Clients open the portal every week or two, not every day, so a 7-day token
// signed them out between visits. They now get 30 days; operators deliberately
// do not, because an operator session reaches every client's data and usually
// lives on a shared office machine.
//
// These assertions exist because the difference is invisible at the call site:
// three of the six signAuthToken() calls in the codebase pass an expiry and
// three rely on the default, and nothing but a test stops someone "tidying up"
// by deleting the argument.

import assert from 'node:assert/strict';
import test from 'node:test';
import jwt from 'jsonwebtoken';

import { CLIENT_SESSION_EXPIRY, signAuthToken, verifyAuthToken } from '../AuthToken.js';

const SECONDS_PER_DAY = 24 * 60 * 60;

/** Lifetime of a token in whole days, read back off the token itself. */
const lifetimeDays = (token) => {
     const { iat, exp } = jwt.decode(token);
     return Math.round((exp - iat) / SECONDS_PER_DAY);
};

test('the client window is 30 days', () => {
     assert.equal(CLIENT_SESSION_EXPIRY, '30d');
});

test('a client token lasts 30 days', () => {
     // Exactly how Login.js, Register.js, GoogleOAuth.js and RefreshToken.js
     // mint a client session.
     const token = signAuthToken({ email: 'client@example.com' }, { expiresIn: CLIENT_SESSION_EXPIRY });
     assert.equal(lifetimeDays(token), 30);
});

test('an operator token keeps the shorter default', () => {
     // RefreshToken.js:50 and GoogleOAuth.js:153 pass no expiry on purpose.
     const token = signAuthToken({ email: 'ops@example.com' });
     assert.equal(lifetimeDays(token), 7);
});

test('an operator-minted client token stays at 24 hours', () => {
     // Controllers/operations/GetUserDetails.js. An operator stepping into a
     // client account must not leave a long-lived client session behind.
     const token = signAuthToken({ email: 'client@example.com', role: 'User' }, { expiresIn: '24h' });
     assert.equal(lifetimeDays(token), 1);
});

test('a 30-day client token verifies today', () => {
     const token = signAuthToken({ email: 'client@example.com' }, { expiresIn: CLIENT_SESSION_EXPIRY });
     assert.equal(verifyAuthToken(token)?.email, 'client@example.com');
});

test('a client token that has run out is rejected, not merely old', () => {
     // The 30 days has to be a real boundary. If this ever passed, the window
     // would be decorative.
     const dead = signAuthToken({ email: 'client@example.com' }, { expiresIn: '-1s' });
     assert.equal(verifyAuthToken(dead), null);
});

test('a client token 29 days old still works, 31 days old does not', () => {
     const now = Math.floor(Date.now() / 1000);
     const fresh = signAuthToken(
          { email: 'client@example.com', iat: now - 29 * SECONDS_PER_DAY },
          { expiresIn: CLIENT_SESSION_EXPIRY, noTimestamp: true },
     );
     const stale = signAuthToken(
          { email: 'client@example.com', iat: now - 31 * SECONDS_PER_DAY },
          { expiresIn: CLIENT_SESSION_EXPIRY, noTimestamp: true },
     );
     assert.equal(verifyAuthToken(fresh)?.email, 'client@example.com');
     assert.equal(verifyAuthToken(stale), null);
});

test('the window slides: a refresh issues a full 30 days again', () => {
     // This is what makes "30 days" mean 30 days of ABSENCE rather than 30 days
     // from first login. The portal refreshes on load and every five minutes,
     // so a client who visits inside the window never gets signed out.
     const old = signAuthToken(
          { email: 'client@example.com', iat: Math.floor(Date.now() / 1000) - 29 * SECONDS_PER_DAY },
          { expiresIn: CLIENT_SESSION_EXPIRY, noTimestamp: true },
     );
     const decoded = verifyAuthToken(old);
     assert.ok(decoded, 'the old token must still verify, or it could not be refreshed');

     const renewed = signAuthToken({ email: decoded.email }, { expiresIn: CLIENT_SESSION_EXPIRY });
     assert.equal(lifetimeDays(renewed), 30);
});
