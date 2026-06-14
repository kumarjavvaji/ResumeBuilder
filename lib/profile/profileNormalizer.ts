/**
 * Deterministic normalization for profile claims, tools, roles, and domains.
 * All comparison keys are derived here — no LLM involved.
 */

// ─── Core key normalization ────────────────────────────────────────────────────

/** Returns a stable lowercase key stripped of punctuation for deduplication. */
export function normalizeKey(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// ─── Tool name aliases ─────────────────────────────────────────────────────────

const TOOL_ALIASES: Record<string, string> = {
  'ms excel': 'excel',
  'microsoft excel': 'excel',
  'ms word': 'word',
  'microsoft word': 'word',
  'ms powerpoint': 'powerpoint',
  'microsoft powerpoint': 'powerpoint',
  'ms teams': 'teams',
  'microsoft teams': 'teams',
  'ms project': 'ms project',
  'azure devops': 'azure devops',
  'ado': 'azure devops',
  'jira software': 'jira',
  'atlassian jira': 'jira',
  'confluence wiki': 'confluence',
  'atlassian confluence': 'confluence',
  'specflow bdd': 'specflow',
  'selenium webdriver': 'selenium',
  'selenium wd': 'selenium',
  'sql server': 'sql server',
  'ms sql': 'sql server',
  'microsoft sql server': 'sql server',
  'postgresql': 'postgres',
  'postgres sql': 'postgres',
  'sso': 'single sign-on',
  'single sign on': 'single sign-on',
  'mfa': 'multi-factor authentication',
  'multi factor auth': 'multi-factor authentication',
  'multi-factor auth': 'multi-factor authentication',
  'okta sso': 'okta',
  'power bi': 'power bi',
  'powerbi': 'power bi',
  'tableau desktop': 'tableau',
  'salesforce crm': 'salesforce',
  'sfdc': 'salesforce',
  'service now': 'servicenow',
  'snow': 'servicenow',
  'postman api': 'postman',
  'rest api testing': 'rest api',
  'github actions': 'github actions',
  'gh actions': 'github actions',
  'ci/cd': 'ci cd',
  'ci / cd': 'ci cd',
}

export function normalizeTool(tool: string): string {
  const key = tool.toLowerCase().trim().replace(/[^\w\s\/]/g, ' ').replace(/\s+/g, ' ').trim()
  return TOOL_ALIASES[key] ?? normalizeKey(tool)
}

// ─── Role label normalization ──────────────────────────────────────────────────

const ROLE_ALIASES: Record<string, string> = {
  'product owner': 'product owner',
  'po': 'product owner',
  'product manager': 'product manager',
  'pm': 'product manager',
  'business analyst': 'business analyst',
  'ba': 'business analyst',
  'product analyst': 'product analyst',
  'pa': 'product analyst',
  'qa analyst': 'qa analyst',
  'quality assurance analyst': 'qa analyst',
  'lead qa': 'lead qa analyst',
  'qa lead': 'lead qa analyst',
  'qa engineer': 'qa engineer',
  'software qa engineer': 'qa engineer',
  'sdet': 'sdet',
  'scrum master': 'scrum master',
  'agile coach': 'agile coach',
  'ux designer': 'ux designer',
  'ui ux designer': 'ux designer',
  'data analyst': 'data analyst',
  'senior product owner': 'senior product owner',
  'sr product owner': 'senior product owner',
  'senior business analyst': 'senior business analyst',
  'sr business analyst': 'senior business analyst',
  'principal product owner': 'principal product owner',
}

export function normalizeRole(title: string): string {
  const key = title.toLowerCase().trim().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim()
  return ROLE_ALIASES[key] ?? normalizeKey(title)
}

// ─── Domain normalization ──────────────────────────────────────────────────────

const DOMAIN_ALIASES: Record<string, string> = {
  'hr tech': 'hcm',
  'hr software': 'hcm',
  'human capital management': 'hcm',
  'human resources technology': 'hcm',
  'hris': 'hcm',
  'fintech': 'fintech',
  'financial technology': 'fintech',
  'banking software': 'fintech',
  'credit union software': 'credit union',
  'insurance tech': 'insurtech',
  'insurance technology': 'insurtech',
  'health tech': 'healthtech',
  'healthcare it': 'healthtech',
  'electronic health records': 'healthtech',
  'ehr': 'healthtech',
  'e-commerce': 'ecommerce',
  'ecommerce platform': 'ecommerce',
  'retail technology': 'ecommerce',
  'saas': 'saas',
  'b2b saas': 'saas',
  'enterprise software': 'enterprise software',
  'gov tech': 'govtech',
  'government technology': 'govtech',
}

export function normalizeDomain(domain: string): string {
  const key = domain.toLowerCase().trim().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim()
  return DOMAIN_ALIASES[key] ?? normalizeKey(domain)
}

// ─── Metric normalization ──────────────────────────────────────────────────────

/**
 * Normalizes a metric string to a stable key.
 * Strips formatting while preserving numeric values.
 * E.g. "40% reduction in deploy time" → "40 reduction in deploy time"
 */
export function normalizeMetric(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/\$[\d,]+/g, m => m.replace(/[$,]/g, '').trim())
    .replace(/[%,]/g, ' ')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// ─── Overlap detection ────────────────────────────────────────────────────────

/**
 * Returns the Jaccard similarity coefficient between two normalized keys.
 * Uses word-level token overlap for fast deterministic comparison.
 * 0 = no overlap, 1 = identical.
 */
export function tokenOverlap(a: string, b: string): number {
  const setA = new Set(a.split(' ').filter(Boolean))
  const setB = new Set(b.split(' ').filter(Boolean))
  if (setA.size === 0 && setB.size === 0) return 1
  if (setA.size === 0 || setB.size === 0) return 0
  let intersection = 0
  for (const t of setA) if (setB.has(t)) intersection++
  const union = setA.size + setB.size - intersection
  return intersection / union
}

/**
 * Returns true when two normalized keys are near-duplicates.
 * Thresholds: exact match = duplicate, Jaccard ≥ 0.7 = near_duplicate.
 */
export function isNearDuplicate(keyA: string, keyB: string): boolean {
  if (keyA === keyB) return true
  const overlap = tokenOverlap(keyA, keyB)
  return overlap >= 0.7
}
