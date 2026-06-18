import { describe, expect, it } from 'vitest'
import { classifyContent, isContentType } from '@/lib/stage5/signal-classifier'

describe('Signal classifier — classification boundary', () => {

  // ── Artifact history (resume content) ─────────────────────────────────────

  it('classifies accepted bullets as artifact-history, not learning-signal', () => {
    const bullets = [
      'Led end-to-end UAT coordination across three product teams.',
      'Managed 3,000+ support signals and translated them into backlog priorities.',
      'Developed requirements documentation for the Backbase migration workstream.',
      'Reviewed workflow maps with product and engineering to reduce release risk.',
      'Supported access-control testing and documented findings for compliance review.',
    ]
    for (const bullet of bullets) {
      expect(classifyContent(bullet)).toBe('artifact-history')
      expect(classifyContent(bullet, 'bullet')).toBe('artifact-history')
    }
  })

  it('classifies a bullet with an explicit bullet context hint as artifact-history', () => {
    expect(classifyContent('Collaborated with stakeholders to define acceptance criteria.', 'bullet'))
      .toBe('artifact-history')
  })

  it('classifies rejected bullet text as artifact-history (not a generation rule)', () => {
    expect(classifyContent('Executed end-to-end delivery of the mobile banking feature.')).toBe('artifact-history')
  })

  // ── Profile evidence ───────────────────────────────────────────────────────

  it('classifies skill/tool names as profile-evidence', () => {
    const skills = ['SQL', 'Jira', 'UAT', 'Confluence', 'Python 3', 'Postman']
    for (const skill of skills) {
      expect(classifyContent(skill)).toBe('profile-evidence')
      expect(classifyContent(skill, 'skill-tool')).toBe('profile-evidence')
    }
  })

  it('classifies metric values as profile-evidence', () => {
    const metrics = ['4M+ MAUs', '3,000+ requests', '40%', '$2M ARR']
    for (const metric of metrics) {
      expect(classifyContent(metric, 'metric')).toBe('profile-evidence')
    }
  })

  it('classifies short quantified facts as profile-evidence', () => {
    expect(classifyContent('3,000+ client requests', 'metric')).toBe('profile-evidence')
  })

  // ── Learning signals (generation rules) ───────────────────────────────────

  it('classifies explicit generation rules as learning-signal', () => {
    const rules = [
      'For BA roles, prioritize requirements translation, UAT readiness, and stakeholder alignment over generic product ownership language.',
      'Do not convert DomainIQ company facts into candidate claims.',
      'When accepted bullets repeatedly use metrics, preserve metric-bearing bullets during compression before cutting unmeasured bullets.',
      'For this candidate, Product Analyst and Product Owner experience should often be merged into a single analysis-to-delivery narrative for BA/APO roles.',
      'Unknown DOCX styles should be treated as parser warnings if extraction succeeds.',
      'Accepted BA bullets that combine workflow review, acceptance criteria, and production-risk reduction are strong for insurance/financial-services BA roles.',
    ]
    for (const rule of rules) {
      expect(classifyContent(rule)).toBe('learning-signal')
      expect(classifyContent(rule, 'generation-rule')).toBe('learning-signal')
    }
  })

  it('classifies rejection phrases as learning-signal via context hint', () => {
    expect(classifyContent('leverage synergies', 'rejection-phrase')).toBe('learning-signal')
    expect(classifyContent('passionate team player', 'rejection-phrase')).toBe('learning-signal')
  })

  it('recognizes "should" and "must" heuristics as generation rules', () => {
    expect(classifyContent('Bridge-question uncertainty should remain negative evidence, not a positive resume claim.')).toBe('learning-signal')
    expect(classifyContent('For future sessions, lead with BA evidence when the role requires requirements elicitation.')).toBe('learning-signal')
  })

  // ── isContentType guard ────────────────────────────────────────────────────

  it('flags legacy content types that should not exist in learningSignals', () => {
    expect(isContentType('accepted-bullet')).toBe(true)
    expect(isContentType('rejected-bullet')).toBe(true)
    expect(isContentType('approved-metric')).toBe(true)
  })

  it('does not flag valid learning signal types', () => {
    const validTypes = [
      'rejected-phrase',
      'role-preference',
      'calibration_pattern',
      'evidence_boundary',
      'role_scope_rule',
      'reusable_prompt_heuristic',
      'artifact_strategy',
    ]
    for (const type of validTypes) {
      expect(isContentType(type)).toBe(false)
    }
  })

  // ── Classification boundary summary ───────────────────────────────────────

  it('boundary: content that can appear directly on a resume → artifact-history', () => {
    // Accepted bullet text
    expect(classifyContent('Analyzed 3,000+ client requests to identify backlog priorities.')).toBe('artifact-history')
    // Role-history claim shaped as a bullet
    expect(classifyContent('Led cross-functional UAT planning for the Backbase migration.')).toBe('artifact-history')
  })

  it('boundary: skills and tools without bullet framing → profile-evidence', () => {
    expect(classifyContent('Jira', 'skill-tool')).toBe('profile-evidence')
    expect(classifyContent('SQL', 'skill-tool')).toBe('profile-evidence')
  })

  it('boundary: reusable rule that changes generation behavior → learning-signal', () => {
    expect(classifyContent(
      'For next-session generation, avoid generic delivery framing when the JD explicitly requires requirements elicitation authorship.',
      'generation-rule'
    )).toBe('learning-signal')
  })
})
