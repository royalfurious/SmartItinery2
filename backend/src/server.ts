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
// Tolerant body parser: try to coerce simple malformed JSON-like payloads
// (e.g. {name:Aditya,email:...}) into valid JSON to avoid 400 parse errors
app.use((req, res, next) => {
  const contentType = req.headers['content-type'] || '';
  if (!contentType.includes('application/json')) {
    return next();
  }

  let raw = '';
  req.setEncoding('utf8');
  req.on('data', chunk => { raw += chunk; });
  req.on('end', () => {
    if (!raw) return next();
    try {
      // If valid JSON, parse and attach
      const parsed = JSON.parse(raw);
      req.body = parsed;
      return next();
    } catch (err) {
      // Attempt simple coercion: add quotes for keys and values
      try {
        let s = raw.trim();
        // Only attempt coercion for simple object-like strings
        if (s.startsWith('{') && s.endsWith('}')) {
          // Quote keys: {name: -> {"name":
          s = s.replace(/([\{,\s])(\w[\w\-\.]*)\s*:/g, '$1"$2":');
          // Quote values that are unquoted (stop at comma or })
          s = s.replace(/:\s*([^\",\}\[\]\s][^,\}]*)/g, ':"$1"');
          // Remove possible trailing commas before closing brace
          s = s.replace(/,\s*}/g, '}');
          const coerced = JSON.parse(s);
          req.body = coerced;
          return next();
        }
      } catch (e) {
        // fallthrough to next and let express.json handle errors
      }
      // Not parseable/coercible — attach raw for downstream handlers and continue
      (req as any).rawBody = raw;
      return next();
    }
  });
});
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


// PostgreSQL Database connection test
const testDatabaseConnection = async () => {
  try {
    await pool.query('SELECT NOW()');
    console.log('✓ PostgreSQL database connected successfully');
  } catch (error) {
    console.error('✗ PostgreSQL database connection failed:', error);
    console.error('Please ensure PostgreSQL is running and credentials are correct in .env file');
  }
};

// Start server
server.listen(PORT, () => {
  console.log(`\n🚀 Server is running on http://localhost:${PORT}`);
  console.log(`📝 Environment: ${process.env.NODE_ENV || 'development'}\n`);
  testDatabaseConnection();
});

export default app;
