# Fix

You are fixing review feedback or a failed verification on {{SOURCE_BRANCH}}.

## Pending review comments
{{REVIEW_COMMENTS}}

- Address every blocker comment; suggestions are optional.
- Re-run the verify command after each change.
- Keep the worktree clean and commit the fix.

## Working agreement
- Source branch: {{SOURCE_BRANCH}}
- Target branch: {{TARGET_BRANCH}}
- Never push to the target branch; commit only inside the task worktree.
- When the stage is finished (success or a documented blocker), end your turn with exactly:
  <promise>COMPLETE</promise>
