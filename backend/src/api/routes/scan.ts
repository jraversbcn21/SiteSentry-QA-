import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../database/client';
import { scanQueue } from '../../queue/queue';
import { ScanStatus } from '../../types';

export const scanRoutes = Router();

const ScanRequestSchema = z.object({
  url: z.string().url('URL invalida - debe incluir http:// o https://'),
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

    const { url, config } = validation.data;
    const normalizedUrl = url.endsWith('/') ? url.slice(0, -1) : url;

    const scan = await prisma.scan.create({
      data: {
        url: normalizedUrl,
        status: ScanStatus.PENDING,
        config: (config as object) || {},
      },
    });

    await scanQueue.add('process-scan', {
      scanId: scan.id,
      url: normalizedUrl,
      config: config || {},
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
      const jobs = await scanQueue.getJobs(['active', 'waiting']);
      const job = jobs.find((j) => j.data?.scanId === id);
      if (job) {
        jobProgress = job.progress;
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
