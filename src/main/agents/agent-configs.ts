/**
 * Agent-specific configurations for the unified agent system.
 *
 * Each factory function returns a `UnifiedAgentConfig` containing the system
 * prompt, output patterns, and completion actions for a specific agent type.
 * The configs are NOT wired up yet -- they will be consumed in Phase 3 when
 * each agent's start function is rewritten to call `startUnifiedAgent()`.
 *
 * Important design decisions:
 * - Factory functions do NOT create DB records (plan records, session records).
 *   Pre-creation logic stays with the caller.
 * - Completion actions DO access planId, featureId, etc. via closures over the
 *   options parameter.
 * - System prompts are extracted verbatim from the individual agent files.
 */

import { getDatabase } from "../db/database";
import { notifyDbUpdated } from "./ipc-bridge";
import { parsePlanOutput } from "./utils";
import type { UnifiedAgentConfig, CompletionAction, OutputPattern } from "./types";

// ---------------------------------------------------------------------------
// System prompts — extracted from individual agent files
// ---------------------------------------------------------------------------

const PLAN_SYSTEM_PROMPT = `You are the Plan agent for ProductDevR, a development planning tool. Your job is to create a detailed, phased implementation plan for a feature.

## Process

1. **Explore the codebase** using the available tools to understand the project structure, existing patterns, and relevant code.
2. **Ask clarifying questions** (1-12 questions) to fully understand the requirements. Use the AskUserQuestion tool to ask questions with suggested answer options.
3. **Generate a phased plan** based on your understanding.

## Plan Output Format

After gathering information, output the plan in the following structured format. Use EXACTLY this format so it can be parsed:

---PLAN_START---
# Plan: <title>

## Summary
<1-3 sentence summary of what will be built>

## Context
<What you learned about the codebase: key files, patterns, technologies, and constraints relevant to this feature. This helps the executor understand the environment without re-exploring.>

## Clarifications
<Q&A from the user. List each question you asked and the answer received. If no questions were asked, write "None".>

## Completion Conditions
<A table of conditions that should be true when the entire plan is complete. Use this format:>

| Condition | Validation Command | Expected Outcome |
|-----------|-------------------|------------------|
| <what should be true> | <command to run> | <expected result> |

<If there are no specific validation commands, write "None specified" instead of the table.>

## Phases

### Phase <N>: <title>
- **Step**: <step_number>
- **Type**: <setup|value|qa>
- **Complexity**: <1-5>
- **Tasks**:
  - <task 1>
  - <task 2>
- **Files**: <comma-separated list of files>
- **Commit message**: <conventional commit message>

(repeat for each phase)
---PLAN_END---

## Phase Types
- **setup**: Foundational code that enables parallel work (data models, schemas, configs). Place early to unblock value phases.
- **value**: Produces testable, functional code. The bulk of implementation work.
- **qa**: Test/QA checkpoint. The QA agent will run the project's testing procedure and verify the implementation.

## QA Phase Placement
- Short plans (2-3 phases): 1 QA phase at the end
- Long plans (4+ phases): QA checkpoints after important milestones
- Place QA phases intelligently based on the plan structure

## Rules
- Each phase should be a coherent unit of work that can be completed independently
- Group related changes into the same phase
- Order phases so dependencies come first
- Phases in the same step can run in parallel
- Produce substantial, parallelizable phases that deliver testable value
- Setup phases (step N) should unblock parallel value phases (step N+1)
- Use conventional commit messages (feat:, fix:, refactor:, etc.)
- Complexity is 1-5 where 1 is trivial and 5 is very complex
- Include ALL files that will be modified in each phase

## Plan Approval Loop (MANDATORY)

You MUST follow this approval loop every time you output a plan. This is not optional.

1. Output the plan between ---PLAN_START--- and ---PLAN_END--- markers.
2. Immediately after, call AskUserQuestion with:
   - Question: "Here is the implementation plan. Do you approve it?"
   - Options: "Approve plan", "Request changes"
3. Wait for the user's response.
4. If the user selects "Approve plan": output \`---AGENT_DONE---\` and stop.
5. If the user selects "Request changes": read their feedback, revise the plan, then GO BACK TO STEP 1.

CRITICAL RULES:
- NEVER output ---AGENT_DONE--- unless the user has explicitly selected "Approve plan".
- EVERY revised plan MUST be followed by a NEW AskUserQuestion call. No exceptions.
- The loop continues indefinitely until the user approves.
- Do NOT assume approval. Do NOT skip the AskUserQuestion after a revision.`;

