import { z } from "zod";
import { Effect } from "effect";
import { router, publicProcedure } from "./trpc";
import { queryOne, queryAll } from "../db/query";
import type { ProjectRow } from "../db/types";
import {
  startPlanAgent,
  startPrdAgent,
  startRefinePlanAgent,
  startRiskAgent,
  startReviewAgent,
  startSessionAgent,
  startQaAgent,
  startReviewFixerAgent,
  startRetroAgent,
} from "../agents/agent-starters";
import { processNextPhase } from "../agents/execute-agent";
import { autoNameFeature, runAutoNameBlocking } from "../agents/auto-name";
import { resolveAgentCwd } from "../agents/resolve-cwd";
import { setupWorktreeForFeatureEffect } from "../effect/services/GitWorktree";
import { AppRuntime } from "../effect/runtime";
import { hasDefaultTitle } from "./shared";
import type { MessageContent } from "../agents/types";

function buildDescription(text: string, images?: { base64: string; mimeType: string }[]): MessageContent {
  if (images && images.length > 0) {
    return [
      { type: "text" as const, text },
      ...images.map((img) => ({
        type: "image" as const,
        source: { type: "base64" as const, media_type: img.mimeType, data: img.base64 },
      })),
    ];
  }
  return text;
}

export const workflowRouter = router({
  /** Start the plan agent for a feature */
  startPlan: publicProcedure
    .input(z.object({
      featureId: z.number(),
      projectId: z.number(),
      description: z.string(),
      images: z.array(z.object({ base64: z.string(), mimeType: z.string() })).optional(),
    }))
    .mutation(async ({ input }) => {
      const { cwd, worktreePath } = await AppRuntime.runPromise(resolveAgentCwd(input.featureId, input.projectId));
      const description = buildDescription(input.description, input.images);
      return startPlanAgent({ featureId: input.featureId, projectId: input.projectId, description, cwd, worktreePath });
    }),

  /** Start the PRD agent for a feature */
  startPrd: publicProcedure
    .input(z.object({
      featureId: z.number(),
      projectId: z.number(),
      description: z.string(),
      images: z.array(z.object({ base64: z.string(), mimeType: z.string() })).optional(),
    }))
    .mutation(async ({ input }) => {
      const { cwd, worktreePath } = await AppRuntime.runPromise(resolveAgentCwd(input.featureId, input.projectId));
      const description = buildDescription(input.description, input.images);
      return startPrdAgent({ featureId: input.featureId, projectId: input.projectId, description, cwd, worktreePath });
    }),

  /** Continue a paused workflow — triggers processNextPhase */
  continueWorkflow: publicProcedure
    .input(z.object({ featureId: z.number(), projectId: z.number() }))
    .mutation(async ({ input }) => {
      const { cwd, worktreePath } = await AppRuntime.runPromise(resolveAgentCwd(input.featureId, input.projectId));
      processNextPhase({ featureId: input.featureId, projectId: input.projectId, cwd, worktreePath });
      return { success: true };
    }),

  /** Refine an existing plan — start a plan agent that appends new phases */
  startRefinePlan: publicProcedure
    .input(z.object({
      featureId: z.number(),
      projectId: z.number(),
      description: z.string(),
      images: z.array(z.object({ base64: z.string(), mimeType: z.string() })).optional(),
    }))
    .mutation(async ({ input }) => {
      const { cwd, worktreePath } = await AppRuntime.runPromise(resolveAgentCwd(input.featureId, input.projectId));
      const description = buildDescription(input.description, input.images);
      return startRefinePlanAgent({ featureId: input.featureId, projectId: input.projectId, description, cwd, worktreePath });
    }),

  /** Start the execute agent for a feature (runs plan phases) */
  startExecute: publicProcedure
    .input(z.object({ featureId: z.number(), projectId: z.number() }))
    .mutation(async ({ input }) => {
      const { cwd, worktreePath } = await AppRuntime.runPromise(resolveAgentCwd(input.featureId, input.projectId));
      processNextPhase({ featureId: input.featureId, projectId: input.projectId, cwd, worktreePath });
      return { success: true };
    }),

  /** Continue execute phases (Level 2 autonomy — user clicks "continue") */
  continueExecute: publicProcedure
    .input(z.object({ featureId: z.number(), projectId: z.number() }))
    .mutation(async ({ input }) => {
      const { cwd, worktreePath } = await AppRuntime.runPromise(resolveAgentCwd(input.featureId, input.projectId));
      processNextPhase({ featureId: input.featureId, projectId: input.projectId, cwd, worktreePath });
      return { success: true };
    }),

  /** Start the risk analysis agent for a feature */
  startRisk: publicProcedure
    .input(z.object({ featureId: z.number(), projectId: z.number() }))
    .mutation(async ({ input }) => {
      const { cwd, worktreePath } = await AppRuntime.runPromise(resolveAgentCwd(input.featureId, input.projectId));
      return startRiskAgent({ ...input, cwd, worktreePath });
    }),

  /** Start the review agent for a feature */
  startReview: publicProcedure
    .input(z.object({ featureId: z.number(), projectId: z.number() }))
    .mutation(async ({ input }) => {
      const { cwd, worktreePath } = await AppRuntime.runPromise(resolveAgentCwd(input.featureId, input.projectId));
      return startReviewAgent({ ...input, cwd, worktreePath });
    }),

  /** Start the retro agent for a feature */
  startRetro: publicProcedure
    .input(z.object({ featureId: z.number(), projectId: z.number() }))
    .mutation(async ({ input }) => {
      const { cwd, worktreePath } = await AppRuntime.runPromise(resolveAgentCwd(input.featureId, input.projectId));
      return startRetroAgent({ ...input, cwd, worktreePath });
    }),

  /** Start the QA agent for a feature */
  startQa: publicProcedure
    .input(z.object({ featureId: z.number(), projectId: z.number() }))
    .mutation(async ({ input }) => {
      const { cwd, worktreePath } = await AppRuntime.runPromise(resolveAgentCwd(input.featureId, input.projectId));
      return startQaAgent({ ...input, cwd, worktreePath });
    }),

  /** Start the review-fixer agent to address diff comments */
  startReviewFixer: publicProcedure
    .input(z.object({ featureId: z.number(), projectId: z.number(), prompt: z.string() }))
    .mutation(async ({ input }) => {
      const { cwd, worktreePath } = await AppRuntime.runPromise(resolveAgentCwd(input.featureId, input.projectId));

      // Build rich prompt with feature context (same as workflow session)
      const { feature, plan, phases } = await AppRuntime.runPromise(
        Effect.gen(function* () {
          const feature = yield* queryOne<{ title: string }>(
            "SELECT title FROM features WHERE id = ?",
            input.featureId,
          );
          const plan = yield* queryOne<{ id: number; summary: string | null; context: string | null }>(
            "SELECT id, summary, context FROM plans WHERE feature_id = ? ORDER BY id DESC LIMIT 1",
            input.featureId,
          );
          const phases = plan
            ? yield* queryAll<{ title: string; status: string; step_number: number }>(
                "SELECT title, status, step_number FROM phases WHERE plan_id = ? ORDER BY step_number, order_index",
                plan.id,
              )
            : [];
          return { feature, plan, phases };
        }),
      );

      const parts: string[] = [];
      if (feature) parts.push(`## Feature: ${feature.title}`);
      if (plan?.summary) parts.push(`**Summary:** ${plan.summary}`);
      if (plan?.context) parts.push(`**Context:** ${plan.context}`);
      if (phases.length > 0) {
        const phaseList = phases.map((p) => `${p.step_number}. ${p.title} — ${p.status}`).join("\n");
        parts.push(`**Phases:**\n${phaseList}`);
      }
      parts.push("---", `## Diff Comments to Address\n\n${input.prompt}`);

      const prompt = parts.join("\n\n");
      return startReviewFixerAgent({ ...input, prompt, cwd, worktreePath });
    }),

  /** Start a session agent within a feature workflow (uses worktree). */
  startWorkflowSession: publicProcedure
    .input(
      z.object({
        featureId: z.number(),
        projectId: z.number(),
        prompt: z.string(),
      }),
    )
    .mutation(async ({ input }) => {
      const { cwd, worktreePath } = await AppRuntime.runPromise(resolveAgentCwd(input.featureId, input.projectId));

      const { feature, plan } = await AppRuntime.runPromise(
        Effect.gen(function* () {
          const feature = yield* queryOne<{ title: string }>(
            "SELECT title FROM features WHERE id = ?",
            input.featureId,
          );
          if (!feature) return yield* Effect.fail(new Error("Feature not found"));
          const plan = yield* queryOne<{ id: number }>(
            "SELECT id FROM plans WHERE feature_id = ? ORDER BY id DESC LIMIT 1",
            input.featureId,
          );
          if (!plan) return yield* Effect.fail(new Error("No plan found for this feature — workflow sessions require a plan"));
          return { feature, plan };
        }),
      );

      const prompt = `Context: you're building "${feature.title}" (plan ID: ${plan.id})\n\n${input.prompt}`;

      const result = await startSessionAgent({
        featureId: input.featureId,
        projectId: input.projectId,
        prompt,
        cwd,
        worktreePath,
        planId: plan.id,
      });

      return result;
    }),

  /** Start a free-form session agent on a project */
  startSession: publicProcedure
    .input(
      z.object({
        featureId: z.number(),
        projectId: z.number(),
        prompt: z.string(),
        images: z.array(z.object({ base64: z.string(), mimeType: z.string() })).optional(),
        permissionMode: z.enum(["acceptEdits", "plan"]).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const { project, featureRow, wtRow } = await AppRuntime.runPromise(
        Effect.gen(function* () {
          const project = yield* queryOne<Pick<ProjectRow, "path">>(
            "SELECT path FROM projects WHERE id = ?",
            input.projectId,
          );
          if (!project?.path) return yield* Effect.fail(new Error("Project path not found"));

          const featureRow = yield* queryOne<{ type: string }>(
            "SELECT type FROM features WHERE id = ?",
            input.featureId,
          );

          let wtRow: { value: string } | null = null;
          if (featureRow?.type !== "ws-session") {
            wtRow = yield* queryOne<{ value: string }>(
              "SELECT value FROM feature_settings WHERE feature_id = ? AND key = 'worktree_path'",
              input.featureId,
            );
          }

          return { project, featureRow, wtRow };
        }),
      );

      let prompt: import("../agents/types").MessageContent;
      if (input.images && input.images.length > 0) {
        prompt = [
          { type: "text" as const, text: input.prompt },
          ...input.images.map((img) => ({
            type: "image" as const,
            source: { type: "base64" as const, media_type: img.mimeType, data: img.base64 },
          })),
        ];
      } else {
        prompt = input.prompt;
      }

      // Session-type features always use the project path directly (no worktree)
      let cwd = project.path;
      let worktreePath: string | undefined;
      if (featureRow?.type !== "ws-session" && wtRow?.value) {
        cwd = wtRow.value;
        worktreePath = wtRow.value;
      }

      const result = await startSessionAgent({
        featureId: input.featureId,
        projectId: input.projectId,
        prompt,
        cwd,
        worktreePath,
        permissionMode: input.permissionMode,
      });

      if (await AppRuntime.runPromise(hasDefaultTitle(input.featureId))) {
        autoNameFeature(input.featureId, input.prompt, project.path, input.projectId);
      }

      return result;
    }),

  /** Ensure a worktree exists for a feature, blocking until created. */
  ensureWorktree: publicProcedure
    .input(
      z.object({
        featureId: z.number(),
        projectId: z.number(),
        description: z.string(),
      }),
    )
    .mutation(async ({ input }) => {
      const { project, feature } = await AppRuntime.runPromise(
        Effect.gen(function* () {
          const project = yield* queryOne<Pick<ProjectRow, "path">>(
            "SELECT path FROM projects WHERE id = ?",
            input.projectId,
          );
          if (!project?.path) return yield* Effect.fail(new Error("Project path not found"));

          const feature = yield* queryOne<{ title: string; type: string }>(
            "SELECT title, type FROM features WHERE id = ?",
            input.featureId,
          );
          if (!feature) return yield* Effect.fail(new Error(`Feature not found: ${input.featureId}`));

          return { project, feature };
        }),
      );

      // Session-type features should never have worktrees
      if (feature.type === "ws-session") {
        return { cwd: project.path };
      }

      if (/^(Untitled Feature|Session \d+)$/i.test(feature.title)) {
        await runAutoNameBlocking(input.featureId, input.description, project.path);
      }

      // Step 2: Create worktree (blocking) — returns after worktree exists on disk
      const worktreePath = await AppRuntime.runPromise(
        setupWorktreeForFeatureEffect(input.projectId, input.featureId, {
          skipSetupCommands: true,
        }),
      );

      // Step 3: Fire off setup commands in background (non-blocking)
      AppRuntime.runPromise(
        setupWorktreeForFeatureEffect(input.projectId, input.featureId, {
          onlySetupCommands: true,
        }),
      ).catch((err) => {
        console.error("[ensureWorktree] Setup commands failed:", err);
      });

      const cwd = worktreePath ?? project.path;
      return { cwd };
    }),
});
