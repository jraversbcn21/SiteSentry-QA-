import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;

  const dbPath = process.env.DB_PATH || path.join(process.cwd(), 'data', 'sitesentry.db');
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS scans (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      config TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS issues (
      id TEXT PRIMARY KEY,
      scan_id TEXT NOT NULL,
      type TEXT NOT NULL,
      severity TEXT NOT NULL,
      url TEXT NOT NULL,
      source_url TEXT,
      description TEXT NOT NULL,
      metadata TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (scan_id) REFERENCES scans(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_scans_status ON scans(status);
    CREATE INDEX IF NOT EXISTS idx_scans_created_at ON scans(created_at);
    CREATE INDEX IF NOT EXISTS idx_issues_scan_id ON issues(scan_id);
    CREATE INDEX IF NOT EXISTS idx_issues_type ON issues(type);
    CREATE INDEX IF NOT EXISTS idx_issues_severity ON issues(severity);
  `);

  // Migracion: agregar screenshot_path a issues (Fase 1 - Screenshots)
  try {
    db.exec('ALTER TABLE issues ADD COLUMN screenshot_path TEXT');
  } catch (e: any) {
    if (!e.message.includes('duplicate column name')) {
      console.warn('Migration warning (screenshot_path):', e.message);
    }
  }

  return db;
}
