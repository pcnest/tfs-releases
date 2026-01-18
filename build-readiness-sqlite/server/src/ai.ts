import OpenAI from 'openai';
import { z } from 'zod';
import type { ApprovalHistoryCandidate, DbRow, ReleaseFeatures } from './types';
import { getApprovalHistoryCandidates } from './db';

/**
 * AI Draft Output Schema
 */
export const AiDraftOutputSchema = z.object({
  purpose: z.string(),
  highlights: z.array(z.string()).min(1).max(10),
  primaryRisk: z.string(),
  blastRadius: z.string(),
  buildReadiness: z.string(),
});

export type AiDraftOutput = z.infer<typeof AiDraftOutputSchema>;

/**
 * Options for draft generation
 */
export interface DraftOptions {
  maxHighlights?: number;
  severityKeywords?: string[];
  releaseType?: string;
}

/**
 * Slim row for AI context to reduce token usage
 */
interface SlimRow {
  id: number;
  type: string;
  title: string;
  state: string;
  severity?: string;
  hot: boolean;
  devNotes?: string;
  qaNotes?: string;
  module: string[];
}

const THEME_KEYWORDS = [
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

const RAG_CANDIDATE_LIMIT = 200;
const RAG_MAX_ITEMS = 3;
const RAG_HIGHLIGHT_LIMIT = 2;
const RAG_TEXT_LIMIT = 200;

/**
 * Rate limiting: one request per 5 seconds
 */
let lastRequestTime = 0;
const RATE_LIMIT_MS = 5000;

/**
 * Initialize OpenAI client
 */
function getOpenAIClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured');
  }

  return new OpenAI({ apiKey });
}

/**
 * Check rate limit
 */
function checkRateLimit(): void {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;
  
  if (timeSinceLastRequest < RATE_LIMIT_MS) {
    const waitTime = Math.ceil((RATE_LIMIT_MS - timeSinceLastRequest) / 1000);
    throw new Error(`Rate limit exceeded. Please wait ${waitTime} seconds.`);
  }
  
  lastRequestTime = now;
}

/**
 * Detect theme keywords for a row based on title/tags
 */
function detectThemes(title: string, tags?: string): string[] {
  const searchText = `${title} ${tags || ''}`.toLowerCase();
  return THEME_KEYWORDS.filter(theme => searchText.includes(theme.toLowerCase()));
}

/**
 * Build slim dataset for AI context with only relevant fields
 */
function buildSlimRows(rows: DbRow[], hotItemIds: Set<number>): SlimRow[] {
  return rows.map(row => ({
    id: row.wi_id,
    type: row.wi_type,
    title: row.title,
    state: row.state,
    severity: row.severity || undefined,
    hot: hotItemIds.has(row.wi_id),
    devNotes: row.dev_notes || undefined,
    qaNotes: row.qa_notes || undefined,
    module: detectThemes(row.title, row.tags),
  }));
}

/**
 * Identify hot items (critical bugs, incomplete items)
 */
function identifyHotItems(rows: DbRow[], severityKeywords: string[]): number[] {
  const hotIds: number[] = [];
  
  for (const row of rows) {
    const isBug = row.wi_type.toLowerCase().includes('bug');
    const titleLower = row.title.toLowerCase();
    
    // Check severity field directly (e.g., "1 - Critical", "2 - High", "Critical", "High")
    const hasSeverityField = row.severity && severityKeywords.some(kw => 
      row.severity!.toLowerCase().includes(kw.toLowerCase())
    );
    
    // Check for severity keywords in title (fallback)
    const hasSeverityInTitle = severityKeywords.some(kw => 
      titleLower.includes(kw.toLowerCase())
    );
    
    // Check for incomplete score
    const isIncomplete = row.missing && row.missing.trim() !== '';
    
    if (isBug && (hasSeverityField || hasSeverityInTitle || isIncomplete)) {
      hotIds.push(row.wi_id);
    }
  }
  
  return hotIds;
}

/**
 * Group rows by themes (keyword bucketing)
 */
function groupByThemes(rows: DbRow[]): Record<string, number> {
  const themes: Record<string, number> = {};

  for (const row of rows) {
    const matches = detectThemes(row.title, row.tags);

    for (const theme of matches) {
      themes[theme] = (themes[theme] || 0) + 1;
    }
  }
  
  return themes;
}

function formatThemeSummary(themes: Record<string, number>): string {
  const entries = Object.entries(themes)
    .map(([theme, count]) => ({ theme, count }))
    .filter(entry => entry.count > 0)
    .sort((a, b) => b.count - a.count || a.theme.localeCompare(b.theme));

  if (entries.length === 0) {
    return 'None';
  }

  return entries.map(entry => `${entry.theme} (${entry.count})`).join(', ');
}

