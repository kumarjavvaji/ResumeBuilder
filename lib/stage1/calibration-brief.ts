import type { CompanyIndustryBasis, Stage1CalibrationBrief } from '@/contracts'

/**
 * The DomainIQ Quick Start UI serializes the full CompanyIndustryBasis into domainIQText via
 * serializeCompanyIndustryBasisForDomainIQ() as `{ export: { exportKind: 'diq_stage3_resume_builder_basis',
 * companyIndustryBasis: {...}, ... } }`. parseDomainIQ() collapses this into a thin DomainIQImport for
 * backward compatibility, but Stage 1 calibration needs the rich object, so we extract it directly here.
 */
export function extractCompanyIndustryBasisFromDomainIQText(domainIQText: string): CompanyIndustryBasis | undefined {
  if (!domainIQText?.trim()) return undefined
  try {
    const parsed = JSON.parse(domainIQText)
    const exp = parsed?.export
    if (exp?.exportKind === 'diq_stage3_resume_builder_basis' && exp?.companyIndustryBasis) {
      return exp.companyIndustryBasis as CompanyIndustryBasis
    }
  } catch {
    return undefined
  }
  return undefined
}

function findPerspective(basis: CompanyIndustryBasis, perspective: CompanyIndustryBasis['companyPerspectiveNeeds'][number]['perspective']) {
  return basis.companyPerspectiveNeeds.filter(p => p.perspective === perspective)
}

function perspectiveSignals(basis: CompanyIndustryBasis, perspective: CompanyIndustryBasis['companyPerspectiveNeeds'][number]['perspective']): string[] {
  return findPerspective(basis, perspective).map(p => p.whyItMattersForResume)
}

export function buildCalibrationBrief(basis: CompanyIndustryBasis): Stage1CalibrationBrief {
  return {
    companyContext: basis.calibrationSummary || basis.problemSpace.companyProblemHypothesis,
    domainContext: basis.industry ?? basis.problemSpace.thesis,
    roleProblemSpace: basis.problemSpace.rolePurposeHypothesis,
    likelyHiringPriorities: basis.problemSpace.impliedBusinessPressures,
    operatingModelSignals: [
      ...basis.problemSpace.operatingContext,
      ...perspectiveSignals(basis, 'operating_priorities'),
      ...perspectiveSignals(basis, 'implementation_or_operations'),
    ],
    stakeholderSignals: [
      ...basis.problemSpace.likelyUserOrStakeholderGroups,
      ...perspectiveSignals(basis, 'stakeholder_landscape'),
      ...perspectiveSignals(basis, 'customer_or_user_base'),
    ],
    deliverySignals: [
      ...basis.problemSpace.systemsOrWorkflowContext,
      ...perspectiveSignals(basis, 'delivery_environment'),
      ...perspectiveSignals(basis, 'risk_quality_compliance'),
    ],
    analyticsReportingSignals: perspectiveSignals(basis, 'data_reporting_analytics'),
    resumeCalibrationImplications: [
      ...basis.companyPerspectiveNeeds.map(p => p.resumeImplication),
      ...basis.resumeCalibrationAngles.map(a => a.exampleResumeUse),
    ],
  }
}
