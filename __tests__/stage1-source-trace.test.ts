import { describe, expect, it } from 'vitest'
import { buildCompanyContextFinding, buildJDRequirementFinding } from '@/lib/stage1/source-trace'
import type { JDRequirement } from '@/contracts'

describe('Stage 1 source trace â€” claim-level provenance', () => {
  it('cites the JD as primary even when QuickStart repeats the same claim', () => {
    const finding = buildCompanyContextFinding({
      id: 'company-context-supply-chain',
      topic: 'company_context',
      findingText: 'Part of the Supply Chain technology team within Global Technology Enterprise Products and Platform.',
      contextSourceType: 'quickstart_company_context',
      contextSourceLabel: 'QuickStart company/industry context',
      contextSupportingText: 'restaurant supply-chain technology, context only',
      jdSupportingText: 'part of the Supply Chain technology team within Global Technology Enterprise Products and Platform',
      jdSourceLabel: 'JD Department Overview',
    })

    const jdTrace = finding.sourceTrace.find(t => t.sourceType === 'jd_company_description')
    const quickStartTrace = finding.sourceTrace.find(t => t.sourceType === 'quickstart_company_context')

    expect(jdTrace?.primary).toBe(true)
    expect(quickStartTrace?.primary).toBe(false)
    expect(finding.downstreamPermission).toBe('context_only_do_not_claim')
  })

  it('marks a gap requirement with no profile coverage as profile_absence / gap_to_bridge', () => {
    const requirement: JDRequirement = {
      text: 'Supply chain, logistics, inventory, or procurement systems experience',
      category: 'domain',
      userCoverageStatus: 'gap',
    }

    const finding = buildJDRequirementFinding(requirement, 0)

    expect(finding.sourceTrace.map(t => t.sourceType)).toContain('profile_absence')
    expect(finding.downstreamPermission).toBe('gap_to_bridge')
  })

  it('marks a covered requirement backed by profile evidence as can_support_resume_claim', () => {
    const requirement: JDRequirement = {
      text: 'Writing epics, user stories, and acceptance criteria',
      category: 'process',
      userCoverageStatus: 'covered',
      profileEvidence: 'Authored epics, user stories, and acceptance criteria for 6 quarterly releases at SaaS Co.',
    }

    const finding = buildJDRequirementFinding(requirement, 0)
    const sourceTypes = finding.sourceTrace.map(t => t.sourceType)

    expect(sourceTypes).toContain('jd_duties')
    expect(sourceTypes).toContain('profile_evidence')
    expect(finding.downstreamPermission).toBe('can_support_resume_claim')
  })
})