function computeSeverityCounts(rows: DbRow[]): { critical: number; high: number } {
  const critical = rows.filter(
    row => row.severity?.toLowerCase().includes('critical') || row.severity?.startsWith('1')
  ).length;
  const high = rows.filter(
    row => row.severity?.toLowerCase().includes('high') || row.severity?.startsWith('2')
  ).length;
  return { critical, high };
}

function extractTagTokens(rows: DbRow[]): string[] {
  const tokens = new Set<string>();
  for (const row of rows) {
    if (!row.tags) {
      continue;
    }
    const parts = row.tags.split(/[;,|]/);
    for (const part of parts) {
      const token = part.trim();
      if (token) {
        tokens.add(token.toLowerCase());
      }
    }
  }
  return Array.from(tokens).sort();
}

export function extractReleaseFeatures(
  rows: DbRow[],
  severityKeywords: string[],
  themeCounts?: Record<string, number>
): ReleaseFeatures {
  const themes = themeCounts || groupByThemes(rows);
  const hotItemIds = identifyHotItems(rows, severityKeywords);
  const tagTokens = extractTagTokens(rows);
  const severityCounts = computeSeverityCounts(rows);

  return {
    themeCounts: themes,
    tagTokens,
    hotItemIds,
    severityCounts: {
      critical: severityCounts.critical,
      high: severityCounts.high,
      total: rows.length,
    },
  };
}

function parseJsonArray<T>(value: string | null | undefined, fallback: T[]): T[] {
  if (!value) {
    return fallback;
  }
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as T[]) : fallback;
  } catch {
    return fallback;
  }
}

function parseJsonObject<T extends Record<string, unknown>>(
  value: string | null | undefined,
  fallback: T
): T {
  if (!value) {
    return fallback;
  }
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? (parsed as T) : fallback;
  } catch {
    return fallback;
  }
}

function intersectTokens(a: string[], b: string[]): string[] {
  if (a.length === 0 || b.length === 0) {
    return [];
  }
  const setB = new Set(b);
  return a.filter(token => setB.has(token));
}

function normalizeText(value: string | null | undefined): string {
  if (!value) {
    return '';
  }
  return value.replace(/\s+/g, ' ').trim();
}

