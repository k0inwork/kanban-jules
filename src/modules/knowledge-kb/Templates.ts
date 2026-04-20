import { db } from '../../services/db';

const DEFAULT_TEMPLATES: Record<string, { title: string; content: string }> = {
  'template_design-spec.md': {
    title: 'template_design-spec.md',
    content: `# Design Spec: <Feature Name>

## Overview
Brief description of the feature and what problem it solves.

## Requirements
- Functional requirement 1
- Functional requirement 2

## Architecture
How this fits into the existing system. Key components and their interactions.

## API / Interface
Endpoints, props, function signatures, or data shapes involved.

## Implementation Steps
1. Step one
2. Step two

## Decisions
Key design decisions and rationale.

## Open Questions
Unresolved items that need input.
`,
  },
  'template_api-analysis.md': {
    title: 'template_api-analysis.md',
    content: `# API Analysis: <Scope>

## Scope
What API surface is being analyzed and why.

## Endpoints
| Method | Path | Purpose | Auth |
|--------|------|---------|------|
| GET | /example | Description | Yes/No |

## Data Models
Key types and their relationships.

## Dependencies
External services, libraries, or APIs consumed.

## Gaps & Risks
Missing coverage, potential failure modes, security concerns.
`,
  },
  'template_implementation-plan.md': {
    title: 'template_implementation-plan.md',
    content: `# Implementation Plan: <Feature>

## Goal
What we're building and the success criteria.

## Prerequisites
Existing code, dependencies, or setup needed before starting.

## Steps
1. **Step 1**: Description
   - Files to modify:
   - Expected output:
2. **Step 2**: Description
   - Files to modify:
   - Expected output:

## Testing Strategy
How to verify each step works correctly.

## Rollback Plan
How to revert if something goes wrong.
`,
  },
  'template_test-report.md': {
    title: 'template_test-report.md',
    content: `# Test Report: <Scope>

## Scope
What was tested and the test environment.

## Results Summary
| Suite | Total | Passed | Failed | Skipped |
|-------|-------|--------|--------|---------|

## Failures
Details on each failing test, root cause, and fix status.

## Coverage
Areas covered and gaps remaining.

## Recommendations
Next steps based on findings.
`,
  },
};

export async function seedTemplates(project: string = 'target'): Promise<number> {
  let created = 0;
  for (const [, tpl] of Object.entries(DEFAULT_TEMPLATES)) {
    const existing = await db.kbDocs
      .where('title').equals(tpl.title)
      .and(d => d.project === project && d.active)
      .first();

    if (!existing) {
      await db.kbDocs.add({
        timestamp: Date.now(),
        title: tpl.title,
        type: 'template',
        content: tpl.content,
        summary: `Default template for ${tpl.title.replace('template_', '').replace('.md', '')}`,
        tags: ['template', 'knowledge-base'],
        layer: ['L1'],
        source: 'system',
        active: true,
        version: 1,
        project,
      });
      created++;
    }
  }
  return created;
}
