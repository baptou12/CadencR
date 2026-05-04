-- Consolidate historical text/thinking delta rows into their first renderable
-- block row. The app now keeps one `agent_messages` row per streamed
-- text/thinking content block and appends deltas into that row as they arrive.
--
-- This migration mirrors the previous `build_blocks` behavior: consecutive
-- text/text_delta rows (or thinking/thinking_delta rows) in the same session
-- and under the same parent_tool_use_id are rendered as one block, so we fold
-- each such run into its first row and delete the rest.

DROP TABLE IF EXISTS agent_message_delta_merged;
DROP TABLE IF EXISTS agent_message_delta_runs;

CREATE TEMP TABLE agent_message_delta_runs AS
WITH ordered AS (
    SELECT
        id,
        session_id,
        parent_tool_use_id,
        CASE
            WHEN message_type IN ('text', 'text_delta') THEN 'text'
            WHEN message_type IN ('thinking', 'thinking_delta') THEN 'thinking'
            ELSE NULL
        END AS normalized_type,
        LAG(CASE
            WHEN message_type IN ('text', 'text_delta') THEN 'text'
            WHEN message_type IN ('thinking', 'thinking_delta') THEN 'thinking'
            ELSE NULL
        END) OVER (PARTITION BY session_id ORDER BY id) AS previous_type,
        LAG(parent_tool_use_id) OVER (PARTITION BY session_id ORDER BY id) AS previous_parent_tool_use_id
    FROM agent_messages
), marked AS (
    SELECT
        id,
        session_id,
        normalized_type,
        CASE
            WHEN normalized_type IS NOT NULL
                AND previous_type = normalized_type
                AND previous_parent_tool_use_id IS parent_tool_use_id
            THEN 0
            ELSE 1
        END AS starts_run
    FROM ordered
), runs AS (
    SELECT
        id,
        session_id,
        normalized_type,
        SUM(starts_run) OVER (PARTITION BY session_id ORDER BY id) AS run_id
    FROM marked
)
SELECT
    id AS message_id,
    MIN(id) OVER (PARTITION BY session_id, run_id) AS keep_id,
    normalized_type
FROM runs
WHERE normalized_type IS NOT NULL;

CREATE TEMP TABLE agent_message_delta_merged AS
WITH ordered_content AS (
    SELECT
        runs.keep_id,
        runs.normalized_type,
        messages.id,
        -- Some old databases may contain NULL content despite the current
        -- NOT NULL schema. Treat those fragments as empty strings so the
        -- UPDATE below never writes NULL back into agent_messages.content.
        group_concat(COALESCE(messages.content, ''), '') OVER (
            PARTITION BY runs.keep_id
            ORDER BY messages.id
            ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
        ) AS merged_content,
        ROW_NUMBER() OVER (PARTITION BY runs.keep_id ORDER BY messages.id DESC) AS reverse_index
    FROM agent_message_delta_runs runs
    JOIN agent_messages messages ON messages.id = runs.message_id
)
SELECT
    keep_id,
    normalized_type,
    merged_content
FROM ordered_content
WHERE reverse_index = 1;

UPDATE agent_messages
SET
    content = COALESCE((
        SELECT merged_content
        FROM agent_message_delta_merged
        WHERE keep_id = agent_messages.id
    ), ''),
    message_type = COALESCE((
        SELECT normalized_type
        FROM agent_message_delta_merged
        WHERE keep_id = agent_messages.id
    ), message_type)
WHERE id IN (SELECT keep_id FROM agent_message_delta_merged);

DELETE FROM agent_messages
WHERE id IN (
    SELECT message_id
    FROM agent_message_delta_runs
    WHERE message_id != keep_id
);

DROP TABLE agent_message_delta_merged;
DROP TABLE agent_message_delta_runs;