function trimText(value: string | null | undefined, maxChars: number): string {
  const normalized = normalizeText(value);
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, maxChars - 3).trimEnd()}...`;
}

function formatHighlightsSnippet(highlights: string[], maxItems: number): string {
  if (highlights.length === 0) {
    return '[]';
  }
  const trimmed = highlights
    .slice(0, maxItems)
    .map(item => `"${trimText(item, RAG_TEXT_LIMIT)}"`);
  return `[${trimmed.join(', ')}]`;
}

function scoreCandidate(
  current: ReleaseFeatures,
  candidate: ReleaseFeatures,
  releaseTypeMatch: boolean
): {
  score: number;
  themeOverlap: string[];
  tagOverlap: string[];
  hotMatch: boolean;
  criticalMatch: boolean;
  highMatch: boolean;
} {
  const currentThemes = Object.keys(current.themeCounts);
  const candidateThemes = Object.keys(candidate.themeCounts);
  const themeOverlap = intersectTokens(currentThemes, candidateThemes);
  const tagOverlap = intersectTokens(current.tagTokens, candidate.tagTokens);
  const hotMatch = current.hotItemIds.length > 0 && candidate.hotItemIds.length > 0;
  const criticalMatch = current.severityCounts.critical > 0 && candidate.severityCounts.critical > 0;
  const highMatch = current.severityCounts.high > 0 && candidate.severityCounts.high > 0;

  const score = themeOverlap.length * 4
    + tagOverlap.length * 2
    + (hotMatch ? 2 : 0)
    + (criticalMatch ? 1 : 0)
    + (highMatch ? 1 : 0)
    + (releaseTypeMatch ? 3 : 0);

  return {
    score,
    themeOverlap,
    tagOverlap,
    hotMatch,
    criticalMatch,
    highMatch,
  };
}

function buildRagSection(
  releaseId: string,
  releaseType: string | undefined,
  currentFeatures: ReleaseFeatures
): string {
  const candidates: ApprovalHistoryCandidate[] = getApprovalHistoryCandidates(
    releaseId,
    RAG_CANDIDATE_LIMIT
  );

  if (candidates.length === 0) {
    return '**Relevant Past Drafts & Edits:** None';
  }

  const scored = candidates
    .map(candidate => {
      const candidateFeatures: ReleaseFeatures = {
        themeCounts: parseJsonObject<Record<string, number>>(candidate.theme_counts, {}),
        tagTokens: parseJsonArray<string>(candidate.tag_tokens, []),
        hotItemIds: parseJsonArray<number>(candidate.hot_item_ids, []),
        severityCounts: parseJsonObject<{ critical: number; high: number; total: number }>(
          candidate.severity_counts,
          { critical: 0, high: 0, total: 0 }
        ),
      };

      const releaseTypeMatch = Boolean(
        releaseType && candidate.release_type && candidate.release_type === releaseType
      );
      const scoreData = scoreCandidate(currentFeatures, candidateFeatures, releaseTypeMatch);

      return {
        candidate,
        candidateFeatures,
        scoreData,
        releaseTypeMatch,
      };
    })
    .filter(entry => entry.scoreData.score > 0)
    .sort((a, b) => {
      if (b.scoreData.score !== a.scoreData.score) {
        return b.scoreData.score - a.scoreData.score;
      }
      return b.candidate.created_at.localeCompare(a.candidate.created_at);
    })
    .slice(0, RAG_MAX_ITEMS);

  if (scored.length === 0) {
    return '**Relevant Past Drafts & Edits:** None';
  }

  const lines = scored.map((entry, index) => {
    const { candidate, candidateFeatures, scoreData } = entry;
    const editedFields = parseJsonArray<string>(candidate.edited_fields, []);
    const aiHighlights = parseJsonArray<string>(candidate.ai_highlights, []);
    const finalHighlights = parseJsonArray<string>(candidate.final_highlights, []);

    const similarityParts = [];
    similarityParts.push(
      scoreData.themeOverlap.length > 0
        ? `themes: ${scoreData.themeOverlap.join(', ')}`
        : 'themes: none'
    );
    similarityParts.push(
      scoreData.tagOverlap.length > 0
        ? `tags: ${scoreData.tagOverlap.join(', ')}`
        : 'tags: none'
    );
    similarityParts.push(
      `hotItems: current ${currentFeatures.hotItemIds.length}, past ${candidateFeatures.hotItemIds.length}`
    );
    if (releaseType && candidate.release_type) {
      similarityParts.push(entry.releaseTypeMatch ? 'releaseType: match' : 'releaseType: diff');
    }

    const aiSummaryParts = [];
    if (candidate.ai_purpose || aiHighlights.length > 0 || candidate.ai_primary_risk) {
      aiSummaryParts.push(
        `purpose="${trimText(candidate.ai_purpose, RAG_TEXT_LIMIT)}"`
      );
      aiSummaryParts.push(
        `highlights=${formatHighlightsSnippet(aiHighlights, RAG_HIGHLIGHT_LIMIT)}`
      );
      aiSummaryParts.push(
        `primaryRisk="${trimText(candidate.ai_primary_risk, RAG_TEXT_LIMIT)}"`
      );
    }

    const finalSummaryParts = [];
    if (candidate.final_purpose || finalHighlights.length > 0 || candidate.final_primary_risk) {
      finalSummaryParts.push(
        `editedFields=${editedFields.length > 0 ? editedFields.join(', ') : 'None'}`
      );
      finalSummaryParts.push(
        `purpose="${trimText(candidate.final_purpose, RAG_TEXT_LIMIT)}"`
      );
      finalSummaryParts.push(
        `highlights=${formatHighlightsSnippet(finalHighlights, RAG_HIGHLIGHT_LIMIT)}`
      );
      finalSummaryParts.push(
        `primaryRisk="${trimText(candidate.final_primary_risk, RAG_TEXT_LIMIT)}"`
      );
    }

    return [
      `${index + 1}) Release ${candidate.release_id} (type: ${candidate.release_type || 'unknown'}, created: ${candidate.created_at})`,
      `Similarity: ${similarityParts.join('; ')}`,
      aiSummaryParts.length > 0 ? `AI: ${aiSummaryParts.join('; ')}` : 'AI: Not stored',
      finalSummaryParts.length > 0 ? `Final: ${finalSummaryParts.join('; ')}` : 'Final: Not stored',
    ].join('\n');
  });

  return `**Relevant Past Drafts & Edits (guidance only):**\n${lines.join('\n\n')}`;
}

function checkPromptRegression(userPrompt: string, highlightLimit: number): void {
  const requiredFragments = [
    'Only reference ticket IDs that exist in the dataset in this prompt.',
    'Not specified in dataset',
    `max ${highlightLimit} bullets`,
    'Ticket footer format (only allowed): " -- Bug 123, 456; PBI 789".',
    'No specific risk found in dataset.',
    'Past drafts/edits are guidance only.',
    'Relevant Past Drafts & Edits',
    '**purpose** (string): max 2 sentences.',
    '**primaryRisk** (string): max 3 sentences.',
    '**buildReadiness** (string): max 4 sentences.',
  ];

  const missing = requiredFragments.filter(fragment => !userPrompt.includes(fragment));
  if (missing.length > 0) {
    throw new Error(`Prompt regression check failed. Missing: ${missing.join(' | ')}`);
  }
}

/**
 * Build prompt for AI
 */
function buildPrompt(
  releaseId: string, 
  rows: DbRow[], 
  options: DraftOptions
): { system: string; user: string } {
  const maxHighlights = options.maxHighlights || 6;
  const highlightLimit = Math.min(maxHighlights, 7);
  const severityKeywords = options.severityKeywords || ['High', 'Critical'];
  
  const themeCounts = groupByThemes(rows);
  const releaseFeatures = extractReleaseFeatures(rows, severityKeywords, themeCounts);
  const hotItems = releaseFeatures.hotItemIds;
  const hotItemIds = new Set(hotItems);
  const slimRows = buildSlimRows(rows, hotItemIds);
  const themeSummary = formatThemeSummary(themeCounts);
  
  // Calculate readiness stats
  const totalItems = rows.length;
  const fullScoreCount = rows.filter(r => {
    const match = r.score?.match(/^(\d+)\/(\d+)$/);
    return match && match[1] === match[2];
  }).length;
  const incompleteCount = rows.filter(r => r.missing && r.missing.trim() !== '').length;
  const readinessPercent = totalItems > 0 ? Math.round((fullScoreCount / totalItems) * 100) : 0;
  
  // Calculate severity statistics
  const severityCounts = releaseFeatures.severityCounts;
  const severitySummary = severityCounts.critical > 0 || severityCounts.high > 0
    ? `Critical: ${severityCounts.critical}, High: ${severityCounts.high}`
    : 'None';
  const ragSection = buildRagSection(releaseId, options.releaseType, releaseFeatures);
  
  const system = `You are a release manager assistant. Output only valid JSON matching the specified schema. Keep text concise and operational.`;
  
  const user = `Generate an approval request for release ${releaseId}.

