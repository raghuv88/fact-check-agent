
// ============================================
// FILE: middleware/validator.ts
// Like FluentValidation in ASP.NET Core
// ============================================

// Note: This is exported directly from errorHandler.ts for simplicity
// In production, split into separate files

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

// ============================================
// API RESPONSE HELPERS
// Like IActionResult helper methods in ASP.NET
// ============================================

export function successResponse<T>(data: T, message?: string) {
  return {
    success: true,
    message,
    data,
    timestamp: new Date().toISOString(),
  };
}

export function errorResponse(message: string, details?: any) {
  return {
    success: false,
    error: message,
    details,
    timestamp: new Date().toISOString(),
  };
}