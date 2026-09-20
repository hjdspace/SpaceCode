"""Smoke tests for the v2.38.0 slash command files.

We do not invoke the commands (that requires Claude Code), but we verify the
markdown files exist, have valid frontmatter, and document the expected
composition with /goal and /loop. This catches accidental deletion + frontmatter
drift in CI.
"""
from __future__ import annotations

import re
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
COMMANDS_DIR = REPO_ROOT / "commands"

PLAN_GOAL = COMMANDS_DIR / "plan-goal.md"
PLAN_LOOP = COMMANDS_DIR / "plan-loop.md"
LOOP_TEMPLATE = REPO_ROOT / "templates" / "loop.md"


def parse_frontmatter(text: str) -> dict:
    if not text.startswith("---\n"):
        return {}
    end = text.find("\n---\n", 4)
    if end == -1:
        return {}
    fm = text[4:end]
    out = {}
    for line in fm.splitlines():
        m = re.match(r'^(\w[\w\-]*):\s*"?(.*?)"?\s*$', line)
        if m:
            out[m.group(1)] = m.group(2)
    return out


class V238CommandFileTests(unittest.TestCase):
    def test_plan_goal_exists(self) -> None:
        self.assertTrue(PLAN_GOAL.is_file(), PLAN_GOAL)

    def test_plan_loop_exists(self) -> None:
        self.assertTrue(PLAN_LOOP.is_file(), PLAN_LOOP)

    def test_loop_template_exists(self) -> None:
        self.assertTrue(LOOP_TEMPLATE.is_file(), LOOP_TEMPLATE)

    def test_plan_goal_frontmatter(self) -> None:
        fm = parse_frontmatter(PLAN_GOAL.read_text(encoding="utf-8"))
        self.assertIn("description", fm, "plan-goal.md missing description")
        self.assertTrue(
            "v2.38.0" in fm["description"],
            "plan-goal.md description should mark version availability",
        )

    def test_plan_loop_frontmatter(self) -> None:
        fm = parse_frontmatter(PLAN_LOOP.read_text(encoding="utf-8"))
        self.assertIn("description", fm)
        self.assertTrue("v2.38.0" in fm["description"])

    def test_plan_goal_mentions_goal_command(self) -> None:
        body = PLAN_GOAL.read_text(encoding="utf-8")
        # /plan-goal must compose with Claude Code's /goal, not replace it.
        self.assertIn("/goal", body)
        self.assertIn("4000-char", body, "should remind that /goal has a 4000 char limit")

    def test_plan_loop_mentions_loop_command(self) -> None:
        body = PLAN_LOOP.read_text(encoding="utf-8")
        self.assertIn("/loop", body)
        self.assertIn("interval", body.lower())

    def test_loop_template_mentions_planning_files(self) -> None:
        body = LOOP_TEMPLATE.read_text(encoding="utf-8")
        for f in ("task_plan.md", "progress.md", "findings.md"):
            self.assertIn(f, body, f"loop.md template should reference {f}")


if __name__ == "__main__":
    unittest.main()
