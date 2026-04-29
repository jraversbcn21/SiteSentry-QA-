import { Router, Request, Response } from 'express';
import { prisma } from '../../database/client';

export const reportsRoutes = Router();

// GET /api/reports - Listar todos los reportes con paginación
reportsRoutes.get('/', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt((req.query.limit as string) || '20', 10), 100);
    const offset = parseInt((req.query.offset as string) || '0', 10);

    const scans = await prisma.scan.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
      select: {
        id: true,
        url: true,
        status: true,
        createdAt: true,
        completedAt: true,
      },
    });

    return res.json(scans);
  } catch (error) {
    console.error('Error obteniendo reportes:', error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// GET /api/reports/:id - Obtener reporte específico con issues
reportsRoutes.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const scan = await prisma.scan.findUnique({
      where: { id },
      include: {
        issues: {
          orderBy: [{ severity: 'asc' }, { type: 'asc' }],
        },
      },
    });

    if (!scan) {
      return res.status(404).json({ error: 'Reporte no encontrado' });
    }

    // Construir resumen
    const byType: Record<string, number> = {};
    const bySeverity: Record<string, number> = {};

    for (const issue of scan.issues) {
      byType[issue.type] = (byType[issue.type] || 0) + 1;
      bySeverity[issue.severity] = (bySeverity[issue.severity] || 0) + 1;
    }

    return res.json({
      id: scan.id,
      url: scan.url,
      status: scan.status,
      createdAt: scan.createdAt,
      completedAt: scan.completedAt,
      issues: scan.issues,
      summary: {
        total: scan.issues.length,
        byType,
        bySeverity,
      },
    });
  } catch (error) {
    console.error('Error obteniendo reporte:', error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
});
