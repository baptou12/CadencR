# Execute automation levels
- **Type**: ✨ Feature
- **Status**: 📋 BACKLOG
- **Description**: Add a setting to determine the level of automation for the execute agent workflow:
  - **Level 1 (Ask before commit)**: Uses AskUserQuestion at the end of an execute agent before committing changes, allowing the user to review code first. The question appears AFTER implementation notes and deviations. This replaces the existing auto_commit option from all settings.
  - **Level 2 (Manual continue)**: Don't ask before commit, but require manual trigger for next execution agents. After an agent execution completes, show a "continue building" button under the agent(s) execution.
  - **Level 3 (Full auto)**: Don't ask before commit, automatically run the next execute agent(s) at the end. Must ensure the database is updated (parsing implementation notes and deviations from the agent) before running the next agent(s).

  In all cases, agent execution parallelism must be maintained: before running the next agent, all agents in the current step must be in completed status (and phase too).
