import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
dotenv.config();

export default function ExtensionAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Missing bearer token' });
  }
  const token = authHeader.substring(7);
  try {
    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET || 'flashfire-secret-key-2024'
    );
    if (!decoded?.email) return res.status(401).json({ message: 'Invalid token payload' });
    req.user = { email: decoded.email, name: decoded.name };
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
}
