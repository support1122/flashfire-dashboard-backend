// Streams a remote (Cloudinary) PDF back to the browser with a proper
// `Content-Disposition` filename. The browser's built-in PDF viewer uses this
// header for its own "Download" button, so previews downloaded from the inline
// viewer get a friendly name (e.g. "Manav_Patel_Cover_Letter.pdf") instead of
// the raw Cloudinary public_id.

// Only allow proxying from trusted asset hosts (avoid SSRF / open proxy).
const ALLOWED_HOSTS = new Set([
  "res.cloudinary.com",
  "res-1.cloudinary.com",
  "res-2.cloudinary.com",
  "res-3.cloudinary.com",
  "res-4.cloudinary.com",
]);

// Make a label safe to drop into a Content-Disposition header (no quotes,
// no path separators, no control chars). Keeps it readable.
function sanitizeFileName(name) {
  return (
    String(name || "document")
      .trim()
      .replace(/\.pdf$/i, "")
      .replace(/[^a-zA-Z0-9-_]+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "")
      .slice(0, 80) || "document"
  );
}

export const serveDocProxy = async (req, res) => {
  try {
    const { url, name, dl, probe } = req.query;
    // Cheap availability check used by the frontend to decide whether to route
    // previews through this proxy (named downloads) or fall back to the direct
    // Cloudinary URL. Lets older backends without this route degrade gracefully.
    if (probe) {
      return res.json({ ok: true });
    }
    if (!url) {
      return res.status(400).json({ success: false, message: "url is required" });
    }

    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return res.status(400).json({ success: false, message: "Invalid url" });
    }
    if (parsed.protocol !== "https:" || !ALLOWED_HOSTS.has(parsed.hostname)) {
      return res.status(400).json({ success: false, message: "URL host not allowed" });
    }

    const upstream = await fetch(parsed.toString());
    if (!upstream.ok) {
      return res.status(upstream.status).json({ success: false, message: "Upstream fetch failed" });
    }

    const fileName = sanitizeFileName(name);
    // `inline` = render in the viewer; `attachment` = force download. Both honor
    // the filename, so the viewer's own download button picks it up either way.
    const disposition = dl === "1" ? "attachment" : "inline";
    const buffer = Buffer.from(await upstream.arrayBuffer());

    // Helmet sets `X-Frame-Options: SAMEORIGIN` and CSP `frame-ancestors 'self'`
    // globally. Relax them for this response so the dashboard (served from a
    // different origin) can embed the PDF in its preview iframe. The asset is
    // already publicly reachable on Cloudinary, so permissive framing leaks
    // nothing that wasn't already public.
    res.removeHeader("X-Frame-Options");
    res.setHeader("Content-Security-Policy", "frame-ancestors *");

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `${disposition}; filename="${fileName}.pdf"; filename*=UTF-8''${encodeURIComponent(fileName)}.pdf`
    );
    res.setHeader("Content-Length", buffer.length);
    res.setHeader("Cache-Control", "private, max-age=300");
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.status(200).send(buffer);
  } catch (error) {
    console.error("Doc proxy error:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};
