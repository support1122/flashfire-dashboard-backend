import { ClientOperationsModel } from "../../Schema_Models/ClientOperationsModel.js";
import { ClientTodosModel } from "../../Schema_Models/ClientTodosModel.js";
import mongoose from "mongoose";

const getCurrentISTTime = () => new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

const ClientSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  name: { type: String, required: true, trim: true },
  status: { type: String, enum: ["active", "inactive"], required: true, default: "active" },
  isPaused: { type: Boolean, default: false }
}, { collection: 'dashboardtrackings', timestamps: false });

const ClientModel = mongoose.models.DashboardTracking || mongoose.model('DashboardTracking', ClientSchema, 'dashboardtrackings');

// Helper function to merge TODOs from both models, keeping the most recent version
const mergeTodos = (todos1, todos2) => {
  const todoMap = new Map();
  
  // Add all TODOs from first array
  todos1.forEach(todo => {
    todoMap.set(todo.id, todo);
  });
  
  // Merge TODOs from second array, keeping the one with the latest updatedAt
  todos2.forEach(todo => {
    const existing = todoMap.get(todo.id);
    if (!existing) {
      todoMap.set(todo.id, todo);
    } else {
      // Compare updatedAt timestamps and keep the most recent
      // Handle both string dates and Date objects
      const existingTime = existing.updatedAt 
        ? (typeof existing.updatedAt === 'string' ? new Date(existing.updatedAt) : existing.updatedAt)
        : (existing.createdAt ? (typeof existing.createdAt === 'string' ? new Date(existing.createdAt) : existing.createdAt) : new Date(0));
      const newTime = todo.updatedAt 
        ? (typeof todo.updatedAt === 'string' ? new Date(todo.updatedAt) : todo.updatedAt)
        : (todo.createdAt ? (typeof todo.createdAt === 'string' ? new Date(todo.createdAt) : todo.createdAt) : new Date(0));
      
      if (newTime > existingTime || isNaN(existingTime.getTime())) {
        todoMap.set(todo.id, todo);
      }
    }
  });
  
  return Array.from(todoMap.values());
};

// Helper function to merge lock periods from both models
const mergeLockPeriods = (periods1, periods2) => {
  const periodMap = new Map();
  
  periods1.forEach(period => {
    periodMap.set(period.id, period);
  });
  
  periods2.forEach(period => {
    const existing = periodMap.get(period.id);
    if (!existing) {
      periodMap.set(period.id, period);
    } else {
      // Keep the most recent one
      const existingTime = existing.createdAt 
        ? (typeof existing.createdAt === 'string' ? new Date(existing.createdAt) : existing.createdAt)
        : new Date(0);
      const newTime = period.createdAt 
        ? (typeof period.createdAt === 'string' ? new Date(period.createdAt) : period.createdAt)
        : new Date(0);
      
      if (newTime > existingTime || isNaN(existingTime.getTime())) {
        periodMap.set(period.id, period);
      }
    }
  });
  
  return Array.from(periodMap.values());
};

// Helper function to get default TODOs
const getDefaultTodos = () => {
  const timestamp = Date.now();
  return [
    {
      id: `todo-${timestamp}-1`,
      title: "Create optimized resume",
      completed: false,
      notes: "",
      createdBy: "",
      createdAt: getCurrentISTTime(),
      updatedAt: getCurrentISTTime()
    },
    {
      id: `todo-${timestamp}-2`,
      title: "LinkedIn Optimization",
      completed: false,
      notes: "",
      createdBy: "",
      createdAt: getCurrentISTTime(),
      updatedAt: getCurrentISTTime()
    },
    {
      id: `todo-${timestamp}-3`,
      title: "Cover letter Optimization",
      completed: false,
      notes: "",
      createdBy: "",
      createdAt: getCurrentISTTime(),
      updatedAt: getCurrentISTTime()
    }
  ];
};

