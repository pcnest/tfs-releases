import OpenAI from 'openai';
import { z } from 'zod';
import type { DbRow } from './types';

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
}

/**
 * Enhanced row for AI context with detailed information
 */
interface EnhancedRow {
  id: number;
  type: string;
  title: string;
  state: string;
  severity?: string;
  tags: string;
  score: string;
  missing: string;
  description?: string;
  devNotes?: string;
  qaNotes?: string;
}

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
 * Enhance dataset for AI context with detailed information
 */
function enhanceRows(rows: DbRow[]): EnhancedRow[] {
  return rows.map(row => ({
    id: row.wi_id,
    type: row.wi_type,
    title: row.title,
    state: row.state,
    severity: row.severity || undefined,
    tags: row.tags || '',
    score: row.score || '',
    missing: row.missing || '',
    description: row.description || undefined,
    devNotes: row.dev_notes || undefined,
    qaNotes: row.qa_notes || undefined,
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
 * Group rows by themes (simple keyword bucketing)
 */
function groupByThemes(rows: DbRow[]): Record<string, number[]> {
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
 * Build prompt for AI
 */
function buildPrompt(
  releaseId: string, 
  rows: DbRow[], 
  options: DraftOptions
): { system: string; user: string } {
  const maxHighlights = options.maxHighlights || 6;
  const severityKeywords = options.severityKeywords || ['High', 'Critical'];
  
  const enhanced = enhanceRows(rows);
  const hotItems = identifyHotItems(rows, severityKeywords);
  const themes = groupByThemes(rows);
  
  // Calculate readiness stats
  const totalItems = rows.length;
  const fullScoreCount = rows.filter(r => {
    const match = r.score?.match(/^(\d+)\/(\d+)$/);
    return match && match[1] === match[2];
  }).length;
  const incompleteCount = rows.filter(r => r.missing && r.missing.trim() !== '').length;
  const readinessPercent = totalItems > 0 ? Math.round((fullScoreCount / totalItems) * 100) : 0;
  
  // Calculate severity statistics
  const criticalCount = rows.filter(r => r.severity?.toLowerCase().includes('critical') || r.severity?.startsWith('1')).length;
  const highCount = rows.filter(r => r.severity?.toLowerCase().includes('high') || r.severity?.startsWith('2')).length;
  const severitySummary = criticalCount > 0 || highCount > 0 ? `Critical: ${criticalCount}, High: ${highCount}` : 'None';
  
  const system = `You are a release manager assistant. Output only valid JSON matching the specified schema. Keep text concise and operational.`;
  
  const user = `Generate an approval request for release ${releaseId}.

**Dataset (${rows.length} items):**
${JSON.stringify(enhanced, null, 2)}

**Hot Items (prioritize):** ${hotItems.length > 0 ? hotItems.join(', ') : 'None'}

**Themes detected:** ${Object.keys(themes).join(', ')}

**Readiness Stats:**
- Total Items: ${totalItems}
- Full Score: ${fullScoreCount} (${readinessPercent}%)
- Incomplete: ${incompleteCount}
- High Severity: ${severitySummary}

**Output Requirements:**
Return a JSON object with these fields:

1. **purpose** (string): 1-2 lines describing the business value or key defects fixed. Use descriptions, devNotes and qaNotes to understand actual outcomes.

2. **highlights** (array of strings): ${maxHighlights}-7 bullet points max. Each bullet should:
   - Start with "-"
   - Describe the outcome or improvement (use devNotes/qaNotes for specifics)
   - End with ticket IDs in format: — Bug 196681, 196682 or — PBI 195883
   - Prioritize hot items (especially Critical/High severity bugs) and group by theme when possible

3. **primaryRisk** (string): 2-3 lines describing SPECIFIC operational/business risks if this release is delayed or rejected. DO NOT use generic phrases like "users may experience issues". Instead:
   - Reference SPECIFIC Critical/High severity bugs/features being fixed/added from the highlights
   - Describe impact in terms of affected user groups, business processes, or deadlines (e.g., "organization", "client-level", "partner-level", "nightly batch jobs", "compliance deadline")
   - Connect directly to business outcomes mentioned in purpose and ticket descriptions
   - Example: "Without fix for Bug 196681, the SearchElse timeout will continue affecting warehouse users during peak hours. Compliance audit scheduled for Feb 15 cannot proceed without the Historical Data export API (PBI 195884)."

4. **blastRadius** (string): List SPECIFIC systems, modules, user groups, or processes affected by changes in this release. DO NOT use vague terms. Instead:
   - Name specific modules/components from ticket titles and descriptions
   - Identify user groups (e.g., "organization", "client-level", "partner-level")
   - List automated processes (e.g., "nightly FTP scheduler", "batch import jobs")
   - Format: "Affects: [Module/Component] ([user type/group]), [System/Process] ([purpose]), [User Group] ([usage context])"
   - Example: "Affects: SearchElse module (warehouse users during peak hours), FTP upload scheduler (nightly automated deliveries to external partners), Historical Data API (compliance team for quarterly audits, external auditors)"

5. **buildReadiness** (string): 3-4 lines assessing overall build readiness based on:
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
    "- Improved SearchElse performance by 40% under high load — Bug 196681, PBI 195883",
    "- Fixed FTP upload failures causing missed scheduled deliveries — Bug 196682, 196683",
    "- Added Historical Data export API for audit requirements — PBI 195884"
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
