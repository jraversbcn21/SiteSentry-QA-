import { Queue } from 'bullmq';
import IORedis from 'ioredis';

let connection: IORedis | null = null;
let scanQueue: Queue | null = null;

function getConnection(): IORedis {
  if (!connection) {
    connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
      maxRetriesPerRequest: null,
      lazyConnect: true,
    });
  }
  return connection;
}

export function getScanQueue(): Queue | null {
  if (scanQueue) return scanQueue;
  try {
    scanQueue = new Queue('scan-queue', {
      connection: getConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: { age: 3600, count: 100 },
        removeOnFail: { age: 86400 },
      },
    });
    return scanQueue;
  } catch {
    console.warn('⚠ Redis no disponible. Los scans no se procesaran hasta que Redis este corriendo y se reinicie el servidor.');
    return null;
  }
}
