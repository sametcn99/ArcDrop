import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import type { ServiceInfo } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getServiceInfo(): ServiceInfo {
    return this.appService.getServiceInfo();
  }
}
