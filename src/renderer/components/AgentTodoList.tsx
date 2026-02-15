import { cn } from "@/lib/utils";
import { CheckIcon, CircleIcon, Loader2Icon } from "lucide-react";
import type { TodoItem } from "@/hooks/useFeatureAgentState";

interface AgentTodoListProps {
  todos: TodoItem[];
}

export function AgentTodoList({ todos }: AgentTodoListProps) {
  const completed = todos.filter((t) => t.status === "completed").length;
  const total = todos.length;

  return (
    <div className="border-t border-border bg-muted/50 px-4 py-2">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-muted-foreground">Tasks</span>
        <span className="text-xs text-muted-foreground">
          {completed}/{total} completed
        </span>
      </div>
      <ul className="space-y-0.5">
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
    </div>
  );
}
