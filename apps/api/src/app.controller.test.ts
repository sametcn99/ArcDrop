import { describe, expect, it } from 'bun:test';
import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController', () => {
  const controller = new AppController(new AppService());

  it('GET / returns the service info', () => {
    const info = controller.getServiceInfo();
    expect(info.name).toBe('arcdrop-api');
    expect(info.status).toBe('ok');
  });
});
