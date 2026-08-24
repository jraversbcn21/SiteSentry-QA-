import { scanQueue } from '../queue/queue';
import { processScanJob } from './ScanWorker';
import { getDb } from '../database/db';
import { ScanStatus } from '../types';

scanQueue.on('process', async (job: any) => {
  try {
    await processScanJob({ data: job.data, updateProgress: async (progress: object) => {
      job.progress = progress;
      // H10: persistir progreso en la fila del scan para sobrevivir reinicios del proceso
      try {
        getDb().prepare('UPDATE scans SET progress = ? WHERE id = ?').run(JSON.stringify(progress), job.data.scanId);
      } catch {}
    }});
    console.log('✅ Scan completado: ' + job.id);
  } catch (err: any) {
    console.error('❌ Scan fallido: ' + job.id, err.message);
  }
});

function recoverOrphanedScans() {
  try {
    var db = getDb();
    var now = new Date().toISOString();

    var runningScans = db.prepare(
      'SELECT id FROM scans WHERE status = ?'
    ).all(ScanStatus.RUNNING) as { id: string }[];

    if (runningScans.length > 0) {
      console.log('[Recovery] Marcando ' + runningScans.length + ' scans RUNNING huerfanos como FAILED');
      var stmt = db.prepare('UPDATE scans SET status = ?, completed_at = ? WHERE id = ? AND status = ?');
      for (var i = 0; i < runningScans.length; i++) {
        stmt.run(ScanStatus.FAILED, now, runningScans[i].id, ScanStatus.RUNNING);
      }
    }

    var pendingScans = db.prepare(
      'SELECT id, url, config FROM scans WHERE status = ?'
    ).all(ScanStatus.PENDING) as { id: string; url: string; config: string }[];

    if (pendingScans.length > 0) {
      console.log('[Recovery] Re-encolando ' + pendingScans.length + ' scans PENDING huerfanos');
      for (var j = 0; j < pendingScans.length; j++) {
        var scan = pendingScans[j];
        var configObj: any = {};
        try { configObj = JSON.parse(scan.config); } catch {}
        scanQueue.add('process-scan', {
          scanId: scan.id,
          url: scan.url,
          config: configObj,
        }).catch(function(err: any) {
          console.error('[Recovery] Error re-encolando scan ' + scan.id + ':', err.message);
        });
      }
    }
  } catch (err: any) {
    console.warn('[Recovery] Error durante recuperacion de scans huerfanos:', err.message);
  }
}

recoverOrphanedScans();

console.log('📋 SiteSentry QA - Procesador de scans registrado (single-process)');