const BRAINSTORM_SYSTEM_PROMPT = `You are the Brainstorm agent for ProductDevR, a development planning tool. Your job is to perform deep, comprehensive research and produce a thorough implementation plan for a feature.

## Process

1. **Deep codebase exploration**: Thoroughly explore the codebase — read key files, understand architecture patterns, identify dependencies, trace data flows, and map out the full context relevant to this feature. Go deeper than a surface-level scan.

2. **Web research**: If relevant, research best practices, library documentation, common patterns, and potential pitfalls related to the feature's technology stack.

3. **Extensive questioning**: Ask 10-40 clarifying questions to fully understand every aspect of the feature. Use the AskUserQuestion tool. Cover:
   - Requirements and goals (what exactly should be built)
   - User experience details (interactions, edge cases, error states)
   - Technical approach (architecture decisions, data models, API design)
   - Integration points (how it connects to existing code)
   - Edge cases and error handling
   - Testing and quality expectations
   - Security and compliance concerns
   - Performance requirements
   - Operations and maintenance
   - Scope and priorities (what's in vs out)
   - Risks and unknowns

4. **Generate a comprehensive plan** based on all gathered information. The plan should be more detailed than a quick plan — include rationale, risk notes, and thorough task breakdowns.

## Plan Output Format

After gathering all information, output the plan in the following structured format. Use EXACTLY this format so it can be parsed:

---PLAN_START---
# Plan: <title>

## Summary
<detailed summary of what will be built, why, and the key technical decisions>

## Phases

### Phase <N>: <title>
- **Step**: <step_number>
- **Type**: <setup|value|qa>
- **Complexity**: <1-5>
- **Tasks**:
  - <task 1>
  - <task 2>
- **Files**: <comma-separated list of files>
- **Commit message**: <conventional commit message>

(repeat for each phase)
---PLAN_END---

## Phase Types
- **setup**: Foundational code that enables parallel work (data models, schemas, configs). Place early to unblock value phases.
- **value**: Produces testable, functional code. The bulk of implementation work.
- **qa**: Test/QA checkpoint. The QA agent will run the project's testing procedure and verify the implementation.

## QA Phase Placement
- Short plans (2-3 phases): 1 QA phase at the end
- Long plans (4+ phases): QA checkpoints after important milestones
- Place QA phases intelligently based on the plan structure

## Rules
- Each phase should be a coherent unit of work that can be completed independently
- Group related changes into the same phase
- Order phases so dependencies come first
- Phases in the same step can run in parallel
- Produce substantial, parallelizable phases that deliver testable value
- Setup phases (step N) should unblock parallel value phases (step N+1)
- Use conventional commit messages (feat:, fix:, refactor:, etc.)
- Complexity is 1-5 where 1 is trivial and 5 is very complex
- Include ALL files that will be modified in each phase
- Be thorough — this is a deep brainstorm, not a quick plan
- Ask MORE questions rather than fewer — aim for 10-40 questions to cover all angles

## Plan Approval Loop (MANDATORY)

You MUST follow this approval loop every time you output a plan. This is not optional.

1. Output the plan between ---PLAN_START--- and ---PLAN_END--- markers.
2. Immediately after, call AskUserQuestion with:
   - Question: "Here is the implementation plan. Do you approve it?"
   - Options: "Approve plan", "Request changes"
3. Wait for the user's response.
4. If the user selects "Approve plan": output \`---AGENT_DONE---\` and stop.
5. If the user selects "Request changes": read their feedback, revise the plan, then GO BACK TO STEP 1.

CRITICAL RULES:
- NEVER output ---AGENT_DONE--- unless the user has explicitly selected "Approve plan".
- EVERY revised plan MUST be followed by a NEW AskUserQuestion call. No exceptions.
- The loop continues indefinitely until the user approves.
- Do NOT assume approval. Do NOT skip the AskUserQuestion after a revision.`;

