import { useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { ipcLink } from "electron-trpc/renderer";
import { trpc } from "./trpc";
import { router } from "./router";
import { queryClient } from "./lib/queryClient";

export default function App() {
  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [ipcLink()],
    }),
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </trpc.Provider>
  );
}
