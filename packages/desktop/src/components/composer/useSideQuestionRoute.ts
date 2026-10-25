import { useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { getListFeaturesQueryKey, useAskSessionSideQuestion } from "@/api/generated";
import { apiErrorMessage } from "@/lib/api-errors";
import { queryClient } from "@/lib/queryClient";
import { parseSideQuestion, SIDE_QUESTION_SKILL } from "@/lib/side-question-skill";
import { navigateToFeatureIdOrHome } from "@/components/project-feature-navigation";
import type { SendFn } from "../agent-prompt-send";

/**
 * Routes a `/cadencr:side <question>` prompt away from the agent: the question
 * goes to a new read-only conversation in the same working directory, seeded
 * with this one's recent messages, and this agent is neither interrupted nor
 * shown it. Any other prompt goes through `send` untouched. A refused question
 * throws after its toast, so the send runner restores the draft.
 */
export function useSideQuestionRoute(sessionId: number | undefined) {
  const navigate = useNavigate();
  const { mutateAsync } = useAskSessionSideQuestion();
  return useCallback(
    (send: SendFn): SendFn =>
      async (text, attachments) => {
        const question = parseSideQuestion(text);
        if (question === null || sessionId == null) return send(text, attachments);
        const refusal = !question
          ? `Type your question after /${SIDE_QUESTION_SKILL.name}.`
          : attachments?.length
            ? "Images can't go to a side question. Remove them, or send them to the agent."
            : null;
        if (refusal) {
          toast.error(refusal);
          throw new Error(refusal);
        }
        try {
          const result = await mutateAsync({ sessionId, data: { question } });
          void queryClient.invalidateQueries({
            queryKey: getListFeaturesQueryKey({ project_id: result.project_id }),
          });
          toast.success("Side question sent", {
            description: "A read-only conversation is answering it next to this one.",
            action: {
              label: "Open",
              onClick: () =>
                navigateToFeatureIdOrHome(navigate, result.project_id, result.feature_id),
            },
          });
        } catch (error) {
          toast.error(apiErrorMessage(error, "Couldn't start the side conversation"));
          throw error;
        }
      },
    [mutateAsync, navigate, sessionId],
  );
}