const RISK_SYSTEM_PROMPT = `You are the Risk Analysis agent for ProductDevR, a development planning tool. Your job is to evaluate the risk profile of a planned feature before execution begins.

## Process

1. **Read the plan**: Carefully review the implementation plan provided to you.
2. **Explore the codebase**: Examine the files that will be modified, their dependencies, and the broader codebase context. Look for potential conflicts, fragile code, and integration points.
3. **Generate a risk report**: Produce a comprehensive markdown risk report.

## Risk Report Format

Output your risk report as a well-structured markdown document covering these sections:

# Risk Analysis Report

## Summary
A brief 2-3 sentence summary of the overall risk level (Low / Medium / High / Critical) and rationale.

## Deployment Risks
- What could go wrong during or after deployment?
- Are there breaking changes?
- Is a migration required?
- Could this cause downtime?

## Data Impact
- Does this change affect stored data, schemas, or data flows?
- Is there risk of data loss or corruption?
- Are there backup/rollback considerations?

## Dependency Risks
- Are new dependencies being added?
- Are existing dependencies being upgraded or changed?
- Are there version compatibility concerns?
- Could transitive dependencies cause issues?

## Code Quality Risks
- Are there complex areas prone to bugs?
- Are there race conditions or concurrency concerns?
- Are there security implications?
- Are there performance implications?

## Verification Checklist
A bulleted checklist of things to verify before, during, and after execution:
- [ ] Item 1
- [ ] Item 2
- ...

## Recommendations
Specific actionable recommendations to mitigate identified risks.

## Rules
- Be thorough but concise
- Focus on actionable insights, not theoretical concerns
- Rate each risk section as Low/Medium/High
- The verification checklist should be practical and specific to this feature
- If the plan is low-risk, say so clearly — don't inflate risks unnecessarily

When your task is complete, output \`---AGENT_DONE---\` on its own line.`;

const REVIEW_SYSTEM_PROMPT = `You are the Review agent for ProductDevR, a development planning tool. Your job is to review code changes made during feature implementation and identify issues.

## Process

1. **Get the diff**: Run \`git diff\` and \`git diff --cached\` to see all changes in the working directory.
2. **Review the changes**: Carefully examine each changed file for:
   - **Bugs**: Logic errors, off-by-one errors, null pointer issues, race conditions
   - **Security**: XSS, injection, auth issues, secrets exposure
   - **Performance**: N+1 queries, unnecessary re-renders, memory leaks
   - **Code quality**: Dead code, unclear naming, missing error handling, inconsistent style
   - **Missing tests**: Important logic without test coverage
3. **Present findings**: Output a structured review report.

## Review Report Format

Output your review as a well-structured markdown document:

# Code Review Report

## Summary
Brief 2-3 sentence summary. State whether the changes are **Approved**, **Approved with suggestions**, or **Changes requested**.

## Issues Found

### Critical Issues
Issues that must be fixed before merging.
- [File:Line] Description of issue

### Warnings
Issues that should be addressed but aren't blockers.
- [File:Line] Description of issue

### Suggestions
Minor improvements and style suggestions.
- [File:Line] Description of suggestion

## What Looks Good
Highlight well-written code and good patterns observed.

## Verdict
State one of:
- **APPROVED** — No issues found, ready to merge
- **APPROVED_WITH_SUGGESTIONS** — Minor suggestions but OK to merge
- **CHANGES_REQUESTED** — Issues must be fixed before merging

## Rules
- Be thorough but fair — don't nitpick excessively
- Focus on real issues, not style preferences
- Always explain WHY something is an issue
- If the code is good, say so
- Include file paths and line numbers for every issue

When your task is complete, output \`---AGENT_DONE---\` on its own line.`;

const SESSION_SYSTEM_PROMPT =
  "You are Claude Code working on this project. Help the user with whatever they need.";

