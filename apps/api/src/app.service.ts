import { Injectable } from '@nestjs/common';
import pkg from '../package.json';

export interface ServiceInfo {
  name: string;
  version: string;
  apiVersion: string;
  status: string;
}

@Injectable()
export class AppService {
  getServiceInfo(): ServiceInfo {
    return {
      name: 'arcdrop-api',
      version: pkg.version,
      apiVersion: 'v1',
      status: 'ok',
    };
  }
}
