import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { router } from "./router";
import { queryClient } from "./lib/queryClient";
import { OnboardingGate } from "./components/onboarding/OnboardingGate";

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <OnboardingGate>
        <RouterProvider router={router} />
      </OnboardingGate>
    </QueryClientProvider>
  );
}
