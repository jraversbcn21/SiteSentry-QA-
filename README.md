# SiteSentry QA

Analizador funcional de paginas web. Introduce una URL y detecta problemas reales: recursos rotos, APIs fallidas, botones muertos, contenido vacio, lazy load roto y formularios/modales defectuosos.

**Una URL = un analisis de esa pagina.** No hace crawling ni sigue enlaces.

## Arquitectura

- **Frontend**: React 18 + TypeScript + Vite
- **Backend**: Node.js + TypeScript + Express
- **Browser Automation**: Playwright (Chromium)
- **Queue**: In-process (EventEmitter, sin dependencias externas)
- **Database**: SQLite via better-sqlite3

**Sin servicios externos.** Todo corre en un solo proceso Node.js: API REST + procesamiento de scans en el mismo proceso. No requiere Redis, PostgreSQL ni ningun servicio externo.

## Requisitos

- Node.js 18+

## Instalacion

```bash
# Backend
cd backend
npm install
npx playwright install chromium

# Frontend
cd frontend
npm install
```

## Ejecucion (2 terminales)

```bash
# Terminal 1 - Backend (API + Worker en un solo proceso)
cd backend && npm run dev

# Terminal 2 - Frontend
cd frontend && npm run dev
```

Abre `http://localhost:5173`, introduce una URL y lanza el analisis.

## Que detecta (9 checkers)

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

### Errores de Consola
- Errores JavaScript en consola
- Errores CORS reportados por el navegador

### Rendimiento
- TTFB, DOMContentLoaded, tiempo de carga total
- Conteo de nodos DOM y recursos cargados

### Accesibilidad
- Violaciones WCAG 2.0A/AA/2.1A/AA via axe-core

## Funcionalidades adicionales

- **Flujos interactivos**: Define secuencias multi-paso (login, busqueda, carrito) via JSON o importando scripts de Playwright codegen
- **Regresion visual**: Compara screenshots entre scans de la misma URL con pixelmatch
- **Explicaciones con IA**: Integracion con Groq LLM para explicar issues detectados
- **Exportacion**: JSON y CSV descargables del reporte

## Variables de Entorno

Archivo `backend/.env` (opcional, todo tiene defaults funcionales):

```env
PORT=3001
FRONTEND_URL=http://localhost:5173
DB_PATH=./data/sitesentry.db
PAGE_TIMEOUT=60000
VISUAL_DIFF_THRESHOLD=0.05
```

## Estructura

```
SiteSentry QA/
├── backend/
│   └── src/
│       ├── api/           # Express REST API
│       ├── analyzer/      # PageAnalyzer (nucleo)
│       ├── checkers/      # 9 checkers funcionales
│       ├── workers/       # ScanWorker + procesador de cola
│       ├── queue/         # Cola in-process (EventEmitter)
│       ├── database/      # SQLite via better-sqlite3
│       └── types/         # Tipos TypeScript
├── frontend/
│   └── src/
│       ├── components/    # Componentes React
│       ├── pages/         # Paginas
│       ├── services/      # Cliente API + AI
│       └── types/         # Tipos TypeScript
└── README.md
```

## Troubleshooting

| Problema | Solucion |
|---|---|
| Analisis no progresa | Verificar logs del backend |
| Timeout en paginas pesadas | Aumentar `PAGE_TIMEOUT` en `.env` |
| Playwright no encuentra navegador | `npx playwright install chromium` |
| Error de CORS | Verificar `FRONTEND_URL` en `.env` |
