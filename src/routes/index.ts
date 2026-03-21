import { Application, Router, Request, Response } from 'express';
import { body } from 'express-validator';
import { v4 as uuidv4 } from 'uuid';
import { validateRequest } from '../middleware/errorHandler.js';
import { factCheckArticle, displayReport, saveReport } from '../fact-checker.js';
import { extractClaims, verifyClaimWithCache, generateReport } from '../agents/index.js';
import { resolveReferences } from '../agents/referenceResolver.js';
import type { Claim } from '../types.js';
import { TokenTracker } from '../middleware/tokenTracker.js';
import { createRequest, markProcessing, markComplete, markFailed, saveTokenUsageSteps } from '../db/repository.js';
import * as fs from 'fs/promises';
import * as path from 'path';

// ============================================
// FILE: routes/index.ts
// Like MapControllers() in ASP.NET Core
// ============================================

export function registerRoutes(app: Application): void {
  // Health check (no prefix)
  app.get('/health', healthCheck);

  // API v1 routes
  app.use('/api/v1/factcheck', factCheckRouter());
  app.use('/api/v1/reports', reportsRouter());

  console.log('📋 Routes registered:');
  console.log('   GET  /health');
  console.log('   POST /api/v1/factcheck/text');
  console.log('   POST /api/v1/factcheck/stream  (SSE)');
  console.log('   POST /api/v1/factcheck/url');
  console.log('   POST /api/v1/factcheck/claims');
  console.log('   GET  /api/v1/reports');
  console.log('   GET  /api/v1/reports/:id');
  console.log('   DELETE /api/v1/reports/:id');
}

// ============================================
// HEALTH CHECK
// ============================================

function healthCheck(req: Request, res: Response): void {
  res.json({
    success: true,
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    services: {
      anthropic: !!process.env.ANTHROPIC_API_KEY,
      serper: !!process.env.SERPER_API_KEY,
    },
  });
}

// ============================================
// FILE: routes/factcheck.ts
// Like FactCheckController in ASP.NET Core
// ============================================

