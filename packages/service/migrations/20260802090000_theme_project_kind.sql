-- The project behind a user theme is a first-class project now — it appears in
-- the sidebar and the user works in it like any other. `system` described a
-- project that was deliberately hidden, which is no longer what this is.
UPDATE projects SET kind = 'theme' WHERE kind = 'system';
