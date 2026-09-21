import ExtensionCode from "../Schema_Models/ExtensionCode.js";


export async function resolveAddedByFromExtensionCode(code) {
  if (code === undefined || code === null) return null;
  const trimmed = String(code).trim();
  if (!/^\d{5}$/.test(trimmed)) return null;
  const doc = await ExtensionCode.findOne({ code: trimmed, isActive: true }).lean();
  return doc?.name || null;
}
