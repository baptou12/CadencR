import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { cn } from "@/lib/utils";

export interface SettingsNavItem {
  id: string;
  label: string;
  icon: ReactNode;
}

export interface SettingsNavGroup {
  label: string;
  items: SettingsNavItem[];
}

function useSettingsSectionTracking(
  sectionIds: string[],
  scrollRef: RefObject<HTMLElement | null>,
) {
  const [activeId, setActiveId] = useState<string>(() => sectionIds[0] ?? "");
  const clickScrolling = useRef(false);
  const releaseClickScroll = useRef<(() => void) | null>(null);
  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const elements = sectionIds
      .map((id) => document.getElementById(id))
      .filter((element): element is HTMLElement => element !== null);
    if (elements.length === 0) return;
    const visibility = new Map<string, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) visibility.set(entry.target.id, entry.intersectionRatio);
        if (clickScrolling.current) return;
        const next = sectionIds.find((id) => (visibility.get(id) ?? 0) > 0) ?? sectionIds[0];
        setActiveId((previous) => (previous === next ? previous : next));
      },
      { root, rootMargin: "-80px 0px 0px 0px", threshold: [0, 1] },
    );
    for (const element of elements) observer.observe(element);
    return () => observer.disconnect();
  }, [scrollRef, sectionIds]);
  useEffect(() => () => releaseClickScroll.current?.(), []);
  const scrollTo = useCallback(
    (id: string): void => {
      const root = scrollRef.current;
      const target = document.getElementById(id);
      if (!root || !target) return;
      setActiveId(id);
      clickScrolling.current = true;
      releaseClickScroll.current?.();
      let timer = 0;
      const release = (): void => {
        clickScrolling.current = false;
        root.removeEventListener("scrollend", release);
        window.clearTimeout(timer);
        releaseClickScroll.current = null;
      };
      timer = window.setTimeout(release, 1000);
      root.addEventListener("scrollend", release);
      releaseClickScroll.current = release;
      root.scrollTo({ top: target.offsetTop - 16, behavior: "smooth" });
    },
    [scrollRef],
  );
  return useMemo(() => ({ activeId, scrollTo }), [activeId, scrollTo]);
}

/**
 * 240px left rail for the settings page. Renders grouped nav links that
 * scroll the main pane to the matching `<section data-section="…">` and
 * auto-track the active section as the user scrolls.
 *
 * Uses IntersectionObserver against the scrollable main element so we don't
 * read layout (`offsetTop`) on every scroll tick.
 */
function SettingsNavSidebarImpl({
  groups,
  scrollRef,
  header,
  footer,
}: {
  groups: SettingsNavGroup[];
  /** Ref to the scrollable main element used as the IntersectionObserver root. */
  scrollRef: RefObject<HTMLElement | null>;
  header?: ReactNode;
  footer?: ReactNode;
}): React.JSX.Element {
  const sectionIds = useMemo(
    () => groups.flatMap((group) => group.items.map((item) => item.id)),
    [groups],
  );
  const { activeId, scrollTo } = useSettingsSectionTracking(sectionIds, scrollRef);

  return (
    <aside
      style={{ width: 240, flexShrink: 0 }}
      // Phones get the full width for content; sections still scroll in `main`,
      // reachable from the workspace drawer's Settings link.
      className="hidden flex-col border-r border-border bg-[var(--sidebar)] md:flex"
    >
      {header ? <div className="px-4 pt-5 pb-3">{header}</div> : null}

      <nav className="flex-1 overflow-y-auto px-2 pb-3">
        {groups.map((group) => (
          <div key={group.label}>
            <div className="px-3 pt-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {group.label}
            </div>
            {group.items.map((item) => {
              const active = item.id === activeId;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => scrollTo(item.id)}
                  className={cn(
                    "relative flex w-full items-center gap-2.5 rounded-md py-1.5 pr-2.5 pl-3 text-left text-[13px] transition-colors",
                    active
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                  aria-current={active ? "true" : undefined}
                >
                  {active ? (
                    <span
                      aria-hidden
                      className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-sm bg-primary"
                    />
                  ) : null}
                  <span className="grid size-4 place-items-center">{item.icon}</span>
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      {footer ? (
        <div className="border-t border-border px-4 py-3 text-[11px] text-muted-foreground">
          {footer}
        </div>
      ) : null}
    </aside>
  );
}

export const SettingsNavSidebar = memo(SettingsNavSidebarImpl);
