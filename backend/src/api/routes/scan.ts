import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../database/client';
import { getDb } from '../../database/db';
import { getScanQueue } from '../../queue/queue';
import { ScanStatus, FlowInfo } from '../../types';

export const scanRoutes = Router();

const FlowStepSchema = z.object({
  action: z.enum(['navigate', 'click', 'type', 'wait', 'select', 'hover', 'press', 'checkpoint']),
  url: z.string().optional(),
  selector: z.string().optional(),
  value: z.string().optional(),
  ms: z.number().int().min(0).optional(),
  key: z.string().optional(),
});

const ScanRequestSchema = z.object({
  url: z.string().url('URL invalida - debe incluir http:// o https://'),
  visualDiffThreshold: z.number().min(0).max(1).optional(),
  flow: z.object({
    name: z.string().min(1).max(200),
    steps: z.array(FlowStepSchema).min(1),
  }).optional(),
  flowId: z.string().optional(),
  config: z
    .object({
      timeout: z.number().int().min(5000).max(120000).optional(),
    })
    .optional(),
});

// POST /api/scan - Iniciar analisis de una pagina
scanRoutes.post('/', async (req: Request, res: Response) => {
  try {
    const validation = ScanRequestSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        error: 'Datos de entrada invalidos',
        details: validation.error.errors,
      });
    }

    const { url, config, visualDiffThreshold } = validation.data;
    const normalizedUrl = url.endsWith('/') ? url.slice(0, -1) : url;

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

    const jobConfig = {
      ...(config || {}),
      ...(visualDiffThreshold !== undefined
        ? { visualDiffThreshold }
        : {}),
      ...(resolvedFlow ? { flow: resolvedFlow } : {}),
    };

    const scan = await prisma.scan.create({
      data: {
        url: normalizedUrl,
        status: ScanStatus.PENDING,
        config: jobConfig as object,
      },
    });

    var queue = getScanQueue();
    if (!queue) {
      return res.status(503).json({ error: 'Servicio de cola no disponible (Redis no esta corriendo). El scan no pudo ser encolado.' });
    }

    await queue.add('process-scan', {
      scanId: scan.id,
      url: normalizedUrl,
      config: jobConfig,
    });

    return res.status(201).json({
      id: scan.id,
      status: scan.status,
      url: scan.url,
      createdAt: scan.createdAt,
    });
  } catch (error) {
    console.error('Error iniciando scan:', error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// GET /api/scan/:id/status - Obtener estado del scan
scanRoutes.get('/:id/status', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const scan = await prisma.scan.findUnique({
      where: { id },
    });

    if (!scan) {
      return res.status(404).json({ error: 'Scan no encontrado' });
    }

    let jobProgress = null;
    try {
      var statusQueue = getScanQueue();
      if (statusQueue) {
        var jobs = await statusQueue.getJobs(['active', 'waiting']);
        var job = jobs.find((j) => j.data?.scanId === id);
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
      createdAt: scan.createdAt,
      completedAt: scan.completedAt,
    });
  } catch (error) {
    console.error('Error obteniendo estado del scan:', error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
});
