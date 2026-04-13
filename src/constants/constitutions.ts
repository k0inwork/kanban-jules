export const CONSTITUTION_TEMPLATES = {
  default: `# Project Constitution: General Development

## Project Stages & Artifacts
- **Discovery**: Research Notes, Feasibility Study
- **Design**: Design Spec, Architecture Diagram
- **Implementation**: Code Analysis, Implementation Notes
- **Testing**: Test Plan, Test Results
- **Deployment**: Deployment Log, Release Notes

## Rules
1. Focus on clear, modular code.
2. Every significant finding should be saved as an artifact.
3. Propose follow-up tasks for implementation after research or design.
4. Ensure all tasks have clear descriptions.`,

  gowaforth: `# Project Constitution: Gowaforth

## Project Scope
The project is a Go-to-Forth transpiler and multitasking environment (WaForth via F-on-F Threading).
We do NOT need to build a Forth VM from scratch; we use an existing one (WaForth) for examples and execution.

## Project Stages & Artifacts
- **Stage 1: Foundation & Test Harness**: Browser-based Wasm Loader, Web Worker Infrastructure, Headless Test Suite
- **Stage 2: Minimal Transpiler**: Go-to-Forth Transpiler, Wasm Library Integration
- **Stage 3: Ecosystem Expansion**: GitHub-based Builder, Performance Optimization, Advanced Tooling

## Artifact-Driven Workflow Rules
1. **The Spec Gate**: Before implementing any feature, a Specification Artifact must exist (e.g., \`spec_wasm_loader.md\`). Use \`listArtifacts\` to check.
2. **The Test Gate**: If a Spec exists but no implementation/test exists, propose an implementation task that includes writing tests.
3. **The Architecture Gate**: For major changes, an Architecture Artifact must exist.`,

  research: `# Project Constitution: Research & Discovery

## Project Stages & Artifacts
- **Exploration**: Literature Review, Competitive Analysis
- **Prototyping**: Proof of Concept, Benchmarks
- **Validation**: User Feedback, Feasibility Report

## Rules
1. Prioritize exploration and documentation of findings.
2. Create detailed artifacts for every research step.
3. Propose new research directions based on current discoveries.
4. Do not focus on implementation yet; focus on feasibility and design.`,

  develop: `# Project Constitution: Feature Development

## Project Stages & Artifacts
- **Planning**: User Stories, Task Breakdown
- **Coding**: Code Review, API Documentation
- **Integration**: Integration Test Results, Build Logs

## Rules
1. Focus on implementing features defined in the backlog.
2. Every feature should have a corresponding test task.
3. Propose refactoring tasks if technical debt is identified.
4. Ensure artifacts include code snippets and implementation notes.`,

  mvp: `# Project Constitution: MVP (Minimum Viable Product)

## Project Stages & Artifacts
- **Core Definition**: Feature List, User Flow
- **Rapid Build**: MVP Implementation Notes
- **Launch Prep**: Basic Smoke Test Results

## Rules
1. Focus only on core functionality.
2. Defer non-essential features to later phases.
3. Propose tasks that directly contribute to the product launch.
4. Keep artifacts concise and focused on the "Happy Path".`,

  acceptance: `# Project Constitution: Acceptance Testing & QA

## Project Stages & Artifacts
- **Test Definition**: Acceptance Criteria, Test Suite
- **Execution**: Bug Reports, Regression Results
- **Sign-off**: Final QA Report, UAT Feedback

## Rules
1. Focus on verifying existing features against requirements.
2. Propose "Bug Fix" tasks for every failed test case.
3. Create detailed "Test Report" artifacts.
4. Ensure all "Done" tasks have been verified by a test task.`
};
