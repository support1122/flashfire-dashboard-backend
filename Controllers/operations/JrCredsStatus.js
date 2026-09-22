import Operations from "../../Schema_Models/Operations.js";
import { UserModel } from "../../Schema_Models/UserModel.js";
import { AutopilotCreds } from "../../Schema_Models/AutopilotCreds.js";

// POST /operations/jr-creds-status   body: { operatorEmail, clientEmail }
//
// Answers one question for the dashboard: does this client still need their
// JobRight login saved before the autopilot can work them unattended?
//
// WHY THE SERVER DECIDES, AND NOT THE BROWSER
// The operator "session" in this app lives in a zustand store persisted to
// localStorage, so `role === "operations"` is a value the person at the
// keyboard can type in their own devtools. A client who did that would see any
// operator-only UI that trusts it. So this route re-establishes the identity
// against the database on every call, and the prompt renders off THIS
// response rather than off local state: a client gets 403, receives no
// payload, and therefore has nothing to render. The password likewise only
// exists in the response - it is never a constant in the bundle.
//
// The check is deliberately two-sided:
//   1. operatorEmail must be a real Operations document. That collection only
//      accepts @flashfirehq addresses (see its schema), so a client address
//      can never match.
//   2. that operator must actually manage this client. Without this, one
//      known operator address would unlock every client on the platform.
//      Admins skip it, because they legitimately work across all clients.
export default async function JrCredsStatus(req, res) {
    try {
        const operatorEmail = String(req.body?.operatorEmail || "").toLowerCase().trim();
        const clientEmail = String(req.body?.clientEmail || "").toLowerCase().trim();

        if (!operatorEmail.includes("@") || !clientEmail.includes("@")) {
            return res.status(400).json({
                success: false,
                error: "BAD_INPUT",
                message: "operatorEmail and clientEmail are required",
            });
        }

        // Same answer for "not an operator" and "not your client": a 403 that
        // distinguishes them lets someone enumerate which operator owns whom.
        const deny = () =>
            res.status(403).json({ success: false, error: "NOT_AN_OPERATOR" });

        const operator = await Operations.findOne({ email: operatorEmail })
            .select("email role managedUsers")
            .lean();
        if (!operator) return deny();

        const client = await UserModel.findOne({ email: clientEmail }).select("_id").lean();
        if (!client) return deny();

        if (operator.role !== "admin") {
            const managed = (operator.managedUsers || []).some(
                (id) => String(id) === String(client._id),
            );
            if (!managed) return deny();
        }

        const creds = await AutopilotCreds.findOne({ clientEmail })
            .select("jrEmail jrPassword")
            .lean();

        // Mirrors the condition the autopilot itself gates auto-login on:
        //   if creds.get("jrEmail") and creds.get("jrPassword"):
        // A row that exists with either field blank is NOT set up, so reporting
        // on the row's existence alone would tell the operator everything is
        // fine while runs keep failing at the login step.
        const hasEmail = !!String(creds?.jrEmail || "").trim();
        const hasPassword = !!String(creds?.jrPassword || "").trim();
        const needsSetup = !hasEmail || !hasPassword;

        return res.status(200).json({
            success: true,
            clientEmail,
            needsSetup,
            // What is already there, so the prompt can say "password is saved,
            // the email is not" instead of asking for both again.
            hasEmail,
            hasPassword,
            // Only travels when there is something to set up, and only to a
            // caller that just proved it manages this client.
            ...(needsSetup
                ? {
                      jobrightUrl: "https://jobright.ai/login",
                      suggestedEmail: clientEmail,
                      suggestedPassword: "Jobhunt@2026",
                  }
                : {}),
        });
    } catch (error) {
        console.error("JrCredsStatus failed:", error);
        return res.status(500).json({ success: false, error: "INTERNAL", message: error.message });
    }
}
