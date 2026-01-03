import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { join } from 'path';
import { initDatabase, closeDatabase } from './db';
import router from './routes';

const app = express();
const PORT = parseInt(process.env.PORT || '8080', 10);
const HOST = '127.0.0.1'; // Localhost only by default

// Middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.tailwindcss.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.tailwindcss.com"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
}));
app.use(morgan('dev'));
app.use(express.json({ limit: '2mb' }));

// Serve static files
app.use('/public', express.static(join(__dirname, '../../public')));

// Set up EJS view engine
app.set('view engine', 'ejs');
app.set('views', join(__dirname, '../views'));

// Initialize database
try {
  initDatabase();
} catch (error) {
  console.error('Failed to initialize database:', error);
  process.exit(1);
}

// Routes
app.use(router);

// Default route
app.get('/', (_req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Build Readiness</title>
      <script src="https://cdn.tailwindcss.com"></script>
    </head>
    <body class="bg-gray-50">
      <div class="container mx-auto px-4 py-12 text-center">
        <h1 class="text-4xl font-bold text-gray-900 mb-4">Build Readiness Tracker</h1>
        <p class="text-gray-600 mb-8">Local SQLite-backed release tracking</p>
        <div class="bg-white rounded-lg shadow p-6 max-w-2xl mx-auto text-left">
          <h2 class="text-xl font-semibold mb-4">Available Endpoints:</h2>
          <ul class="space-y-2 text-gray-700">
            <li><code class="bg-gray-100 px-2 py-1 rounded">GET /healthz</code> - Health check</li>
            <li><code class="bg-gray-100 px-2 py-1 rounded">POST /api/ingest</code> - Ingest build data (requires auth)</li>
            <li><code class="bg-gray-100 px-2 py-1 rounded">GET /release/:rid</code> - View release table</li>
            <li><code class="bg-gray-100 px-2 py-1 rounded">GET /release/:rid.json</code> - Get release JSON</li>
          </ul>
        </div>
      </div>
    </body>
    </html>
  `);
});

// Start server
const server = app.listen(PORT, HOST, () => {
  console.log(`\n✓ Server running at http://${HOST}:${PORT}`);
  console.log(`✓ Health check: http://${HOST}:${PORT}/healthz`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down gracefully...');
  server.close(() => {
    closeDatabase();
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  console.log('\nShutting down gracefully...');
  server.close(() => {
    closeDatabase();
    process.exit(0);
  });
});
