import Operations from "../../Schema_Models/Operations.js";
import bcrypt from "bcrypt";

export async function OperationsLogin(req, res) {
     try {
          const { email, password } = req.body;

          if (!email || !password) {
               return res.status(400).json({ error: "Email and password are required" });
          }

          const opUser = await Operations.findOne({ email }).populate({
               path: 'managedUsers',
               select: 'userID name email'
          });

          if (!opUser) {
               return res.status(401).json({ error: "Invalid credentials" });
          }

          const isMatch = await bcrypt.compare(password, opUser.password);
          if (!isMatch) {
               return res.status(401).json({ error: "Invalid credentials" });
          }

          res.json({
               message: "Login successful",
               user: {
                    id: opUser._id,
                    name: opUser.name,
                    email: opUser.email,
                    role: opUser.role,
                    managedUsers: opUser.managedUsers
               },
          });
     } catch (err) {
          console.error("Login error:", err);
          res.status(500).json({ error: "Server error" });
     }
}


export async function OperationsRegister(req, res) {
     try {
          const { email, password } = req.body;

          if (!email || !password) {
               return res.status(400).json({ error: "Email and password are required" });
          }

          // check existing
          const exists = await Operations.findOne({ email });
          if (exists) {
               return res.status(400).json({ error: "Email already registered" });
          }

          // hash password
          const hashed = await bcrypt.hash(password, 10);

          const opUser = new Operations({
               name: email.split("@")[0], // simple default name
               email,
               password: hashed,
               role: 'operations', // Hard-code the role to 'operations'
          });

          await opUser.save();

          res.status(201).json({ message: "Registered successfully", id: opUser._id });
     } catch (err) {
          console.error("Register error:", err);
          res.status(500).json({ error: "Server error" });
     }
}
