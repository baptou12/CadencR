-- Custom Actions: opt a long-running action into spawning in a dedicated
-- terminal split (a client-side PTY) instead of a backgrounded server process.
ALTER TABLE custom_actions
    ADD COLUMN run_in_terminal INTEGER NOT NULL DEFAULT 0;
