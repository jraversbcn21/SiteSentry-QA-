# Diseño: Proxy server-side para Groq (H7)

**Fecha:** 2026-08-15
**Estado:** Aprobado por el usuario
**Origen:** Pending Tasks #1 en AGENTS.md (parte aplazada de T26/H7)

## Problema

Hoy el frontend llama directamente a `https://api.groq.com` con la API key guardada en
`localStorage` (`sitesentry_groq_api_key`). La key queda expuesta en el navegador de
cada usuario. Objetivo: la key nunca toca el navegador; vive en el backend como env var.

## Decisiones tomadas

- **Modelo:** híbrido — el frontend propone el modelo (selector en Settings, guardado en
  localStorage y enviado por request); el backend valida contra una whitelist y aplica
  default si no llega ninguno.
- **Rate limit:** sí, limiter dedicado de 30 req/min para `/api/ai`, separado del de scans.
- **Settings:** nuevo endpoint `GET /api/ai/status`; Settings muestra si la IA está
  configurada en el servidor y mantiene solo el selector de modelo.
- **Enfoque:** proxy delgado y específico (no proxy genérico de chat, no caché en DB).

## Arquitectura

### Backend

1. **`backend/src/api/routes/ai.ts`** (nuevo):
   - `POST /api/ai/explain`
     - Body validado con zod: `{ type: string, severity: string, description: string, url: string, model?: string }`.
     - Whitelist de modelos (los 5 actuales: `llama-3.1-8b-instant`, `llama-3.3-70b-versatile`,
       `deepseek-r1-distill-llama-70b`, `openai/gpt-oss-120b`, `qwen/qwen3.6-27b`).
       Modelo fuera de la lista → 400. Sin modelo → `GROQ_MODEL` env var o fallback
       `llama-3.1-8b-instant`.
     - Si `GROQ_API_KEY` no está definida → 503.
     - Construye el prompt en el servidor (mismo texto que hoy genera `ai.ts` del frontend)
       y llama a `https://api.groq.com/openai/v1/chat/completions` con `fetch` global de Node.
     - Timeout de 20s con `AbortController`.
     - Devuelve `{ explanation: string }`.
   - `GET /api/ai/status` → `{ configured: boolean, defaultModel: string }`.
2. **`server.ts`**: registra `/api/ai` con un rate limiter dedicado (30 req/min, mismo
   patrón que `scanLimiter`). Queda detrás del auth middleware existente (`/api`).
3. **Env vars nuevas:** `GROQ_API_KEY` (requerida para IA), `GROQ_MODEL` (opcional).
   Se leen con `process.env` directo (patrón existente; no hay dotenv).

### Frontend

1. **`services/ai.ts`**: `explainIssue(issue)` pasa a hacer `api.post('/ai/explain', {...})`
   con el cliente axios existente y `unwrapApiError`. Lee el modelo de localStorage
   (como hoy) y lo envía en el body. Se elimina toda la lógica de API key.
2. **`Settings.tsx`**: se quita el campo de API key. Al montar hace `GET /api/ai/status`;
   si `configured` es false muestra aviso "IA no configurada en el servidor (falta
   GROQ_API_KEY)". El selector de modelo se mantiene (localStorage).
3. **`index.html`**: se elimina `https://api.groq.com` del `connect-src` del CSP.

### Documentación

- AGENTS.md: actualizar sección "Groq LLM Integration" (key en backend, env vars,
  endpoints nuevos), tabla de archivos (`routes/ai.ts`), y quitar el item #1 de Pending Tasks.

## Flujo de datos

```
ErrorCard (click "Explicar con IA")
  → explainIssue(issue)
  → POST /api/ai/explain { type, severity, description, url, model? }
  → zod valida body → whitelist de modelo (o default GROQ_MODEL)
  → 503 si falta GROQ_API_KEY
  → fetch a Groq con AbortController (timeout 20s)
  → { explanation } → ErrorCard la muestra
```

## Manejo de errores

Mensajes en español, sin filtrar detalles internos ni la key:

| Caso | HTTP | Mensaje |
|------|------|---------|
| `GROQ_API_KEY` no definida | 503 | "IA no configurada en el servidor" |
| Modelo fuera de whitelist / body inválido | 400 | error de validación zod |
| Timeout (>20s) o error de red | 504 | "El servicio de IA no respondió a tiempo" |
| Groq devuelve error (4xx/5xx) | 502 | "Error del servicio de IA" (detalle en log del server) |
| Rate limit superado | 429 | mensaje del limiter (mismo estilo que scan) |

En el frontend, `unwrapApiError` muestra el mensaje en el ErrorCard (ya funciona así hoy).

## Testing

Tests Jest en backend (patrón existente), mockeando `fetch` global:

- Caso feliz: devuelve `{ explanation }` y llama a Groq con el modelo correcto.
- Modelo inválido → 400.
- Sin `GROQ_API_KEY` → 503.
- Timeout/abort → 504; error upstream de Groq → 502.
- Sin `model` en el body → usa `GROQ_MODEL` o el fallback.

No hay infra de tests en frontend; no se añade.

## Fuera de alcance

- Caché/persistencia de explicaciones.
- Proxy genérico de chat (messages arbitrarios).
- Migración/limpieza de keys viejas en localStorage de usuarios existentes (el campo
  desaparece de Settings; el valor huérfano en localStorage es inofensivo).
