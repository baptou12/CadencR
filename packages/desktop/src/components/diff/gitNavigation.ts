/** Commands exposed by whichever Git sub-view is currently visible. */
export interface GitNavigationAdapter {
  getActiveItem: () => string | null;
  moveSelection: (offset: -1 | 1) => boolean;
  open: () => boolean;
  back: () => boolean;
  toggleViewed?: () => boolean;
  /** Picks/unpicks the focused item for the agent — the PR view's thread list. */
  togglePicked?: () => boolean;
  stage?: () => boolean;
  reset?: () => boolean;
  scrollHalfPage?: (direction: -1 | 1) => boolean;
  openInEditor?: () => boolean;
}

/** Registers one active adapter and returns an identity-safe cleanup. */
export type GitNavigationAdapterRegistrar = (adapter: GitNavigationAdapter) => () => void;

export type GitNavigationCommand = Exclude<keyof GitNavigationAdapter, "getActiveItem">;

export function delegateGitNavigation(
  adapter: GitNavigationAdapter | null,
  command: GitNavigationCommand,
  ...args: [-1 | 1] | []
): boolean {
  if (!adapter) return false;
  switch (command) {
    case "moveSelection": {
      const direction = args[0];
      return direction == null ? false : adapter.moveSelection(direction);
    }
    case "scrollHalfPage": {
      const direction = args[0];
      return direction == null ? false : (adapter.scrollHalfPage?.(direction) ?? false);
    }
    case "open":
      return adapter.open();
    case "back":
      return adapter.back();
    case "toggleViewed":
      return adapter.toggleViewed?.() ?? false;
    case "togglePicked":
      return adapter.togglePicked?.() ?? false;
    case "stage":
      return adapter.stage?.() ?? false;
    case "reset":
      return adapter.reset?.() ?? false;
    case "openInEditor":
      return adapter.openInEditor?.() ?? false;
  }
}
