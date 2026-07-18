import type { ReactElement } from "react";
import { useMutation } from "@tanstack/react-query";
import { beforeEach, describe, expect, it } from "vitest";

import { render, screen, waitFor } from "@/test-utils";
import { useGitUpdateRecoveryStore } from "./gitUpdateRecoveryStore";
import { gitUpdateMutationKey, useGitUpdatePending } from "./useGitUpdatePending";

interface PendingHarnessProps {
  mutationFeatureId: number;
  observedFeatureId: number;
  complete: Promise<void>;
}

function PendingHarness({
  mutationFeatureId,
  observedFeatureId,
  complete,
}: PendingHarnessProps): ReactElement {
  const mutation = useMutation<void, Error, void>({
    mutationKey: gitUpdateMutationKey(mutationFeatureId),
    mutationFn: () => complete,
  });
  const pending = useGitUpdatePending(observedFeatureId);
  return (
    <>
      <button type="button" onClick={() => mutation.mutate()}>
        Start update
      </button>
      <output>{pending ? "pending" : "idle"}</output>
    </>
  );
}

beforeEach(() => {
  useGitUpdateRecoveryStore.setState({ byFeature: {} });
});

describe("useGitUpdatePending", () => {
  it("tracks only update mutations for the requested feature", async () => {
    let resolveMutation = (): void => undefined;
    const complete = new Promise<void>((resolve) => {
      resolveMutation = resolve;
    });
    const { user } = render(
      <PendingHarness mutationFeatureId={42} observedFeatureId={42} complete={complete} />,
    );

    await user.click(screen.getByRole("button", { name: "Start update" }));
    await waitFor(() => expect(screen.getByText("pending")).toBeInTheDocument());

    resolveMutation();
    await waitFor(() => expect(screen.getByText("idle")).toBeInTheDocument());
  });

  it("ignores an update mutation for another feature", async () => {
    const { user } = render(
      <PendingHarness
        mutationFeatureId={7}
        observedFeatureId={42}
        complete={new Promise<void>(() => undefined)}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Start update" }));

    expect(screen.getByText("idle")).toBeInTheDocument();
  });
});
