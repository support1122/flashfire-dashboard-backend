import { ClientOperationsModel } from "../../Schema_Models/ClientOperationsModel.js";
import { resolveAddedByFromExtensionCode } from "../../Utils/resolveAddedByFromExtensionCode.js";

/**
 * POST /extension/exclusion-lists
 * Body: { extensionCode, clientEmail }
 */
export async function getExtensionExclusionLists(req, res) {
  try {
    const { extensionCode, clientEmail } = req.body || {};

    const rawExtensionCode =
      extensionCode !== undefined && extensionCode !== null
        ? String(extensionCode).trim()
        : "";
    if (!rawExtensionCode || !/^\d{5}$/.test(rawExtensionCode)) {
      return res.status(400).json({
        success: false,
        error: "EXTENSION_CODE_REQUIRED",
        message:
          "A valid 5-digit operator code is required. Open the extension and enter your code, then try again.",
      });
    }

    if (!clientEmail || !String(clientEmail).trim()) {
      return res.status(400).json({
        success: false,
        message: "clientEmail is required",
      });
    }

    const addedBy = await resolveAddedByFromExtensionCode(rawExtensionCode);
    if (!addedBy) {
      return res.status(400).json({
        success: false,
        error: "INVALID_EXTENSION_CODE",
        message:
          "This code is invalid or no longer active. Re-enter your operator code in the extension.",
      });
    }

    const emailLower = String(clientEmail).toLowerCase().trim();
    const doc = await ClientOperationsModel.findOne({ clientEmail: emailLower }).lean();

    return res.status(200).json({
      success: true,
      excludedCompanies: doc?.excludedCompanies || [],
      excludedLocations: doc?.excludedLocations || [],
    });
  } catch (error) {
    console.error("getExtensionExclusionLists:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to load exclusion lists",
    });
  }
}
