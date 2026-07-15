/**
 * Stage 1 Multi-Pass Profile-to-JD Reasoning Pipeline
 *
 * Six sequential Anthropic LLM passes that fully analyze the candidate profile
 * BEFORE evaluating JD requirements — treating Stage 1 like a recruiter who
 * understands the candidate first, then reads the JD.
 *
 * Pass A: Candidate Profile Map  — understand what the candidate has done
 * Pass B: Claim Validation       — validate what can be claimed
 * Pass C: JD Requirement Map     — understand what the role actually needs (parallel with A)
 * Pass D: Match Matrix           — compare validated profile against requirements
 * Pass E: Gap Fit Analysis       — distinguish resume gaps from true evidence gaps
 * Pass F: Bridge Questions       — generate Stage 2 questions only where eligible
 *
 * Application responsibility: evidence loading, assembly, sequencing, persistence.
 * LLM responsibility: reasoning, normalization, matching, classification, gap analysis.
 */

import { anthropic, MODEL } from '@/lib/llm/client'
import { parseDomainIQ } from '@/lib/llm/parse-domainiq'
import { generateIntakeSynthesis } from '@/lib/llm/generate-intake'
import { deriveStage1Findings } from '@/lib/stage1/source-trace'
import { extractCompanyIndustryBasisFromDomainIQText, buildCalibrationBrief } from '@/lib/stage1/calibration-brief'
import { requirementTextToId } from '@/lib/llm/jd-hash'
import type {
  CandidateProfileMap,
  ValidatedProfileClaims,
  ValidatedProfileClaim,
  JDRequirementMapExtended,
  MatchMatrix,
  RequirementMatchEntry,
  GapFitAnalysis,
  GapFitEntry,
  Stage2QuestionCandidate,
  Stage1EvidencePayload,
  JDRequirement,
  JDRequirementMap,
  JDSourceType,
  RawJD,
  FitAnalysis,
  FitRequirement,
  CalibratedFitClassification,
  GapClassification,
  DomainIQImport,
  UserProfile,
  Stage1CalibrationBrief,
  ProfileEvidenceIndexItem,
} from '@/contracts'
import { matchRow } from '@/lib/stage1/evidence-match'

// ─── Shared LLM utility ───────────────────────────────────────────────────────

interface ValidationResult {
  valid: boolean
  issues: string[]
}

async function callTool<T>(opts: {
  toolName: string
  tools: any[]
  system: string
  userContent: string
  maxTokens: number
  validate?: (input: any) => boolean | ValidationResult
  _diagLabel?: string  // optional label for diagnostic logging (e.g. 'Pass B')
}): Promise<{ output: T; raw: any }> {
  const diagLabel = opts._diagLabel ?? opts.toolName

  if (process.env.NODE_ENV === 'development') {
    const tool = opts.tools.find(t => t.name === opts.toolName)
    console.log(`[Stage1 ${diagLabel} pre-call]`, {
      toolName: opts.toolName,
      maxTokens: opts.maxTokens,
      toolChoice: { type: 'tool', name: opts.toolName },
      toolInputSchema: tool?.input_schema,
      userContentLength: opts.userContent.length,
    })
  }

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: opts.maxTokens,
    tools: opts.tools,
    tool_choice: { type: 'tool', name: opts.toolName },
    system: opts.system,
    messages: [{ role: 'user', content: opts.userContent }],
  })

  if (process.env.NODE_ENV === 'development') {
    console.dir({
      diagLabel,
      stop_reason: response.stop_reason,
      usage: response.usage,
      content: response.content,
    }, { depth: 10 })

    const toolUses = response.content.filter(b => b.type === 'tool_use')
    console.dir({
      diagLabel,
      toolUseCount: toolUses.length,
      toolUses: toolUses.map((t: any) => ({
        id: t.id,
        name: t.name,
        inputKeys: Object.keys((t.input ?? {}) as Record<string, unknown>),
        input: t.input,
      })),
    }, { depth: 10 })
  }

  // Find by name — do not select first block blindly
  const toolUse = response.content.find(
    (b): b is Extract<typeof b, { type: 'tool_use' }> =>
      b.type === 'tool_use' && (b as any).name === opts.toolName
  )
  if (!toolUse) {
    const foundNames = response.content
      .filter(b => b.type === 'tool_use')
      .map((b: any) => b.name)
    throw new Error(
      `Pass ${opts.toolName}: no matching tool_use block found. ` +
      `stop_reason=${response.stop_reason}, found tool names: [${foundNames.join(', ') || 'none'}]`
    )
  }

  if (opts.validate) {
    const result = opts.validate((toolUse as any).input)
    const valid = typeof result === 'boolean' ? result : result.valid
    const issues = typeof result === 'boolean' ? [] : (result.issues ?? [])
    if (!valid) {
      const issueStr = issues.length ? issues.join('; ') : 'no details'
      throw Object.assign(
        new Error(`Pass ${opts.toolName}: output failed schema validation — ${issueStr}`),
        { rawOutput: (toolUse as any).input, validationIssues: issues, passName: opts.toolName }
      )
    }
  }
  return { output: (toolUse as any).input as T, raw: (toolUse as any).input }
}

// Attempt a single repair: sends the bad output back with schema constraints, re-validates
async function repairToolOutput<T>(opts: {
  toolName: string
  tools: any[]
  system: string
  originalUserContent: string
  invalidOutput: any
  validationIssues: string[]
  maxTokens: number
  validate: (input: any) => boolean | ValidationResult
  schemaKeys: string[]
}): Promise<T> {
  const repairPrompt = [
    'Your previous output failed schema validation.',
    '',
    `Validation issues: ${opts.validationIssues.length ? opts.validationIssues.join('; ') : 'output missing required fields'}`,
    `Required top-level keys: ${opts.schemaKeys.join(', ')}`,
    '',
    'Invalid output you produced:',
    JSON.stringify(opts.invalidOutput, null, 2).slice(0, 3000),
    '',
    'Rules for repair:',
    '- Do NOT add new analysis.',
    '- Do NOT remove substantive claims unless they violate the schema.',
    '- Rewrite the same content into valid JSON matching the tool schema exactly.',
    '- Every required field must be present.',
    '- Return via the tool only.',
  ].join('\n')

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: opts.maxTokens,
    tools: opts.tools,
    tool_choice: { type: 'tool', name: opts.toolName },
    system: opts.system,
    messages: [
      { role: 'user', content: opts.originalUserContent },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'repair_context', name: opts.toolName, input: opts.invalidOutput }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'repair_context', content: repairPrompt }] },
    ],
  })

  if (process.env.NODE_ENV === 'development') {
    console.dir({
      diagLabel: `${opts.toolName}_repair`,
      stop_reason: response.stop_reason,
      usage: response.usage,
      content: response.content,
    }, { depth: 10 })
  }

  const toolUse = response.content.find(
    (b): b is Extract<typeof b, { type: 'tool_use' }> =>
      b.type === 'tool_use' && (b as any).name === opts.toolName
  )
  if (!toolUse) {
    const foundNames = response.content
      .filter(b => b.type === 'tool_use')
      .map((b: any) => b.name)
    throw new Error(
      `Pass ${opts.toolName} repair: no matching tool_use block found. ` +
      `stop_reason=${response.stop_reason}, found: [${foundNames.join(', ') || 'none'}]`
    )
  }
  const result = opts.validate((toolUse as any).input)
  const valid = typeof result === 'boolean' ? result : result.valid
  const issues = typeof result === 'boolean' ? [] : (result.issues ?? [])
  if (!valid) {
    const issueStr = issues.length ? issues.join('; ') : 'no details'
    throw Object.assign(
      new Error(`Pass ${opts.toolName} repair: still failed validation after repair — ${issueStr}`),
      { rawOutput: (toolUse as any).input, validationIssues: issues, passName: opts.toolName }
    )
  }
  return (toolUse as any).input as T
}

