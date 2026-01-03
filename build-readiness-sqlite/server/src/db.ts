import Database from 'better-sqlite3';
import { mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import type { DbRow, ReleaseCounts } from './types';

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

  // Create tables and indexes (idempotent)
  db.exec(`
    CREATE TABLE IF NOT EXISTS build_readiness (
      release_id           TEXT NOT NULL,
      wi_id                INTEGER NOT NULL,
      wi_type              TEXT NOT NULL,
      title                TEXT NOT NULL,
      state                TEXT NOT NULL,
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
  `);

  console.log(`✓ Database initialized at ${DB_PATH}`);
}

/**
 * Replace all rows for a given release (transaction-safe)
 */
export function replaceReleaseRows(releaseId: string, rows: DbRow[]): void {
  const deleteStmt = db.prepare('DELETE FROM build_readiness WHERE release_id = ?');
  
  const insertStmt = db.prepare(`
    INSERT INTO build_readiness(
      release_id, wi_id, wi_type, title, state, tags,
      acceptance_criteria, description, dev_notes, qa_notes,
      score, missing, review_evidence
    )
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(release_id, wi_id) DO UPDATE SET
      wi_type = excluded.wi_type,
      title = excluded.title,
      state = excluded.state,
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
 * Close database connection (for graceful shutdown)
 */
export function closeDatabase(): void {
  if (db) {
    db.close();
    console.log('✓ Database connection closed');
  }
}
