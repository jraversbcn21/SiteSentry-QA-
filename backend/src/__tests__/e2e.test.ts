// E2E smoke test: POST /api/scan -> worker (in-process) -> GET report.
// Sirve una pagina fixture local y la escanea a traves de la API real.
// - SSRF profundo mockeado (la fixture vive en loopback); el bloqueo de hostname
//   del endpoint queda activo: se usa 127.0.0.2, que no esta en su denylist literal.
// - Sin supertest: app.listen(0) + fetch nativo.
import http from 'http';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { AddressInfo } from 'net';

jest.mock('../security/ssrf', () => ({
  validateUrl: jest.fn().mockResolvedValue(undefined),
  isPrivateIp: jest.fn().mockReturnValue(false),
}));

// pixelmatch es ESM-only (jest CJS no lo parsea); irrelevante aqui: el primer scan no tiene baseline
jest.mock('pixelmatch', () => jest.fn().mockReturnValue(0));

var FIXTURE_HTML = `<!DOCTYPE html>
<html lang="es"><head><title>Pagina fixture E2E</title></head>
<body>
  <main>
    <h1>Contenido de prueba</h1>
    <p>Parrafo con contenido real para que ContentChecker no se queje.</p>
    <img src="/missing.png" alt="imagen rota" style="width:100px;height:100px;">
  </main>
</body></html>`;

describe('E2E smoke — pipeline completo', () => {
  jest.setTimeout(180000);

  var app: any;
  var apiServer: http.Server;
  var fixtureServer: http.Server;
  var apiBase: string;
  var fixtureUrl: string;
  var scanId: string;
  var dbPath: string;

  beforeAll(async () => {
    dbPath = path.join(os.tmpdir(), 'sitesentry-e2e-' + Date.now() + '.db');
    process.env.DB_PATH = dbPath;
    delete process.env.API_KEY;

    // Importar despues de fijar DB_PATH (workers/index abre la DB al cargar)
    app = require('../api/server').app;

    fixtureServer = http.createServer(function(req, res) {
      if (req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(FIXTURE_HTML);
      } else {
        res.writeHead(404);
        res.end('not found');
      }
    });
    await new Promise<void>(function(resolve) { fixtureServer.listen(0, '0.0.0.0', resolve); });
    fixtureUrl = 'http://127.0.0.2:' + (fixtureServer.address() as AddressInfo).port;

    apiServer = app.listen(0);
    await new Promise<void>(function(resolve) { apiServer.once('listening', resolve); });
    apiBase = 'http://127.0.0.1:' + (apiServer.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>(function(resolve) { apiServer.close(function() { resolve(); }); });
    await new Promise<void>(function(resolve) { fixtureServer.close(function() { resolve(); }); });
    var { getDb } = require('../database/db');
    try { getDb().close(); } catch {}
    try { fs.rmSync(dbPath, { force: true }); } catch {}
    try { fs.rmSync(dbPath + '-wal', { force: true }); } catch {}
    try { fs.rmSync(dbPath + '-shm', { force: true }); } catch {}
    if (scanId) {
      try { fs.rmSync(path.join(process.cwd(), 'data', 'screenshots', scanId), { recursive: true, force: true }); } catch {}
    }
  });

  it('POST /api/scan -> worker -> reporte completo', async () => {
    // 1. Crear scan via API
    var postRes = await fetch(apiBase + '/api/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: fixtureUrl }),
    });
    expect(postRes.status).toBe(201);
    var created: any = await postRes.json();
    scanId = created.id;
    expect(created.status).toBe('PENDING');

    // 2. Esperar a que el worker in-process complete (poll en DB, no en API, para no gastar rate limit)
    var { getDb } = require('../database/db');
    var db = getDb();
    var status = 'PENDING';
    var deadline = Date.now() + 150000;
    while (Date.now() < deadline) {
      var row = db.prepare('SELECT status FROM scans WHERE id = ?').get(scanId) as { status: string };
      status = row.status;
      if (status === 'COMPLETED' || status === 'FAILED') break;
      await new Promise(function(resolve) { setTimeout(resolve, 1000); });
    }
    expect(status).toBe('COMPLETED');

    // 3. Endpoint de status refleja el estado final
    var statusRes = await fetch(apiBase + '/api/scan/' + scanId + '/status');
    expect(statusRes.status).toBe(200);
    var statusBody: any = await statusRes.json();
    expect(statusBody.status).toBe('COMPLETED');
    expect(statusBody.completedAt).toBeTruthy();

    // 4. El reporte existe y contiene los issues detectados
    var reportRes = await fetch(apiBase + '/api/reports/' + scanId);
    expect(reportRes.status).toBe(200);
    var report: any = await reportRes.json();
    expect(report.url).toBe(fixtureUrl);
    expect(Array.isArray(report.issues)).toBe(true);

    // La imagen rota de la fixture debe aparecer como BROKEN_RESOURCE
    var brokenResource = report.issues.find(function(i: any) { return i.type === 'BROKEN_RESOURCE'; });
    expect(brokenResource).toBeDefined();

    // H10: el progreso persistido quedo escrito en la fila durante la ejecucion
    var progressRow = db.prepare('SELECT progress FROM scans WHERE id = ?').get(scanId) as { progress: string | null };
    expect(progressRow.progress).toBeTruthy();
    var lastProgress = JSON.parse(progressRow.progress as string);
    expect(lastProgress.phase).toBeTruthy();
  });
});