// ─── Pass A: Candidate Profile Map ───────────────────────────────────────────

const PASS_A_SYSTEM = `You are a career evidence analyst.

Your task: analyze raw candidate profile evidence and produce a normalized, claim-oriented profile map.

Rules:
- Do NOT compare against any job description.
- Do NOT generate gaps.
- Understand only what the candidate has done, demonstrated, and evidenced.
- Every item in the profile map must be grounded in the provided evidence. Do not invent.
- Be exhaustive: scan every bullet, role, bridge answer, and accepted artifact.
- Organize by capability category, not by resume section.
- Distinguish what the candidate has done from what they've been exposed to.
- Known limitations = genuine gaps or contradictions you observe in the evidence itself (e.g., "mentions Scrum but never describes specific ceremonies").'`

const PASS_A_TOOL = {
  name: 'build_candidate_profile_map',
  description: 'Create a normalized, claim-oriented candidate profile map from all profile evidence.',
  input_schema: {
    type: 'object' as const,
    required: ['roles', 'agileEvidence', 'backlogEvidence', 'tools', 'metrics', 'domainExperience', 'knownLimitations'],
    properties: {
      roles: {
        type: 'array',
        items: {
          type: 'object',
          required: ['title', 'company', 'dates', 'coreFunctions'],
          properties: {
            title: { type: 'string' },
            company: { type: 'string' },
            dates: { type: 'string' },
            coreFunctions: { type: 'array', items: { type: 'string' }, description: 'What the candidate actually did in this role, ≤6 items.' },
          },
        },
      },
      productOwnershipEvidence: { type: 'array', items: { type: 'string' }, description: 'PO-level evidence: backlog ownership, roadmap, acceptance criteria, sprint planning, stakeholder sign-off.' },
      productAnalystEvidence: { type: 'array', items: { type: 'string' }, description: 'PA-level evidence: data pulls, reporting, dashboards, analysis artifacts.' },
      businessAnalystEvidence: { type: 'array', items: { type: 'string' }, description: 'BA-level evidence: requirements gathering, process mapping, BRDs, user stories.' },
      qaEvidence: { type: 'array', items: { type: 'string' }, description: 'QA evidence: test planning, UAT, defect tracking, test cases.' },
      agileEvidence: { type: 'array', items: { type: 'string' }, description: 'Agile/Scrum evidence: ceremonies facilitated, sprints led, velocity tracked.' },
      backlogEvidence: { type: 'array', items: { type: 'string' }, description: 'Backlog management evidence: grooming, prioritization, Jira usage.' },
      storyWritingEvidence: { type: 'array', items: { type: 'string' }, description: 'User story writing evidence: story format, acceptance criteria, epic decomposition.' },
      acceptanceCriteriaEvidence: { type: 'array', items: { type: 'string' }, description: 'AC definition evidence: Given/When/Then, DoD, gating criteria.' },
      technicalLiteracyEvidence: { type: 'array', items: { type: 'string' }, description: 'Technical literacy: API understanding, SQL, data models, architecture awareness.' },
      documentationEvidence: { type: 'array', items: { type: 'string' }, description: 'Documentation: PRDs, specs, wikis, runbooks, process docs.' },
      analyticsReportingEvidence: { type: 'array', items: { type: 'string' }, description: 'Analytics and reporting: dashboards, metrics tracking, reporting to stakeholders.' },
      stakeholderEvidence: { type: 'array', items: { type: 'string' }, description: 'Stakeholder management: presentations, cross-functional alignment, executive updates.' },
      leadershipEvidence: { type: 'array', items: { type: 'string' }, description: 'Leadership signals: mentoring, team direction, initiative ownership.' },
      metrics: { type: 'array', items: { type: 'string' }, description: 'Quantified outcomes and approved metrics.' },
      tools: { type: 'array', items: { type: 'string' }, description: 'Tools and platforms used (named tools only).' },
      domainExperience: { type: 'array', items: { type: 'string' }, description: 'Industry and domain exposure: healthcare, fintech, SaaS, logistics, etc.' },
      certifications: { type: 'array', items: { type: 'string' }, description: 'Certifications and credentials.' },
      remoteWorkSignals: { type: 'array', items: { type: 'string' }, description: 'Remote or distributed work evidence.' },
      knownLimitations: { type: 'array', items: { type: 'string' }, description: 'Observable gaps or contradictions within the evidence itself. Not JD gaps — profile-internal limitations only.' },
    },
  },
}

export async function runPassA(payload: Stage1EvidencePayload): Promise<CandidateProfileMap> {
  const userContent = JSON.stringify({
    workHistory: payload.workHistory,
    skills: payload.skills,
    certifications: payload.certifications,
    profileClaims: payload.profileClaims.map(c => ({
      id: c.claimId,
      text: c.text,
      category: c.category,
      strength: c.evidenceStrength,
    })),
    bridgeAnswers: payload.bridgeAnswers,
    acceptedArtifacts: payload.acceptedArtifacts,
  }, null, 2)

  const { output } = await callTool<CandidateProfileMap>({
    toolName: 'build_candidate_profile_map',
    tools: [PASS_A_TOOL],
    system: PASS_A_SYSTEM,
    userContent,
    maxTokens: 4000,
    validate: (i) => Array.isArray(i?.roles),
  })
  return output
}

// ─── Pass B: Claim Validation ─────────────────────────────────────────────────

