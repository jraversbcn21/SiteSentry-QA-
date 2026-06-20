import { EventEmitter } from 'events';

interface Job {
  id: string;
  name: string;
  data: any;
  progress: any;
  timestamp: number;
}

class SimpleQueue extends EventEmitter {
  private jobs: Job[] = [];
  private processing = false;
  private nextId = 1;

  async add(name: string, data: any, _opts?: any): Promise<Job> {
    var id = String(this.nextId++);
    var job: Job = { id, name, data, progress: null, timestamp: Date.now() };
    this.jobs.push(job);
    this.processNext();
    return job;
  }

  async getJobs(_types: string[]): Promise<Job[]> {
    return this.jobs;
  }

  private async processNext() {
    if (this.processing) return;
    this.processing = true;
    while (this.jobs.length > 0) {
      var job = this.jobs.shift()!;
      try {
        await this.emitAsync('process', job);
      } catch (err) {
        this.emit('failed', job, err);
      }
    }
    this.processing = false;
  }

  private emitAsync(event: string, ...args: any[]): Promise<void> {
    return new Promise((resolve, reject) => {
      var listeners = this.listeners(event);
      if (listeners.length === 0) {
        resolve();
        return;
      }
      var handler = listeners[0] as Function;
      try {
        var result = handler(...args);
        if (result && typeof result.then === 'function') {
          result.then(resolve, reject);
        } else {
          resolve();
        }
      } catch (err) {
        reject(err);
      }
    });
  }
}

var scanQueue = new SimpleQueue();

export function getScanQueue(): SimpleQueue | null {
  return scanQueue;
}

export { scanQueue };
