import { scanQueue } from '../queue/queue';
import { processScanJob } from './ScanWorker';

scanQueue.on('process', async (job: any) => {
  try {
    await processScanJob({ data: job.data, updateProgress: async (progress: object) => {
      job.progress = progress;
    }});
    console.log('✅ Scan completado: ' + job.id);
  } catch (err: any) {
    console.error('❌ Scan fallido: ' + job.id, err.message);
  }
});

console.log('👷 SiteSentry QA Worker iniciado');
