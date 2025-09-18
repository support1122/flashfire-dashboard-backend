import Operations from "../../Schema_Models/Operations.js";
import { UserModel } from "../../Schema_Models/UserModel.js";

export async function listOperations(req, res) {
    try {
        const ops = await Operations.find({}, "name email managedUsers")
            .populate({ path: "managedUsers", select: "firstName lastName email" });

        const payload = ops.map((op) => ({
            id: op._id,
            name: op.name,
            email: op.email,
            managedUsers: (op.managedUsers || []).map((u) => ({
                id: u._id,
                name: `${u.firstName || ""} ${u.lastName || ""}`.trim() || (u.email || ""),
                email: u.email || "",
            })),
        }));

        res.json({ operations: payload });
    } catch (err) {
        console.error("listOperations error:", err);
        res.status(500).json({ error: "Server error" });
    }
}

export async function removeManagedUser(req, res) {
    try {
        const { opId, userId } = req.params;
        if (!opId || !userId) {
            return res.status(400).json({ error: "Operation ID and User ID are required" });
        }

        const op = await Operations.findById(opId);
        if (!op) {
            return res.status(404).json({ error: "Operation user not found" });
        }

        const before = op.managedUsers.length;
        op.managedUsers = op.managedUsers.filter((id) => id.toString() !== userId);
        const after = op.managedUsers.length;

        if (before === after) {
            return res.status(404).json({ error: "User was not assigned to this operation" });
        }

        await op.save();
        res.json({ message: "User removed from operation successfully" });
    } catch (err) {
        console.error("removeManagedUser error:", err);
        res.status(500).json({ error: "Server error" });
    }
}

export async function removeOperationUser(req, res) {
    try {
        const { opId } = req.params;
        if (!opId) {
            return res.status(400).json({ error: "Operation ID is required" });
        }

        const op = await Operations.findById(opId);
        if (!op) {
            return res.status(404).json({ error: "Operation user not found" });
        }

        await Operations.deleteOne({ _id: opId });
        return res.json({ message: "Operations user removed successfully" });
    } catch (err) {
        console.error("removeOperationUser error:", err);
        res.status(500).json({ error: "Server error" });
    }
}

export async function listAllUsers(req, res) {
    try {
        const users = await UserModel.find({}, "firstName lastName email");
        const payload = users.map((u) => ({
            id: u._id,
            name: `${u.firstName || ""} ${u.lastName || ""}`.trim() || (u.email || ""),
            email: u.email || "",
        }));
        res.json({ users: payload });
    } catch (err) {
        console.error("listAllUsers error:", err);
        res.status(500).json({ error: "Server error" });
    }
}

export async function listAllOperations(req, res) {
    try {
        const ops = await Operations.find({}, "name email");
        const payload = ops.map((o) => ({ id: o._id, name: o.name, email: o.email }));
        res.json({ operations: payload });
    } catch (err) {
        console.error("listAllOperations error:", err);
        res.status(500).json({ error: "Server error" });
    }
}


