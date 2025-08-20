import express from 'express';
import Routes from "./Routes.js";
import Connection from './Utils/ConnectDB.js';
import cors from 'cors';

const app = express();
app.use(cors({
  origin: ['https://portal.flashfirejobs.com','https://flashfire-dashboard-frontend.vercel.app', 'http://localhost:5173', 'http://localhost:5173/login', 'https://portal.flashfirejobs.com/login'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));
app.options('*', cors());
app.use((req, res, next) => {
  res.removeHeader('Cross-Origin-Opener-Policy');
  res.setHeader('Cross-Origin-Opener-Policy', 'unsafe-none');
  next();
});
app.use(express.json());

// Add default root route
app.get('/', (req, res) => {
    res.send('Dashboard API is up and running 🚀');
});


app.post('/sheets/row-marked', (req, res) => {
  if (req.headers['x-auth-token'] !== 'your-shared-secret') {
    return res.status(401).json({ error: 'unauthorized' });
  }

  // req.body contains the row object (including headers as keys)
  console.log('Received marked row:', req.body);

  // TODO: save to DB, queue, etc.
  res.json({ ok: true });
});

try {
  Routes(app);
} catch (err) {
  console.error("❌ Route Mount Error:", err);
}
Connection();

const PORT = 8086;
app.listen(PORT, () => {
    console.log('Server is live at port:', PORT);
});
