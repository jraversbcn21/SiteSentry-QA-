# Groq Server-Side Proxy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mover la API key de Groq del navegador (localStorage) al backend (env var `GROQ_API_KEY`), proxiedando las explicaciones IA a través de un endpoint propio.

**Architecture:** Nuevo `GroqService` en backend (whitelist de modelos, timeout, errores tipados) expuesto vía `routes/ai.ts` (`POST /api/ai/explain`, `GET /api/ai/status`) con rate limit dedicado. El frontend reescribe `services/ai.ts` para llamar al proxy y Settings muestra el estado de configuración del servidor.

**Tech Stack:** Express 4, zod, `fetch` global de Node 20, Jest + ts-jest, React + axios.

**Spec:** `docs/superpowers/specs/2026-08-15-groq-proxy-design.md`

## Global Constraints

- Backend: CommonJS, estilo `var` + `function` dentro de funciones (convención del repo). Los `export const`/`export class` de nivel superior son válidos (ya usados: `export const flowsRoutes`, `export var FlowStepSchema`).
- Mensajes de error user-facing en español, sin tildes en strings de código (convención existente: "invalidos", "explicacion").
- La API key de Groq NUNCA debe aparecer en respuestas, logs ni frontend.
- Rate limit del proxy: 30 req/min, mensaje `'Demasiadas solicitudes. Intenta de nuevo en un minuto.'` (mismo estilo que `scanLimiter`).
- Timeout a Groq: 20s vía `AbortController`.
- Whitelist de modelos (exacta): `llama-3.1-8b-instant`, `llama-3.3-70b-versatile`, `deepseek-r1-distill-llama-70b`, `openai/gpt-oss-120b`, `qwen/qwen3.6-27b`.
- Modelo default: env `GROQ_MODEL` o fallback `llama-3.1-8b-instant`.
- No añadir dependencias nuevas (no supertest, no dotenv).

---

### Task 1: GroqService + schema zod + tests

**Files:**
- Create: `backend/src/services/GroqService.ts`
- Modify: `backend/src/api/schemas.ts`
- Test: `backend/src/__tests__/groq.test.ts`

**Interfaces:**
- Produces (consumido por Task 2):
  - `explainWithGroq(input: ExplainInput): Promise<string>` — lanza `AiError`
  - `getAiStatus(): { configured: boolean; defaultModel: string }`
  - `class AiError extends Error { statusCode: number }`
  - `interface ExplainInput { type: string; severity: string; description: string; url: string; model?: string }`
  - `ExplainRequestSchema` (zod) en `schemas.ts`

- [ ] **Step 1: Write the failing test**

Crear `backend/src/__tests__/groq.test.ts`:

```typescript
import { explainWithGroq, getAiStatus } from '../services/GroqService';

var validInput = {
  type: 'BROKEN_RESOURCE',
  severity: 'HIGH',
  description: 'Imagen rota',
  url: 'https://example.com/img.png',
};

function mockGroqOk(content: string) {
  (global.fetch as jest.Mock).mockResolvedValueOnce({
    ok: true,
    json: async () => ({ choices: [{ message: { content: content } }] }),
  });
}

describe('GroqService', () => {
  var originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = jest.fn();
    process.env.GROQ_API_KEY = 'test-key';
    delete process.env.GROQ_MODEL;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.GROQ_API_KEY;
    delete process.env.GROQ_MODEL;
  });

  describe('explainWithGroq', () => {
    it('returns explanation on success', async () => {
      mockGroqOk('Explicacion de prueba');
      var result = await explainWithGroq(validInput);
      expect(result).toBe('Explicacion de prueba');
    });

    it('sends the requested whitelisted model', async () => {
      mockGroqOk('ok');
      await explainWithGroq({ ...validInput, model: 'llama-3.3-70b-versatile' });
      var body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
      expect(body.model).toBe('llama-3.3-70b-versatile');
    });

    it('uses default model when none provided', async () => {
      mockGroqOk('ok');
      await explainWithGroq(validInput);
      var body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
      expect(body.model).toBe('llama-3.1-8b-instant');
    });

    it('uses GROQ_MODEL env var when set and no model provided', async () => {
      process.env.GROQ_MODEL = 'qwen/qwen3.6-27b';
      mockGroqOk('ok');
      await explainWithGroq(validInput);
      var body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
      expect(body.model).toBe('qwen/qwen3.6-27b');
    });

    it('rejects non-whitelisted model with 400', async () => {
      await expect(explainWithGroq({ ...validInput, model: 'gpt-4o' }))
        .rejects.toMatchObject({ statusCode: 400 });
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('throws 503 when GROQ_API_KEY is missing', async () => {
      delete process.env.GROQ_API_KEY;
      await expect(explainWithGroq(validInput))
        .rejects.toMatchObject({ statusCode: 503 });
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('throws 502 when Groq returns an error', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: async () => 'rate limited',
      });
      await expect(explainWithGroq(validInput))
        .rejects.toMatchObject({ statusCode: 502 });
    });

    it('throws 504 when fetch aborts (timeout)', async () => {
      var abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      (global.fetch as jest.Mock).mockRejectedValueOnce(abortError);
      await expect(explainWithGroq(validInput))
        .rejects.toMatchObject({ statusCode: 504 });
    });

    it('throws 504 on network failure', async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('socket hang up'));
      await expect(explainWithGroq(validInput))
        .rejects.toMatchObject({ statusCode: 504 });
    });
  });

  describe('getAiStatus', () => {
    it('reports configured when key present', () => {
      expect(getAiStatus()).toEqual({ configured: true, defaultModel: 'llama-3.1-8b-instant' });
    });

    it('reports not configured when key missing', () => {
      delete process.env.GROQ_API_KEY;
      expect(getAiStatus().configured).toBe(false);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend; npx jest src/__tests__/groq.test.ts`
