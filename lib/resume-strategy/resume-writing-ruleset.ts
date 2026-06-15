import type { ResumeWritingRuleset } from '@/contracts'

export function buildDefaultResumeWritingRuleset(): ResumeWritingRuleset {
  return {
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
