import mongoose from 'mongoose';
import { UserModel } from '../Schema_Models/UserModel.js';

// Dashboard Manager Schema
const dashboardManagerSchema = new mongoose.Schema({
  fullName: {
    type: String,
    required: true
  },
  email: {
    type: String,
    required: true
  },
  phone: {
    type: String,
    required: true
  },
  profilePhoto: {
    type: String,
    required: true
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

const DashboardManager = mongoose.models.DashboardManager || mongoose.model('DashboardManager', dashboardManagerSchema, 'dashboard_managers');
const CLIENT_TRACKING_BASE_URL = (process.env.CLIENT_TRACKING_API_BASE_URL || '').replace(/\/$/, '');

const escapeRegex = (value = '') => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const buildFallbackProfilePhoto = (fullName = 'Manager') =>
  `https://ui-avatars.com/api/?name=${encodeURIComponent(fullName)}&background=f97316&color=ffffff&bold=true`;

// Get all active dashboard managers
export const getDashboardManagers = async (req, res) => {
  try {
    const managers = await DashboardManager.find({ isActive: true })
      .select('fullName profilePhoto email phone')
      .sort({ fullName: 1 });

    res.status(200).json({
      success: true,
      data: managers
    });
  } catch (error) {
    console.error('Error fetching dashboard managers:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch dashboard managers',
      error: error.message
    });
  }
};

// Get dashboard manager by name
export const getDashboardManagerByName = async (req, res) => {
  try {
    const { name } = req.params;
    const trimmedName = String(name || '').trim();
    const exactNameRegex = new RegExp(`^${escapeRegex(trimmedName)}$`, 'i');
    
    const manager = await DashboardManager.findOne({ 
      fullName: exactNameRegex,
      isActive: true 
    });

    if (!manager) {
      return res.status(404).json({
        success: false,
        message: 'Dashboard manager not found'
      });
    }

    res.status(200).json({
      success: true,
      data: manager
    });
  } catch (error) {
    console.error('Error fetching dashboard manager:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch dashboard manager',
      error: error.message
    });
  }
};

// Sync managers + assignments from clients-tracking service into this backend.
export const syncDashboardManagers = async (_req, res) => {
  try {
    if (!CLIENT_TRACKING_BASE_URL) {
      return res.status(400).json({
        success: false,
        message: 'CLIENT_TRACKING_API_BASE_URL is not configured'
      });
    }

    const [managerRes, clientsRes] = await Promise.all([
      fetch(`${CLIENT_TRACKING_BASE_URL}/api/managers/public`),
      fetch(`${CLIENT_TRACKING_BASE_URL}/api/clients/all`)
    ]);

    if (!managerRes.ok) {
      return res.status(502).json({
        success: false,
        message: 'Failed to fetch managers from clients-tracking'
      });
    }

    if (!clientsRes.ok) {
      return res.status(502).json({
        success: false,
        message: 'Failed to fetch clients from clients-tracking'
      });
    }

    const managerPayload = await managerRes.json();
    const clientsPayload = await clientsRes.json();

    const sourceManagers = Array.isArray(managerPayload?.managers) ? managerPayload.managers : [];
    const sourceClients = Array.isArray(clientsPayload?.clients) ? clientsPayload.clients : [];

    const normalizedManagers = sourceManagers
      .map((mgr) => {
        const fullName = String(mgr?.fullName || '').trim();
        const email = String(mgr?.email || '').trim().toLowerCase();
        if (!fullName || !email) return null;

        return {
          fullName,
          email,
          phone: String(mgr?.phone || 'N/A').trim() || 'N/A',
          profilePhoto: String(mgr?.profilePhoto || '').trim() || buildFallbackProfilePhoto(fullName),
          isActive: true
        };
      })
      .filter(Boolean);

    const syncedEmails = [];
    for (const manager of normalizedManagers) {
      await DashboardManager.findOneAndUpdate(
        { email: manager.email },
        { $set: manager },
        {
          new: true,
          upsert: true,
          runValidators: true,
          setDefaultsOnInsert: true
        }
      );
      syncedEmails.push(manager.email);
    }

    if (syncedEmails.length > 0) {
      await DashboardManager.updateMany(
        { email: { $nin: syncedEmails } },
        { $set: { isActive: false } }
      );
    }

    let syncedAssignments = 0;
    for (const client of sourceClients) {
      const email = String(client?.email || '').trim().toLowerCase();
      const dashboardManager = String(client?.dashboardTeamLeadName || '').trim();
      if (!email || !dashboardManager) continue;

      const result = await UserModel.updateOne(
        { email },
        { $set: { dashboardManager } }
      );
      if (result?.modifiedCount) syncedAssignments += 1;
    }

    const activeManagers = await DashboardManager.find({ isActive: true })
      .select('fullName profilePhoto email phone')
      .sort({ fullName: 1 })
      .lean();

    return res.status(200).json({
      success: true,
      message: 'Managers synced successfully',
      syncedManagers: normalizedManagers.length,
      syncedAssignments,
      data: activeManagers
    });
  } catch (error) {
    console.error('Error syncing dashboard managers:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to sync dashboard managers',
      error: error.message
    });
  }
};

export { DashboardManager };
