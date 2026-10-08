import assert from 'node:assert/strict';
import test from 'node:test';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import ExtensionCode from './Schema_Models/ExtensionCode.js';
import { generateExtensionCode, verifyExtensionCode, listExtensionCodes, deleteExtensionCode } from './Controllers/operations/ExtensionCodes.js';

dotenv.config();

// Mock res object
const mockRes = () => {
  const res = {};
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (data) => {
    res.body = data;
    return res;
  };
  return res;
};

test('Extension Code Lifecycle: Create -> List -> Verify -> Delete -> Verify', async () => {
  // Connect to DB (use test db if possible, but here we'll just use the one from env)
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGODB_URI);
  }

  const name = 'Test Operator ' + Date.now();
  let generatedCode;

  // 1. Generate
  const reqGen = { body: { name } };
  const resGen = mockRes();
  await generateExtensionCode(reqGen, resGen);
  assert.equal(resGen.statusCode, 201);
  generatedCode = resGen.body.code;
  assert.match(generatedCode, /^\d{5}$/);

  // 2. List
  const reqList = {};
  const resList = mockRes();
  await listExtensionCodes(reqList, resList);
  const found = resList.body.find(c => c.code === generatedCode);
  assert.ok(found);
  assert.equal(found.name, name);

  // 3. Verify
  const reqVerify = { body: { code: generatedCode } };
  const resVerify = mockRes();
  await verifyExtensionCode(reqVerify, resVerify);
  assert.equal(resVerify.body.valid, true);
  assert.equal(resVerify.body.name, name);

  // 4. Delete
  const reqDel = { params: { code: generatedCode } };
  const resDel = mockRes();
  await deleteExtensionCode(reqDel, resDel);
  assert.equal(resDel.body.success, true);

  // 5. List again
  const resList2 = mockRes();
  await listExtensionCodes(reqList, resList2);
  const found2 = resList2.body.find(c => c.code === generatedCode);
  assert.ok(!found2);

  // 6. Verify again
  const resVerify2 = mockRes();
  await verifyExtensionCode(reqVerify, resVerify2);
  assert.equal(resVerify2.body.valid, false);
  assert.equal(resVerify2.body.error, 'Invalid or deactivated code');

  // Cleanup: ensure it's deleted (already should be)
  await ExtensionCode.deleteOne({ code: generatedCode });
});

test.after(async () => {
  await mongoose.disconnect();
});