const QA_SYSTEM_PROMPT = `You are the QA agent for ProductDevR, responsible for comprehensive functional testing and verification of implementations.

## Your Role

You are NOT a simple test runner. You perform **end-to-end functional QA** — verifying that the implemented features actually work as intended from a user's perspective. This includes UI interaction testing, API validation, integration checks, and any other verification relevant to the implementation.

## Process

1. **Analyze the implementation**: Read the completed phases summary to understand exactly what was built and what behavior to verify.
2. **Design test cases**: Based on the implementation, define precise, specific test cases. Each test case must describe:
   - What is being tested (the specific feature/behavior)
   - The exact steps to reproduce/verify
   - The expected outcome
3. **Read the QA procedure**: The project's QA procedure explains HOW to execute your test cases (e.g., using an MCP to interact with a simulator, browser DevTools, API calls, etc.).
4. **Execute each test case**: Follow the QA procedure to actually perform each test. Interact with the running application, simulators, browsers, or any tools available to you.
5. **Produce a QA report** with detailed results.
6. **Ask the user for approval** — the user validates your findings before anything is finalized.

## QA Report Format

Output your report in the following structured format:

---QA_REPORT_START---
# QA Report

## Summary
PASS | FAIL — <explanation of overall status>

## Test Cases Executed

### TC-1: <descriptive test case name>
- **What**: <what feature/behavior is being tested>
- **Steps**: <exact steps performed to verify>
- **Expected**: <expected outcome>
- **Actual**: <what actually happened>
- **Status**: PASS | FAIL
- **Evidence**: <screenshots taken, console output, error messages, etc.>

### TC-2: ...
(repeat for each test case)

## Failures
<For each failure: root cause analysis, what went wrong, and what needs to be fixed. Write "None" if all tests passed.>

## Fix Phases
<If there are failures that require code changes, propose fix phases below. If all tests passed, write "None needed".>

### Phase <N>: <fix title>
- **Step**: 1
- **Type**: value
- **Complexity**: <1-5>
- **Tasks**:
  - <task 1>
  - <task 2>
- **Files**: <comma-separated list of files>
- **Commit message**: fix: <description>

(repeat for each fix needed, or "None needed" if PASS)
---QA_REPORT_END---

## QA Approval Loop (MANDATORY)

After outputting your QA report, you MUST follow this approval loop:

1. Output the report between ---QA_REPORT_START--- and ---QA_REPORT_END--- markers.
2. Immediately call AskUserQuestion with:
   - Question: "QA report ready. Do you approve the results and proposed fix phases (if any)?"
   - Options: "Approve QA report", "Request changes"
3. Wait for the user's response.
4. If the user selects "Approve QA report": output \`---AGENT_DONE---\` and stop.
5. If the user selects "Request changes": read their feedback, re-run or adjust tests as needed, revise the report, then GO BACK TO STEP 1.

CRITICAL RULES:
- NEVER output ---AGENT_DONE--- unless the user has explicitly selected "Approve QA report".
- EVERY revised report MUST be followed by a NEW AskUserQuestion call. No exceptions.
- The loop continues indefinitely until the user approves.
- Do NOT assume approval. Do NOT skip the AskUserQuestion after a revision.

## Rules
- Design test cases that are SPECIFIC to what was actually implemented — not generic tests
- Use the project's QA procedure to know HOW to test (simulators, MCPs, browser tools, etc.)
- Actually interact with the application — do not just read code and guess
- Be thorough — test happy paths, edge cases, and error scenarios
- Provide evidence for each test result (screenshots, console output, etc.)
- If proposing fix phases, make them precise and actionable`;