function factCheckRouter(): Router {
  const router = Router();

  /**
   * POST /api/v1/factcheck/text
   * Fact-check article from raw text
   * 
   * Body: { text: string, options?: { maxClaims?: number } }
   */
  router.post(
    '/text',
    [
      body('text')
        .notEmpty().withMessage('Article text is required')
        .isLength({ min: 50 }).withMessage('Text must be at least 50 characters')
        .isLength({ max: 50000 }).withMessage('Text must not exceed 50,000 characters'),
      body('options.maxClaims')
        .optional()
        .isInt({ min: 1, max: 20 }).withMessage('maxClaims must be between 1 and 20'),
    ],
    validateRequest,
    async (req: Request, res: Response, next: any) => {
      try {
        const { text, options = {} } = req.body;
        const jobId = uuidv4();

        console.log(`\n📥 Received fact-check request (job: ${jobId})`);
        console.log(`   Text length: ${text.length} chars`);

        createRequest(jobId, text);
        markProcessing(jobId);

        try {
          const report = await factCheckArticle(text);

          if (report.token_usage) {
            markComplete(jobId, report.token_usage);
            saveTokenUsageSteps(jobId, report.token_usage);
          }

          const enrichedReport = {
            ...report,
            job_id: jobId,
            request_timestamp: new Date().toISOString(),
          };

          saveReport(enrichedReport as any, `report-${jobId}.json`);

          res.status(200).json({
            success: true,
            job_id: jobId,
            data: enrichedReport,
          });
        } catch (err) {
          markFailed(jobId);
          throw err;
        }
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * POST /api/v1/factcheck/claims
   * Just extract claims from text (without verification)
   * 
   * Body: { text: string }
   */
  router.post(
    '/claims',
    [
      body('text')
        .notEmpty().withMessage('Text is required')
        .isLength({ min: 10 }).withMessage('Text too short'),
    ],
    validateRequest,
    async (req: Request, res: Response, next: any) => {
      try {
        const { text } = req.body;

        console.log(`\n📥 Received claim extraction request`);

        const result = await extractClaims(text);

        res.status(200).json({
          success: true,
          data: result,
        });
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * POST /api/v1/factcheck/url
   * Fact-check article from URL
   * 
   * Body: { url: string }
   */
  router.post(
    '/url',
    [
      body('url')
        .notEmpty().withMessage('URL is required')
        .isURL().withMessage('Must be a valid URL'),
    ],
    validateRequest,
    async (req: Request, res: Response, next: any) => {
      try {
        const { url } = req.body;

        console.log(`\n📥 Received URL fact-check request: ${url}`);

        const jobId = uuidv4();

        // Fetch article content from URL
        const { fetchArticle } = await import('../tools/index.js');
        const articleJson = await fetchArticle(url);
        const article = JSON.parse(articleJson);

        createRequest(jobId, article.content);
        markProcessing(jobId);

        try {
          const report = await factCheckArticle(article.content);

          if (report.token_usage) {
            markComplete(jobId, report.token_usage);
            saveTokenUsageSteps(jobId, report.token_usage);
          }

          const enrichedReport = {
            ...report,
            job_id: jobId,
            article_source: url,
            request_timestamp: new Date().toISOString(),
          };

          saveReport(enrichedReport as any, `report-${jobId}.json`);

          res.status(200).json({
            success: true,
            job_id: jobId,
            data: enrichedReport,
          });
        } catch (err) {
          markFailed(jobId);
          throw err;
        }
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * POST /api/v1/factcheck/stream
   * Fact-check with Server-Sent Events — streams progress as claims are verified
   *
   * Body: { text: string }
   */
  router.post(
    '/stream',
    [
      body('text')
        .notEmpty().withMessage('Article text is required')
        .isLength({ min: 50 }).withMessage('Text must be at least 50 characters')
        .isLength({ max: 50000 }).withMessage('Text must not exceed 50,000 characters'),
    ],
    validateRequest,
    async (req: Request, res: Response) => {
      const { text } = req.body;
      const jobId = uuidv4();

      createRequest(jobId, text);

      // SSE headers
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();

      const send = (data: object) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      };

      // Token tracker — emits a token_usage SSE event after each agent step
      const tracker = new TokenTracker((usage) => {
        send({ type: 'token_usage', data: usage });
      });

      try {
        markProcessing(jobId);

        // Step 1 — extract claims
        send({ type: 'status', message: 'Extracting claims from article…' });
        const extractionResult = await extractClaims(text, tracker);

        const rawVerifiable = extractionResult.claims.filter(c => c.category === 'VERIFIABLE');
        const opinions      = extractionResult.claims.filter(c => c.category !== 'VERIFIABLE');

        send({
          type: 'claims_extracted',
          verifiable_claims: rawVerifiable,
          opinion_claims: opinions,
          total: rawVerifiable.length,
        });

        // Step 2 — resolve references
        send({ type: 'status', message: 'Resolving references…' });
        const { resolvedClaims } = await resolveReferences(
          { articleText: text, claims: extractionResult.claims },
          tracker,
        );

        const resolvedCount = resolvedClaims.filter(rc => rc.resolutionsApplied.length > 0).length;
        const allResolutions = resolvedClaims.flatMap(rc => rc.resolutionsApplied);

        send({
          type: 'references_resolved',
          data: {
            resolvedCount,
            entitiesFound: [...new Set(resolvedClaims.flatMap(rc => rc.entityIds))].length,
            resolutions: allResolutions,
          },
        });

        // Use resolved claim texts for verification
        const verifiable: Claim[] = resolvedClaims
          .filter(rc => rc.category === 'VERIFIABLE')
          .map(rc => ({
            id: rc.id,
            claim: rc.resolvedClaim,
            category: rc.category,
            reason: '',
            source_reference: rc.originalClaim !== rc.resolvedClaim ? rc.originalClaim : undefined,
          }));

        // Step 3 — verify each claim
        const verificationResults = [];
        for (let i = 0; i < verifiable.length; i++) {
          const claim = verifiable[i];
          send({
            type: 'claim_verifying',
            claim_id: claim.id,
            claim: claim.claim,
            index: i + 1,
            total: verifiable.length,
          });

          try {
            const result = await verifyClaimWithCache(claim, tracker, i + 1);
            verificationResults.push(result);
            send({
              type: 'claim_verified',
              result,
              index: i + 1,
              total: verifiable.length,
              from_cache: result.from_cache ?? false,
            });
          } catch (err) {
            console.error(`Failed to verify claim ${claim.id}:`, err);
          }
        }

        // Step 4 — generate final report
        send({ type: 'status', message: 'Generating final report…' });
        const report = await generateReport(extractionResult, verificationResults, tracker);

        const tokenSummary = tracker.getSummary();
        const enrichedReport = {
          ...report,
          job_id: jobId,
          request_timestamp: new Date().toISOString(),
          token_usage: tokenSummary,
        };
        markComplete(jobId, tokenSummary);
        saveTokenUsageSteps(jobId, tokenSummary);
        saveReport(enrichedReport as any, `report-${jobId}.json`);

        send({ type: 'complete', report: enrichedReport, job_id: jobId, token_usage: tokenSummary });
      } catch (err: any) {
        markFailed(jobId);
        send({ type: 'error', message: err?.message || 'Fact-check failed' });
      } finally {
        res.end();
      }
    }
  );

  return router;
}

// ============================================
// FILE: routes/reports.ts
// Like ReportsController in ASP.NET Core
// ============================================

function reportsRouter(): Router {
  const router = Router();
  const reportsDir = path.join(process.cwd(), 'reports');

  /**
   * GET /api/v1/reports
   * List all saved reports
   */
  router.get('/', async (req: Request, res: Response, next: any) => {
    try {
      await fs.mkdir(reportsDir, { recursive: true });
      const files = await fs.readdir(reportsDir);
      const jsonFiles = files.filter(f => f.endsWith('.json'));

      // Get summary for each report
      const reports = await Promise.all(
        jsonFiles.map(async (file) => {
          const filepath = path.join(reportsDir, file);
          const content = await fs.readFile(filepath, 'utf-8');
          const report = JSON.parse(content);

          return {
            id: file.replace('report-', '').replace('.json', ''),
            filename: file,
            total_claims: report.total_claims,
            verifiable_claims: report.verifiable_claims,
            generated_at: report.generated_at,
            article_source: report.article_source,
          };
        })
      );

      // Sort by newest first
      reports.sort((a, b) =>
        new Date(b.generated_at).getTime() - new Date(a.generated_at).getTime()
      );

      res.json({
        success: true,
        count: reports.length,
        data: reports,
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * GET /api/v1/reports/:id
   * Get a specific report by ID
   */
  router.get('/:id', async (req: Request, res: Response, next: any) => {
    try {
      const { id } = req.params;
      const filepath = path.join(reportsDir, `report-${id}.json`);

      try {
        const content = await fs.readFile(filepath, 'utf-8');
        const report = JSON.parse(content);

        res.json({
          success: true,
          data: report,
        });
      } catch (err: any) {
        if (err.code === 'ENOENT') {
          res.status(404).json({
            success: false,
            error: `Report with ID "${id}" not found`,
          });
          return;
        }
        throw err;
      }
    } catch (error) {
      next(error);
    }
  });

  /**
   * DELETE /api/v1/reports/:id
   * Delete a specific report
   */
  router.delete('/:id', async (req: Request, res: Response, next: any) => {
    try {
      const { id } = req.params;
      const filepath = path.join(reportsDir, `report-${id}.json`);

      try {
        await fs.unlink(filepath);
        res.json({
          success: true,
          message: `Report "${id}" deleted successfully`,
        });
      } catch (err: any) {
        if (err.code === 'ENOENT') {
          res.status(404).json({
            success: false,
            error: `Report with ID "${id}" not found`,
          });
          return;
        }
        throw err;
      }
    } catch (error) {
      next(error);
    }
  });

  return router;
}