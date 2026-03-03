import './instrumentation';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as cookieParser from 'cookie-parser';
import { trace } from '@opentelemetry/api';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.use(cookieParser());

  app.enableCors({
    origin: true, // or set to your frontend origin(s), e.g. ['http://localhost:5173']
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  const config = new DocumentBuilder()
    .setTitle('Tasky API')
    .setDescription('API for Tasky (notes, tasks, workspaces)')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);

  await app.listen(process.env.PORT ?? 8000);

  // One-time test span so you can verify traces in Grafana (Explore → Traces → tasky-server)
  if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
    const tracer = trace.getTracer('tasky-server', '1.0.0');
    const span = tracer.startSpan('server-started');
    span.addEvent('hello-grafana');
    span.end();
  }
}
bootstrap();
