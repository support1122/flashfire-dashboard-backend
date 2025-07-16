import express from 'express';
import Routes from "./Routes.js";
import Connection from './Utils/ConnectDB.js';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json());

// Add default root route
app.get('/', (req, res) => {
    res.send('Dashboard API is up and running 🚀');
});

Routes(app);
Connection();

const PORT = 8086;
app.listen(PORT, () => {
    console.log('Server is live at port:', PORT);
});
