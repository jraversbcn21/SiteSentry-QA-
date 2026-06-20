import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import fs from 'fs';
import { scanRoutes } from './routes/scan';
import { reportsRoutes } from './routes/reports';
import { flowsRoutes } from './routes/flows';
import { getDb } from '../database/db';
import '../workers/index';

const app = express();
const PORT = process.env.PORT || 3001;

// Allowed origins - support both Vite (5173) and CRA (3000)
const ALLOWED_ORIGINS = [
  process.env.FRONTEND_URL || 'http://localhost:5173',
  'http://localhost:3000',
  'http://localhost:5173',
];

// Middleware
app.use(helmet({
  crossOriginEmbedderPolicy: false,
}));
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Routes
app.use('/api/scan', scanRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/flows', flowsRoutes);

// Set/unset manual baseline
app.post('/api/scans/:id/set-baseline', (req, res) => {
  try {
    const { id } = req.params;
    const { isBaseline } = req.body;

    if (!/^[a-f0-9-]{36}$/.test(id)) {
      res.status(400).json({ error: 'ID de scan inválido' });
      return;
    }

    if (typeof isBaseline !== 'boolean') {
      res.status(400).json({ error: 'isBaseline debe ser booleano' });
      return;
    }

    const db = getDb();
    const scan = db.prepare('SELECT id, url FROM scans WHERE id = ?').get(id) as { id: string; url: string } | undefined;

    if (!scan) {
      res.status(404).json({ error: 'Scan no encontrado' });
      return;
    }

    if (isBaseline) {
      db.prepare('UPDATE scans SET is_baseline = 0 WHERE url = ? AND is_baseline = 1 AND id != ?').run(scan.url, id);
      db.prepare('UPDATE scans SET is_baseline = 1 WHERE id = ?').run(id);
    } else {
      db.prepare('UPDATE scans SET is_baseline = 0 WHERE id = ?').run(id);
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error setting baseline:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Screenshots serving
app.get('/screenshots/:scanId/:filename', (req, res) => {
  const { scanId, filename } = req.params;

  // Validate to prevent path traversal
  if (!/^[a-f0-9-]{36}$/.test(scanId) ||
      filename.includes('..') ||
      filename.includes('/') ||
      filename.includes('\\')) {
    res.status(400).json({ error: 'Invalid path' });
    return;
  }

  const filePath = path.join(process.cwd(), 'data', 'screenshots', scanId, filename);

  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: 'Screenshot not found' });
    return;
  }

  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  const stream = fs.createReadStream(filePath);
  stream.on('error', () => {
    if (!res.headersSent) {
      res.status(500).json({ error: 'Error reading screenshot' });
    }
  });
  stream.pipe(res);
});

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
});

app.listen(PORT, () => {
  console.log(`🚀 SiteSentry QA Backend corriendo en puerto ${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/health`);
});
