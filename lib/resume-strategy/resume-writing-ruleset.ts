import type { ResumeWritingRuleset } from '@/contracts'

const SCRUM_ALLIANCE_SOURCE_ID = 'scrum-alliance-product-owner-resume-guidance'

const PRODUCT_ADJACENT_ROLE_FAMILIES = [
  'product_owner',
  'product_analyst',
  'associate_pm',
  'business_analyst',
  'it_product',
]

export function buildDefaultResumeWritingRuleset(): ResumeWritingRuleset {
  const scrumAllianceRules: ResumeWritingRuleset['sourceBackedRules'] = [
    {
      id: 'scrum-po-value-delivery',
      sourceId: SCRUM_ALLIANCE_SOURCE_ID,
      category: 'executivePresence',
      text: 'Product Owner resume content should emphasize value delivery, ROI awareness, prioritization, product backlog decisions, and quality of delivery.',
      appliesToRoleFamilies: PRODUCT_ADJACENT_ROLE_FAMILIES,
    },
    {
      id: 'scrum-po-avoid-ceremony-ticket-processing',
      sourceId: SCRUM_ALLIANCE_SOURCE_ID,
      category: 'antiPattern',
      text: 'Avoid presenting Product Owner work as only ceremonies or ticket processing.',
      appliesToRoleFamilies: PRODUCT_ADJACENT_ROLE_FAMILIES,
    },
    {
      id: 'scrum-po-summary-tailored-hook',
      sourceId: SCRUM_ALLIANCE_SOURCE_ID,
      category: 'summaryPurpose',
      text: 'Summary should be a short, tailored positioning hook that communicates target-role fit and core competencies without career chronology or duplicated work-experience proof.',
      appliesToRoleFamilies: PRODUCT_ADJACENT_ROLE_FAMILIES,
    },
    {
      id: 'scrum-po-action-quantified-accomplishments',
      sourceId: SCRUM_ALLIANCE_SOURCE_ID,
      category: 'bulletConstruction',
      text: 'Experience bullets should use action-oriented verbs, emphasize accomplishments, prefer quantified outcomes when evidence exists, and show what improved or was delivered, how it was done, and what changed.',
      appliesToRoleFamilies: PRODUCT_ADJACENT_ROLE_FAMILIES,
    },
    {
      id: 'scrum-po-avoid-responsible-task-only',
      sourceId: SCRUM_ALLIANCE_SOURCE_ID,
      category: 'antiPattern',
      text: 'Avoid "responsible for" phrasing and task-only Product Owner bullets.',
      appliesToRoleFamilies: PRODUCT_ADJACENT_ROLE_FAMILIES,
    },
    {
      id: 'scrum-po-proof-themes',
      sourceId: SCRUM_ALLIANCE_SOURCE_ID,
      category: 'productOwnerAgileScrumProof',
      text: 'When supported by evidence and relevant to the JD, prove backlog management, user stories, acceptance criteria, stakeholder collaboration, requirements gathering, Scrum/Agile delivery, and data-informed product decisions in Experience bullets.',
      appliesToRoleFamilies: PRODUCT_ADJACENT_ROLE_FAMILIES,
    },
    {
      id: 'scrum-po-skills-ats-experience-proof',
      sourceId: SCRUM_ALLIANCE_SOURCE_ID,
      category: 'skillsPurpose',
      text: 'Use relevant Product Owner keywords from the JD and calibration artifacts for ATS support, while Experience proves the most important themes.',
      appliesToRoleFamilies: PRODUCT_ADJACENT_ROLE_FAMILIES,
    },
    {
      id: 'scrum-po-jd-tailoring',
      sourceId: SCRUM_ALLIANCE_SOURCE_ID,
      category: 'jdAlignment',
      text: 'Tailor resume strategy to each JD, emphasize the experience most relevant to the target role, and avoid generic Product Owner language when JD-specific proof is available.',
      appliesToRoleFamilies: PRODUCT_ADJACENT_ROLE_FAMILIES,
    },
  ]

  return {
    sourceBasis: [
      {
        sourceId: SCRUM_ALLIANCE_SOURCE_ID,
        sourceName: 'Scrum Alliance Product Owner resume guidance',
        ruleIds: scrumAllianceRules.map(rule => rule.id),
      },
    ],
    sourceBackedRules: scrumAllianceRules,
    sectionPurposeGuidance: {
      summary: 'Use a 2-3 sentence positioning hook: target identity, core fit, and one or two differentiators. Do not recap proof-level bullets.',
      skills: 'Use compact ATS support terms. Skills should support matching, while Experience carries proof.',
      experience: 'Use reverse-chronological proof. Lead bullets with accomplishments, decisions, outcomes, risk reduction, or delivery value.',
      education: 'Keep education and relevant certifications visible, complete, and concise.',
    },
    bulletConstructionRules: [
      'Prefer action + outcome + method or evidence.',
      'Lead with impact, judgment, decisions, outcomes, or risk reduction.',
      'Use quantified impact when verified evidence exists.',
      'Avoid duty-only bullets that read like job descriptions.',
    ],
    metricUseRules: [
      'Impact metrics can lead bullets when verified.',
      'Scope metrics can support context but should not be the main proof.',
      'Volume metrics require an outcome, decision quality, prioritization, backlog quality, or support-reduction tie.',
      'High-volume wording is still volume-led when it lacks impact.',
    ],
    jdAlignmentRules: [
      'Tailor keywords to the JD and use exact terms only when supported by evidence.',
      'JD-critical themes should be proven in Experience, not only listed in Skills.',
      'Route proof to the section specified by the Blueprint.',
    ],
    productOwnerAgileScrumProofRules: [
      'When relevant and evidenced, prove backlog management, user stories, acceptance criteria, stakeholder translation, Agile/Scrum delivery, and prioritization.',
      'Agile or Scrum ceremony references need decision value, readiness value, or delivery impact.',
    ],
    executivePresenceRules: [
      'Executive presence means operator judgment, not inflated seniority.',
      'Show prioritization, sequencing, tradeoff judgment, ambiguity reduction, stakeholder alignment, and protected release quality.',
      'Respect authority boundaries from the Blueprint.',
    ],
    antiPatternsToAvoid: [
      'Summary that recaps Experience proof.',
      'Skills carrying the main fit argument without Experience proof.',
      'Volume-led bullets without outcome tie.',
      'Task-led or ceremony-led bullets without decision impact.',
      'Inflated strategy ownership beyond the evidence.',
      'Unsupported tools, certifications, metrics, employers, platforms, or titles.',
      'Generic praise or keyword stuffing.',
    ],
    rewritePreferences: [
      'Convert volume-led bullets into impact-led or judgment-led bullets using allowed evidence.',
      'Move proof out of Summary and into Experience.',
      'Add Experience proof for JD-critical themes that appear only in Skills.',
      'Remove unsupported facts instead of softening them into vague claims.',
    ],
  }
}