**Slim dataset (${rows.length} items):**
Fields: id, type, title, state, severity, hot, devNotes, qaNotes, module.
Note: "module" is a keyword theme array derived from title/tags; empty means not specified.
${JSON.stringify(slimRows)}

**Hot Items (prioritize):** ${hotItems.length > 0 ? hotItems.join(', ') : 'None'}

**Themes (counts):** ${themeSummary}

**Readiness Stats:**
- Total Items: ${totalItems}
- Full Score: ${fullScoreCount} (${readinessPercent}%)
- Incomplete: ${incompleteCount}
- High Severity: ${severitySummary}

${ragSection}

**Hard Rules:**
- Only reference ticket IDs that exist in the dataset in this prompt. If something is not in the rows, write "Not specified in dataset".
- Ticket footer format (only allowed): " -- Bug 123, 456; PBI 789". Use only Bug and/or PBI groups that apply, in that order. If only one type exists, omit the other and the semicolon.
- If you cannot tie a risk to a specific item, write "No specific risk found in dataset."
- Past drafts/edits are guidance only. Do not reuse any details unless they are supported by the current dataset.
- Do not invent details or IDs.

**Output Requirements:**
Return a JSON object with these fields:

1. **purpose** (string): max 2 sentences. Describe the business value or key defects fixed. Use title, description, devNotes and qaNotes to understand outcomes.

2. **highlights** (array of strings): max ${highlightLimit} bullets. Each bullet must:
   - Start with "-"
   - Describe the outcome or improvement (use title, description, devNotes/qaNotes for specifics)
   - End with the ticket footer format above
   - Prioritize hot items (especially Critical/High severity bugs) and group by theme when possible

3. **primaryRisk** (string): max 3 sentences. Describe SPECIFIC operational/business risks if this release is delayed or rejected. DO NOT use generic phrases like "users may experience issues". Instead:
   - Reference SPECIFIC Critical/High severity bugs/features being fixed/added from the highlights
   - Describe impact in terms of affected user groups, business processes, or deadlines (e.g., "organization", "client-level", "partner-level", "nightly batch jobs", "compliance deadline")
   - Connect directly to business outcomes mentioned in purpose and ticket descriptions
   - Example: "Without fix for Bug 196681, the SearchElse timeout will continue affecting warehouse users during peak hours. Compliance audit scheduled for Feb 15 cannot proceed without the Historical Data export API (PBI 195884)."

