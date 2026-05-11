import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { RouterProvider } from "@tanstack/react-router";
import { router } from "./router";
import { persister, queryClient } from "./lib/queryClient";
import { shouldDehydrateQuery } from "./lib/persistedQueries";
import { OnboardingGate } from "./components/onboarding/OnboardingGate";

const PERSIST_MAX_AGE_MS = 1000 * 60 * 60 * 24; // 24h

export default function App() {
  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        maxAge: PERSIST_MAX_AGE_MS,
        dehydrateOptions: { shouldDehydrateQuery },
      }}
    >
      <OnboardingGate>
        <RouterProvider router={router} />
      </OnboardingGate>
    </PersistQueryClientProvider>
  );
}
