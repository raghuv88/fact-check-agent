import * as dotenv from 'dotenv';
dotenv.config();

import { createApp } from './app.js';

const PORT = process.env.PORT || 3000;
const app = createApp();

// Start the server
const server = app.listen(PORT, () => {
  console.log('='.repeat(60));
  console.log('🚀 Fact-Check API Server Started');
  console.log('='.repeat(60));
  console.log(`📡 Port:    ${PORT}`);
  console.log(`🌍 URL:     http://localhost:${PORT}`);
  console.log(`📋 Health:  http://localhost:${PORT}/health`);
  console.log(`📚 API:     http://localhost:${PORT}/api/v1`);
  console.log('='.repeat(60));
});

// Graceful shutdown (like IHostApplicationLifetime in ASP.NET)
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  server.close(() => {
    console.log('Server closed.');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('\nSIGINT received, shutting down...');
  server.close(() => {
    process.exit(0);
  });
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});