// Get client operations data (TODOs and lock periods) - SYNCED with ClientTodosModel
export const getClientOperations = async (req, res) => {
  try {
    const { clientEmail } = req.body;

    if (!clientEmail) {
      return res.status(400).json({
        success: false,
        message: "Client email is required"
      });
    }

    const emailLower = clientEmail.toLowerCase();
    
    // Fetch from both models
    let clientOps = await ClientOperationsModel.findOne({ clientEmail: emailLower });
    let clientTodos = await ClientTodosModel.findOne({ clientEmail: emailLower });

    // If neither exists, create default structure in both
    if (!clientOps && !clientTodos) {
      const defaultTodos = getDefaultTodos();
      const defaultData = {
        clientEmail: emailLower,
        todos: defaultTodos,
        lockPeriods: [],
        createdAt: getCurrentISTTime(),
        updatedAt: getCurrentISTTime()
      };

      clientOps = new ClientOperationsModel(defaultData);
      clientTodos = new ClientTodosModel(defaultData);
      
      await Promise.all([
        clientOps.save(),
        clientTodos.save()
      ]);
    } else {
      // Merge data from both models
      const mergedTodos = mergeTodos(
        clientOps?.todos || [],
        clientTodos?.todos || []
      );
      const mergedLockPeriods = mergeLockPeriods(
        clientOps?.lockPeriods || [],
        clientTodos?.lockPeriods || []
      );

      // Ensure default TODOs are present
      const defaultTodoTitles = ["Create optimized resume", "LinkedIn Optimization", "Cover letter Optimization"];
      const existingTitles = mergedTodos.map(t => t.title);
      const missingDefaults = defaultTodoTitles.filter(title => !existingTitles.includes(title));
      
      if (missingDefaults.length > 0 || mergedTodos.length === 0) {
        // Add missing default TODOs
        const defaultTodos = getDefaultTodos();
        defaultTodos.forEach(defaultTodo => {
          if (!mergedTodos.find(t => t.title === defaultTodo.title)) {
            mergedTodos.push(defaultTodo);
          }
        });
      }

      // Update both models with merged data
      const updateData = {
        todos: mergedTodos,
        lockPeriods: mergedLockPeriods,
        updatedAt: getCurrentISTTime()
      };

      if (!clientOps) {
        clientOps = new ClientOperationsModel({
          clientEmail: emailLower,
          ...updateData,
          createdAt: getCurrentISTTime()
        });
      } else {
        clientOps.todos = mergedTodos;
        clientOps.lockPeriods = mergedLockPeriods;
        clientOps.updatedAt = getCurrentISTTime();
      }

      if (!clientTodos) {
        clientTodos = new ClientTodosModel({
          clientEmail: emailLower,
          ...updateData,
          createdAt: getCurrentISTTime()
        });
      } else {
        clientTodos.todos = mergedTodos;
        clientTodos.lockPeriods = mergedLockPeriods;
        clientTodos.updatedAt = getCurrentISTTime();
      }

      // Save both models
      await Promise.all([
        clientOps.save(),
        clientTodos.save()
      ]);
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

// Update client operations (TODOs and lock periods) - SYNCED with ClientTodosModel
export const updateClientOperations = async (req, res) => {
  try {
    const { clientEmail, todos, lockPeriods, operatorName } = req.body;

    if (!clientEmail) {
      return res.status(400).json({
        success: false,
        message: "Client email is required"
      });
    }

    const emailLower = clientEmail.toLowerCase();
    const updateData = {
      updatedAt: getCurrentISTTime()
    };

    if (todos !== undefined) {
      updateData.todos = todos.map(todo => ({
        ...todo,
        // Preserve createdBy if it exists, otherwise set from operatorName
        createdBy: todo.createdBy || (operatorName || ""),
        updatedAt: todo.updatedAt || getCurrentISTTime()
      }));
    }

    if (lockPeriods !== undefined) {
      updateData.lockPeriods = lockPeriods;
    }

    // Update both models simultaneously to keep them in sync
    const [clientOps, clientTodos] = await Promise.all([
      ClientOperationsModel.findOneAndUpdate(
        { clientEmail: emailLower },
        { $set: updateData },
        { new: true, upsert: true }
      ),
      ClientTodosModel.findOneAndUpdate(
        { clientEmail: emailLower },
        { $set: updateData },
        { new: true, upsert: true }
      )
    ]);

    // If upsert created new documents, ensure they have clientEmail
    if (clientOps && !clientOps.clientEmail) {
      clientOps.clientEmail = emailLower;
      await clientOps.save();
    }
    if (clientTodos && !clientTodos.clientEmail) {
      clientTodos.clientEmail = emailLower;
      await clientTodos.save();
    }

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

export const isClientLocked = async (clientEmail) => {
  try {
    const emailLower = clientEmail.toLowerCase();
    
    const client = await ClientModel.findOne({ email: emailLower }).select('status isPaused').lean();
    if (client && client.isPaused) {
      return {
        isLocked: true,
        message: "Client is in lock period"
      };
    }
    
    const clientOps = await ClientOperationsModel.findOne({ clientEmail: emailLower });
    if (!clientOps || !clientOps.lockPeriods || clientOps.lockPeriods.length === 0) {
      return { isLocked: false, message: null };
    }
    
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    
    for (const period of clientOps.lockPeriods) {
      const startDate = new Date(period.startDate);
      const endDate = new Date(period.endDate);
      startDate.setHours(0, 0, 0, 0);
      endDate.setHours(23, 59, 59, 999);
      
      if (now >= startDate && now <= endDate) {
        return {
          isLocked: true,
          message: period.reason || "Client is in lock period"
        };
      }
    }
    
    return { isLocked: false, message: null };
  } catch (error) {
    console.error("Error checking if client is locked:", error);
    return { isLocked: false, message: null };
  }
};

export const checkLockPeriod = async (req, res) => {
  try {
    const { clientEmail } = req.body;

    if (!clientEmail) {
      return res.status(400).json({
        success: false,
        message: "Client email is required"
      });
    }

    const lockCheck = await isClientLocked(clientEmail);

    if (lockCheck.isLocked) {
      return res.status(200).json({
        success: true,
        isLocked: true,
        message: lockCheck.message || "Client is in lock period"
      });
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