Expected: FAIL — "Cannot find module '../services/GroqService'"

- [ ] **Step 3: Add the zod schema**

En `backend/src/api/schemas.ts`, añadir al final:

```typescript
export var ExplainRequestSchema = z.object({
  type: z.string().min(1),
  severity: z.string().min(1),
  description: z.string().min(1),
  url: z.string().min(1),
  model: z.string().optional(),
});
```

- [ ] **Step 4: Implement GroqService**

Crear `backend/src/services/GroqService.ts`:

```typescript
import { logger } from '../logger';

export var ALLOWED_MODELS = [
  'llama-3.1-8b-instant',
  'llama-3.3-70b-versatile',
  'deepseek-r1-distill-llama-70b',
  'openai/gpt-oss-120b',
  'qwen/qwen3.6-27b',
];

var GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
var DEFAULT_MODEL = 'llama-3.1-8b-instant';
var REQUEST_TIMEOUT_MS = 20000;

export class AiError extends Error {
  statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
  }
}

export interface ExplainInput {
  type: string;
  severity: string;
  description: string;
  url: string;
  model?: string;
}

export function getAiStatus(): { configured: boolean; defaultModel: string } {
  return {
    configured: Boolean(process.env.GROQ_API_KEY),
    defaultModel: process.env.GROQ_MODEL || DEFAULT_MODEL,
  };
}

function buildPrompt(input: ExplainInput): string {
  return 'Explica en espanol y de forma breve (2-3 oraciones) que significa el siguiente problema de QA detectado en una pagina web y como solucionarlo:\n\n' +
    'Tipo: ' + input.type + '\n' +
    'Severidad: ' + input.severity + '\n' +
    'Descripcion: ' + input.description + '\n' +
    'URL: ' + input.url;
}

export async function explainWithGroq(input: ExplainInput): Promise<string> {
  var apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new AiError('IA no configurada en el servidor', 503);
  }

  var model = input.model || process.env.GROQ_MODEL || DEFAULT_MODEL;
  if (ALLOWED_MODELS.indexOf(model) === -1) {
    throw new AiError('Modelo no permitido: ' + model, 400);
  }

  var controller = new AbortController();
  var timeout = setTimeout(function() { controller.abort(); }, REQUEST_TIMEOUT_MS);

  try {
    var response = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
      },
      body: JSON.stringify({
        model: model,
        messages: [
          { role: 'system', content: 'Eres un experto en QA y calidad web. Responde siempre en espanol, de forma breve y directa.' },
          { role: 'user', content: buildPrompt(input) },
        ],
        max_tokens: 300,
        temperature: 0.3,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      var errorBody = await response.text();
      logger.error('Groq API respondio ' + response.status + ': ' + errorBody);
      throw new AiError('Error del servicio de IA', 502);
    }

    var data = await response.json() as any;
    return data.choices?.[0]?.message?.content || 'No se pudo generar una explicacion.';
  } catch (err) {
    if (err instanceof AiError) throw err;
    if ((err as Error).name === 'AbortError') {
      throw new AiError('El servicio de IA no respondio a tiempo', 504);
    }
    logger.error('Fallo la llamada a Groq: ' + (err as Error).message);
    throw new AiError('El servicio de IA no respondio a tiempo', 504);
  } finally {
    clearTimeout(timeout);
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend; npx jest src/__tests__/groq.test.ts`
Expected: PASS — 11 tests passed

