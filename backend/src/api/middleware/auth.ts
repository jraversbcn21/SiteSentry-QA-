import { Request, Response, NextFunction } from 'express';

var API_KEY = process.env.API_KEY;

function authMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!API_KEY) {
    return next();
  }

  var providedKey = req.headers['x-api-key'] as string | undefined;

  if (!providedKey || providedKey !== API_KEY) {
    return res.status(401).json({ error: 'Acceso no autorizado. Se requiere una API key valida.' });
  }

  next();
}

export function setAuthConfig(key: string | undefined) {
  API_KEY = key;
}

export { authMiddleware };
