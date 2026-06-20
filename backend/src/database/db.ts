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

  // Migracion: agregar is_baseline a scans (Fase 2 - Visual Regression)
  try {
    db.exec('ALTER TABLE scans ADD COLUMN is_baseline INTEGER NOT NULL DEFAULT 0');
  } catch (e: any) {
    if (!e.message.includes('duplicate column name')) {
      console.warn('Migration warning (is_baseline):', e.message);
    }
  }

  // Migracion: crear tabla visual_diffs (Fase 2 - Visual Regression)
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS visual_diffs (
        id TEXT PRIMARY KEY,
        scan_id TEXT NOT NULL,
        baseline_scan_id TEXT NOT NULL,
        diff_type TEXT NOT NULL,
        issue_id TEXT,
        baseline_issue_id TEXT,
        element_identifier TEXT,
        diff_percentage REAL NOT NULL,
        diff_image_path TEXT,
        threshold_used REAL NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (scan_id) REFERENCES scans(id) ON DELETE CASCADE,
        FOREIGN KEY (baseline_scan_id) REFERENCES scans(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_visual_diffs_scan_id ON visual_diffs(scan_id);
      CREATE INDEX IF NOT EXISTS idx_visual_diffs_issue_id ON visual_diffs(issue_id);
    `);
  } catch (e: any) {
    if (!e.message.includes('already exists')) {
      console.warn('Migration warning (visual_diffs):', e.message);
    }
  }

  // Migracion: agregar baseline_issue_id a visual_diffs (Fase 2 - Fix)
  try {
    db.exec('ALTER TABLE visual_diffs ADD COLUMN baseline_issue_id TEXT');
  } catch (e: any) {
    if (!e.message.includes('duplicate column name')) {
      console.warn('Migration warning (baseline_issue_id):', e.message);
    }
  }

  // Migracion: crear tabla flows (Fase 3 - Interactive Flows)
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS flows (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        steps TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  } catch (e: any) {
    if (!e.message.includes('already exists')) {
      console.warn('Migration warning (flows):', e.message);
    }
  }

  // Migracion: agregar step_index a issues (Fase 3 - Interactive Flows)
  try {
    db.exec('ALTER TABLE issues ADD COLUMN step_index INTEGER');
  } catch (e: any) {
    if (!e.message.includes('duplicate column name')) {
      console.warn('Migration warning (step_index):', e.message);
    }
  }

  return db;
}
