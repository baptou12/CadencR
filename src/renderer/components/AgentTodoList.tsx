import { useState, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { CheckIcon, ChevronDownIcon, CircleIcon, Loader2Icon } from "lucide-react";
import type { TodoItem } from "@/types/agent";

interface AgentTodoListProps {
  todos: TodoItem[];
}

export function AgentTodoList({ todos }: AgentTodoListProps) {
  const [collapsed, setCollapsed] = useState(false);
  const autoCollapsedRef = useRef(false);
  const completed = todos.filter((t) => t.status === "completed").length;
  const total = todos.length;
  const allDone = total > 0 && completed === total;

  useEffect(() => {
    if (!allDone) {
      autoCollapsedRef.current = false;
      return;
    }
    if (autoCollapsedRef.current) return;

    const timer = setTimeout(() => {
      autoCollapsedRef.current = true;
      setCollapsed(true);
    }, 15_000);
    return () => clearTimeout(timer);
  }, [allDone]);

  return (
    <div className="border-t border-border bg-muted/50 px-4 py-2">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="flex w-full items-center justify-between cursor-pointer"
      >
        <span className="text-xs font-medium text-muted-foreground">Tasks</span>
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          {completed}/{total} completed
          <ChevronDownIcon
            className={cn(
              "size-3 transition-transform duration-200",
              collapsed && "-rotate-90",
            )}
          />
        </span>
      </button>
      {!collapsed && (
        <ul className="mt-1 space-y-0.5">
          {todos.map((todo, i) => (
            <li key={i} className="flex items-center gap-2 text-xs">
              {todo.status === "completed" ? (
                <CheckIcon className="size-3 shrink-0 text-green-400" />
              ) : todo.status === "in_progress" ? (
                <Loader2Icon className="size-3 shrink-0 animate-spin text-yellow-400" />
              ) : (
                <CircleIcon className="size-3 shrink-0 text-muted-foreground" />
              )}
              <span
                className={cn(
                  "truncate",
                  todo.status === "completed" && "text-muted-foreground line-through",
                  todo.status === "in_progress" && "text-foreground",
                  todo.status === "pending" && "text-muted-foreground",
                )}
              >
                {todo.status === "in_progress" && todo.activeForm
                  ? todo.activeForm
                  : todo.content}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
