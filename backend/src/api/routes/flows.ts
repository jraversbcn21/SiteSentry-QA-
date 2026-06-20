import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { getDb } from '../../database/db';

export const flowsRoutes = Router();

// GET /api/flows - Listar flujos
flowsRoutes.get('/', (_req: Request, res: Response) => {
  try {
    var db = getDb();
    var flows = db.prepare('SELECT * FROM flows ORDER BY updated_at DESC').all() as Array<{
      id: string;
      name: string;
      steps: string;
      created_at: string;
      updated_at: string;
    }>;
    return res.json(flows.map(function(f) {
      return {
        id: f.id,
        name: f.name,
        steps: JSON.parse(f.steps),
        createdAt: f.created_at,
        updatedAt: f.updated_at,
      };
    }));
  } catch (error) {
    console.error('Error listando flujos:', error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// GET /api/flows/:id - Obtener flujo
flowsRoutes.get('/:id', (req: Request, res: Response) => {
  try {
    var db = getDb();
    var flow = db.prepare('SELECT * FROM flows WHERE id = ?').get(req.params.id) as {
      id: string; name: string; steps: string; created_at: string; updated_at: string;
    } | undefined;
    if (!flow) return res.status(404).json({ error: 'Flujo no encontrado' });
    return res.json({
      id: flow.id,
      name: flow.name,
      steps: JSON.parse(flow.steps),
      createdAt: flow.created_at,
      updatedAt: flow.updated_at,
    });
  } catch (error) {
    console.error('Error obteniendo flujo:', error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// POST /api/flows - Crear flujo
flowsRoutes.post('/', (req: Request, res: Response) => {
  try {
    var { name, steps } = req.body;
    if (!name || typeof name !== 'string' || name.trim().length === 0 || name.length > 200) {
      return res.status(400).json({ error: 'Nombre requerido (1-200 caracteres)' });
    }
    if (!steps || !Array.isArray(steps) || steps.length === 0) {
      return res.status(400).json({ error: 'Steps requerido (array no vacio)' });
    }
    for (var i = 0; i < steps.length; i++) {
      if (!steps[i].action) return res.status(400).json({ error: 'Cada paso requiere una accion' });
    }

    var db = getDb();
    var id = randomUUID();
    var now = new Date().toISOString();
    db.prepare('INSERT INTO flows (id, name, steps, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, name.trim(), JSON.stringify(steps), now, now);
    return res.status(201).json({ id, name: name.trim(), steps, createdAt: now, updatedAt: now });
  } catch (error) {
    console.error('Error creando flujo:', error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// PUT /api/flows/:id - Actualizar flujo
flowsRoutes.put('/:id', (req: Request, res: Response) => {
  try {
    var db = getDb();
    var existing = db.prepare('SELECT * FROM flows WHERE id = ?').get(req.params.id) as any;
    if (!existing) return res.status(404).json({ error: 'Flujo no encontrado' });

    var { name, steps } = req.body;
    var newName = name || existing.name;
    var newSteps = steps ? JSON.stringify(steps) : existing.steps;
    var now = new Date().toISOString();

    db.prepare('UPDATE flows SET name = ?, steps = ?, updated_at = ? WHERE id = ?')
      .run(newName, newSteps, now, req.params.id);
    return res.json({ success: true });
  } catch (error) {
    console.error('Error actualizando flujo:', error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// DELETE /api/flows/:id - Eliminar flujo
flowsRoutes.delete('/:id', (req: Request, res: Response) => {
  try {
    var db = getDb();
    var existing = db.prepare('SELECT id FROM flows WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Flujo no encontrado' });
    db.prepare('DELETE FROM flows WHERE id = ?').run(req.params.id);
    return res.json({ success: true });
  } catch (error) {
    console.error('Error eliminando flujo:', error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
});