- [ ] **Step 6: Type-check**

Run: `cd backend; npx tsc --noEmit`
Expected: sin errores

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/GroqService.ts backend/src/api/schemas.ts backend/src/__tests__/groq.test.ts
git commit -m "feat: GroqService with model whitelist, timeout and typed errors (H7)"
```

---

### Task 2: Ruta `/api/ai` + registro en server.ts

**Files:**
- Create: `backend/src/api/routes/ai.ts`
- Modify: `backend/src/api/server.ts`

**Interfaces:**
- Consumes (de Task 1): `explainWithGroq`, `getAiStatus`, `AiError`, `ExplainInput` de `../../services/GroqService`; `ExplainRequestSchema` de `../schemas`.
- Produces: `aiRoutes` (Router Express) montado en `/api/ai`.

- [ ] **Step 1: Create the route**

Crear `backend/src/api/routes/ai.ts`:

```typescript
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
```

- [ ] **Step 2: Register route + rate limiter in server.ts**

En `backend/src/api/server.ts`:

1. Añadir import junto a los demás (línea ~9, tras `flowsRoutes`):

```typescript
import { aiRoutes } from './routes/ai';
```

2. Tras el bloque de `scanLimiter` (línea ~54), añadir:

```typescript
// Rate limiting for AI proxy (protects Groq quota)
var aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: 'Demasiadas solicitudes. Intenta de nuevo en un minuto.' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/ai', aiLimiter);
```

3. Junto al registro de rutas (tras `app.use('/api/flows', flowsRoutes);`, línea ~64), añadir:

```typescript
app.use('/api/ai', aiRoutes);
```

- [ ] **Step 3: Type-check**

Run: `cd backend; npx tsc --noEmit`
Expected: sin errores

- [ ] **Step 4: Smoke test del endpoint**

Run (dejar corriendo, verificar, y matar el proceso después):

```powershell
cd backend; npx tsx src/api/server.ts
```

En otra terminal:

```powershell
curl http://localhost:3001/api/ai/status
```

Expected: `{"configured":false,"defaultModel":"llama-3.1-8b-instant"}` (sin `GROQ_API_KEY` definida).

Y:

```powershell
curl -X POST http://localhost:3001/api/ai/explain -H "Content-Type: application/json" -d '{"type":"X","severity":"HIGH","description":"d","url":"https://example.com"}'
```

Expected: `{"error":"IA no configurada en el servidor"}` con HTTP 503.

Matar el proceso tsx tras verificar.

- [ ] **Step 5: Run full backend test suite**

Run: `cd backend; npm test`
Expected: 7 suites, 54 tests, todos PASS

- [ ] **Step 6: Commit**

```bash
git add backend/src/api/routes/ai.ts backend/src/api/server.ts
git commit -m "feat: /api/ai proxy route with dedicated rate limit (H7)"
```

---

### Task 3: Frontend — reescribir `services/ai.ts`

**Files:**
- Modify: `frontend/src/services/ai.ts`

**Interfaces:**
- Consumes: `api` (default export axios) y `unwrapApiError` de `./api`; endpoints de Task 2.
- Produces: `explainIssue(issue: Issue): Promise<string>` (firma sin cambios — ErrorCard no se toca).

- [ ] **Step 1: Rewrite ai.ts**

Reemplazar **todo** el contenido de `frontend/src/services/ai.ts` por:

```typescript
import type { Issue } from '../types';
import api, { unwrapApiError } from './api';

function getModel(): string {
  try {
    const stored = localStorage.getItem('sitesentry_groq_model');
    return stored || 'llama-3.1-8b-instant';
  } catch {
    return 'llama-3.1-8b-instant';
  }
}

