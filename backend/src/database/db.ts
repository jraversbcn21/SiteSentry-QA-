import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

let db: Database.Database | null = null;

interface Migration {
  version: number;
  name: string;
  sql: string;
}

var migrations: Migration[] = [
  {
    version: 1,
    name: 'base_schema',
    sql: `
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
    `,
  },
  {
    version: 2,
    name: 'screenshot_path',
    sql: 'ALTER TABLE issues ADD COLUMN screenshot_path TEXT',
  },
  {
    version: 3,
    name: 'is_baseline',
    sql: 'ALTER TABLE scans ADD COLUMN is_baseline INTEGER NOT NULL DEFAULT 0',
  },
  {
    version: 4,
    name: 'visual_diffs',
    sql: `
      CREATE TABLE IF NOT EXISTS visual_diffs (
        id TEXT PRIMARY KEY,
        scan_id TEXT NOT NULL,
        baseline_scan_id TEXT NOT NULL,
        diff_type TEXT NOT NULL,
        issue_id TEXT,
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
    `,
  },
  {
    version: 5,
    name: 'baseline_issue_id',
    sql: 'ALTER TABLE visual_diffs ADD COLUMN baseline_issue_id TEXT',
  },
  {
    version: 6,
    name: 'flows',
    sql: `
      CREATE TABLE IF NOT EXISTS flows (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        steps TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `,
  },
  {
    version: 7,
    name: 'step_index',
    sql: 'ALTER TABLE issues ADD COLUMN step_index INTEGER',
  },
  {
    version: 8,
    name: 'scan_progress',
    sql: 'ALTER TABLE scans ADD COLUMN progress TEXT',
  },
];

function ensureMigrationsTable(database: Database.Database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);
}

function getAppliedVersions(database: Database.Database): number[] {
  var rows = database.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as { version: number }[];
  return rows.map(function(r) { return r.version; });
}

function tablesExist(database: Database.Database): boolean {
  try {
    var row = database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='scans'").get() as any;
    return !!row;
  } catch {
    return false;
  }
}

function seedExistingDb(database: Database.Database) {
  var now = new Date().toISOString();
  var insert = database.prepare('INSERT OR IGNORE INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)');
  for (var i = 0; i < migrations.length; i++) {
    insert.run(migrations[i].version, migrations[i].name, now);
  }
  console.log('[DB] Base de datos existente detectada — ' + migrations.length + ' migraciones registradas como aplicadas');
}

function runMigrations(database: Database.Database) {
  ensureMigrationsTable(database);

  var appliedVersions = getAppliedVersions(database);

  if (appliedVersions.length === 0 && tablesExist(database)) {
    seedExistingDb(database);
    return;
  }

  var appliedSet = new Set(appliedVersions);
  var pending = migrations.filter(function(m) { return !appliedSet.has(m.version); });

  if (pending.length === 0) return;

  console.log('[DB] Aplicando ' + pending.length + ' migraciones pendientes...');
  var now = new Date().toISOString();
  var insertMigration = database.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)');

  for (var i = 0; i < pending.length; i++) {
    var m = pending[i];
    try {
      database.exec(m.sql);
      insertMigration.run(m.version, m.name, now);
      console.log('[DB]  Migracion ' + m.version + ' (' + m.name + ') aplicada');
    } catch (err: any) {
      console.error('[DB] Error aplicando migracion ' + m.version + ' (' + m.name + '):', err.message);
      throw err;
    }
  }
}

export function getDb(): Database.Database {
  if (db) return db;

  var dbPath = process.env.DB_PATH || path.join(process.cwd(), 'data', 'sitesentry.db');
  var dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  runMigrations(db);

  return db;
}
