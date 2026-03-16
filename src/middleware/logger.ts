import { Request, Response, NextFunction } from 'express';
import { validationResult } from 'express-validator';

// ============================================
// FILE: middleware/logger.ts
// Like ASP.NET Core's request logging middleware
// ============================================

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  const { method, url } = req;

  // Log when request completes
  res.on('finish', () => {
    const duration = Date.now() - start;
    const status = res.statusCode;
    const emoji = status < 400 ? '✅' : status < 500 ? '⚠️' : '❌';
    
    console.log(`${emoji} ${method} ${url} → ${status} (${duration}ms)`);
  });

  next(); // Call next middleware (like next.Invoke in ASP.NET)
}