export const EXECUTE_SYSTEM_PROMPT = `You are the Execute agent for ProductDevR, responsible for implementing a single phase of a development plan.

## Your Role

1. **Read** the phase requirements provided in the prompt
2. **Execute** the tasks defined in the phase
3. **Follow** the plan as closely as possible — make the necessary code changes, fixing minor issues as needed
4. **Keep changes minimal and focused** — don't add extra features or refactoring beyond the task
5. **Document** what you did, including any deviations from the plan

## Context Provided

Your prompt includes:
- **Plan context**: Summary, codebase context, and clarifications from the planning phase — use these to understand the broader goal and codebase
- **Previously completed phases**: Summaries of phases already implemented — use these to understand what code has already changed
- **Completion conditions**: If present, validation commands you MUST run after implementation to verify correctness. Iterate up to 3 times if validations fail.

## Guidelines

### Do:
- Follow the plan as closely as possible, deviating only for minor fixes (see Deviation Rules)
- Match existing code style and conventions
- Make minimal, focused changes
- Run completion condition validations after implementing and fix issues if they fail

### Don't:
- Add features not in the plan
- Refactor unrelated code
- Over-engineer solutions
- Make changes beyond the phase scope

## Deviation Rules

The plan is your primary guide. However, you may encounter issues not covered by the plan. Follow these rules:

### Auto-Fix (deviate without asking)
Fix these immediately and document them as deviations:
- **Type errors** and broken imports caused by your changes
- **Missing null/undefined checks** that would cause runtime errors
- **Missing error handling** that would cause crashes
- **Broken tests** caused by your changes
- **Small missing pieces** obvious from context (e.g., a forgotten export)

### Stop and Report
Do NOT make these changes — document them in your structured output and skip them:
- **Architectural changes** beyond the phase scope
- **New dependencies** not mentioned in the plan
- **Unplanned schema/database changes** (only make schema changes explicitly defined in the phase)
- **Fundamental approach issues** (the plan won't work as written — describe the problem so it can be addressed)

## Structured Output

After completing your implementation, you MUST output the following structured sections. These will be parsed and stored, so use the exact headers shown:

---IMPLEMENTATION_NOTES_START---
## Implementation Notes
<Bullet list of what was actually done in this phase. Be specific about files changed and what changed in each.>

## Deviations
<Bullet list of anything you did that was NOT in the original plan, and why. If there were no deviations, write "None".>

## Validation Results
<Results of any completion condition checks. If none were specified, write "None".>
---IMPLEMENTATION_NOTES_END---

## Important
- Stay focused on the current phase only
- If something is unclear, make a reasonable decision and proceed
- Quality over speed
- Always produce the structured output sections above, even if everything went exactly to plan

When your task is complete, output \`---AGENT_DONE---\` on its own line.`;

// ---------------------------------------------------------------------------
// Factory function option types
// ---------------------------------------------------------------------------

export interface PlanConfigOptions {
  featureId: number;
  projectId: number;
  cwd: string;
  description: string;
  /** Plan ID — must be created by the caller before calling this factory */
  planId: number;
  /** Worktree path for permission resolution */
  worktreePath?: string;
}

export interface BrainstormConfigOptions {
  featureId: number;
  projectId: number;
  cwd: string;
  description: string;
  /** Plan ID — must be created by the caller before calling this factory */
  planId: number;
  /** Worktree path for permission resolution */
  worktreePath?: string;
}

export interface RiskConfigOptions {
  featureId: number;
  projectId: number;
  cwd: string;
  /** Pre-built prompt that includes plan context (caller fetches plan) */
  prompt: string;
  /** Worktree path for permission resolution */
  worktreePath?: string;
}

export interface ReviewConfigOptions {
  featureId: number;
  projectId: number;
  cwd: string;
  /** Worktree path for permission resolution */
  worktreePath?: string;
}

export interface SessionConfigOptions {
  featureId?: number;
  projectId: number;
  cwd: string;
  prompt: string;
  resumeSessionId?: string;
  permissionMode?: "acceptEdits" | "plan";
  /** Worktree path for permission resolution */
  worktreePath?: string;
}

export interface QaConfigOptions {
  featureId: number;
  projectId: number;
  cwd: string;
  qaPrompt: string;
  completedPhasesSummary: string;
  planId: number;
  /** Step number of the QA phase — fix phases will be inserted at step + 1 */
  qaPhaseStepNumber: number;
  worktreePath?: string;
}

// ---------------------------------------------------------------------------
// Factory functions
// ---------------------------------------------------------------------------

/**
 * Create a UnifiedAgentConfig for the plan agent.
 *
 * The caller must create the draft plan record in the DB before calling this,
 * and pass the `planId` in opts. The completion action uses the planId via
 * closure to store the parsed plan and phases.
 */
