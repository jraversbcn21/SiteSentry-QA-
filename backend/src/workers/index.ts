import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import { processScanJob } from './ScanWorker';

const connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

export const scanWorker = new Worker(
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
  console.log(`✅ Scan completado: ${job.id}`);
});

scanWorker.on('failed', (job, err) => {
  console.error(`❌ Scan fallido: ${job?.id}`, err.message);
});

console.log('👷 SiteSentry QA Worker iniciado');
