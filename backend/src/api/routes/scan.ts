import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { getDb } from '../../database/db';
import { getScanQueue } from '../../queue/queue';
import { ScanStatus, FlowInfo } from '../../types';
import { ScanRequestSchema } from '../schemas';

export const scanRoutes = Router();

// POST /api/scan - Iniciar analisis de una pagina
scanRoutes.post('/', async (req: Request, res: Response) => {
  try {
    var validation = ScanRequestSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        error: 'Datos de entrada invalidos',
        details: validation.error.errors,
      });
    }

    var { url, config, visualDiffThreshold } = validation.data;
    var normalizedUrl = url.endsWith('/') ? url.slice(0, -1) : url;

    var parsedUrl: URL;
    try {
      parsedUrl = new URL(normalizedUrl);
    } catch {
      return res.status(400).json({ error: 'URL invalida' });
    }

    var hostname = parsedUrl.hostname.toLowerCase();
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      hostname === '0.0.0.0'
    ) {
      return res.status(400).json({ error: 'No se permite escanear direcciones locales (localhost/loopback).' });
    }

    var resolvedFlow: FlowInfo | undefined;

    if (validation.data.flow) {
      resolvedFlow = validation.data.flow as FlowInfo;
    } else if (validation.data.flowId) {
      var db = getDb();
      var savedFlow = db.prepare('SELECT name, steps FROM flows WHERE id = ?').get(validation.data.flowId) as { name: string; steps: string } | undefined;
      if (!savedFlow) {
        return res.status(404).json({ error: 'Flujo no encontrado' });
      }
      resolvedFlow = { name: savedFlow.name, steps: JSON.parse(savedFlow.steps) };
    }

    var jobConfig = {
      ...(config || {}),
      ...(visualDiffThreshold !== undefined
        ? { visualDiffThreshold }
        : {}),
      ...(resolvedFlow ? { flow: resolvedFlow } : {}),
    };

    var db2 = getDb();
    var scanId = randomUUID();
    var now = new Date().toISOString();

    db2.prepare('INSERT INTO scans (id, url, status, config, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(scanId, normalizedUrl, ScanStatus.PENDING, JSON.stringify(jobConfig), now);

    var queue = getScanQueue();
    if (!queue) {
      return res.status(503).json({ error: 'Servicio de cola no disponible. El scan no pudo ser encolado.' });
    }

    await queue.add('process-scan', {
      scanId: scanId,
      url: normalizedUrl,
      config: jobConfig,
    });

    return res.status(201).json({
      id: scanId,
      status: ScanStatus.PENDING,
      url: normalizedUrl,
      createdAt: now,
    });
  } catch (error) {
    console.error('Error iniciando scan:', error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// GET /api/scan/:id/status - Obtener estado del scan
scanRoutes.get('/:id/status', async (req: Request, res: Response) => {
  try {
    var { id } = req.params;

    var db = getDb();
    var scan = db.prepare('SELECT id, url, status, created_at, completed_at FROM scans WHERE id = ?').get(id) as {
      id: string;
      url: string;
      status: string;
      created_at: string;
      completed_at: string | null;
    } | undefined;

    if (!scan) {
      return res.status(404).json({ error: 'Scan no encontrado' });
    }

    var jobProgress = null;
    try {
      var statusQueue = getScanQueue();
      if (statusQueue) {
        var jobs = await statusQueue.getJobs(['active', 'waiting']);
        var job = jobs.find(function(j: any) { return j.data?.scanId === id; });
        if (job) {
          jobProgress = job.progress;
        }
      }
    } catch {
      // Ignorar errores de cola
    }

    return res.json({
      id: scan.id,
      status: scan.status,
      url: scan.url,
      progress: jobProgress,
      createdAt: scan.created_at,
      completedAt: scan.completed_at,
    });
  } catch (error) {
    console.error('Error obteniendo estado del scan:', error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
});