const PASS_B_SYSTEM = `You are a resume claims validator.

Your task: classify each item in the candidate profile map by evidence support level.

Rules:
- "supported" = direct, specific evidence from multiple sources or strong single source.
- "weak" = only adjacent or secondary evidence; the claim requires hedging or reframing.
- "unsupported" = claim appears in profile language but no grounding evidence was found.
- "do_not_claim" = evidence contradicts the claim, or it would be an overclaim.
- Contradictions = two or more items that conflict with each other (e.g., "SAFe certified" but "no SAFe experience").
- Do NOT generate gaps against any job description. Only evaluate internal evidence consistency.
- Every classification must have a reasoning field.`

const PASS_B_TOOL = {
  name: 'validate_profile_claims',
  description: 'Classify all profile map items by evidence support level.',
  input_schema: {
    type: 'object' as const,
    required: ['supported', 'weak', 'unsupported', 'doNotClaim', 'contradictions'],
    properties: {
      supported: {
        type: 'array',
        items: {
          type: 'object',
          required: ['claim', 'category', 'validationStatus', 'supportingEvidenceRefs', 'evidenceStrength', 'reasoning'],
          properties: {
            claim: { type: 'string' },
            category: { type: 'string', description: 'e.g. product_ownership, agile, backlog, documentation, tool, domain, metric' },
            validationStatus: { type: 'string', enum: ['supported'] },
            supportingEvidenceRefs: { type: 'array', items: { type: 'string' }, description: 'Brief refs to the supporting evidence (role+bullet, bridge answer snippet, etc.).' },
            evidenceStrength: { type: 'string', enum: ['strong', 'medium', 'weak', 'none'] },
            reasoning: { type: 'string', maxLength: 100 },
          },
        },
      },
      weak: {
        type: 'array',
        items: {
          type: 'object',
          required: ['claim', 'category', 'validationStatus', 'supportingEvidenceRefs', 'evidenceStrength', 'reasoning'],
          properties: {
            claim: { type: 'string' },
            category: { type: 'string' },
            validationStatus: { type: 'string', enum: ['weak'] },
            supportingEvidenceRefs: { type: 'array', items: { type: 'string' } },
            evidenceStrength: { type: 'string', enum: ['strong', 'medium', 'weak', 'none'] },
            reasoning: { type: 'string', maxLength: 100 },
          },
        },
      },
      unsupported: {
        type: 'array',
        items: {
          type: 'object',
          required: ['claim', 'category', 'validationStatus', 'supportingEvidenceRefs', 'evidenceStrength', 'reasoning'],
          properties: {
            claim: { type: 'string' },
            category: { type: 'string' },
            validationStatus: { type: 'string', enum: ['unsupported'] },
            supportingEvidenceRefs: { type: 'array', items: { type: 'string' } },
            evidenceStrength: { type: 'string', enum: ['strong', 'medium', 'weak', 'none'] },
            reasoning: { type: 'string', maxLength: 100 },
          },
        },
      },
      doNotClaim: {
        type: 'array',
        items: {
          type: 'object',
          required: ['claim', 'category', 'validationStatus', 'supportingEvidenceRefs', 'evidenceStrength', 'reasoning'],
          properties: {
            claim: { type: 'string' },
            category: { type: 'string' },
            validationStatus: { type: 'string', enum: ['do_not_claim'] },
            supportingEvidenceRefs: { type: 'array', items: { type: 'string' } },
            evidenceStrength: { type: 'string', enum: ['strong', 'medium', 'weak', 'none'] },
            reasoning: { type: 'string', maxLength: 100 },
          },
        },
      },
      contradictions: {
        type: 'array',
        items: { type: 'string' },
        description: 'Contradictions found between items in the profile map.',
      },
    },
  },
}

const PASS_B_REQUIRED_KEYS = ['supported', 'weak', 'unsupported', 'doNotClaim', 'contradictions']

function validatePassB(i: any): ValidationResult {
  const issues: string[] = []
  for (const key of PASS_B_REQUIRED_KEYS) {
    if (!Array.isArray(i?.[key])) issues.push(`"${key}" must be an array (got ${typeof i?.[key]})`)
  }
  return { valid: issues.length === 0, issues }
}

export async function runPassB(
  profileMap: CandidateProfileMap,
  payload: Stage1EvidencePayload,
): Promise<ValidatedProfileClaims> {
  const userContent = JSON.stringify({
    profileMap,
    rawSkills: payload.skills,
    certifications: payload.certifications,
  }, null, 2)

  if (process.env.NODE_ENV === 'development') {
    console.log('[Stage1 Pass A output]', {
      pass: 'build_candidate_profile_map',
      topLevelKeys: Object.keys(profileMap ?? {}),
      outputPreview: JSON.stringify(profileMap).slice(0, 2000),
    })
    console.log('[Pass B input summary]', {
      profileMapKeys: Object.keys(profileMap ?? {}),
      profileMapJsonLength: JSON.stringify(profileMap).length,
      userContentLength: userContent.length,
    })
  }

  let rawOutput: any
  let validationIssues: string[] = []

  try {
    const { output, raw } = await callTool<ValidatedProfileClaims>({
      toolName: 'validate_profile_claims',
      tools: [PASS_B_TOOL],
      system: PASS_B_SYSTEM,
      userContent,
      maxTokens: 8192,
      validate: validatePassB,
      _diagLabel: 'Pass B',
    })
    rawOutput = raw

    if (process.env.NODE_ENV === 'development') {
      console.log('[Stage1 Pass B raw output]', {
        pass: 'validate_profile_claims',
        topLevelKeys: Object.keys(raw ?? {}),
        rawPreview: JSON.stringify(raw).slice(0, 3000),
      })
    }

    return output
  } catch (err: any) {
    rawOutput = err.rawOutput
    validationIssues = err.validationIssues ?? []

    if (process.env.NODE_ENV === 'development') {
      console.error('[Stage1 Pass B raw output]', {
        pass: 'validate_profile_claims',
        rawPreview: rawOutput !== undefined
          ? JSON.stringify(rawOutput).slice(0, 3000)
          : '(no output — tool_use block missing)',
        topLevelKeys: rawOutput ? Object.keys(rawOutput) : [],
      })
      console.error('[Stage1 Pass B validation error]', {
        pass: 'validate_profile_claims',
        issues: validationIssues,
        requiredKeys: PASS_B_REQUIRED_KEYS,
      })
    }

    // Only attempt repair when we have raw output to repair (validation failure, not network/LLM error)
    if (rawOutput === undefined) throw err

    // One repair attempt before failing
    try {
      console.warn('[Stage1 Pass B] Attempting repair pass…')
      const repaired = await repairToolOutput<ValidatedProfileClaims>({
        toolName: 'validate_profile_claims',
        tools: [PASS_B_TOOL],
        system: PASS_B_SYSTEM,
        originalUserContent: userContent,
        invalidOutput: rawOutput,
        validationIssues,
        maxTokens: 8192,
        validate: validatePassB,
        schemaKeys: PASS_B_REQUIRED_KEYS,
      })
      console.warn('[Stage1 Pass B] Repair succeeded.')
      return repaired
    } catch (repairErr: any) {
      if (process.env.NODE_ENV === 'development') {
        console.error('[Stage1 Pass B repair failed]', {
          repairError: repairErr.message,
          repairedRawOutput: repairErr.rawOutput,
          repairedIssues: repairErr.validationIssues,
          originalRawOutput: rawOutput,
          originalIssues: validationIssues,
          profileMapKeys: Object.keys(profileMap ?? {}),
        })
      }
      throw Object.assign(
        new Error(`Pass validate_profile_claims failed schema validation. Open console for schema path and raw output preview.`),
        { rawOutput, validationIssues, passName: 'validate_profile_claims' }
      )
    }
  }
}

