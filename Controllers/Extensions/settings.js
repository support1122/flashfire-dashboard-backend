import { ClientOperationsModel } from "../../Schema_Models/ClientOperationsModel.js";
import { ClientTodosModel } from "../../Schema_Models/ClientTodosModel.js";
import { resolveAddedByFromExtensionCode } from "../../Utils/resolveAddedByFromExtensionCode.js";

const getCurrentISTTime = () => new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });

const DEFAULT_AUTOFILL_PREFERENCES = {
  autoClickNextPage: true,
  autoSubmit: false,
  saveResponses: true,
};

function normalizePrefs(input) {
  const src = input || {};
  return {
    autoClickNextPage: src.autoClickNextPage !== false,
    autoSubmit: src.autoSubmit === true,
    saveResponses: src.saveResponses !== false,
  };
}

function normalizeResumeRefs(input) {
  const src = input || {};
  return {
    resumeId: src.resumeId ? String(src.resumeId).trim() : "",
    resumeVersion: src.resumeVersion ? String(src.resumeVersion).trim() : "",
    resumeLink: src.resumeLink ? String(src.resumeLink).trim() : "",
    source: src.source ? String(src.source).trim() : "",
    syncedAt: src.syncedAt ? String(src.syncedAt).trim() : "",
  };
}

function pickLatestSettings(opDoc, todoDoc) {
  const opPrefs = opDoc?.extensionAutofillPreferences || null;
  const tdPrefs = todoDoc?.extensionAutofillPreferences || null;
  const opRefs = opDoc?.extensionResumeRefs || null;
  const tdRefs = todoDoc?.extensionResumeRefs || null;

  return {
    extensionAutofillPreferences: normalizePrefs(opPrefs || tdPrefs || DEFAULT_AUTOFILL_PREFERENCES),
    extensionResumeRefs: normalizeResumeRefs(opRefs || tdRefs || {}),
  };
}

async function validateExtensionAuth(extensionCode, clientEmail) {
  const rawExtensionCode =
    extensionCode !== undefined && extensionCode !== null
      ? String(extensionCode).trim()
      : "";
  if (!rawExtensionCode || !/^\d{5}$/.test(rawExtensionCode)) {
    return {
      ok: false,
      status: 400,
      body: {
        success: false,
        error: "EXTENSION_CODE_REQUIRED",
        message:
          "A valid 5-digit operator code is required. Open the extension and enter your code, then try again.",
      },
    };
  }

  const emailLower = clientEmail ? String(clientEmail).toLowerCase().trim() : "";
  if (!emailLower) {
    return {
      ok: false,
      status: 400,
      body: {
        success: false,
        message: "clientEmail is required",
      },
    };
  }

  const addedBy = await resolveAddedByFromExtensionCode(rawExtensionCode);
  if (!addedBy) {
    return {
      ok: false,
      status: 400,
      body: {
        success: false,
        error: "INVALID_EXTENSION_CODE",
        message:
          "This code is invalid or no longer active. Re-enter your operator code in the extension.",
      },
    };
  }

  return {
    ok: true,
    extensionCode: rawExtensionCode,
    clientEmail: emailLower,
  };
}

export async function getExtensionSettings(req, res) {
  try {
    const auth = await validateExtensionAuth(req.body?.extensionCode, req.body?.clientEmail);
    if (!auth.ok) {
      return res.status(auth.status).json(auth.body);
    }

    const [opDoc, todoDoc] = await Promise.all([
      ClientOperationsModel.findOne({ clientEmail: auth.clientEmail })
        .select("extensionAutofillPreferences extensionResumeRefs")
        .lean(),
      ClientTodosModel.findOne({ clientEmail: auth.clientEmail })
        .select("extensionAutofillPreferences extensionResumeRefs")
        .lean(),
    ]);

    const settings = pickLatestSettings(opDoc, todoDoc);
    return res.status(200).json({
      success: true,
      data: settings,
    });
  } catch (error) {
    console.error("getExtensionSettings:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to load extension settings",
    });
  }
}

export async function updateExtensionSettings(req, res) {
  try {
    const auth = await validateExtensionAuth(req.body?.extensionCode, req.body?.clientEmail);
    if (!auth.ok) {
      return res.status(auth.status).json(auth.body);
    }

    const hasPrefs = req.body?.extensionAutofillPreferences !== undefined;
    const hasResumeRefs = req.body?.extensionResumeRefs !== undefined;
    if (!hasPrefs && !hasResumeRefs) {
      return res.status(400).json({
        success: false,
        message: "No settings payload provided",
      });
    }

    const now = getCurrentISTTime();
    const updateData = {
      updatedAt: now,
    };

    if (hasPrefs) {
      updateData.extensionAutofillPreferences = {
        ...normalizePrefs(req.body.extensionAutofillPreferences),
        updatedAt: now,
      };
    }

    if (hasResumeRefs) {
      updateData.extensionResumeRefs = {
        ...normalizeResumeRefs(req.body.extensionResumeRefs),
        updatedAt: now,
      };
    }

    const updatePayload = {
      $set: updateData,
      $setOnInsert: {
        clientEmail: auth.clientEmail,
        createdAt: now,
      },
    };

    const [opDoc, todoDoc] = await Promise.all([
      ClientOperationsModel.findOneAndUpdate(
        { clientEmail: auth.clientEmail },
        updatePayload,
        { new: true, upsert: true }
      ),
      ClientTodosModel.findOneAndUpdate(
        { clientEmail: auth.clientEmail },
        updatePayload,
        { new: true, upsert: true }
      ),
    ]);

    const settings = pickLatestSettings(opDoc, todoDoc);
    return res.status(200).json({
      success: true,
      message: "Extension settings updated successfully",
      data: settings,
    });
  } catch (error) {
    console.error("updateExtensionSettings:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to update extension settings",
    });
  }
}
