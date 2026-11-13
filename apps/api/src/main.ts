import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '@api/app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  console.log(`arcdrop-api listening on ${await app.getUrl()}`);
}

void bootstrap();