4. **blastRadius** (string): List SPECIFIC systems, modules, user groups, or processes affected by changes in this release. DO NOT use vague terms. Instead:
   - Name specific modules/components from ticket titles and module themes
   - Identify user groups (e.g., "organization", "client-level", "partner-level")
   - List automated processes (e.g., "nightly FTP scheduler", "batch import jobs")
   - Format: "Affects: [Module/Component] ([user type/group]), [System/Process] ([purpose]), [User Group] ([usage context])"
   - Example: "Affects: SearchElse module (warehouse users during peak hours), FTP upload scheduler (nightly automated deliveries to external partners), Historical Data API (compliance team for quarterly audits, external auditors)"

5. **buildReadiness** (string): max 4 sentences. Assess overall build readiness based on:
   - Completion percentage (${readinessPercent}%)
   - Number of incomplete items (${incompleteCount})
   - Severity distribution (Critical/High severity items: ${severitySummary})
   - Hot items status
   - Overall quality based on devNotes/qaNotes
   - Be concise, factual, and provide a go/no-go recommendation

**Example Output:**
{
  "purpose": "Fixes critical search performance issues and adds historical data export for compliance.",
  "highlights": [
    "- Improved SearchElse performance by 40% under high load -- Bug 196681; PBI 195883",
    "- Fixed FTP upload failures causing missed scheduled deliveries -- Bug 196682, 196683",
    "- Added Historical Data export API for audit requirements -- PBI 195884"
  ],
  "primaryRisk": "Without Bug 196681 fix, SearchElse will continue timing out for warehouse users during peak hours, causing order processing delays. PBI 195884 (Historical Data export) must be deployed before Feb 15 compliance audit or face regulatory penalties.",
  "blastRadius": "Affects: SearchElse module (warehouse users during peak hours), FTP upload scheduler (nightly automated deliveries to external partners), Historical Data API (internal compliance team for quarterly audits, external auditors), inmsg processing pipeline (batch imports for accounting).",
  "buildReadiness": "Release is ready for deployment. 95% completion rate with 6/6 items at full score. All critical bugs validated through QA testing with no blockers. Minor documentation gaps remain but do not impact functionality. Recommend: PROCEED to production."
}

**Important:**
- Keep highlights concise (1 line each)
- Always end highlights with ticket IDs
- Focus on business impact, not technical details
- Use plain text, no markdown formatting
- Base insights on actual devNotes and qaNotes content when available
- Make buildReadiness assessment realistic and actionable`;

  checkPromptRegression(user, highlightLimit);

  return { system, user };
}

/**
 * Call OpenAI API to draft approval request
 */
export async function draftApproval(
  releaseId: string,
  rows: DbRow[],
  options: DraftOptions = {}
): Promise<AiDraftOutput> {
  // Check rate limit
  checkRateLimit();
  
  // Validate input
  if (!rows || rows.length === 0) {
    throw new Error('No rows provided for draft generation');
  }
  
  // Build prompt
  let { system, user } = buildPrompt(releaseId, rows, options);
  
  // Initialize OpenAI
  const openai = getOpenAIClient();
  
  // Call API with retry logic for invalid JSON
  let attempt = 0;
  const maxAttempts = 2;
  
  while (attempt < maxAttempts) {
    attempt++;
    
    try {
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0.7,
        max_tokens: 1500,
      });
      
      const content = completion.choices[0]?.message?.content;
      
      if (!content) {
        throw new Error('No content returned from OpenAI');
      }
      
      // Try to extract JSON if wrapped in markdown code blocks
      let jsonString = content.trim();
      const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
      if (jsonMatch) {
        jsonString = jsonMatch[1];
      }
      
      // Parse and validate JSON
      const parsed = JSON.parse(jsonString);
      const validated = AiDraftOutputSchema.parse(parsed);
      
      return validated;
      
    } catch (error) {
      if (attempt === maxAttempts) {
        console.error('AI draft error:', error);
        throw new Error(
          `Failed to generate valid draft after ${maxAttempts} attempts: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`
        );
      }
      
      // Retry with stricter instruction
      if (error instanceof SyntaxError || error instanceof z.ZodError) {
        console.log(`Attempt ${attempt} failed, retrying with stricter prompt...`);
        // Add stricter instruction to user message
        user += '\n\n**CRITICAL: Respond with ONLY the JSON object, no markdown formatting, no explanations.**';
        continue;
      }
      
      throw error;
    }
  }
  
  // Should never reach here
  throw new Error('Unexpected error in draft generation');
}
