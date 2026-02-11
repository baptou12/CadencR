import { createRootRoute, Link, Outlet } from "@tanstack/react-router";

export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  return (
    <div className="flex h-screen">
      <nav className="w-48 border-r border-border bg-muted/50 p-4 flex flex-col gap-2">
        <Link
          to="/"
          className="px-3 py-2 rounded-md text-sm font-medium hover:bg-accent [&.active]:bg-accent [&.active]:text-accent-foreground"
        >
          Home
        </Link>
        <Link
          to="/settings"
          className="px-3 py-2 rounded-md text-sm font-medium hover:bg-accent [&.active]:bg-accent [&.active]:text-accent-foreground"
        >
          Settings
        </Link>
      </nav>
      <main className="flex-1 p-6 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
