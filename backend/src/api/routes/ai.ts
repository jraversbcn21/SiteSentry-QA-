import { Router, Request, Response } from 'express';
import { ExplainRequestSchema } from '../schemas';
import { explainWithGroq, getAiStatus, AiError } from '../../services/GroqService';
import { logger } from '../../logger';

export const aiRoutes = Router();

// GET /api/ai/status - Estado de configuracion de la IA
aiRoutes.get('/status', (_req: Request, res: Response) => {
  return res.json(getAiStatus());
});

// POST /api/ai/explain - Proxy de explicaciones IA via Groq
aiRoutes.post('/explain', async (req: Request, res: Response) => {
  var validation = ExplainRequestSchema.safeParse(req.body);
  if (!validation.success) {
    return res.status(400).json({
      error: 'Datos de entrada invalidos',
      details: validation.error.errors,
    });
  }

  try {
    var explanation = await explainWithGroq(validation.data);
    return res.json({ explanation: explanation });
  } catch (err) {
    if (err instanceof AiError) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    logger.error('Error inesperado en /api/ai/explain: ' + (err as Error).message);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
});
