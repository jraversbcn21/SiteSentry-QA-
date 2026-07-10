import { isPrivateIp } from '../security/ssrf';

describe('isPrivateIp', () => {
  it('should detect 127.0.0.1 as private', () => {
    expect(isPrivateIp('127.0.0.1')).toBe(true);
  });

  it('should detect 127.255.255.255 as private (loopback range)', () => {
    expect(isPrivateIp('127.255.255.255')).toBe(true);
  });

  it('should detect 10.x.x.x as private', () => {
    expect(isPrivateIp('10.0.0.1')).toBe(true);
    expect(isPrivateIp('10.255.255.255')).toBe(true);
  });

  it('should detect 172.16.x.x as private', () => {
    expect(isPrivateIp('172.16.0.1')).toBe(true);
    expect(isPrivateIp('172.31.255.255')).toBe(true);
  });

  it('should detect 192.168.x.x as private', () => {
    expect(isPrivateIp('192.168.0.1')).toBe(true);
    expect(isPrivateIp('192.168.255.255')).toBe(true);
  });

  it('should detect 169.254.x.x as private (link-local)', () => {
    expect(isPrivateIp('169.254.0.1')).toBe(true);
    expect(isPrivateIp('169.254.255.255')).toBe(true);
  });

  it('should detect 0.0.0.0 as private', () => {
    expect(isPrivateIp('0.0.0.0')).toBe(true);
  });

  it('should NOT detect 8.8.8.8 as private', () => {
    expect(isPrivateIp('8.8.8.8')).toBe(false);
  });

  it('should NOT detect 1.1.1.1 as private', () => {
    expect(isPrivateIp('1.1.1.1')).toBe(false);
  });

  it('should NOT detect 172.32.0.1 as private (outside 172.16/12 range)', () => {
    expect(isPrivateIp('172.32.0.1')).toBe(false);
  });

  it('should NOT detect 192.169.0.1 as private (outside 192.168/16 range)', () => {
    expect(isPrivateIp('192.169.0.1')).toBe(false);
  });

  it('should NOT detect 11.0.0.1 as private (near 10/8)', () => {
    expect(isPrivateIp('11.0.0.1')).toBe(false);
  });
});
