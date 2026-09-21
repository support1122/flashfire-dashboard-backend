import sharp from "sharp";

const IMAGE_MIME_RX = /^image\/(jpeg|jpg|png|webp|heic|heif|avif|tiff|bmp)$/i;
const ANIMATED_MIME_RX = /^image\/(gif|apng)$/i;

// Cap width to keep dashboards/print views readable on retina without resizing screenshots vertically.
const MAX_WIDTH = 2560;
// WebP encoder rejects any side > 16383px. Tall full-page screenshots can hit this.
const WEBP_DIM_LIMIT = 16383;
const TARGET_BYTES = 1_800_000;
const HARD_FLOOR_QUALITY = 60;
const WEBP_QUALITY_LADDER = [85, 78, 70, HARD_FLOOR_QUALITY];
const JPEG_QUALITY_LADDER = [88, 82, 76, 70];

export function isCompressibleImage(mime) {
  if (!mime) return false;
  if (ANIMATED_MIME_RX.test(mime)) return false;
  return IMAGE_MIME_RX.test(mime);
}

function swapExt(filename, newExt) {
  const safe = filename || "image";
  return safe.replace(/\.[^/.]+$/, "") + "." + newExt;
}

function buildBasePipeline(inputBuffer) {
  // Width-only cap — preserves vertical resolution for long screenshots.
  // Auto-rotate via EXIF. Disable animation (we already short-circuit on GIF/APNG).
  return sharp(inputBuffer, { failOn: "none", animated: false })
    .rotate()
    .resize({ width: MAX_WIDTH, withoutEnlargement: true });
}

async function encodeWebpLadder(pipeline) {
  let last = null;
  for (const quality of WEBP_QUALITY_LADDER) {
    const out = await pipeline
      .clone()
      .webp({ quality, effort: 4, smartSubsample: true })
      .toBuffer();
    last = { buffer: out, quality, encoder: "webp" };
    if (out.length <= TARGET_BYTES) break;
  }
  return last;
}

async function encodeJpegLadder(pipeline) {
  // JPEG has no alpha. Flatten to white so transparency doesn't go black.
  const flattened = pipeline.clone().flatten({ background: "#ffffff" });
  let last = null;
  for (const quality of JPEG_QUALITY_LADDER) {
    const out = await flattened
      .clone()
      .jpeg({ quality, mozjpeg: true, progressive: true })
      .toBuffer();
    last = { buffer: out, quality, encoder: "jpeg" };
    if (out.length <= TARGET_BYTES) break;
  }
  return last;
}

export async function compressImageBuffer(
  inputBuffer,
  { originalMime, originalFilename } = {}
) {
  const originalSize = inputBuffer.length;
  const passthrough = (reason) => ({
    compressed: false,
    buffer: inputBuffer,
    contentType: originalMime,
    filename: originalFilename,
    originalSize,
    finalSize: originalSize,
    quality: null,
    encoder: null,
    reason,
  });

  if (!isCompressibleImage(originalMime)) {
    return passthrough("mime-not-compressible");
  }

  let probedHeightAfterResize = null;
  let pipeline;
  try {
    pipeline = buildBasePipeline(inputBuffer);
    const meta = await sharp(inputBuffer, { failOn: "none" }).metadata();
    if (meta && meta.width && meta.height) {
      const scale = meta.width > MAX_WIDTH ? MAX_WIDTH / meta.width : 1;
      probedHeightAfterResize = Math.round(meta.height * scale);
    }
  } catch (err) {
    return passthrough(`sharp-init-failed:${err.message}`);
  }

  const webpUnsafe =
    probedHeightAfterResize !== null && probedHeightAfterResize > WEBP_DIM_LIMIT;

  let chosen = null;
  try {
    if (!webpUnsafe) {
      chosen = await encodeWebpLadder(pipeline);
    }
  } catch (err) {
    // WebP encode threw — fall through to JPEG path.
    chosen = null;
  }

  if (!chosen) {
    try {
      chosen = await encodeJpegLadder(pipeline);
    } catch (err) {
      return passthrough(`sharp-encode-failed:${err.message}`);
    }
  }

  if (!chosen || !chosen.buffer || chosen.buffer.length >= originalSize) {
    return passthrough("compression-grew-file");
  }

  const ext = chosen.encoder === "webp" ? "webp" : "jpg";
  const contentType = chosen.encoder === "webp" ? "image/webp" : "image/jpeg";
  return {
    compressed: true,
    buffer: chosen.buffer,
    contentType,
    filename: swapExt(originalFilename, ext),
    originalSize,
    finalSize: chosen.buffer.length,
    quality: chosen.quality,
    encoder: chosen.encoder,
    reason: "ok",
  };
}

export function formatCompressionLog(result) {
  if (!result) return "";
  const kb = (n) => `${(n / 1024).toFixed(0)}KB`;
  if (!result.compressed) {
    return `[compress] skipped (${result.reason}) size=${kb(result.originalSize)}`;
  }
  const ratio = (result.originalSize / result.finalSize).toFixed(2);
  return `[compress] ${kb(result.originalSize)} → ${kb(result.finalSize)} (${ratio}x, ${result.encoder} q=${result.quality})`;
}

export default { compressImageBuffer, isCompressibleImage, formatCompressionLog };
