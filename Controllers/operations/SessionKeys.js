import Operations from "../../Schema_Models/Operations.js";

function generateEightDigitKey() {
     return Math.floor(10000000 + Math.random() * 90000000).toString();
}

export async function generateSessionKey(req, res) {
     try {
          const { username, duration = 24, createdBy = 'admin', target = 'dashboard' } = req.body || {};
          if (!username) return res.status(400).json({ error: 'username (email) is required' });

          if (!username.toLowerCase().endsWith("@flashfirehq")) {
               return res.status(400).json({ error: 'Only @flashfirehq emails are allowed' });
          }

          if (target === 'optimizer') {
               // No session key needed for optimizer per requirements
               return res.status(200).json({ message: 'No session key required for optimizer' });
          }

          const opUser = await Operations.findOne({ email: username.toLowerCase() });
          if (!opUser) return res.status(404).json({ error: 'Operator not found' });

          const sessionKey = generateEightDigitKey();
          const expiresAt = new Date(Date.now() + Number(duration) * 60 * 60 * 1000);

          opUser.sessionKeys.push({
               sessionKey,
               createdBy,
               duration: Number(duration),
               target: 'dashboard',
               expiresAt,
               isUsed: false,
               isActive: true,
          });

          await opUser.save();

          return res.status(201).json({ sessionKey, expiresAt });
     } catch (err) {
          console.error('generateSessionKey error:', err);
          return res.status(500).json({ error: 'Server error' });
     }
}

export async function listSessionKeys(_req, res) {
     try {
          const ops = await Operations.find({}, 'email sessionKeys');
          const flat = [];
          for (const op of ops) {
               for (const s of op.sessionKeys || []) {
                    flat.push({
                         _id: s._id,
                         username: op.email,
                         sessionKey: s.sessionKey,
                         createdBy: s.createdBy,
                         duration: s.duration,
                         target: s.target,
                         expiresAt: s.expiresAt,
                         isUsed: s.isUsed,
                         isActive: s.isActive,
                         createdAt: s.createdAt,
                    });
               }
          }
          flat.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
          return res.json(flat);
     } catch (err) {
          console.error('listSessionKeys error:', err);
          return res.status(500).json({ error: 'Server error' });
     }
}

export async function revokeSession(req, res) {
     try {
          const { sessionId } = req.body || {};
          if (!sessionId) return res.status(400).json({ error: 'sessionId is required' });

          const opUser = await Operations.findOne({ 'sessionKeys._id': sessionId });
          if (!opUser) return res.status(404).json({ error: 'Session not found' });
          const s = opUser.sessionKeys.id(sessionId);
          if (!s) return res.status(404).json({ error: 'Session not found' });
          s.isActive = false;
          await opUser.save();
          return res.json({ message: 'Session revoked' });
     } catch (err) {
          console.error('revokeSession error:', err);
          return res.status(500).json({ error: 'Server error' });
     }
}

export async function revokeUserSessions(req, res) {
     try {
          const { username } = req.body || {};
          if (!username) return res.status(400).json({ error: 'username is required' });
          const opUser = await Operations.findOne({ email: username.toLowerCase() });
          if (!opUser) return res.status(404).json({ error: 'Operator not found' });
          for (const s of opUser.sessionKeys || []) {
               s.isActive = false;
          }
          await opUser.save();
          return res.json({ message: 'All sessions revoked' });
     } catch (err) {
          console.error('revokeUserSessions error:', err);
          return res.status(500).json({ error: 'Server error' });
     }
}

export async function listActiveSessions(_req, res) {
     try {
          const ops = await Operations.find({}, 'email sessionKeys');
          const active = [];
          const now = Date.now();
          for (const op of ops) {
               for (const s of op.sessionKeys || []) {
                    if (s.isActive && !s.isUsed && new Date(s.expiresAt).getTime() > now) {
                         active.push({
                              _id: s._id,
                              username: op.email,
                              ipAddress: 'N/A',
                              userAgent: 'N/A',
                              location: 'N/A',
                              createdAt: s.createdAt,
                              lastActivity: s.createdAt,
                              isActive: true,
                         });
                    }
               }
          }
          return res.json(active);
     } catch (err) {
          console.error('listActiveSessions error:', err);
          return res.status(500).json({ error: 'Server error' });
     }
}

export async function verifySessionKey(req, res) {
     try {
          const { email, sessionKey } = req.body || {};
          if (!email || !sessionKey) return res.status(400).json({ error: 'email and sessionKey are required' });
          const opUser = await Operations.findOne({ email: email.toLowerCase() });
          if (!opUser) return res.status(404).json({ error: 'Operator not found' });
          const now = Date.now();
          const entry = (opUser.sessionKeys || []).find(s => s.sessionKey === sessionKey && s.isActive && new Date(s.expiresAt).getTime() > now);
          if (!entry) return res.status(400).json({ error: 'Invalid or expired session key' });
          // Allow reuse until expiry; do not flip to used
          return res.json({ message: 'Session key verified', expiresAt: entry.expiresAt });
     } catch (err) {
          console.error('verifySessionKey error:', err);
          return res.status(500).json({ error: 'Server error' });
     }
}


