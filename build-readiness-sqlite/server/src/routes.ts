import { Router, Request, Response } from 'express';
import {
  ApiPayloadSchema,
  ApprovalHistoryInputSchema,
  DraftApprovalInputSchema,
  mapApiRowToDb,
} from './types';
import {
  getByRelease,
  getCounts,
  getRowsByRelease,
  replaceReleaseRows,
  saveApprovalHistory,
} from './db';
import { draftApproval, extractReleaseFeatures } from './ai';

const router = Router();
const DEFAULT_SEVERITY_KEYWORDS = ['High', 'Critical'];

function normalizeText(value?: string): string {
  if (!value) {
    return '';
  }
  return value.replace(/\s+/g, ' ').trim();
}

function normalizeHighlights(value?: string[]): string[] {
  if (!value) {
    return [];
  }
  return value.map(line => line.trim()).filter(Boolean);
}

function computeEditedFields(
  aiDraft: { purpose?: string; highlights?: string[]; primaryRisk?: string; blastRadius?: string; buildReadiness?: string } | undefined,
  finalDraft: { purpose?: string; highlights?: string[]; primaryRisk?: string; blastRadius?: string; buildReadiness?: string }
): string[] {
  if (!aiDraft) {
    return [];
  }

  const edited: string[] = [];
  if (normalizeText(aiDraft.purpose) !== normalizeText(finalDraft.purpose)) {
    edited.push('purpose');
  }
  const aiHighlights = normalizeHighlights(aiDraft.highlights).join('\n');
  const finalHighlights = normalizeHighlights(finalDraft.highlights).join('\n');
  if (aiHighlights !== finalHighlights) {
    edited.push('highlights');
  }
  if (normalizeText(aiDraft.primaryRisk) !== normalizeText(finalDraft.primaryRisk)) {
    edited.push('primaryRisk');
  }
  if (normalizeText(aiDraft.blastRadius) !== normalizeText(finalDraft.blastRadius)) {
    edited.push('blastRadius');
  }
  if (normalizeText(aiDraft.buildReadiness) !== normalizeText(finalDraft.buildReadiness)) {
    edited.push('buildReadiness');
  }

  return edited;
}

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

/**
 * Save approval draft + edits for RAG history
 * POST /api/approval-history/:rid
 * Requires: Authorization: Bearer <AUTH_TOKEN>
 */
router.post('/api/approval-history/:rid', (req: Request, res: Response) => {
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

    const releaseId = req.params.rid;
    const rows = getRowsByRelease(releaseId);

    if (rows.length === 0) {
      return res.status(400).json({ 
        error: 'No rows found for this release',
        release_id: releaseId
      });
    }

    const parseResult = ApprovalHistoryInputSchema.safeParse(req.body || {});
    if (!parseResult.success) {
      return res.status(400).json({ 
        error: 'Invalid input options',
        details: parseResult.error.issues 
      });
    }

    const input = parseResult.data;
    const normalizedInput = {
      ...input,
      aiDraft: input.aiDraft ? {
        ...input.aiDraft,
        highlights: normalizeHighlights(input.aiDraft.highlights),
      } : undefined,
      finalDraft: {
        ...input.finalDraft,
        highlights: normalizeHighlights(input.finalDraft.highlights),
      },
    };

    const editedFields = computeEditedFields(
      normalizedInput.aiDraft,
      normalizedInput.finalDraft
    );

    const features = extractReleaseFeatures(rows, DEFAULT_SEVERITY_KEYWORDS);
    const historyId = saveApprovalHistory(releaseId, normalizedInput, features, editedFields);

    res.json({ ok: true, id: historyId });
  } catch (error) {
    console.error('Approval history error:', error);
    res.status(500).json({ 
      error: 'Failed to save approval history',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;
