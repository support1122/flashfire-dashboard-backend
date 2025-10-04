import mongoose from 'mongoose';

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
    
    const manager = await DashboardManager.findOne({ 
      fullName: name,
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

export { DashboardManager };