// ─── Pass C: JD Requirement Map ──────────────────────────────────────────────

const PASS_C_SYSTEM = `You are a hiring-signal analyst.

Your task: analyze the job description and company context to produce a structured requirement map.

Rules:
- Identify the REAL job function — not the posted title. A "Senior Product Owner" posting may actually be a "BA + scrum coordinator" role. Be honest.
- Must-have requirements = things the JD explicitly marks required or uses "must" language.
- Nice-to-have = "preferred", "a plus", "bonus", "ideally", "exposure to".
- Hidden hiring signals = what the company is ACTUALLY hiring for, reading between the JD lines.
- ATS signals = specific keywords and phrases to include in the resume for keyword matching.
- Expected resume proof points = what a competitive resume for this role would show.
- Split compound requirements: "Agile ceremonies AND stakeholder management" = two separate items.
- Do NOT evaluate the candidate at all. This pass is JD-only analysis.`

const PASS_C_TOOL = {
  name: 'analyze_jd_requirements',
  description: 'Analyze a JD to identify what the company is actually hiring for.',
  input_schema: {
    type: 'object' as const,
    required: ['realJobFunction', 'summary', 'coreResponsibilities', 'mustHaveRequirements', 'niceToHaveRequirements', 'hiddenHiringSignals', 'atsSignals', 'likelyInterviewThemes', 'expectedResumeProofPoints'],
    properties: {
      realJobFunction: { type: 'string', description: '≤20 words. What this role actually does, regardless of posted title.' },
      summary: { type: 'string', description: '2-3 sentence summary of the role and company.' },
      coreResponsibilities: { type: 'array', items: { type: 'string' }, maxItems: 8, description: 'Top day-to-day responsibilities, ≤8.' },
      mustHaveRequirements: {
        type: 'array',
        maxItems: 12,
        items: {
          type: 'object',
          required: ['text', 'category', 'priority'],
          properties: {
            text: { type: 'string', description: '≤15 words. Atomic — one skill or dimension per item.' },
            category: { type: 'string', enum: ['technical', 'domain', 'soft', 'tool', 'process'] },
            priority: { type: 'string', enum: ['high', 'medium', 'low'] },
          },
        },
      },
      niceToHaveRequirements: {
        type: 'array',
        maxItems: 8,
        items: {
          type: 'object',
          required: ['text', 'category', 'priority'],
          properties: {
            text: { type: 'string', description: '≤15 words. Atomic.' },
            category: { type: 'string', enum: ['technical', 'domain', 'soft', 'tool', 'process'] },
            priority: { type: 'string', enum: ['high', 'medium', 'low'] },
          },
        },
      },
      hiddenHiringSignals: { type: 'array', items: { type: 'string' }, maxItems: 5, description: 'What the company is actually hiring for — reading between the lines. Max 5.' },
      atsSignals: { type: 'array', items: { type: 'string' }, maxItems: 12, description: 'Specific keyword phrases to include in the resume for ATS matching. Max 12.' },
      likelyInterviewThemes: { type: 'array', items: { type: 'string' }, maxItems: 6, description: 'Likely interview themes or question areas based on the JD. Max 6.' },
      expectedResumeProofPoints: { type: 'array', items: { type: 'string' }, maxItems: 6, description: 'Proof points a competitive resume for this role would show. Max 6.' },
      domainSignals: { type: 'array', items: { type: 'string' }, maxItems: 6, description: 'Industry, domain, or company-type signals from the JD. Max 6.' },
    },
  },
}

export async function runPassC(
  jdText: string,
  calibrationBrief?: Stage1CalibrationBrief,
): Promise<JDRequirementMapExtended> {
  const userContent = [
    'Job description:',
    jdText,
    calibrationBrief ? `\nCompany/domain context:\n${JSON.stringify(calibrationBrief, null, 2)}` : null,
  ].filter(Boolean).join('\n')

  const { output } = await callTool<JDRequirementMapExtended>({
    toolName: 'analyze_jd_requirements',
    tools: [PASS_C_TOOL],
    system: PASS_C_SYSTEM,
    userContent,
    maxTokens: 3500,
    validate: (i) => typeof i?.realJobFunction === 'string' && Array.isArray(i?.mustHaveRequirements),
  })
  return output
}

// ─── Pass D: Match Matrix ─────────────────────────────────────────────────────

const PASS_D_SYSTEM = `You are a profile-to-JD match analyst.

Your task: compare validated candidate claims against each JD requirement.

Classification rules:
- "direct" = validated supported claim clearly and specifically covers the requirement. You can cite exact evidence.
- "adjacent" = validated supported or weak claim covers a related capability. Resume can reasonably reference this but needs clarity on the specific match.
- "weak" = only validated weak claims or indirect evidence exists. Resume cannot lead with this.
- "unsupported" = no validated claim covers this requirement after checking all provided evidence.
- "do_not_claim" = the candidate explicitly should not claim this (contradicted or do_not_claim in validation).

Hard rules:
- DO NOT call anything "unsupported" if a supported claim covers it, even under a different name.
- Check synonyms and transferable capabilities before marking unsupported.
- Evidence refs must come from the validated claim set — do not invent evidence.
- One output row per input requirement. Row count must match exactly.
- Do NOT generate gaps in this step — only classify match strength.`

const PASS_D_ITEM_SCHEMA = {
  type: 'object' as const,
  required: ['requirementText', 'requirementCategory', 'classification', 'supportingEvidence', 'evidenceRefs', 'reasoning', 'resumeRelevance'],
  properties: {
    requirementText: { type: 'string' },
    requirementCategory: { type: 'string', enum: ['technical', 'domain', 'soft', 'tool', 'process'] },
    classification: { type: 'string', enum: ['direct', 'adjacent', 'weak', 'unsupported', 'do_not_claim'] },
    supportingEvidence: { type: 'array', items: { type: 'string' }, description: 'Validated claim texts that support this classification.' },
    evidenceRefs: { type: 'array', items: { type: 'string' }, description: 'Brief refs to validated claims (e.g. "supported: backlog management at TechCorp").' },
    reasoning: { type: 'string', maxLength: 80, description: '≤80 chars explaining the match or mismatch.' },
    resumeRelevance: { type: 'string', maxLength: 80, description: '≤80 chars. How to present this on the resume, or why it should be avoided.' },
  },
}

