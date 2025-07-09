import jwt from 'jsonwebtoken';
import dotenv from 'dotenv'
dotenv.config();


export default async function Tokenizer(req, res,next) {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ message: 'Email is required for token generation' });
  }

  try {
    const secret = process.env.JWT_SECRET_KEY ;
    const token = jwt.sign({email} , secret , { expiresIn: '1d' });
    req.body.token = token;
    next();

    // Option 2: If you want to send the token back immediately:
    // return res.json({ token });

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Failed to generate token' });
  }
}
