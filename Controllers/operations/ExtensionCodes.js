import ExtensionCode from "../../Schema_Models/ExtensionCode.js";

function generateFiveDigitCode() {
  return Math.floor(10000 + Math.random() * 90000).toString();
}

export async function generateExtensionCode(req, res) {
  try {
    const { name } = req.body || {};
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Operator name is required' });
    }

    // Generate unique 5-digit code (retry on collision, max 10 attempts)
    let code;
    for (let i = 0; i < 10; i++) {
      const candidate = generateFiveDigitCode();
      const exists = await ExtensionCode.findOne({ code: candidate }).lean();
      if (!exists) {
        code = candidate;
        break;
      }
    }

    if (!code) {
      return res.status(500).json({ error: 'Failed to generate unique code. Try again.' });
    }

    await ExtensionCode.create({ code, name: name.trim() });

    return res.status(201).json({ code });
  } catch (error) {
    console.error('[ExtensionCodes] generate error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function verifyExtensionCode(req, res) {
  try {
    const { code } = req.body || {};
    if (!code || !/^\d{5}$/.test(String(code).trim())) {
      return res.json({ valid: false, error: 'Invalid code format' });
    }

    const doc = await ExtensionCode.findOne({ code: String(code).trim(), isActive: true }).lean();

    if (!doc) {
      return res.json({ valid: false, error: 'Invalid or deactivated code' });
    }

    return res.json({ valid: true, name: doc.name });
  } catch (error) {
    console.error('[ExtensionCodes] verify error:', error.message);
    return res.status(500).json({ valid: false, error: 'Server error' });
  }
}

export async function listExtensionCodes(req, res) {
  try {
    const codes = await ExtensionCode.find({ isActive: true })
      .sort({ createdAt: -1 })
      .select('code name createdAt isActive')
      .lean();

    return res.json(codes);
  } catch (error) {
    console.error('[ExtensionCodes] list error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
