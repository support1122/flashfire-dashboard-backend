import { ClientOperationsModel } from "../../Schema_Models/ClientOperationsModel.js";

const getCurrentISTTime = () => new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

// Get client operations data (TODOs and lock periods)
export const getClientOperations = async (req, res) => {
  try {
    const { clientEmail } = req.body;

    if (!clientEmail) {
      return res.status(400).json({
        success: false,
        message: "Client email is required"
      });
    }

    let clientOps = await ClientOperationsModel.findOne({ clientEmail: clientEmail.toLowerCase() });

    // If not found, create default structure
    if (!clientOps) {
      clientOps = new ClientOperationsModel({
        clientEmail: clientEmail.toLowerCase(),
        todos: [
          {
            id: `todo-${Date.now()}-1`,
            title: "Create optimized resume",
            completed: false,
            createdAt: getCurrentISTTime(),
            updatedAt: getCurrentISTTime()
          },
          {
            id: `todo-${Date.now()}-2`,
            title: "LinkedIn Optimization",
            completed: false,
            createdAt: getCurrentISTTime(),
            updatedAt: getCurrentISTTime()
          },
          {
            id: `todo-${Date.now()}-3`,
            title: "Cover letter Optimization",
            completed: false,
            createdAt: getCurrentISTTime(),
            updatedAt: getCurrentISTTime()
          }
        ],
        lockPeriods: []
      });
      await clientOps.save();
    }

    return res.status(200).json({
      success: true,
      data: clientOps
    });
  } catch (error) {
    console.error("Error getting client operations:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch client operations data"
    });
  }
};

// Update client operations (TODOs and lock periods)
export const updateClientOperations = async (req, res) => {
  try {
    const { clientEmail, todos, lockPeriods } = req.body;

    if (!clientEmail) {
      return res.status(400).json({
        success: false,
        message: "Client email is required"
      });
    }

    const updateData = {
      updatedAt: getCurrentISTTime()
    };

    if (todos !== undefined) {
      updateData.todos = todos.map(todo => ({
        ...todo,
        updatedAt: todo.updatedAt || getCurrentISTTime()
      }));
    }

    if (lockPeriods !== undefined) {
      updateData.lockPeriods = lockPeriods;
    }

    const clientOps = await ClientOperationsModel.findOneAndUpdate(
      { clientEmail: clientEmail.toLowerCase() },
      { $set: updateData },
      { new: true, upsert: true }
    );

    return res.status(200).json({
      success: true,
      message: "Client operations updated successfully",
      data: clientOps
    });
  } catch (error) {
    console.error("Error updating client operations:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update client operations"
    });
  }
};

// Check if current date is within any lock period
export const checkLockPeriod = async (req, res) => {
  try {
    const { clientEmail } = req.body;

    if (!clientEmail) {
      return res.status(400).json({
        success: false,
        message: "Client email is required"
      });
    }

    const clientOps = await ClientOperationsModel.findOne({ clientEmail: clientEmail.toLowerCase() });

    if (!clientOps || !clientOps.lockPeriods || clientOps.lockPeriods.length === 0) {
      return res.status(200).json({
        success: true,
        isLocked: false,
        message: null
      });
    }

    const now = new Date();
    // Set time to start of day for accurate date comparison
    now.setHours(0, 0, 0, 0);

    for (const period of clientOps.lockPeriods) {
      const startDate = new Date(period.startDate);
      const endDate = new Date(period.endDate);
      
      // Set time to start of day for accurate date comparison
      startDate.setHours(0, 0, 0, 0);
      endDate.setHours(23, 59, 59, 999); // End of day

      if (now >= startDate && now <= endDate) {
        return res.status(200).json({
          success: true,
          isLocked: true,
          message: period.reason || "Job card movement is locked during this period. Please try again after the lock period ends.",
          lockPeriod: {
            startDate: period.startDate,
            endDate: period.endDate,
            reason: period.reason
          }
        });
      }
    }

    return res.status(200).json({
      success: true,
      isLocked: false,
      message: null
    });
  } catch (error) {
    console.error("Error checking lock period:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to check lock period"
    });
  }
};

