import { describe, expect, it } from 'vitest';
import { endpoint, isInsecureEndpoint } from './configuration';

describe('provider endpoint policy', () => {
  it('accepts HTTPS and HTTP endpoints', () => {
    expect(endpoint('https://models.example/v1')).toBe('https://models.example/v1');
    expect(endpoint('http://models.example/v1')).toBe('http://models.example/v1');
    expect(endpoint('http://192.168.1.20:8080/v1')).toBe('http://192.168.1.20:8080/v1');
    expect(endpoint('http://127.0.0.1:8080/v1')).toBe('http://127.0.0.1:8080/v1');
    expect(endpoint('http://[::1]:8080/v1')).toBe('http://[::1]:8080/v1');
  });

  it('flags plain HTTP outside loopback for a warning', () => {
    expect(isInsecureEndpoint('http://models.example/v1')).toBe(true);
    expect(isInsecureEndpoint('http://192.168.1.20:8080/v1')).toBe(true);
    expect(isInsecureEndpoint('http://127.0.0.1:8080/v1')).toBe(false);
    expect(isInsecureEndpoint('https://models.example/v1')).toBe(false);
  });

  it('rejects non-HTTP endpoints', () => {
    expect(() => endpoint('ftp://models.example/v1')).toThrow('HTTP or HTTPS');
  });

  it('rejects credentials, queries and fragments in the endpoint', () => {
    expect(() => endpoint('https://user:pass@models.example/v1')).toThrow('credentials');
    expect(() => endpoint('https://models.example/v1?key=x')).toThrow('credentials');
  });
});