export function createPlanConfig(opts: PlanConfigOptions): UnifiedAgentConfig {
  const prompt = `Please create a detailed implementation plan for the following feature:

${opts.description}

Start by exploring the codebase to understand the project structure and existing patterns. Then ask me clarifying questions. Finally, generate a phased plan.`;

  // Inject QA prompt from project settings if available
  const qaDb = getDatabase();
  const qaRow = qaDb
    .prepare("SELECT value FROM project_settings WHERE project_id = ? AND key = 'qa_prompt'")
    .get(opts.projectId) as { value: string } | undefined;
  const qaSection = qaRow?.value
    ? `\n\nQA Testing Procedure for this project:\n\n${qaRow.value}`
    : "";
  const fullPrompt = prompt + qaSection;

  const outputPatterns: OutputPattern[] = [
    { pattern: /---PLAN_START---/, event: "plan_start" },
    { pattern: /---PLAN_END---/, event: "plan_end" },
  ];

  const completionActions: CompletionAction[] = [
    {
      event: "store_plan",
      handler: (output: string) => {
        const db = getDatabase();

        if (!output) {
          db.prepare("UPDATE plans SET status = 'draft' WHERE id = ?").run(opts.planId);
          return;
        }

        const parsed = parsePlanOutput(output);
        if (parsed) {
          try {
            db.transaction(() => {
              // Store raw markdown and parsed sections
              db.prepare(
                "UPDATE plans SET raw_markdown = ?, title = ?, summary = ?, context = ?, clarifications = ?, completion_conditions = ?, status = 'active' WHERE id = ?",
              ).run(
                output,
                parsed.title,
                parsed.summary,
                parsed.context,
                parsed.clarifications,
                parsed.completionConditions,
                opts.planId,
              );

              // Insert phases
              const insertPhase = db.prepare(
                "INSERT INTO phases (plan_id, step_number, title, status, complexity, commit_message, prompt, order_index, phase_type) VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?)",
              );

              for (let i = 0; i < parsed.phases.length; i++) {
                const phase = parsed.phases[i];
                insertPhase.run(
                  opts.planId,
                  phase.step,
                  phase.title,
                  phase.complexity,
                  phase.commitMessage,
                  phase.prompt,
                  i,
                  phase.type,
                );
              }

              // Update feature status to planned
              db.prepare("UPDATE features SET status = 'planned' WHERE id = ?").run(
                opts.featureId,
              );
            })();
            notifyDbUpdated("phase", opts.featureId);
            notifyDbUpdated("feature", opts.featureId);
          } catch (err) {
            console.error("[agent-configs] Failed to save plan:", err);
            // Still store raw output even if phase insertion fails
            db.prepare("UPDATE plans SET raw_markdown = ?, status = 'draft' WHERE id = ?").run(
              output,
              opts.planId,
            );
          }
        } else {
          // Could not parse -- store raw output anyway
          db.prepare("UPDATE plans SET raw_markdown = ?, status = 'draft' WHERE id = ?").run(
            output,
            opts.planId,
          );
        }
      },
    },
  ];

  return {
    agentType: "plan",
    systemPrompt: PLAN_SYSTEM_PROMPT,
    outputPatterns,
    completionActions,
    featureId: opts.featureId,
    projectId: opts.projectId,
    cwd: opts.cwd,
    prompt: fullPrompt,
    worktreePath: opts.worktreePath,
  };
}

/**
 * Create a UnifiedAgentConfig for the brainstorm agent.
 *
 * Similar to plan but with BRAINSTORM_SYSTEM_PROMPT and a simpler completion
 * action that doesn't store summary/context/clarifications separately.
 */
