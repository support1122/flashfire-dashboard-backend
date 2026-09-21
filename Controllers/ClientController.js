import { UserModel } from '../Schema_Models/UserModel.js';

// Get all clients from the users collection
export const getAllClients = async (req, res) => {
  try {
    // Fetch all users from the users collection
    const clients = await UserModel.find({}, {
      userID: 1,
      name: 1,
      email: 1,
      planType: 1,
      dashboardManager: 1,
      createdAt: 1,
      updatedAt: 1
    }).sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      data: clients,
      count: clients.length
    });
  } catch (error) {
    console.error('Error fetching clients:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch clients',
      error: error.message
    });
  }
};

// Get client by email
export const getClientByEmail = async (req, res) => {
  try {
    const { email } = req.params;
    const client = await UserModel.findOne({ email: email.toLowerCase() }, {
      userID: 1,
      name: 1,
      email: 1,
      planType: 1,
      dashboardManager: 1,
      createdAt: 1,
      updatedAt: 1
    });

    if (!client) {
      return res.status(404).json({
        success: false,
        message: 'Client not found'
      });
    }

    res.status(200).json({
      success: true,
      data: client
    });
  } catch (error) {
    console.error('Error fetching client:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch client',
      error: error.message
    });
  }
};
