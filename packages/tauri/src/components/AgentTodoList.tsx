import { cn } from "@/lib/utils";
import { CheckIcon, CircleIcon, Loader2Icon } from "lucide-react";
import type { TodoItem } from "@/types/agent";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface AgentTodoListProps {
  todos: TodoItem[];
  chipClass?: string;
}

export function AgentTodoList({ todos, chipClass }: AgentTodoListProps) {
  const completed = todos.filter((t) => t.status === "completed").length;
  const total = todos.length;
  const inProgress = todos.find((t) => t.status === "in_progress");

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            chipClass,
            "bg-rose-500/15 text-rose-400 hover:bg-rose-500/25",
          )}
        >
          {inProgress ? (
            <Loader2Icon className="size-3 animate-spin" />
          ) : (
            <CheckIcon className="size-3" />
          )}
          <span>
            {completed}/{total}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" side="top" className="w-72 p-3">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Tasks
        </p>
        <ul className="space-y-1">
          {todos.map((todo, i) => (
            <li key={i} className="flex items-center gap-2 text-xs">
              {todo.status === "completed" ? (
                <CheckIcon className="size-3 shrink-0 text-green-400" />
              ) : todo.status === "in_progress" ? (
                <Loader2Icon className="size-3 shrink-0 animate-spin text-yellow-400" />
              ) : (
                <CircleIcon className="size-3 shrink-0 text-muted-foreground/40" />
              )}
              <span
                className={cn(
                  "truncate",
                  todo.status === "completed" &&
                    "text-muted-foreground line-through",
                  todo.status === "in_progress" && "text-foreground",
                  todo.status === "pending" && "text-muted-foreground/60",
                )}
              >
                {todo.status === "in_progress" && todo.activeForm
                  ? todo.activeForm
                  : todo.content}
              </span>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
