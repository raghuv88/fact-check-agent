import express, { Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { requestLogger } from './middleware/logger.ts';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.ts';
import { registerRoutes } from './routes/index.ts';

/**
 * Create and configure Express application
 * Like ASP.NET Core's Startup.cs / WebApplication.CreateBuilder()
 */
export function createApp(): Application {
  const app = express();

  // ============================================
  // MIDDLEWARE (like app.Use() in ASP.NET Core)
  // ============================================

  // Security headers (like ASP.NET Security middleware)
  app.use(helmet());

  // CORS - allow frontend to call API
  app.use(cors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
    methods: ['GET', 'POST', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }));

  // Parse JSON request bodies (like [FromBody] in ASP.NET)
  app.use(express.json({ limit: '10mb' }));

  // Parse URL-encoded bodies
  app.use(express.urlencoded({ extended: true }));

  // Request logging
  app.use(requestLogger);

  // ============================================
  // ROUTES (like MapControllers() in ASP.NET Core)
  // ============================================
  registerRoutes(app);

  // ============================================
  // ERROR HANDLING (must be last!)
  // ============================================
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}