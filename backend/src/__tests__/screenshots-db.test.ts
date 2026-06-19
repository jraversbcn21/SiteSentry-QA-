import { getDb } from '../database/db';
import { randomUUID } from 'crypto';

describe('screenshot_path column', () => {
  it('should allow storing screenshot_path on issues table', () => {
    const db = getDb();

    const scanId = randomUUID();
    db.prepare('INSERT INTO scans (id, url, status, config, created_at) VALUES (?, ?, ?, ?, ?)').run(
      scanId, 'https://example.com', 'COMPLETED', '{}', new Date().toISOString()
    );

    const issueId = randomUUID();
    db.prepare('INSERT INTO issues (id, scan_id, type, severity, url, description, screenshot_path, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
      issueId, scanId, 'EMPTY_CONTENT', 'HIGH', 'https://example.com', 'test issue', scanId + '/test.png', new Date().toISOString()
    );

    const row = db.prepare('SELECT screenshot_path FROM issues WHERE id = ?').get(issueId) as any;
    expect(row.screenshot_path).toBe(scanId + '/test.png');

    db.prepare('DELETE FROM issues WHERE scan_id = ?').run(scanId);
    db.prepare('DELETE FROM scans WHERE id = ?').run(scanId);
  });
});
