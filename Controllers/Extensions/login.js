import Operations from '../../Schema_Models/Operations.js';
import { UserModel } from '../../Schema_Models/UserModel.js';
import bcrypt from 'bcrypt';

const ExtensionLogin = async (req, res) => {
     try {
          const { email, password } = req.body;

          // Check if email and password are provided
          if (!email || !password) {
               return res.status(400).json({ success: false, message: 'Email and password are required' });
          }
          const operationsUser = await Operations.findOne({ email });
          if (!operationsUser) {
               return res.status(401).json({ success: false, message: 'Invalid email or password' });
          }

          // Compare the provided password with the hashed password
          const isPasswordValid = await bcrypt.compare(password, operationsUser.password);
          if (!isPasswordValid) {
               return res.status(401).json({ success: false, message: 'Invalid email or password' });
          }

          // Fetch all users from the UserModel schema
          const users = await UserModel.find({}, 'userID name email'); // Select only userID, name, and email

          // Successful login
          return res.status(200).json({
               success: true,
               message: 'Login successful',
               users: users, // Return the list of users
          });
     } catch (error) {
          console.error('Error during login:', error);
          return res.status(500).json({ success: false, message: 'Internal server error' });
     }
};

export default ExtensionLogin;