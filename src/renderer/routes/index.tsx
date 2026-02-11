import { createFileRoute } from "@tanstack/react-router";
import { trpc } from "../trpc";

export const Route = createFileRoute("/")({
  component: HomePage,
});

function HomePage() {
  const hello = trpc.hello.useQuery({ name: "ProductDevR" });

  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">Home</h1>
      <p className="text-muted-foreground">
        {hello.data?.greeting ?? "Loading..."}
      </p>
    </div>
  );
}