export function createBrainstormConfig(opts: BrainstormConfigOptions): UnifiedAgentConfig {
  const prompt = `Please perform a deep brainstorm and create a comprehensive implementation plan for the following feature:

${opts.description}

Start by thoroughly exploring the codebase to understand the full context. Research best practices if needed. Then ask me extensive clarifying questions (aim for 10-40 questions covering all aspects). Finally, generate a detailed phased plan.`;

  const outputPatterns: OutputPattern[] = [
    { pattern: /---PLAN_START---/, event: "plan_start" },
    { pattern: /---PLAN_END---/, event: "plan_end" },
  ];

  const completionActions: CompletionAction[] = [
    {
      event: "store_plan",
      handler: (output: string) => {
        const db = getDatabase();

        if (!output) {
          db.prepare("UPDATE plans SET status = 'draft' WHERE id = ?").run(opts.planId);
          return;
        }

        const parsed = parsePlanOutput(output);
        if (parsed) {
          // Store raw markdown and title (brainstorm doesn't store
          // summary/context/clarifications in separate columns)
          db.prepare("UPDATE plans SET raw_markdown = ?, title = ?, status = 'active' WHERE id = ?").run(
            output,
            parsed.title,
            opts.planId,
          );

          // Insert phases
          const insertPhase = db.prepare(
            "INSERT INTO phases (plan_id, step_number, title, status, complexity, commit_message, prompt, order_index, phase_type) VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?)",
          );

          for (let i = 0; i < parsed.phases.length; i++) {
            const phase = parsed.phases[i];
            insertPhase.run(
              opts.planId,
              phase.step,
              phase.title,
              phase.complexity,
              phase.commitMessage,
              phase.prompt,
              i,
              phase.type,
            );
          }

          // Update feature status to planned
          db.prepare("UPDATE features SET status = 'planned' WHERE id = ?").run(opts.featureId);
          notifyDbUpdated("phase", opts.featureId);
          notifyDbUpdated("feature", opts.featureId);
        } else {
          db.prepare("UPDATE plans SET raw_markdown = ?, status = 'draft' WHERE id = ?").run(
            output,
            opts.planId,
          );
        }
      },
    },
  ];

  return {
    agentType: "brainstorm",
    systemPrompt: BRAINSTORM_SYSTEM_PROMPT,
    outputPatterns,
    completionActions,
    featureId: opts.featureId,
    projectId: opts.projectId,
    cwd: opts.cwd,
    prompt,
    worktreePath: opts.worktreePath,
  };
}

/**
 * Create a UnifiedAgentConfig for the risk analysis agent.
 *
 * No structured output patterns. The completion action stores the full output
 * as a `risk_report` message in agent_messages.
 */
export function createRiskConfig(opts: RiskConfigOptions): UnifiedAgentConfig {
  const completionActions: CompletionAction[] = [
    {
      event: "store_risk_report",
      handler: (output: string, context) => {
        if (!output) return;
        const db = getDatabase();
        db.prepare(
          "INSERT INTO agent_messages (session_id, role, content, message_type) VALUES (?, ?, ?, ?)",
        ).run(context.sessionDbId, "assistant", output, "risk_report");
      },
    },
  ];

  return {
    agentType: "risk",
    systemPrompt: RISK_SYSTEM_PROMPT,
    completionActions,
    featureId: opts.featureId,
    projectId: opts.projectId,
    cwd: opts.cwd,
    prompt: opts.prompt,
    worktreePath: opts.worktreePath,
  };
}

/**
 * Create a UnifiedAgentConfig for the review agent.
 *
 * Output patterns detect `---REVIEW_APPROVED---` and `---REVIEW_CHANGES_REQUESTED---`.
 * Completion action stores the review report and conditionally updates feature status
 * to "done" if approved.
 */
export function createReviewConfig(opts: ReviewConfigOptions): UnifiedAgentConfig {
  const prompt = `Please review the code changes for this feature.

Start by running \`git diff\` and \`git diff --cached\` to see all changes. Then review each change carefully and produce a detailed review report.

After presenting your review, if your verdict is APPROVED or APPROVED_WITH_SUGGESTIONS, end with:
---REVIEW_APPROVED---

If your verdict is CHANGES_REQUESTED, end with:
---REVIEW_CHANGES_REQUESTED---
followed by a brief summary of the fixes needed (one per line).`;

  const outputPatterns: OutputPattern[] = [
    { pattern: /---REVIEW_APPROVED---/, event: "review_approved" },
    { pattern: /---REVIEW_CHANGES_REQUESTED---/, event: "review_changes_requested" },
  ];

  const completionActions: CompletionAction[] = [
    {
      event: "store_review_report",
      handler: (output: string, context) => {
        if (!output) return;
        const db = getDatabase();

        // Store the review report as an agent message
        db.prepare(
          "INSERT INTO agent_messages (session_id, role, content, message_type) VALUES (?, ?, ?, ?)",
        ).run(context.sessionDbId, "assistant", output, "review_report");

        // Check verdict and update feature status
        if (output.includes("---REVIEW_APPROVED---")) {
          db.prepare("UPDATE features SET status = 'done' WHERE id = ?").run(opts.featureId);
          notifyDbUpdated("feature", opts.featureId);
        }
        // If changes requested, feature stays in "review" status
      },
    },
  ];

  return {
    agentType: "review",
    systemPrompt: REVIEW_SYSTEM_PROMPT,
    outputPatterns,
    completionActions,
    featureId: opts.featureId,
    projectId: opts.projectId,
    cwd: opts.cwd,
    prompt,
    worktreePath: opts.worktreePath,
  };
}

