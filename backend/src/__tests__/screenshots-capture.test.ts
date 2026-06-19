import fs from 'fs';
import path from 'path';

describe('screenshot directory creation', () => {
  const testDir = path.join(process.cwd(), 'data', 'screenshots', '__test__');

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  it('should create nested screenshot directories', () => {
    const nestedPath = path.join(testDir, 'nested', 'deep');
    fs.mkdirSync(nestedPath, { recursive: true });
    expect(fs.existsSync(nestedPath)).toBe(true);
  });

  it('should not fail when directory already exists', () => {
    fs.mkdirSync(testDir, { recursive: true });
    fs.mkdirSync(testDir, { recursive: true });
    expect(fs.existsSync(testDir)).toBe(true);
  });
});
