// import crypto from 'crypto';
// import dotenv from 'dotenv';
// dotenv.config();


// const ALGORITHM = process.env.CRYPTO_ALGORITHM;
// const SECRET_KEY = process.env.CRYPTO_AES_SECRET_SECRET_KEY ;
// const IV_LENGTH = Number(process.env.CRYPTO_IV_LENGTH);




// export function encrypt(text) {
//   const iv = crypto.randomBytes(IV_LENGTH);
//   const cipher = crypto.createCipheriv(ALGORITHM, Buffer.from(SECRET_KEY, 'hex'), iv);
//   let encrypted = cipher.update(text, 'utf8', 'hex');
//   encrypted += cipher.final('hex');
//   return iv.toString('hex') + ':' + encrypted; // return iv + ciphertext
// }

// export function decrypt(encryptedText) {
//   const [ivHex, encrypted] = encryptedText.split(':');
//   const iv = Buffer.from(ivHex, 'hex');
//   const decipher = crypto.createDecipheriv(ALGORITHM, Buffer.from(SECRET_KEY, 'hex'), iv);
//   let decrypted = decipher.update(encrypted, 'hex', 'utf8');
//   decrypted += decipher.final('utf8');
//   return decrypted;
// }


import crypto from 'crypto';
import dotenv from 'dotenv';
dotenv.config();

const ALGORITHM = process.env.CRYPTO_ALGORITHM || 'aes-256-cbc';
const SECRET_KEY = process.env.CRYPTO_AES_SECRET_SECRET_KEY; 
const IV_LENGTH = Number(process.env.CRYPTO_IV_LENGTH) || 16;

const KEY_BUFFER = Buffer.from(SECRET_KEY, 'hex');

if (KEY_BUFFER.length !== 32) {
  throw new Error('SECRET_KEY must be 32 bytes (64 hex characters) for aes-256-cbc');
}

if (IV_LENGTH !== 16) {
  throw new Error('IV_LENGTH must be 16 bytes for aes-256-cbc');
}

export function encrypt(text) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, KEY_BUFFER, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

export function decrypt(encryptedText) {
  const [ivHex, encrypted] = encryptedText.split(':');
  if (!ivHex || !encrypted) throw new Error('Invalid encrypted text format');
  const iv = Buffer.from(ivHex, 'hex');
  if (iv.length !== IV_LENGTH) throw new Error('Invalid IV length');
  const decipher = crypto.createDecipheriv(ALGORITHM, KEY_BUFFER, iv);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}