const PASS_D_TOOL = {
  name: 'build_match_matrix',
  description: 'Compare validated profile claims against each JD requirement.',
  input_schema: {
    type: 'object' as const,
    required: ['required', 'niceToHave'],
    properties: {
      required: { type: 'array', items: PASS_D_ITEM_SCHEMA },
      niceToHave: { type: 'array', items: PASS_D_ITEM_SCHEMA },
    },
  },
}

export async function runPassD(
  validatedClaims: ValidatedProfileClaims,
  jdMap: JDRequirementMapExtended,
): Promise<MatchMatrix> {
  const userContent = JSON.stringify({
    validatedClaims: {
      supported: validatedClaims.supported.map(c => ({ claim: c.claim, category: c.category, strength: c.evidenceStrength })),
      weak: validatedClaims.weak.map(c => ({ claim: c.claim, category: c.category, strength: c.evidenceStrength })),
      doNotClaim: validatedClaims.doNotClaim.map(c => c.claim),
      contradictions: validatedClaims.contradictions,
    },
    jdRequirements: {
      required: jdMap.mustHaveRequirements,
      niceToHave: jdMap.niceToHaveRequirements,
    },
  }, null, 2)

  const { output } = await callTool<MatchMatrix>({
    toolName: 'build_match_matrix',
    tools: [PASS_D_TOOL],
    system: PASS_D_SYSTEM,
    userContent,
    maxTokens: 5000,
    validate: (i) => Array.isArray(i?.required) && Array.isArray(i?.niceToHave),
  })
  return output
}

// ─── Pass E: Gap Fit Analysis ─────────────────────────────────────────────────

const PASS_E_SYSTEM = `You are a resume gap analyst.

Your task: analyze the match matrix and produce a precise gap fit classification.

CRITICAL DISTINCTION:
- "resume_gap" = the candidate HAS the capability (evidence exists in profile) but the resume fails to surface it. This is a resume framing problem, not an evidence problem.
- "true_gap" = the candidate DOES NOT have the capability. No evidence exists.
Never merge these two categories. A resume_gap is high-confidence coverage; a true_gap is an actual hiring risk.

Other categories:
- "directly_supported" = "direct" classification in the match matrix.
- "weakly_supported" = "adjacent" or "weak" classification.
- "do_not_claim" = any "do_not_claim" requirement from the match matrix.

Resume action = what the resume should do: "surface existing evidence", "reframe", "bridge question needed", "avoid claiming", etc.`

const PASS_E_ENTRY_SCHEMA = {
  type: 'object' as const,
  required: ['requirementText', 'gapCategory', 'reasoning', 'resumeAction'],
  properties: {
    requirementText: { type: 'string' },
    gapCategory: { type: 'string', enum: ['directly_supported', 'weakly_supported', 'resume_gap', 'true_gap', 'do_not_claim'] },
    reasoning: { type: 'string', maxLength: 100 },
    resumeAction: { type: 'string', maxLength: 80, description: '≤80 chars. What the resume should do about this requirement.' },
  },
}

const PASS_E_TOOL = {
  name: 'analyze_gap_fit',
  description: 'Classify each JD requirement into a gap fit category.',
  input_schema: {
    type: 'object' as const,
    required: ['directlySupported', 'weaklySupported', 'resumeGaps', 'trueGaps', 'doNotClaim'],
    properties: {
      directlySupported: { type: 'array', items: PASS_E_ENTRY_SCHEMA },
      weaklySupported: { type: 'array', items: PASS_E_ENTRY_SCHEMA },
      resumeGaps: { type: 'array', items: PASS_E_ENTRY_SCHEMA, description: 'Evidence exists but is not surfaced on the resume. DO NOT put true_gap items here.' },
      trueGaps: { type: 'array', items: PASS_E_ENTRY_SCHEMA, description: 'No evidence exists. Actual candidate capability gap. DO NOT put resume_gap items here.' },
      doNotClaim: { type: 'array', items: PASS_E_ENTRY_SCHEMA },
    },
  },
}

export async function runPassE(
  matchMatrix: MatchMatrix,
  validatedClaims: ValidatedProfileClaims,
): Promise<GapFitAnalysis> {
  const userContent = JSON.stringify({
    matchMatrix,
    availableEvidence: {
      supportedClaimsCount: validatedClaims.supported.length,
      weakClaimsCount: validatedClaims.weak.length,
      unsupportedCount: validatedClaims.unsupported.length,
    },
  }, null, 2)

  const { output } = await callTool<GapFitAnalysis>({
    toolName: 'analyze_gap_fit',
    tools: [PASS_E_TOOL],
    system: PASS_E_SYSTEM,
    userContent,
    maxTokens: 3500,
    validate: (i) => Array.isArray(i?.directlySupported) && Array.isArray(i?.trueGaps),
  })
  return enrichGapFitWithIds(output)
}

/**
 * Assigns deterministic requirementIds to every GapFitEntry after Pass E.
 * IDs are derived from requirementText — no LLM changes needed.
 */
function enrichGapFitWithIds(analysis: GapFitAnalysis): GapFitAnalysis {
  const tag = (entries: GapFitEntry[]) =>
    entries.map(e => ({ ...e, requirementId: e.requirementId || requirementTextToId(e.requirementText) }))
  return {
    directlySupported: tag(analysis.directlySupported),
    weaklySupported: tag(analysis.weaklySupported),
    resumeGaps: tag(analysis.resumeGaps),
    trueGaps: tag(analysis.trueGaps),
    doNotClaim: tag(analysis.doNotClaim),
  }
}

// ─── Pass F: Bridge Question Generation ──────────────────────────────────────

const PASS_F_SYSTEM = `You are a Stage 2 bridge question specialist.

Your task: generate targeted bridge questions for the Stage 2 interview prep.

ELIGIBILITY RULES — a question is ONLY valid if ALL of these are true:
1. A JD requirement exists.
2. The requirement is classified as "weakly_supported" or "true_gap".
3. No "directly_supported" or "do_not_claim" classification exists for this requirement.
4. The question would materially improve resume targeting if answered.
5. The answer does not already exist in validated supported profile claims.

For "resume_gap" requirements: DO NOT generate a question. Evidence already exists — the resume just needs to surface it. Generate a resume action note instead.

Question requirements:
- Target the SPECIFIC MISSING ELEMENT, not the whole requirement.
- Ask for specific examples, metrics, or context — not "do you have experience with X?"
- Include the potential resume impact — what a good answer would unlock.
- Assign an affected section (summary / skills / experience-primary / experience-secondary).`

