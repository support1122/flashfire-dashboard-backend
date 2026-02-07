import { RecruiterEmailGroup } from "../Schema_Models/RecruiterEmailGroup.js";
import { RecruiterEmailTemplate } from "../Schema_Models/RecruiterEmailTemplate.js";
import { RecruiterEmailAutomation } from "../Schema_Models/RecruiterEmailAutomation.js";

export const listGroups = async (req, res) => {
  try {
    const groups = await RecruiterEmailGroup.find({})
      .sort({ createdAt: -1 })
      .lean();
    const result = groups.map(g => ({
      id: String(g._id),
      name: g.name,
      category: g.category,
      description: g.description || "",
      emailsCount: Array.isArray(g.emails) ? g.emails.length : 0,
      createdAt: g.createdAt,
      updatedAt: g.updatedAt
    }));
    res.json({ groups: result });
  } catch (error) {
    res.status(500).json({ error: "Failed to load groups" });
  }
};

export const createGroup = async (req, res) => {
  try {
    const { name, category, description, createdBy } = req.body || {};
    if (!name || !name.trim()) {
      return res.status(400).json({ error: "Group name is required" });
    }
    const group = await RecruiterEmailGroup.create({
      name: name.trim(),
      category: (category || "custom").trim(),
      description: description || "",
      emails: [],
      createdBy: createdBy || ""
    });
    res.status(201).json({
      id: String(group._id),
      name: group.name,
      category: group.category,
      description: group.description,
      emailsCount: 0,
      createdAt: group.createdAt,
      updatedAt: group.updatedAt
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to create group" });
  }
};

export const getGroup = async (req, res) => {
  try {
    const { id } = req.params;
    const group = await RecruiterEmailGroup.findById(id).lean();
    if (!group) {
      return res.status(404).json({ error: "Group not found" });
    }
    res.json({
      id: String(group._id),
      name: group.name,
      category: group.category,
      description: group.description || "",
      emails: Array.isArray(group.emails) ? group.emails : []
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to load group" });
  }
};

export const updateGroup = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, category, description, emailsText } = req.body || {};
    const group = await RecruiterEmailGroup.findById(id);
    if (!group) {
      return res.status(404).json({ error: "Group not found" });
    }
    if (name && name.trim()) {
      group.name = name.trim();
    }
    if (category && category.trim()) {
      group.category = category.trim();
    }
    if (typeof description === "string") {
      group.description = description;
    }
    if (typeof emailsText === "string") {
      const parts = emailsText
        .split(/[\n,]/)
        .map(v => v.trim())
        .filter(Boolean);
      const unique = Array.from(new Set(parts.map(v => v.toLowerCase())));
      group.emails = unique;
    }
    await group.save();
    res.json({
      id: String(group._id),
      name: group.name,
      category: group.category,
      description: group.description || "",
      emailsCount: group.emails.length
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to update group" });
  }
};

export const listTemplates = async (req, res) => {
  try {
    const templates = await RecruiterEmailTemplate.find({})
      .sort({ createdAt: -1 })
      .select("name subject createdAt updatedAt")
      .lean();
    const result = templates.map(t => ({
      id: String(t._id),
      name: t.name,
      subject: t.subject,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt
    }));
    res.json({ templates: result });
  } catch (error) {
    res.status(500).json({ error: "Failed to load templates" });
  }
};

export const createTemplate = async (req, res) => {
  try {
    const { name, subject, text, ownerEmail } = req.body || {};
    if (!name || !name.trim() || !subject || !subject.trim() || !text || !text.trim()) {
      return res.status(400).json({ error: "Name, subject and text are required" });
    }
    let attachment = null;
    if (req.file) {
      attachment = {
        filename: req.file.originalname,
        mimetype: req.file.mimetype,
        content: req.file.buffer
      };
    }
    const template = await RecruiterEmailTemplate.create({
      name: name.trim(),
      subject: subject.trim(),
      text: text.trim(),
      attachment,
      createdBy: ownerEmail || ""
    });
    res.status(201).json({
      id: String(template._id),
      name: template.name,
      subject: template.subject
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to create template" });
  }
};

export const getAutomationConfig = async (req, res) => {
  try {
    const { ownerEmail } = req.body || {};
    if (!ownerEmail || !ownerEmail.trim()) {
      return res.status(400).json({ error: "ownerEmail is required" });
    }
    const doc = await RecruiterEmailAutomation.findOne({
      ownerEmail: ownerEmail.toLowerCase().trim()
    })
      .populate("group")
      .populate("template");
    if (!doc) {
      return res.json({ config: null });
    }
    res.json({
      config: {
        id: String(doc._id),
        ownerEmail: doc.ownerEmail,
        groupId: doc.group ? String(doc.group._id) : null,
        groupName: doc.group ? doc.group.name : null,
        templateId: doc.template ? String(doc.template._id) : null,
        templateName: doc.template ? doc.template.name : null,
        dailyLimit: doc.dailyLimit,
        enabled: doc.enabled
      }
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to load automation config" });
  }
};

export const saveAutomationConfig = async (req, res) => {
  try {
    const { ownerEmail, groupId, templateId, dailyLimit, enabled } = req.body || {};
    if (!ownerEmail || !ownerEmail.trim()) {
      return res.status(400).json({ error: "ownerEmail is required" });
    }
    if (!groupId || !templateId) {
      return res.status(400).json({ error: "groupId and templateId are required" });
    }
    const limitNumber = Number(dailyLimit || 0);
    if (!Number.isFinite(limitNumber) || limitNumber <= 0) {
      return res.status(400).json({ error: "dailyLimit must be greater than zero" });
    }
    const groupExists = await RecruiterEmailGroup.exists({ _id: groupId });
    if (!groupExists) {
      return res.status(400).json({ error: "Invalid groupId" });
    }
    const templateExists = await RecruiterEmailTemplate.exists({ _id: templateId });
    if (!templateExists) {
      return res.status(400).json({ error: "Invalid templateId" });
    }
    const doc = await RecruiterEmailAutomation.findOneAndUpdate(
      { ownerEmail: ownerEmail.toLowerCase().trim() },
      {
        ownerEmail: ownerEmail.toLowerCase().trim(),
        group: groupId,
        template: templateId,
        dailyLimit: limitNumber,
        enabled: !!enabled
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    res.json({
      config: {
        id: String(doc._id),
        ownerEmail: doc.ownerEmail,
        groupId: String(doc.group),
        templateId: String(doc.template),
        dailyLimit: doc.dailyLimit,
        enabled: doc.enabled
      }
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to save automation config" });
  }
};

