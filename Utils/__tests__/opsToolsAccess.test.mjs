// Which client accounts get the operator tools without the secret key.
//
// The list grants access to Mail and Operations with no unlock modal, so the
// two things worth pinning are that it matches the intended account however the
// email is typed, and that it does not quietly match anyone else.

import assert from 'node:assert/strict';
import test from 'node:test';

import { hasOpsTools, opsToolsClientEmails } from '../opsToolsAccess.js';

const withEnv = (value, fn) => {
     const saved = process.env.OPS_TOOLS_CLIENT_EMAILS;
     if (value === undefined) delete process.env.OPS_TOOLS_CLIENT_EMAILS;
     else process.env.OPS_TOOLS_CLIENT_EMAILS = value;
     try {
          fn();
     } finally {
          if (saved === undefined) delete process.env.OPS_TOOLS_CLIENT_EMAILS;
          else process.env.OPS_TOOLS_CLIENT_EMAILS = saved;
     }
};

test('the default list grants Rijul', () => {
     withEnv(undefined, () => {
          assert.equal(hasOpsTools('rijuljain17@gmail.com'), true);
     });
});

test('case and surrounding spaces do not matter', () => {
     withEnv(undefined, () => {
          assert.equal(hasOpsTools('  RijulJain17@Gmail.com '), true);
     });
});

test('an ordinary client gets nothing', () => {
     withEnv(undefined, () => {
          assert.equal(hasOpsTools('client@example.com'), false);
          assert.equal(hasOpsTools('rijuljain17@gmail.co'), false);
          assert.equal(hasOpsTools('xrijuljain17@gmail.com'), false);
     });
});

test('missing or junk input is a no, not a throw', () => {
     withEnv(undefined, () => {
          assert.equal(hasOpsTools(undefined), false);
          assert.equal(hasOpsTools(null), false);
          assert.equal(hasOpsTools(''), false);
     });
});

test('the env var replaces the default list', () => {
     withEnv('a@x.com, B@Y.com', () => {
          assert.equal(hasOpsTools('a@x.com'), true);
          assert.equal(hasOpsTools('b@y.com'), true);
          assert.equal(hasOpsTools('rijuljain17@gmail.com'), false);
     });
});

test('an empty env var switches the feature off for everyone', () => {
     withEnv('', () => {
          assert.equal(opsToolsClientEmails().size, 0);
          assert.equal(hasOpsTools('rijuljain17@gmail.com'), false);
     });
});
