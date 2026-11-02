# Merge conflict

Resolve the conflict between {{SOURCE_BRANCH}} and {{TARGET_BRANCH}}.

- Preserve both intents where possible; never delete work just to silence the conflict.
- Re-run the verify command after resolution.
- Mention every resolved file in your summary.

## Working agreement
- Source branch: {{SOURCE_BRANCH}}
- Target branch: {{TARGET_BRANCH}}
- Never push to the target branch; commit only inside the task worktree.
- When the stage is finished (success or a documented blocker), end your turn with exactly:
  <promise>COMPLETE</promise>