export async function explainIssue(issue: Issue): Promise<string> {
  try {
    const response = await api.post<{ explanation: string }>('/ai/explain', {
      type: issue.type,
      severity: issue.severity,
      description: issue.description,
      url: issue.url,
      model: getModel(),
    });
    return response.data.explanation || 'No se pudo generar una explicacion.';
  } catch (err) {
    throw new Error(unwrapApiError(err));
  }
}
```

- [ ] **Step 2: Type-check + lint**

Run: `cd frontend; npm run build`
Expected: compila sin errores (tsc + vite build)

Run: `cd frontend; npm run lint`
Expected: sin errores nuevos

- [ ] **Step 3: Commit**

```bash
git add frontend/src/services/ai.ts
git commit -m "feat: explainIssue calls backend proxy instead of Groq directly (H7)"
```

---

### Task 4: Frontend — Settings sin API key + CSP

**Files:**
- Modify: `frontend/src/components/Settings/Settings.tsx`
- Modify: `frontend/src/components/Settings/Settings.css`
- Modify: `frontend/index.html`

**Interfaces:**
- Consumes: `GET /api/ai/status` → `{ configured: boolean; defaultModel: string }` (Task 2); `api` default export de `../../services/api`.

- [ ] **Step 1: Rewrite Settings.tsx**

Reemplazar **todo** el contenido de `frontend/src/components/Settings/Settings.tsx` por:

```tsx
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../services/api';
import './Settings.css';

