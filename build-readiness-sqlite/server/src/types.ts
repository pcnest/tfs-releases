import { z } from 'zod';

/**
 * API payload structure (camelCase from PowerShell agent)
 */
export const ApiRowSchema = z.object({
  release_id: z.string().min(1),
  id: z.number().int().positive(),
  type: z.string().min(1),
  title: z.string(),
  state: z.string(),
  tags: z.string().optional(),
  acceptanceCriteria: z.string().optional(),
  description: z.string().optional(),
  devNotes: z.string().optional(),
  qaNotes: z.string().optional(),
  score: z.string().optional(),
  missing: z.string().optional(),
  reviewEvidence: z.string().optional(),
});

export type ApiRow = z.infer<typeof ApiRowSchema>;

/**
 * Validate array of API rows (max 5000)
 */
export const ApiPayloadSchema = z.array(ApiRowSchema).max(5000);

/**
 * Database row structure (snake_case for SQLite)
 */
export interface DbRow {
  release_id: string;
  wi_id: number;
  wi_type: string;
  title: string;
  state: string;
  tags?: string;
  acceptance_criteria?: string;
  description?: string;
  dev_notes?: string;
  qa_notes?: string;
  score?: string;
  missing?: string;
  review_evidence?: string;
  created_at?: string;
}

/**
 * Release statistics
 */
export interface ReleaseCounts {
  total: number;
  pbiCount: number;
  bugCount: number;
  fullScoreCount: number;
  fullScorePercent: number;
}

/**
 * Map API row (camelCase) to DB row (snake_case)
 */
export function mapApiRowToDb(apiRow: ApiRow): DbRow {
  return {
    release_id: apiRow.release_id,
    wi_id: apiRow.id,
    wi_type: apiRow.type,
    title: apiRow.title,
    state: apiRow.state,
    tags: apiRow.tags,
    acceptance_criteria: apiRow.acceptanceCriteria,
    description: apiRow.description,
    dev_notes: apiRow.devNotes,
    qa_notes: apiRow.qaNotes,
    score: apiRow.score,
    missing: apiRow.missing,
    review_evidence: apiRow.reviewEvidence,
  };
}
