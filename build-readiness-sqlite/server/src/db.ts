import Database from 'better-sqlite3';
import { mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import type {
  ApprovalHistoryCandidate,
  ApprovalHistoryInput,
  DbRow,
  ReleaseCounts,
  ReleaseFeatures,
} from './types';

const DATA_DIR = join(process.cwd(), 'data');
const DB_PATH = join(DATA_DIR, 'build_readiness.db');

let db: Database.Database;

/**
 * Initialize database connection and schema
 */
export function initDatabase(): void {
  // Ensure data directory exists
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }

  // Open database
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  const addColumnIfMissing = (table: string, column: string, type: string): void => {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    const hasColumn = columns.some(entry => entry.name === column);
    if (!hasColumn) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    }
  };

  // Create tables and indexes (idempotent)
  db.exec(`
    CREATE TABLE IF NOT EXISTS build_readiness (
      release_id           TEXT NOT NULL,
      wi_id                INTEGER NOT NULL,
      wi_type              TEXT NOT NULL,
      title                TEXT NOT NULL,
      state                TEXT NOT NULL,
      severity             TEXT,
      tags                 TEXT,
      acceptance_criteria  TEXT,
      description          TEXT,
      dev_notes            TEXT,
      qa_notes             TEXT,
      score                TEXT,
      missing              TEXT,
      review_evidence      TEXT,
      created_at           TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (release_id, wi_id)
    );

    CREATE INDEX IF NOT EXISTS idx_release ON build_readiness(release_id);

    CREATE TABLE IF NOT EXISTS approval_history (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      release_id          TEXT NOT NULL,
      release_type        TEXT,
      release_env         TEXT,
      project_name        TEXT,
      project_owner       TEXT,
      release_manager     TEXT,
      ai_purpose          TEXT,
      ai_highlights       TEXT,
      ai_primary_risk     TEXT,
      ai_blast_radius     TEXT,
      ai_build_readiness  TEXT,
      final_purpose       TEXT,
      final_highlights    TEXT,
      final_primary_risk  TEXT,
      final_blast_radius  TEXT,
      final_build_readiness TEXT,
      edited_fields       TEXT,
      created_at          TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_approval_history_release_id ON approval_history(release_id);
    CREATE INDEX IF NOT EXISTS idx_approval_history_created_at ON approval_history(created_at);

    CREATE TABLE IF NOT EXISTS approval_features (
      history_id      INTEGER NOT NULL,
      release_id      TEXT NOT NULL,
      release_type    TEXT,
      theme_counts    TEXT NOT NULL,
      tag_tokens      TEXT NOT NULL,
      hot_item_ids    TEXT NOT NULL,
      severity_counts TEXT NOT NULL,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (history_id),
      FOREIGN KEY (history_id) REFERENCES approval_history(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_approval_features_release_id ON approval_features(release_id);
    CREATE INDEX IF NOT EXISTS idx_approval_features_release_type ON approval_features(release_type);
  `);

  addColumnIfMissing('approval_history', 'project_owner', 'TEXT');

  console.log(`✓ Database initialized at ${DB_PATH}`);
}

/**
 * Replace all rows for a given release (transaction-safe)
 */
export function replaceReleaseRows(releaseId: string, rows: DbRow[]): void {
  const deleteStmt = db.prepare('DELETE FROM build_readiness WHERE release_id = ?');
  
  const insertStmt = db.prepare(`
    INSERT INTO build_readiness(
      release_id, wi_id, wi_type, title, state, severity, tags,
      acceptance_criteria, description, dev_notes, qa_notes,
      score, missing, review_evidence
    )
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(release_id, wi_id) DO UPDATE SET
      wi_type = excluded.wi_type,
      title = excluded.title,
      state = excluded.state,
      severity = excluded.severity,
      tags = excluded.tags,
      acceptance_criteria = excluded.acceptance_criteria,
      description = excluded.description,
      dev_notes = excluded.dev_notes,
      qa_notes = excluded.qa_notes,
      score = excluded.score,
      missing = excluded.missing,
      review_evidence = excluded.review_evidence,
      created_at = excluded.created_at
  `);

  // Execute in transaction
  const transaction = db.transaction(() => {
    deleteStmt.run(releaseId);
    for (const row of rows) {
      insertStmt.run(
        row.release_id,
        row.wi_id,
        row.wi_type,
        row.title,
        row.state,
        row.severity ?? null,
        row.tags ?? null,
        row.acceptance_criteria ?? null,
        row.description ?? null,
        row.dev_notes ?? null,
        row.qa_notes ?? null,
        row.score ?? null,
        row.missing ?? null,
        row.review_evidence ?? null
      );
    }
  });

  transaction();
}

/**
 * Get all rows for a release, ordered by type and ID
 */
export function getByRelease(releaseId: string): DbRow[] {
  const stmt = db.prepare(`
    SELECT * FROM build_readiness
    WHERE release_id = ?
    ORDER BY wi_type, wi_id
  `);
  
  return stmt.all(releaseId) as DbRow[];
}

/**
 * Get counts and statistics for a release
 */
