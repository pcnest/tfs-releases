import { Router, Request, Response } from 'express';
import { ApiPayloadSchema, mapApiRowToDb, DraftApprovalInputSchema } from './types';
import { replaceReleaseRows, getByRelease, getCounts, getRowsByRelease } from './db';
import { draftApproval } from './ai';

const router = Router();

/**
 * Health check endpoint
 */
router.get('/healthz', (_req: Request, res: Response) => {
  res.json({ ok: true });
});

/**
 * Ingest API rows from PowerShell agent
 * POST /api/ingest
 * Requires: Authorization: Bearer <AUTH_TOKEN>
 * Body: Array<ApiRow>
 */
router.post('/api/ingest', (req: Request, res: Response) => {
  try {
    // Verify authorization
    const authHeader = req.headers.authorization;
    const expectedToken = process.env.AUTH_TOKEN;

    if (!expectedToken) {
      return res.status(500).json({ 
        error: 'Server configuration error: AUTH_TOKEN not set' 
      });
    }

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid Authorization header' });
    }

    const token = authHeader.substring(7);
    if (token !== expectedToken) {
      return res.status(401).json({ error: 'Invalid authentication token' });
    }

    // Validate payload
    const parseResult = ApiPayloadSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ 
        error: 'Invalid payload',
        details: parseResult.error.issues 
      });
    }

    const apiRows = parseResult.data;

    if (apiRows.length === 0) {
      return res.status(400).json({ error: 'Empty payload' });
    }

    // Ensure all rows have the same release_id
    const releaseIds = new Set(apiRows.map(r => r.release_id));
    if (releaseIds.size > 1) {
      return res.status(400).json({ 
        error: 'All rows must share the same release_id',
        found: Array.from(releaseIds)
      });
    }

    const releaseId = apiRows[0].release_id;

    // Map to DB rows
    const dbRows = apiRows.map(mapApiRowToDb);

    // Replace in database
    replaceReleaseRows(releaseId, dbRows);

    res.json({
      ok: true,
      release_id: releaseId,
      inserted: dbRows.length,
    });

  } catch (error) {
    console.error('Ingest error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Get release rows as JSON
 * GET /release/:rid.json
 */
router.get('/release/:rid.json', (req: Request, res: Response) => {
  try {
    const releaseId = req.params.rid;
    const rows = getByRelease(releaseId);
    const counts = getCounts(releaseId);

    res.json({
      release_id: releaseId,
      counts,
      rows,
    });
  } catch (error) {
    console.error('JSON fetch error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Render release table (EJS)
 * GET /release/:rid
 */
router.get('/release/:rid', (req: Request, res: Response) => {
  try {
    const releaseId = req.params.rid;
    const rows = getByRelease(releaseId);
    const counts = getCounts(releaseId);

    res.render('table', {
      releaseId,
      rows,
      counts,
      authToken: process.env.AUTH_TOKEN || '',
      port: process.env.PORT || '8080',
      tfsBase: process.env.TFS_BASE || '',
      tfsProject: process.env.TFS_PROJECT || '',
    });
  } catch (error) {
    console.error('Render error:', error);
    res.status(500).send('Internal server error');
  }
});

/**
 * Draft approval request using AI
 * POST /api/draft-approval/:rid
 * Requires: Authorization: Bearer <AUTH_TOKEN>
 * Body (optional): { maxHighlights?: number, severityKeywords?: string[] }
 */
router.post('/api/draft-approval/:rid', async (req: Request, res: Response) => {
  try {
    // Verify authorization
    const authHeader = req.headers.authorization;
    const expectedToken = process.env.AUTH_TOKEN;

    if (!expectedToken) {
      return res.status(500).json({ 
        error: 'Server configuration error: AUTH_TOKEN not set' 
      });
    }

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid Authorization header' });
    }

    const token = authHeader.substring(7);
    if (token !== expectedToken) {
      return res.status(401).json({ error: 'Invalid authentication token' });
    }

    // Get release ID
    const releaseId = req.params.rid;

    // Get rows for this release
    const rows = getRowsByRelease(releaseId);

    if (rows.length === 0) {
      return res.status(400).json({ 
        error: 'No rows found for this release',
        release_id: releaseId
      });
    }

    // Parse and validate input options
    const parseResult = DraftApprovalInputSchema.safeParse(req.body || {});
    if (!parseResult.success) {
      return res.status(400).json({ 
        error: 'Invalid input options',
        details: parseResult.error.issues 
      });
    }

    const options = parseResult.data;

    // Call AI service
    const draft = await draftApproval(releaseId, rows, options);

    res.json(draft);

  } catch (error) {
    console.error('Draft approval error:', error);
    
    // Handle specific error types
    if (error instanceof Error) {
      if (error.message.includes('Rate limit')) {
        return res.status(429).json({ error: error.message });
      }
      if (error.message.includes('OPENAI_API_KEY')) {
        return res.status(500).json({ error: 'OpenAI API not configured' });
      }
    }
    
    res.status(500).json({ 
      error: 'Failed to generate draft',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;