const GROQ_MODELS = [
  { value: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B (rapido)' },
  { value: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B (potente)' },
  { value: 'deepseek-r1-distill-llama-70b', label: 'DeepSeek R1 70B (razonamiento)' },
  { value: 'openai/gpt-oss-120b', label: 'GPT OSS 120B' },
  { value: 'qwen/qwen3.6-27b', label: 'Qwen 3.6 27B' },
];

interface AiStatus {
  configured: boolean;
  defaultModel: string;
}

export default function Settings() {
  const [model, setModel] = useState(localStorage.getItem('sitesentry_groq_model') || 'llama-3.1-8b-instant');
  const [saved, setSaved] = useState(false);
  const [aiStatus, setAiStatus] = useState<AiStatus | null>(null);

  useEffect(() => {
    let ignore = false;
    api.get<AiStatus>('/ai/status')
      .then((res) => { if (!ignore) setAiStatus(res.data); })
      .catch(() => { if (!ignore) setAiStatus(null); });
    return () => { ignore = true; };
  }, []);

  function handleSave() {
    localStorage.setItem('sitesentry_groq_model', model);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="settings-page">
      <Link to="/" className="settings-back">← Volver al inicio</Link>
      <h2>Ajustes</h2>
      <p>Configura la integracion con IA para recibir explicaciones de los issues detectados.</p>

      <div className="settings-card">
        <h3>🤖 Groq API</h3>
        <p className="card-desc">La API key de Groq se configura en el servidor (variable de entorno GROQ_API_KEY).</p>
        {aiStatus && (
          aiStatus.configured
            ? <p className="card-desc ai-status-ok">✓ IA configurada en el servidor (modelo por defecto: {aiStatus.defaultModel})</p>
            : <p className="card-desc ai-status-error">⚠ IA no configurada en el servidor (falta GROQ_API_KEY)</p>
        )}
        <div className="settings-field">
          <label>Modelo</label>
          <select value={model} onChange={(e) => setModel(e.target.value)}>
            {GROQ_MODELS.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        </div>
        <button className="settings-save" onClick={handleSave}>
          Guardar
        </button>
        {saved && <span className="settings-saved">✓ Guardado</span>}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add status styles to Settings.css**

Añadir al final de `frontend/src/components/Settings/Settings.css`:

```css
.settings-card .ai-status-ok {
  color: var(--color-success);
  font-weight: 500;
}

.settings-card .ai-status-error {
  color: var(--color-error);
  font-weight: 500;
}
```

- [ ] **Step 3: Remove Groq from CSP**

En `frontend/index.html` línea 7, cambiar:

```
connect-src 'self' https://api.groq.com;
```

por:

```
connect-src 'self';
```

(la meta tag completa queda: `content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none';"`)

- [ ] **Step 4: Type-check + lint**

Run: `cd frontend; npm run build`
Expected: compila sin errores

Run: `cd frontend; npm run lint`
Expected: sin errores nuevos

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/Settings/Settings.tsx frontend/src/components/Settings/Settings.css frontend/index.html
git commit -m "feat: Settings shows server AI status, drop client-side Groq key + CSP (H7)"
```

---

### Task 5: Documentación (AGENTS.md) + verificación final

**Files:**
- Modify: `AGENTS.md`

**Interfaces:**
- Consumes: todo lo anterior (verificación integral).

- [ ] **Step 1: Update AGENTS.md — sección Groq LLM Integration**

Reemplazar la sección `## Groq LLM Integration` completa por:

```markdown
## Groq LLM Integration

AI explanations are proxied through the backend — the Groq API key never touches the browser.

| Item | Detail |
|------|--------|
| `POST /api/ai/explain` | Body: `{ type, severity, description, url, model? }` → `{ explanation }`. Dedicated rate limit: 30 req/min. Timeout: 20s. |
| `GET /api/ai/status` | `{ configured: boolean, defaultModel: string }` |
| `backend/src/services/GroqService.ts` | Model whitelist, prompt building, typed `AiError` (400/502/503/504) |
| `GROQ_API_KEY` env var | Required for AI; server returns 503 when unset |
| `GROQ_MODEL` env var | Optional server-side default model |

Available models (backend whitelist): `llama-3.1-8b-instant`, `llama-3.3-70b-versatile`, `deepseek-r1-distill-llama-70b`, `openai/gpt-oss-120b`, `qwen/qwen3.6-27b`.

The Settings page (`/settings`) shows server AI status and stores only the model preference in localStorage (`sitesentry_groq_model`). `services/ai.ts` sends it per request; the backend validates it against the whitelist.
```

- [ ] **Step 2: Update AGENTS.md — tablas de archivos**

En la tabla "Backend Files", añadir tras la fila de `src/api/routes/flows.ts`:

```markdown
| `src/api/routes/ai.ts` | Groq proxy: POST /explain (zod-validated, model whitelist), GET /status. Dedicated 30 req/min rate limit. |
| `src/services/GroqService.ts` | Groq API calls: prompt building, model whitelist, 20s AbortController timeout, typed `AiError`. Reads `GROQ_API_KEY`/`GROQ_MODEL` env vars. |
```

En la tabla "Frontend Files", cambiar la descripción de `src/services/ai.ts` a:

```markdown
| `src/services/ai.ts` | AI issue explanations via backend proxy (`/api/ai/explain`). Model preference from localStorage. |
```

- [ ] **Step 3: Update AGENTS.md — tabla Security, fila CSP**

Cambiar la descripción de la fila CSP a:

```markdown
| CSP | Content-Security-Policy meta tag in `index.html` | `default-src 'self'`, allows Google Fonts; AI calls go through backend |
```

- [ ] **Step 4: Update AGENTS.md — Pending Tasks**

Eliminar el item 1 (Groq proxy) y renumerar el resto 1-4:

```markdown
1. **Checker test coverage gaps**: fixture tests exist for ContentChecker, InteractivityChecker, FormModalChecker, LazyLoadChecker, BrokenResourcesChecker and PageFacts; missing for FailedAPIChecker, ConsoleErrorChecker, PerformanceChecker, AccessibilityChecker.
2. **Performance validation of PageFacts (T33)**: measure per-scan latency before/after the single-pass snapshot on a real heavy page to confirm the expected speedup (audit predicted a measurable win; never benchmarked).
3. **Scan-progress persistence (H10, robust option)**: progress is exposed via in-memory `activeJob`; persisting it to the `scans` row would survive process restarts and enable future ETAs/cancel-while-running.
4. **E2E smoke test**: no automated test covers the full pipeline (POST /api/scan → worker → report) against a local fixture page.
```

- [ ] **Step 5: Full verification**

Run: `cd backend; npx tsc --noEmit; npm test`
Expected: tsc sin errores; 7 suites / 54 tests PASS

Run: `cd frontend; npm run build; npm run lint`
Expected: build OK, lint sin errores nuevos

- [ ] **Step 6: Commit**

```bash
git add AGENTS.md
git commit -m "docs: Groq proxy in AGENTS.md, remove H7 from pending tasks"
```

---

## Self-Review Notes

- **Spec coverage:** proxy endpoint (T1+T2), status endpoint (T2), rate limit (T2), whitelist+default (T1), timeout (T1), error mapping (T1+T2), frontend rewrite (T3), Settings UX (T4), CSP (T4), AGENTS.md (T5). ✅
- **Desviación menor del spec:** la lógica de llamada a Groq vive en `services/GroqService.ts` (testeable sin supertest) y `routes/ai.ts` queda delgado, en vez de todo en la ruta. Mismo comportamiento externo.
- **Tipos consistentes:** `ExplainInput` coincide con `ExplainRequestSchema`; `{ explanation }` coincide con lo que espera `services/ai.ts` del frontend; `AiStatus` del frontend coincide con `getAiStatus()`.
