import { anthropic, MODEL } from './client'
import type { UserProfile, WorkEntry, EducationEntry } from '@/contracts'
import { nanoid } from '@/lib/storage/nanoid'
import { migrateToSkillGroups } from '@/lib/skills/classify'

const TOOL_SCHEMA = {
  name: 'extract_resume_profile',
  description: 'Extract structured profile data from a resume.',
  input_schema: {
    type: 'object' as const,
    required: ['fullName', 'email', 'phone', 'location', 'linkedIn', 'summary', 'skills', 'workHistory', 'education', 'certifications'],
    properties: {
      fullName: { type: 'string' },
      email: { type: 'string' },
      phone: { type: 'string' },
      location: { type: 'string' },
      linkedIn: { type: 'string' },
      summary: { type: 'string' },
      skills: { type: 'array', items: { type: 'string' } },
      certifications: { type: 'array', items: { type: 'string' } },
      workHistory: {
        type: 'array',
        items: {
          type: 'object',
          required: ['company', 'title', 'startDate', 'endDate', 'domain', 'skills', 'bullets'],
          properties: {
            company: { type: 'string' },
            title: { type: 'string' },
            startDate: { type: 'string' },
            endDate: { type: 'string' },
            domain: { type: 'string' },
            skills: { type: 'array', items: { type: 'string' } },
            bullets: { type: 'array', items: { type: 'string' } },
            approvedMetrics: { type: 'array', items: { type: 'string' } }
          }
        }
      },
      education: {
        type: 'array',
        items: {
          type: 'object',
          required: ['institution', 'degree', 'field', 'graduationYear'],
          properties: {
            institution: { type: 'string' },
            degree: { type: 'string' },
            field: { type: 'string' },
            graduationYear: { type: 'string' }
          }
        }
      }
    }
  }
}

interface RawExtracted {
  fullName: string
  email: string
  phone: string
  location: string
  linkedIn: string
  summary: string
  skills: string[]
  certifications: string[]
  workHistory: Array<{
    company: string; title: string; startDate: string; endDate: string
    domain: string; skills: string[]; bullets: string[]; approvedMetrics?: string[]
  }>
  education: Array<{
    institution: string; degree: string; field: string; graduationYear: string
  }>
}

export async function parseResumeText(resumeText: string): Promise<Omit<UserProfile, 'id' | 'updatedAt' | 'constraints' | 'rejectedPhrases'>> {
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4096,
    tools: [TOOL_SCHEMA],
    tool_choice: { type: 'tool', name: 'extract_resume_profile' },
    system: `You extract structured profile data from resume text.

Rules:
- Extract exactly what is written. Do not add, embellish, or infer experience not stated.
- bullets: copy resume bullets verbatim — do not rewrite them.
- approvedMetrics: extract specific numeric claims from the bullets (e.g. "40% reduction in deploy time", "managed team of 12"). Leave empty if none present.
- domain: infer the primary industry/domain for that role from the company and bullets (e.g. "fintech", "healthcare IT", "e-commerce").
- skills: extract the full skills section. Also infer skills mentioned only in bullets if clearly stated as a skill.
- startDate/endDate: preserve the format from the resume (e.g. "Jan 2021", "2019", "Present").
- If a field is not present in the resume, return an empty string or empty array.`,
    messages: [{ role: 'user', content: `Resume text:\n\n${resumeText}` }]
  })

  const toolUse = response.content.find(b => b.type === 'tool_use')
  if (!toolUse || toolUse.type !== 'tool_use') {
    throw new Error('Resume parser: no tool_use response from model')
  }

  return buildProfile(toolUse.input as RawExtracted)
}

export async function parseResumePDF(pdfBuffer: Buffer): Promise<Omit<UserProfile, 'id' | 'updatedAt' | 'constraints' | 'rejectedPhrases'>> {
  const base64 = pdfBuffer.toString('base64')

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4096,
    tools: [TOOL_SCHEMA],
    tool_choice: { type: 'tool', name: 'extract_resume_profile' },
    system: `You extract structured profile data from a resume PDF.

Rules:
- Extract exactly what is written. Do not add, embellish, or infer experience not stated.
- bullets: copy resume bullets verbatim — do not rewrite them.
- approvedMetrics: extract specific numeric claims from the bullets. Leave empty if none present.
- domain: infer the primary industry/domain for that role.
- skills: extract the full skills section plus skills explicitly mentioned in bullets.
- startDate/endDate: preserve the format from the resume.
- If a field is not present, return an empty string or empty array.`,
    messages: [{
      role: 'user',
      content: [{
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: base64 }
      }]
    }]
  })

  const toolUse = response.content.find(b => b.type === 'tool_use')
  if (!toolUse || toolUse.type !== 'tool_use') {
    throw new Error('Resume PDF parser: no tool_use response from model')
  }

  return buildProfile(toolUse.input as RawExtracted)
}

type ParsedProfile = Omit<UserProfile, 'id' | 'updatedAt' | 'constraints' | 'rejectedPhrases'>

function buildProfile(raw: RawExtracted): ParsedProfile {
  const skillGroups = migrateToSkillGroups(raw.skills)
  return {
    fullName: raw.fullName,
    email: raw.email,
    phone: raw.phone,
    location: raw.location,
    linkedIn: raw.linkedIn,
    summary: raw.summary,
    skills: raw.skills,
    skillGroups,
    certifications: raw.certifications,
    workHistory: raw.workHistory.map(w => ({
      id: nanoid(),
      company: w.company,
      title: w.title,
      startDate: w.startDate,
      endDate: w.endDate,
      domain: w.domain,
      skills: w.skills,
      bullets: w.bullets,
      approvedMetrics: w.approvedMetrics ?? []
    })) satisfies WorkEntry[],
    education: raw.education.map(e => ({
      id: nanoid(),
      institution: e.institution,
      degree: e.degree,
      field: e.field,
      graduationYear: e.graduationYear
    })) satisfies EducationEntry[]
  }
}
