import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import { processScanJob } from './ScanWorker';

let scanWorker: Worker | null = null;

try {
  var connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
    lazyConnect: true,
  });

  scanWorker = new Worker(
    'scan-queue',
    async (job) => {
      await processScanJob(job);
    },
    {
      connection,
      concurrency: 3,
    }
  );

  scanWorker.on('completed', (job) => {
    console.log('✅ Scan completado: ' + job.id);
  });

  scanWorker.on('failed', (job, err) => {
    console.error('❌ Scan fallido: ' + (job?.id || 'unknown'), err.message);
  });

  console.log('👷 SiteSentry QA Worker iniciado');
} catch (err: any) {
  console.warn('⚠ Redis no disponible. El worker no procesara scans hasta que Redis este corriendo.');
}
