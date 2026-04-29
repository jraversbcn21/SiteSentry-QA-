# Guia de Setup - SiteSentry QA

## Requisitos

- Node.js 18+ ([descargar](https://nodejs.org/))
- npm

## Paso 1: Supabase (Base de Datos)

1. Crea un proyecto en [supabase.com](https://supabase.com)
2. Ve a **Settings > Database**
3. Copia la **Connection string (URI)**
4. Reemplaza `[YOUR-PASSWORD]` con tu contrasena
5. Resultado: `postgresql://postgres:tu_password@db.xxxxx.supabase.co:5432/postgres`

## Paso 2: Redis

**Opcion A - Redis local (Docker):**
```bash
docker run -d -p 6379:6379 redis
```

**Opcion B - Redis Cloud:** Crea una cuenta gratis en [redis.com](https://redis.com/try-free/)

## Paso 3: Backend

```bash
cd backend
npm install
```

Crea el archivo `.env`:
```bash
cp .env.example .env
```

Edita `backend/.env`:
```env
DATABASE_URL="postgresql://postgres:TU_PASSWORD@db.xxxxx.supabase.co:5432/postgres"
REDIS_URL="redis://localhost:6379"
PORT=3001
FRONTEND_URL=http://localhost:5173
PAGE_TIMEOUT=60000
```

Genera Prisma y migra la base de datos:
```bash
npm run prisma:generate
npm run prisma:migrate
```

Instala Chromium para Playwright:
```bash
npx playwright install chromium
```

## Paso 4: Frontend

```bash
cd frontend
npm install
```

## Paso 5: Iniciar servicios

Necesitas **3 terminales** abiertas simultaneamente:

**Terminal 1 - API:**
```bash
cd backend
npm run dev
```
Esperado: `Server running on port 3001`

**Terminal 2 - Worker:**
```bash
cd backend
npm run worker
```
Esperado: `Scan Worker iniciado`

**Terminal 3 - Frontend:**
```bash
cd frontend
npm run dev
```
Esperado: `Local: http://localhost:5173/`

## Paso 6: Probar

1. Abre `http://localhost:5173`
2. Introduce una URL (ej: `https://example.com`)
3. Haz clic en "Analizar"
4. Espera 10-60 segundos
5. Revisa el reporte con los problemas detectados

## Verificacion en Supabase

Ve al **Table Editor** en tu dashboard de Supabase. Deberias ver:
- Tabla `Scan` con tu analisis
- Tabla `Issue` con los errores detectados

## Solucion de Problemas

### No conecta a la base de datos
- Verifica `DATABASE_URL` en `.env`
- Confirma que reemplazaste `[YOUR-PASSWORD]`
- Verifica que tu proyecto Supabase este activo

### No conecta a Redis
- Redis local: `redis-cli ping` debe responder `PONG`
- Redis Cloud: verifica la URL en `.env`

### El analisis no progresa
- Verifica que el Worker este corriendo (Terminal 2)
- Revisa los logs del worker

### Error de CORS
- Verifica que `FRONTEND_URL` en `.env` sea `http://localhost:5173`
- Reinicia el backend

### Timeout en paginas pesadas
- Aumenta `PAGE_TIMEOUT` en `.env` (por defecto 60000ms = 60s)
