export const CONSTITUTION_TEMPLATES: Record<string, { label: string; text: string }> = {
  research: {
    label: 'Research',
    text: `## Objective
Explore the codebase, understand architecture, document findings.

## Rules
- Read-only: no code modifications
- Document all findings as artifacts
- Generate a research report artifact before closing

## Gates
- Research report: draft → in_review → approved

## Constraints
- No branching — all work on main
- All output goes to artifact documents, not code files`,
  },
  mvp: {
    label: 'MVP',
    text: `## Objective
Build the minimum viable product. Ship fast, iterate.

## Rules
- All changes via branches (task/{taskId})
- Tests encouraged but not required for initial implementation
- Prefer working code over perfect code

## Gates
- Feature spec: draft → approved
- Implementation: verified by manual review

## Constraints
- No refactoring unless directly related to the feature
- No documentation generation unless requested`,
  },
  testing: {
    label: 'Testing',
    text: `## Objective
Comprehensive test coverage. All existing features must be tested.

## Rules
- Every PR must include tests for changed code
- No merge without passing test suite
- Integration tests over unit tests where possible
- Test files must follow existing naming conventions

## Gates
- Test plan: draft → approved
- Test implementation: all tests passing
- Coverage report: generated and reviewed

## Constraints
- No code changes outside test files unless fixing a bug found during testing
- No skipping failing tests — fix or flag`,
  },
  production: {
    label: 'Production',
    text: `## Objective
Hardening for production deployment. Strict quality gates.

## Rules
- All changes via PR with review
- Every change must have tests
- No direct pushes to main
- All CI checks must pass

## Gates
- Design doc: draft → in_review → approved
- Implementation: tests pass, code reviewed
- Deployment checklist: verified

## Constraints
- No breaking changes without migration path
- No undocumented behavior changes
- All errors must be handled, no bare catches`,
  },
  blank: {
    label: 'Blank',
    text: '',
  },
};

export const TEMPLATE_KEYS = Object.keys(CONSTITUTION_TEMPLATES);
