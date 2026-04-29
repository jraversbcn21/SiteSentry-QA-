# SiteSentry QA

Analizador funcional de paginas web. Introduce una URL y detecta problemas reales: recursos rotos, APIs fallidas, botones muertos, contenido vacio, lazy load roto y formularios/modales defectuosos.

**Una URL = un analisis de esa pagina.** No hace crawling ni sigue enlaces.

## Arquitectura

- **Frontend**: React 18 + TypeScript + Vite
- **Backend**: Node.js + TypeScript + Express
- **Browser Automation**: Playwright (Chromium)
- **Queue**: BullMQ + Redis
- **Database**: PostgreSQL (Supabase) + Prisma

## Requisitos

- Node.js 18+
- Redis 6+
- PostgreSQL 14+ (o cuenta en [Supabase](https://supabase.com))

## Instalacion

Consulta [SETUP.md](./SETUP.md) para la guia completa paso a paso.

### Resumen rapido

```bash
# Backend
cd backend
npm install
cp .env.example .env   # Configurar DATABASE_URL y REDIS_URL
npm run prisma:generate
npm run prisma:migrate
npx playwright install chromium

# Frontend
cd frontend
npm install
```

## Ejecucion (3 terminales)

```bash
# Terminal 1 - API
cd backend && npm run dev

# Terminal 2 - Worker
cd backend && npm run worker

# Terminal 3 - Frontend
cd frontend && npm run dev
```

Abre `http://localhost:5173`, introduce una URL y lanza el analisis.

## Que detecta

### Recursos Rotos
- Imagenes, CSS, JS, fuentes que no cargan (4xx/5xx o fallo de red)
- Imagenes rotas en el DOM (naturalWidth === 0)

### APIs Fallidas
- Llamadas XHR/fetch con error (4xx, 5xx, fallo de red)
- APIs extremadamente lentas (>10s)
- Posibles errores CORS

### Interactividad
- Enlaces sin destino (href vacio)
- Enlaces con destino placeholder (`#`, `javascript:void(0)`)
- Botones visualmente deshabilitados sin atributo `disabled`

### Contenido Vacio
- Contenedores visibles sin contenido
- Mensajes de error visibles en la pagina
- Contenedor principal vacio (posible fallo de renderizado)

### Carga Diferida (Lazy Load)
- Imagenes lazy que no se cargaron tras scroll
- Spinners/skeletons atascados
- Imagenes mostrando placeholder en vez de contenido real

### Formularios y Modales
- Formularios sin boton de envio
- Formularios sin action definido
- Modales sin boton de cierre
- Banners de cookies que bloquean interaccion

## Variables de Entorno

Archivo `backend/.env`:

```env
DATABASE_URL="postgresql://postgres:password@db.xxx.supabase.co:5432/postgres"
REDIS_URL="redis://localhost:6379"
PORT=3001
FRONTEND_URL=http://localhost:5173
PAGE_TIMEOUT=60000
```

## Estructura

```
SiteSentry QA/
├── backend/
│   └── src/
│       ├── api/           # Express REST API
│       ├── analyzer/      # PageAnalyzer (nucleo)
│       ├── checkers/      # 6 checkers funcionales
│       ├── workers/       # ScanWorker (BullMQ)
│       ├── queue/         # Configuracion de colas
│       ├── database/      # Prisma schema y cliente
│       └── types/         # Tipos TypeScript
├── frontend/
│   └── src/
│       ├── components/    # Componentes React
│       ├── pages/         # Paginas
│       ├── services/      # Cliente API
│       └── types/         # Tipos TypeScript
└── README.md
```

## Seguridad (Supabase)

Si usas Supabase, habilita Row Level Security (RLS). Consulta `backend/security/README-SEGURIDAD.md`.

## Troubleshooting

| Problema | Solucion |
|---|---|
| No conecta a DB | Verificar `DATABASE_URL` en `.env` |
| No conecta a Redis | Verificar `REDIS_URL` en `.env` |
| Analisis no progresa | Verificar que el worker esta corriendo |
| Timeout en paginas pesadas | Aumentar `PAGE_TIMEOUT` en `.env` |
| Playwright no encuentra navegador | `npx playwright install chromium` |