const PASS_F_TOOL = {
  name: 'generate_bridge_questions',
  description: 'Generate Stage 2 bridge questions for eligible requirements only.',
  input_schema: {
    type: 'object' as const,
    required: ['questions'],
    properties: {
      questions: {
        type: 'array',
        maxItems: 8,
        items: {
          type: 'object',
          required: ['requirementId', 'requirement', 'currentClassification', 'whyEvidenceIsMissing', 'potentialResumeImpact', 'question', 'priority', 'affectedSection', 'evidenceStatus'],
          properties: {
            requirementId: { type: 'string', description: 'Echo the requirementId from the eligible requirement entry.' },
            requirement: { type: 'string' },
            currentClassification: { type: 'string', enum: ['weakly_supported', 'true_gap'] },
            whyEvidenceIsMissing: { type: 'string', maxLength: 80 },
            potentialResumeImpact: { type: 'string', maxLength: 80 },
            question: { type: 'string', description: '≤35 words. Specific, concrete question targeting the missing element.' },
            priority: { type: 'string', enum: ['high', 'medium', 'low'] },
            affectedSection: { type: 'string', enum: ['summary', 'skills', 'experience-primary', 'experience-secondary', 'experience-supporting'] },
            evidenceStatus: { type: 'string', enum: ['partial', 'weak', 'gap', 'retrieval_gap'], description: 'Coverage state that motivated this question.' },
          },
        },
      },
    },
  },
}

export async function runPassF(
  gapAnalysis: GapFitAnalysis,
  validatedClaims: ValidatedProfileClaims,
): Promise<Stage2QuestionCandidate[]> {
  // gapAnalysis already has requirementIds assigned by enrichGapFitWithIds after Pass E
  const eligibleRequirements = [
    ...gapAnalysis.weaklySupported.map(e => ({ ...e, fromCategory: 'weakly_supported' as const })),
    ...gapAnalysis.trueGaps.map(e => ({ ...e, fromCategory: 'true_gap' as const })),
  ]

  if (eligibleRequirements.length === 0) return []

  const userContent = JSON.stringify({
    eligibleRequirements,
    ineligible: {
      directlySupported: gapAnalysis.directlySupported.map(e => e.requirementText),
      resumeGaps: gapAnalysis.resumeGaps.map(e => e.requirementText),
      doNotClaim: gapAnalysis.doNotClaim.map(e => e.requirementText),
    },
    alreadyAnsweredIn: validatedClaims.supported.map(c => c.claim),
  }, null, 2)

  const { output } = await callTool<{ questions: Stage2QuestionCandidate[] }>({
    toolName: 'generate_bridge_questions',
    tools: [PASS_F_TOOL],
    system: PASS_F_SYSTEM,
    userContent,
    maxTokens: 2500,
    validate: (i) => Array.isArray(i?.questions),
  })
  // Ensure every candidate has requirementId and evidenceStatus (echo from eligible requirements if LLM omitted)
  const requirementIdByText = new Map(eligibleRequirements.map(e => [e.requirementText, e.requirementId]))
  const categoryByText = new Map(eligibleRequirements.map(e => [e.requirementText, e.fromCategory]))
  const enriched = output.questions.map(q => ({
    ...q,
    requirementId: q.requirementId || requirementIdByText.get(q.requirement) || requirementTextToId(q.requirement),
    evidenceStatus: q.evidenceStatus || (categoryByText.get(q.requirement) === 'true_gap' ? 'gap' as const : 'weak' as const),
  }))

  return enriched
}

// ─── Output assembly — converts pipeline results to existing contract types ───

function matchStrengthToClassification(
  strength: string | undefined,
  gapCategory: string | undefined,
): CalibratedFitClassification {
  if (gapCategory === 'resume_gap') return 'retrieval_gap'
  switch (strength) {
    case 'direct':      return 'covered'
    case 'adjacent':    return 'partially_covered'
    case 'weak':        return 'weakly_supported'
    case 'do_not_claim': return 'needs_evidence'
    case 'unsupported':
    default:            return 'needs_evidence'
  }
}

function matchStrengthToUserCoverage(strength: string | undefined, gapCategory: string | undefined): JDRequirement['userCoverageStatus'] {
  if (gapCategory === 'resume_gap') return 'partial'
  switch (strength) {
    case 'direct':       return 'covered'
    case 'adjacent':     return 'partial'
    case 'weak':         return 'partial'
    case 'unsupported':  return 'gap'
    case 'do_not_claim': return 'gap'
    default:             return 'gap'
  }
}

function matchStrengthToGapClassification(
  strength: string | undefined,
  gapCategory: string | undefined,
): GapClassification | undefined {
  if (gapCategory === 'resume_gap') return 'retrieval_gap'
  switch (strength) {
    case 'direct':       return undefined
    case 'adjacent':     return 'needs_confirmation'
    case 'weak':         return 'wording_gap'
    case 'do_not_claim': return 'mapping_gap'
    case 'unsupported':  return 'profile_missing'
    default:             return 'profile_missing'
  }
}

function deriveStage2Action(
  strength: string | undefined,
  gapCategory: string | undefined,
  hasBridgeQuestion: boolean,
): JDRequirement['stage2Action'] {
  if (gapCategory === 'resume_gap') return 'retrieve_more_evidence'
  if (strength === 'direct') return 'suppress'
  if (strength === 'do_not_claim') return 'suppress'
  if (hasBridgeQuestion) return 'ask_bridge_question'
  return 'suppress'
}

