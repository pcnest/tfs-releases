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
  severity: z.string().nullish(),
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
  severity?: string;
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
    severity: apiRow.severity,
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

/**
 * Draft approval request input options
 */
export const DraftApprovalInputSchema = z.object({
  maxHighlights: z.number().int().min(1).max(10).optional().default(6),
  severityKeywords: z.array(z.string()).optional().default(['High', 'Critical']),
  releaseType: z.string().optional(),
});

export type DraftApprovalInput = z.infer<typeof DraftApprovalInputSchema>;

/**
 * Draft approval request output
 */
export const DraftApprovalOutputSchema = z.object({
  purpose: z.string(),
  highlights: z.array(z.string()),
  primaryRisk: z.string(),
  blastRadius: z.string(),
  buildReadiness: z.string(),
});

export type DraftApprovalOutput = z.infer<typeof DraftApprovalOutputSchema>;

/**
 * Approval history storage (AI draft + final edits)
 */
export const ApprovalDraftSchema = z.object({
  purpose: z.string().optional(),
  highlights: z.array(z.string()).optional(),
  primaryRisk: z.string().optional(),
  blastRadius: z.string().optional(),
  buildReadiness: z.string().optional(),
});

export const ApprovalHistoryInputSchema = z.object({
  releaseType: z.string().optional(),
  releaseEnv: z.string().optional(),
  projectName: z.string().optional(),
  projectOwner: z.string().optional(),
  releaseManager: z.string().optional(),
  aiDraft: ApprovalDraftSchema.optional(),
  finalDraft: ApprovalDraftSchema,
});

export type ApprovalHistoryInput = z.infer<typeof ApprovalHistoryInputSchema>;

export interface ReleaseFeatures {
  themeCounts: Record<string, number>;
  tagTokens: string[];
  hotItemIds: number[];
  severityCounts: {
    critical: number;
    high: number;
    total: number;
  };
}

export interface ApprovalHistoryCandidate {
  id: number;
  release_id: string;
  release_type?: string;
  release_env?: string;
  project_name?: string;
  project_owner?: string;
  release_manager?: string;
  ai_purpose?: string;
  ai_highlights?: string;
  ai_primary_risk?: string;
  ai_blast_radius?: string;
  ai_build_readiness?: string;
  final_purpose?: string;
  final_highlights?: string;
  final_primary_risk?: string;
  final_blast_radius?: string;
  final_build_readiness?: string;
  edited_fields?: string;
  created_at: string;
  theme_counts: string;
  tag_tokens: string;
  hot_item_ids: string;
  severity_counts: string;
}