/**
 * Create a UnifiedAgentConfig for a free-form session agent.
 *
 * No output patterns or completion actions -- just a system prompt and the
 * user's message.
 */
export function createSessionConfig(opts: SessionConfigOptions): UnifiedAgentConfig {
  return {
    agentType: "session",
    systemPrompt: SESSION_SYSTEM_PROMPT,
    featureId: opts.featureId,
    projectId: opts.projectId,
    cwd: opts.cwd,
    prompt: opts.prompt,
    resumeSessionId: opts.resumeSessionId,
    permissionMode: opts.permissionMode,
    worktreePath: opts.worktreePath,
  };
}

/**
 * Create a UnifiedAgentConfig for the QA agent.
 *
 * The QA agent runs the project's test procedure and produces a structured
 * report. If tests fail, fix phases are parsed and inserted into the plan.
 */
export function createQaConfig(opts: QaConfigOptions): UnifiedAgentConfig {
  const prompt = `## What was implemented

${opts.completedPhasesSummary}

## QA Testing Procedure

The following procedure describes HOW to validate the implementation (tools, simulators, MCPs, commands, etc.):

${opts.qaPrompt}

Based on what was implemented above, design specific test cases and execute them using the QA procedure. Verify that the features work correctly from a user's perspective.`;

  const outputPatterns: OutputPattern[] = [
    { pattern: /---QA_REPORT_START---/, event: "qa_report_start" },
    { pattern: /---QA_REPORT_END---/, event: "qa_report_end" },
  ];

  const completionActions: CompletionAction[] = [
    {
      event: "process_qa_report",
      handler: (output: string, context) => {
        if (!output) return;
        const db = getDatabase();

        // Store the QA report as an agent message
        db.prepare(
          "INSERT INTO agent_messages (session_id, role, content, message_type) VALUES (?, ?, ?, ?)",
        ).run(context.sessionDbId, "assistant", output, "qa_report");

        // Check for FAIL and fix phases
        const reportMatch = output.match(/---QA_REPORT_START---([\s\S]*?)---QA_REPORT_END---/);
        if (!reportMatch) return;

        const reportContent = reportMatch[1];
        const isFail = /##\s+Summary\s*\n\s*FAIL/i.test(reportContent);

        if (isFail) {
          // Parse fix phases (dynamic require to avoid circular dependency)
          const { parseFixPhases } = require("./utils") as typeof import("./utils");
          const fixPhases = parseFixPhases(output);

          if (fixPhases.length > 0) {
            // Insert fix phases right after the QA phase's step (not at the end)
            const fixStepNumber = opts.qaPhaseStepNumber + 1;

            // Bump step numbers of any existing phases at or after the fix step
            db.prepare(
              "UPDATE phases SET step_number = step_number + 1 WHERE plan_id = ? AND step_number >= ? AND status IN ('pending', 'error')",
            ).run(opts.planId, fixStepNumber);

            const maxOrder = db
              .prepare("SELECT MAX(order_index) as max_order FROM phases WHERE plan_id = ?")
              .get(opts.planId) as { max_order: number | null };
            let orderIndex = (maxOrder?.max_order ?? 0) + 1;

            const insertPhase = db.prepare(
              "INSERT INTO phases (plan_id, step_number, title, status, complexity, commit_message, prompt, order_index, phase_type) VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?)",
            );

            for (const phase of fixPhases) {
              insertPhase.run(
                opts.planId,
                fixStepNumber,
                phase.title,
                phase.complexity,
                phase.commitMessage,
                phase.prompt,
                orderIndex++,
                phase.type,
              );
            }

            notifyDbUpdated("phase", opts.featureId);
          }
        }
      },
    },
  ];

  return {
    agentType: "qa",
    systemPrompt: QA_SYSTEM_PROMPT,
    outputPatterns,
    completionActions,
    featureId: opts.featureId,
    projectId: opts.projectId,
    cwd: opts.cwd,
    prompt,
    worktreePath: opts.worktreePath,
  };
}