function assembleJDRequirements(
  jdMapItems: JDRequirementMapExtended['mustHaveRequirements'] | JDRequirementMapExtended['niceToHaveRequirements'],
  matchEntries: RequirementMatchEntry[],
  gapEntries: GapFitEntry[],
  bridgeQuestions: Stage2QuestionCandidate[],
  evidenceIndex: ProfileEvidenceIndexItem[],
  jdSourceType: JDSourceType,
): JDRequirement[] {
  return jdMapItems.map((item, i) => {
    const match = matchEntries.find(m => m.requirementText === item.text) ?? matchEntries[i]
    const gap = gapEntries.find(g => g.requirementText === item.text)
    const bq = bridgeQuestions.find(q => q.requirement === item.text)
    const hasBridgeQuestion = !!bq

    const classification = matchStrengthToClassification(match?.classification, gap?.gapCategory)
    const userCoverageStatus = matchStrengthToUserCoverage(match?.classification, gap?.gapCategory)
    const gapClassification = matchStrengthToGapClassification(match?.classification, gap?.gapCategory)
    const stage2Action = deriveStage2Action(match?.classification, gap?.gapCategory, hasBridgeQuestion)

    // Deterministic pre-match for matchedClaimIds
    const tempRow: JDRequirement = { text: item.text, category: item.category, userCoverageStatus: 'unknown' }
    const preMatched = matchRow(tempRow, evidenceIndex)

    return {
      text: item.text,
      category: item.category,
      userCoverageStatus,
      classification,
      gapClassification,
      sourceType: jdSourceType,
      rowLabel: item.text.slice(0, 60),
      profileGrounding: match?.supportingEvidence?.join('; ') ?? '',
      resumeImplication: match?.resumeRelevance ?? gap?.resumeAction ?? '',
      bridgeReasoning: match?.reasoning ?? '',
      bridgeAssessment: matchStrengthToBridgeAssessment(match?.classification),
      stage2Action,
      stage2Implication: bq?.question,
      evidenceNeeded: gap?.gapCategory === 'true_gap' ? bq?.whyEvidenceIsMissing : undefined,
      matchedClaimIds: preMatched.matchedClaimIds ?? [],
      matchedEvidenceTexts: preMatched.matchedEvidenceTexts ?? [],
      profileEvidenceStrength: preMatched.profileEvidenceStrength ?? 'none',
    }
  })
}

function matchStrengthToBridgeAssessment(strength: string | undefined): JDRequirement['bridgeAssessment'] {
  switch (strength) {
    case 'direct':       return 'direct'
    case 'adjacent':     return 'adjacent'
    case 'weak':         return 'proxy'
    case 'unsupported':  return 'insufficient'
    case 'do_not_claim': return 'insufficient'
    default:             return 'insufficient'
  }
}

// ─── Pipeline result type ─────────────────────────────────────────────────────

export interface Stage1PipelineResult {
  rawJD: RawJD
  requirementMap: JDRequirementMap
  domainIQ: DomainIQImport
  synthesis: Awaited<ReturnType<typeof generateIntakeSynthesis>>
  fitAnalysis: FitAnalysis
  // Rich intermediate pass outputs for display and debugging
  profileMap: CandidateProfileMap
  validatedClaims: ValidatedProfileClaims
  jdRequirementMapExtended: JDRequirementMapExtended
  matchMatrix: MatchMatrix
  gapFitAnalysis: GapFitAnalysis
  bridgeQuestions: Stage2QuestionCandidate[]
}

// ─── Evidence payload builder (exported for individual pass routes) ───────────

export function buildStage1EvidencePayload(
  profile: UserProfile,
  evidenceIndex: ProfileEvidenceIndexItem[],
  bridgeAnswers: Array<{ question: string; answer: string; questionType: string }> = [],
  acceptedArtifacts: Array<{ sectionType: string; content: string }> = [],
): Stage1EvidencePayload {
  return {
    workHistory: profile.workHistory.map(w => ({
      id: w.id,
      title: w.title,
      company: w.company,
      startDate: w.startDate,
      endDate: w.endDate,
      bullets: w.bullets,
      domain: w.domain,
      skills: w.skills,
      approvedMetrics: w.approvedMetrics,
    })),
    skills: profile.skills,
    certifications: profile.certifications,
    profileClaims: evidenceIndex,
    bridgeAnswers,
    acceptedArtifacts,
  }
}

// ─── Assembly — builds the final artifact from all pass outputs ───────────────

export async function assembleStage1Result(opts: {
  profileMap: CandidateProfileMap
  validatedClaims: ValidatedProfileClaims
  jdMapExtended: JDRequirementMapExtended
  matchMatrix: MatchMatrix
  gapFitAnalysis: GapFitAnalysis
  bridgeQuestions: Stage2QuestionCandidate[]
  jdText: string
  domainIQText: string
  profile: UserProfile
  jdSourceType: JDSourceType
  evidenceIndex: ProfileEvidenceIndexItem[]
}): Promise<Stage1PipelineResult> {
  const { profileMap, validatedClaims, jdMapExtended, matchMatrix, gapFitAnalysis, bridgeQuestions, jdText, domainIQText, profile, jdSourceType, evidenceIndex } = opts

  const companyIndustryBasis = extractCompanyIndustryBasisFromDomainIQText(domainIQText ?? '')
  const calibrationBrief = companyIndustryBasis ? buildCalibrationBrief(companyIndustryBasis) : undefined

  const allGapEntries = [
    ...gapFitAnalysis.directlySupported,
    ...gapFitAnalysis.weaklySupported,
    ...gapFitAnalysis.resumeGaps,
    ...gapFitAnalysis.trueGaps,
    ...gapFitAnalysis.doNotClaim,
  ]

  const required = assembleJDRequirements(
    jdMapExtended.mustHaveRequirements, matchMatrix.required, allGapEntries, bridgeQuestions, evidenceIndex, jdSourceType,
  )
  const niceToHave = assembleJDRequirements(
    jdMapExtended.niceToHaveRequirements, matchMatrix.niceToHave, allGapEntries, bridgeQuestions, evidenceIndex, jdSourceType,
  )

  const needsEvidenceItems = [...required, ...niceToHave]
    .filter(r => r.stage2Action === 'ask_bridge_question')
    .map(r => r.evidenceNeeded || r.stage2Implication || r.text)

  const weaklySupportedRequirements = [...required, ...niceToHave]
    .filter(r => r.classification === 'weakly_supported' || r.classification === 'partially_covered')
    .map(r => r.rowLabel || r.text)

  const requirementMap: JDRequirementMap = {
    required,
    niceToHave,
    realJobFunction: jdMapExtended.realJobFunction,
    needsEvidenceItems,
    unsupportedRequirements: needsEvidenceItems,
    weaklySupportedRequirements,
  }

  const rawJD: RawJD = {
    fullText: jdText,
    summary: jdMapExtended.summary,
    responsibilities: jdMapExtended.coreResponsibilities,
    requiredSkills: jdMapExtended.mustHaveRequirements.map(r => r.text),
    niceToHaves: jdMapExtended.niceToHaveRequirements.map(r => r.text),
    domainSignals: jdMapExtended.domainSignals ?? [],
  }

  const [domainIQ, synthesis] = await Promise.all([
    parseDomainIQ(domainIQText ?? ''),
    generateIntakeSynthesis(
      requirementMap,
      { rawText: domainIQText, companyProfile: '', industrySignals: [], techStack: [], cultureSignals: [] },
      profile,
      calibrationBrief,
      validatedClaims.contradictions,
    ),
  ])

  const fitRequirements: FitRequirement[] = required.map((r, i) => ({
    requirementId: `req-${i}`,
    requirementText: r.text,
    category: r.category,
    coverageStatus: r.userCoverageStatus,
    gapClassification: r.gapClassification,
    supportingEvidence: r.profileGrounding ? [r.profileGrounding] : [],
    resumeImplication: r.resumeImplication,
    rowLabel: r.rowLabel,
    classification: r.classification,
    evidenceNeeded: r.evidenceNeeded,
    stage2Implication: r.stage2Implication,
    matchedClaimIds: r.matchedClaimIds,
    profileEvidenceStrength: r.profileEvidenceStrength,
  }))

  const fitAnalysis: FitAnalysis = {
    fitHypothesis: synthesis.fitHypothesis,
    realJobFunction: jdMapExtended.realJobFunction,
    evaluatorLens: synthesis.evaluatorLens ?? '',
    riskNotes: synthesis.riskGaps,
    requirements: fitRequirements,
    gapSummary: {
      trueGaps: gapFitAnalysis.trueGaps.map(g => g.requirementText),
      missingFromProfile: gapFitAnalysis.trueGaps.map(g => g.requirementText),
      needsConfirmation: gapFitAnalysis.weaklySupported.map(g => g.requirementText),
      wordingOrMapping: gapFitAnalysis.resumeGaps.map(g => g.requirementText),
    },
    recommendedBridgeTargets: needsEvidenceItems,
    generatedAt: new Date().toISOString(),
    findings: deriveStage1Findings(requirementMap, domainIQ),
    calibrationBrief,
    riskGapBreakdown: synthesis.riskGapBreakdown,
    resumeDirection: synthesis.resumeDirection,
    qualityAudit: synthesis.qualityAudit,
  }

  return {
    rawJD,
    requirementMap,
    domainIQ,
    synthesis,
    fitAnalysis,
    profileMap,
    validatedClaims,
    jdRequirementMapExtended: jdMapExtended,
    matchMatrix,
    gapFitAnalysis,
    bridgeQuestions,
  }
}

