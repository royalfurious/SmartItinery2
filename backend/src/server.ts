import express, { Application } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import http from 'http';
import authRoutes from './routes/auth.routes';
import itineraryRoutes from './routes/itinerary.routes';
import translationRoutes from './routes/translation.routes';
import weatherRoutes from './routes/weather.routes';
import uploadRoutes from './routes/upload.routes';
import collaboratorRoutes from './routes/collaborator.routes';
import messageRoutes from './routes/message.routes';
import chatRoutes from './routes/chat.routes';
import { errorHandler, notFoundHandler } from './middleware/error.middleware';
import pool from './config/database';
import { socketService } from './services/socket.service';

dotenv.config();

const app: Application = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

// Initialize Socket.io
socketService.initialize(server);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve uploaded files statically
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Routes
app.get('/', (req, res) => {
  res.json({ message: 'Smart Travel Itinerary Planner API' });
});

app.use('/api/auth', authRoutes);
app.use('/api/itineraries', itineraryRoutes);
app.use('/api/translate', translationRoutes);
app.use('/api/weather', weatherRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/collaborators', collaboratorRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/chat', chatRoutes);

// Error handling
app.use(notFoundHandler);
app.use(errorHandler);

// Database connection test
const testDatabaseConnection = async () => {
  try {
    const connection = await pool.getConnection();
    console.log('✓ Database connected successfully');
    connection.release();
  } catch (error) {
    console.error('✗ Database connection failed:', error);
    console.error('Please ensure MySQL is running and credentials are correct in .env file');
  }
};

// Lightweight startup migration: ensure users.status exists for admin dashboard stats & user management
const ensureUserStatusColumn = async () => {
  const dbName = process.env.DB_NAME;
  if (!dbName) {
    return;
  }

  try {
    const [rows] = await pool.query(
      "SELECT COUNT(*) AS count FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users' AND COLUMN_NAME = 'status'",
      [dbName]
    );

    const count = (rows as any)?.[0]?.count ?? 0;
    if (Number(count) > 0) {
      return;
    }

    console.log("ℹ Adding missing column users.status (active/suspended)...");
    await pool.query("ALTER TABLE users ADD COLUMN status ENUM('active','suspended') DEFAULT 'active'");
    await pool.query("UPDATE users SET status = 'active' WHERE status IS NULL");
    console.log('✓ users.status column added');
  } catch (error) {
    console.error('✗ Failed to ensure users.status column:', error);
  }
};

// Ensure users.profile_picture column exists
const ensureProfilePictureColumn = async () => {
  const dbName = process.env.DB_NAME;
  if (!dbName) {
    return;
  }

  try {
    const [rows] = await pool.query(
      "SELECT COUNT(*) AS count FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users' AND COLUMN_NAME = 'profile_picture'",
      [dbName]
    );

    const count = (rows as any)?.[0]?.count ?? 0;
    if (Number(count) > 0) {
      return;
    }

    console.log("ℹ Adding missing column users.profile_picture...");
    await pool.query("ALTER TABLE users ADD COLUMN profile_picture VARCHAR(255) DEFAULT NULL");
    console.log('✓ users.profile_picture column added');
  } catch (error) {
    console.error('✗ Failed to ensure users.profile_picture column:', error);
  }
};

// Start server
server.listen(PORT, () => {
  console.log(`\n🚀 Server is running on http://localhost:${PORT}`);
  console.log(`📝 Environment: ${process.env.NODE_ENV || 'development'}\n`);
  testDatabaseConnection();
  ensureUserStatusColumn();
  ensureProfilePictureColumn();
});

export default app;
