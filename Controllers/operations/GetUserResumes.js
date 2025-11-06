import { UserModel } from "../../Schema_Models/UserModel.js";

export default async function GetUserResumes(req, res) {
     try {
          const email = (req.body?.email || req.query?.email || '').toLowerCase();
          if (!email) return res.status(400).json({ message: 'Email is required' });

          // Project only optimizedResumes for minimal payload
          const user = await UserModel.findOne({ email }).select('optimizedResumes').lean();
          if (!user) return res.status(404).json({ message: 'User not found' });

          return res.status(200).json({ optimizedResumes: user.optimizedResumes || [] });
     } catch (err) {
          console.error('GetUserResumes error:', err);
          return res.status(500).json({ message: 'Internal server error' });
     }
}


