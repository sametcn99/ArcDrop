import { describe, expect, it } from 'bun:test';
import { AppService } from './app.service';

describe('AppService', () => {
  const service = new AppService();

  it('returns service info', () => {
    const info = service.getServiceInfo();
    expect(info.name).toBe('arcdrop-api');
    expect(info.version).toBe('0.1.0');
    expect(info.apiVersion).toBe('v1');
    expect(info.status).toBe('ok');
  });
});