export function getCounts(releaseId: string): ReleaseCounts {
  const rows = getByRelease(releaseId);
  const total = rows.length;
  
  let pbiCount = 0;
  let bugCount = 0;
  let fullScoreCount = 0;

  for (const row of rows) {
    // Count PBIs vs Bugs (case-insensitive)
    const type = row.wi_type.toLowerCase();
    if (type.includes('pbi') || type.includes('product backlog')) {
      pbiCount++;
    } else if (type.includes('bug')) {
      bugCount++;
    }

    // Count full scores (e.g., "4/4", "6/6")
    if (row.score) {
      const match = row.score.match(/^(\d+)\/(\d+)$/);
      if (match) {
        const [, numerator, denominator] = match;
        if (numerator === denominator) {
          fullScoreCount++;
        }
      }
    }
  }

  const fullScorePercent = total > 0 ? Math.round((fullScoreCount / total) * 100) : 0;

  return {
    total,
    pbiCount,
    bugCount,
    fullScoreCount,
    fullScorePercent,
  };
}

/**
 * Get all rows for a release (alias for getByRelease, for AI module)
 */
export function getRowsByRelease(releaseId: string): DbRow[] {
  return getByRelease(releaseId);
}

/**
 * Get theme-based groupings (simple keyword bucketing)
 */
export function getThemeBuckets(releaseId: string): Record<string, number[]> {
  const rows = getByRelease(releaseId);
  const themes: Record<string, number[]> = {};
  
  // Define theme keywords
  const themeKeywords = [
    'SearchElse',
    'Historical Data',
    'FTP',
    'inmsg',
    'FarPoint',
    'ESL',
    'Load',
    'Unload',
    'Device',
    'Page',
    'API',
    'Performance',
    'Security',
    'UI',
    'Database',
  ];
  
  for (const row of rows) {
    const searchText = `${row.title} ${row.tags || ''}`.toLowerCase();
    
    for (const theme of themeKeywords) {
      if (searchText.includes(theme.toLowerCase())) {
        if (!themes[theme]) {
          themes[theme] = [];
        }
        themes[theme].push(row.wi_id);
      }
    }
  }
  
  return themes;
}

/**
 * Store AI draft + final edits for approval history
 */
export function saveApprovalHistory(
  releaseId: string,
  input: ApprovalHistoryInput,
  features: ReleaseFeatures,
  editedFields: string[]
): number {
  const insertHistory = db.prepare(`
    INSERT INTO approval_history(
      release_id, release_type, release_env, project_name, project_owner, release_manager,
      ai_purpose, ai_highlights, ai_primary_risk, ai_blast_radius, ai_build_readiness,
      final_purpose, final_highlights, final_primary_risk, final_blast_radius, final_build_readiness,
      edited_fields
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertFeatures = db.prepare(`
    INSERT INTO approval_features(
      history_id, release_id, release_type, theme_counts, tag_tokens, hot_item_ids, severity_counts
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const transaction = db.transaction(() => {
    const historyResult = insertHistory.run(
      releaseId,
      input.releaseType ?? null,
      input.releaseEnv ?? null,
      input.projectName ?? null,
      input.projectOwner ?? null,
      input.releaseManager ?? null,
      input.aiDraft?.purpose ?? null,
      input.aiDraft?.highlights ? JSON.stringify(input.aiDraft.highlights) : null,
      input.aiDraft?.primaryRisk ?? null,
      input.aiDraft?.blastRadius ?? null,
      input.aiDraft?.buildReadiness ?? null,
      input.finalDraft?.purpose ?? null,
      input.finalDraft?.highlights ? JSON.stringify(input.finalDraft.highlights) : null,
      input.finalDraft?.primaryRisk ?? null,
      input.finalDraft?.blastRadius ?? null,
      input.finalDraft?.buildReadiness ?? null,
      JSON.stringify(editedFields)
    );

    const historyId = Number(historyResult.lastInsertRowid);

    insertFeatures.run(
      historyId,
      releaseId,
      input.releaseType ?? null,
      JSON.stringify(features.themeCounts),
      JSON.stringify(features.tagTokens),
      JSON.stringify(features.hotItemIds),
      JSON.stringify(features.severityCounts)
    );

    return historyId;
  });

  return transaction();
}

/**
 * Fetch approval history candidates for RAG scoring
 */
export function getApprovalHistoryCandidates(
  excludeReleaseId: string,
  limit = 200
): ApprovalHistoryCandidate[] {
  const safeLimit = Math.max(1, Math.min(limit, 500));
  const stmt = db.prepare(`
    SELECT
      h.id,
      h.release_id,
      h.release_type,
      h.release_env,
      h.project_name,
      h.project_owner,
      h.release_manager,
      h.ai_purpose,
      h.ai_highlights,
      h.ai_primary_risk,
      h.ai_blast_radius,
      h.ai_build_readiness,
      h.final_purpose,
      h.final_highlights,
      h.final_primary_risk,
      h.final_blast_radius,
      h.final_build_readiness,
      h.edited_fields,
      h.created_at,
      f.theme_counts,
      f.tag_tokens,
      f.hot_item_ids,
      f.severity_counts
    FROM approval_history h
    JOIN approval_features f ON f.history_id = h.id
    WHERE h.release_id != ?
    ORDER BY h.created_at DESC
    LIMIT ?
  `);

  return stmt.all(excludeReleaseId, safeLimit) as ApprovalHistoryCandidate[];
}

/**
 * Close database connection (for graceful shutdown)
 */
export function closeDatabase(): void {
  if (db) {
    db.close();
    console.log('✓ Database connection closed');
  }
}
