
import express from "express";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import dotenv from "dotenv";

dotenv.config();
const router = express.Router();

// ✅ Cloudflare R2 client configuration
const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

router.get("/presigned-url", async (req, res) => {
  try {
    const { fileName, fileType, clientName, fileKind } = req.query;
    console.log('R2_ACCOUNT_ID:', process.env.R2_ACCOUNT_ID);
console.log('R2_BUCKET_NAME:', process.env.R2_BUCKET_NAME);

    if (!clientName || !fileKind || !fileName || !fileType)
      return res.status(400).json({ error: "fileName, fileType, clientName and fileKind are required" });

    // sanitize inputs
    const safeClient = encodeURIComponent(String(clientName));
    const safeFile = encodeURIComponent(String(fileName)).replace(/%2F/g, '-');

    // Decide folder based on file kind
    const folder = String(fileKind) === "pdf" ? "Docs" : "attachments";

    // Build key: clientName/folder/timestamp_filename
    const key = `${safeClient}/${folder}/${Date.now()}_${safeFile}`;

    const command = new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key,
      ContentType: String(fileType),
    });

    const uploadUrl = await getSignedUrl(r2, command, { expiresIn: 300 });

    // Construct a user-facing file URL. Ensure R2_PUBLIC_DOMAIN is set correctly in env
    const fileUrl = `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${process.env.R2_BUCKET_NAME}/${key}`;

    // Also generate a temporary signed GET URL so the browser can fetch the object even if bucket is private
    const getCommand = new GetObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key,
    });
    const signedGetUrl = await getSignedUrl(r2, getCommand, { expiresIn: 300 });

    console.log("Generated presigned upload URL:", uploadUrl);
    console.log("Accessible file URL (may require public bucket):", fileUrl);
    console.log("Signed GET URL (temporary):", signedGetUrl);

    // Helpful for local dev testing; remove or restrict in production
    res.setHeader('Access-Control-Allow-Origin', '*');

    res.json({ uploadUrl, fileUrl, signedGetUrl, key });
  } catch (err) {
    console.error("Error generating presigned URL:", err);
    res.status(500).json({ error: "Failed to generate upload URL" });
  }
});

export default router;
