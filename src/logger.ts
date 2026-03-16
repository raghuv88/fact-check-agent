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

// ============================================
// FILE: middleware/errorHandler.ts
// Like UseExceptionHandler in ASP.NET Core
// ============================================

// Custom API Error class (like custom exceptions in C#)
export class ApiError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public details?: any
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// 404 handler
export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    success: false,
    error: 'Route not found',
    path: req.originalUrl,
  });
}

// Global error handler (must have 4 params for Express to recognize it)
export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  console.error('❌ Error:', err.message);
  if (process.env.NODE_ENV === 'development') {
    console.error(err.stack);
  }

  // Handle known API errors
  if (err instanceof ApiError) {
    res.status(err.statusCode).json({
      success: false,
      error: err.message,
      details: err.details,
    });
    return;
  }

  // Handle validation errors
  if (err.name === 'ValidationError') {
    res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: err.message,
    });
    return;
  }

  // Default 500 error
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong',
  });
}

// ============================================
// FILE: middleware/validator.ts
// Like FluentValidation in ASP.NET Core
// ============================================

export function validateRequest(req: Request, res: Response, next: NextFunction): void {
  const errors = validationResult(req);
  
  if (!errors.isEmpty()) {
    res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: errors.array(),
    });
    return;
  }
  
  next();
}