// ─── Pipeline events (for SSE streaming / legacy route) ──────────────────────

export type Stage1PipelineEvent =
  | { type: 'progress'; step: string; status: 'in_progress' | 'completed' | 'failed'; error?: string }
  | { type: 'partial'; step: string; data: unknown }
  | { type: 'complete'; result: Stage1PipelineResult }
  | { type: 'error'; error: string }

// ─── Legacy monolithic orchestrator (kept for /api/intake backward compat) ───

export async function runStage1Pipeline(opts: {
  jdText: string
  domainIQText: string
  profile: UserProfile
  jdSourceType: JDSourceType
  roleTitle: string
  company: string
  evidenceIndex: ProfileEvidenceIndexItem[]
  bridgeAnswers?: Array<{ question: string; answer: string; questionType: string }>
  acceptedArtifacts?: Array<{ sectionType: string; content: string }>
  onEvent: (event: Stage1PipelineEvent) => void
}): Promise<Stage1PipelineResult> {
  const { jdText, domainIQText, profile, jdSourceType, evidenceIndex, onEvent } = opts
  const emit = (event: Stage1PipelineEvent) => onEvent(event)

  emit({ type: 'progress', step: 'loadingProfileEvidence', status: 'in_progress' })
  const payload = buildStage1EvidencePayload(profile, evidenceIndex, opts.bridgeAnswers, opts.acceptedArtifacts)
  emit({ type: 'progress', step: 'loadingProfileEvidence', status: 'completed' })

  const companyIndustryBasis = extractCompanyIndustryBasisFromDomainIQText(domainIQText ?? '')
  const calibrationBrief = companyIndustryBasis ? buildCalibrationBrief(companyIndustryBasis) : undefined

  emit({ type: 'progress', step: 'buildingCandidateProfileMap', status: 'in_progress' })
  emit({ type: 'progress', step: 'analyzingJDRequirements', status: 'in_progress' })

  let profileMap: CandidateProfileMap
  let jdMapExtended: JDRequirementMapExtended
  ;[profileMap, jdMapExtended] = await Promise.all([
    runPassA(payload).catch(err => {
      emit({ type: 'progress', step: 'buildingCandidateProfileMap', status: 'failed', error: err.message })
      throw err
    }),
    runPassC(jdText, calibrationBrief).catch(err => {
      emit({ type: 'progress', step: 'analyzingJDRequirements', status: 'failed', error: err.message })
      throw err
    }),
  ])

  emit({ type: 'progress', step: 'buildingCandidateProfileMap', status: 'completed' })
  emit({ type: 'progress', step: 'analyzingJDRequirements', status: 'completed' })

  emit({ type: 'progress', step: 'validatingProfileClaims', status: 'in_progress' })
  let validatedClaims: ValidatedProfileClaims
  try {
    validatedClaims = await runPassB(profileMap, payload)
  } catch (err) {
    emit({ type: 'progress', step: 'validatingProfileClaims', status: 'failed', error: (err as Error).message })
    throw err
  }
  emit({ type: 'progress', step: 'validatingProfileClaims', status: 'completed' })

  emit({ type: 'progress', step: 'matchingProfileToJD', status: 'in_progress' })
  let matchMatrix: MatchMatrix
  try {
    matchMatrix = await runPassD(validatedClaims, jdMapExtended)
  } catch (err) {
    emit({ type: 'progress', step: 'matchingProfileToJD', status: 'failed', error: (err as Error).message })
    throw err
  }
  emit({ type: 'progress', step: 'matchingProfileToJD', status: 'completed' })

  emit({ type: 'progress', step: 'generatingGapFitAnalysis', status: 'in_progress' })
  let gapFitAnalysis: GapFitAnalysis
  try {
    gapFitAnalysis = await runPassE(matchMatrix, validatedClaims)
  } catch (err) {
    emit({ type: 'progress', step: 'generatingGapFitAnalysis', status: 'failed', error: (err as Error).message })
    throw err
  }
  emit({ type: 'progress', step: 'generatingGapFitAnalysis', status: 'completed' })

  emit({ type: 'progress', step: 'generatingBridgeQuestions', status: 'in_progress' })
  let bridgeQuestions: Stage2QuestionCandidate[]
  try {
    bridgeQuestions = await runPassF(gapFitAnalysis, validatedClaims)
  } catch (err) {
    emit({ type: 'progress', step: 'generatingBridgeQuestions', status: 'failed', error: (err as Error).message })
    throw err
  }
  emit({ type: 'progress', step: 'generatingBridgeQuestions', status: 'completed' })

  emit({ type: 'progress', step: 'savingResults', status: 'in_progress' })
  const result = await assembleStage1Result({
    profileMap, validatedClaims, jdMapExtended, matchMatrix, gapFitAnalysis, bridgeQuestions,
    jdText, domainIQText, profile, jdSourceType, evidenceIndex,
  })
  emit({ type: 'progress', step: 'savingResults', status: 'completed' })
  emit({ type: 'complete', result })
  return result
}
