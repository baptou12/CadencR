import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: HomePage,
});

function HomePage() {
  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">Home</h1>
      <p className="text-muted-foreground">Welcome to ProductDevR.</p>
    </div>
  );
}
