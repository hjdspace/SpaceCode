"""Regression tests for the PreCompact hook (v2.38.0).

PreCompact fires on Claude Code's autoCompact and manual /compact. The hook
re-injects a planning reminder before context compaction. It must:
  - Be declared in the canonical SKILL.md frontmatter.
  - Match all triggers (manual and auto).
  - Print a reminder when task_plan.md exists.
  - Stay silent when task_plan.md is absent.
  - Surface the Plan-SHA256 hash when an attestation is set.
"""
from __future__ import annotations

import os
import re
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
CANONICAL_SKILL = REPO_ROOT / "skills" / "planning-with-files" / "SKILL.md"


def extract_precompact_command(text: str) -> str:
    """Pull the PreCompact hook command string out of SKILL.md frontmatter.

    Frontmatter format:
      PreCompact:
        - matcher: "*"
          hooks:
            - type: command
              command: "..."
    """
    in_section = False
    for line in text.splitlines():
        stripped = line.strip()
        if stripped == "PreCompact:":
            in_section = True
            continue
        if in_section and stripped.startswith("command:"):
            m = re.match(r'command:\s*"(.+)"\s*$', stripped)
            if m:
                return m.group(1).replace('\\"', '"')
        if in_section and stripped.endswith(":") and not stripped.startswith("-") and stripped != "hooks:":
            # Next top-level frontmatter key starts a new section.
            break
    return ""


class PreCompactHookDeclarationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.text = CANONICAL_SKILL.read_text(encoding="utf-8")

    def test_precompact_is_declared(self) -> None:
        self.assertIn("PreCompact:", self.text, "PreCompact hook missing from canonical SKILL.md")

    def test_precompact_uses_wildcard_matcher(self) -> None:
        # We want both autoCompact and manual /compact to fire the reminder.
        self.assertRegex(
            self.text,
            r"PreCompact:\s*\n\s*-\s*matcher:\s*\"\*\"",
            "PreCompact should match all triggers ('*'), got something stricter",
        )


@unittest.skipUnless(shutil.which("sh"), "sh not available on this platform")
class PreCompactCommandBehaviorTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="pwf-precompact-"))
        self.cmd = extract_precompact_command(CANONICAL_SKILL.read_text(encoding="utf-8"))
        self.assertTrue(self.cmd, "Could not extract PreCompact command from SKILL.md")

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _run(self) -> subprocess.CompletedProcess:
        return subprocess.run(
            ["sh", "-c", self.cmd],
            cwd=str(self.tmp),
            text=True,
            capture_output=True,
            check=False,
        )

    def test_silent_when_no_plan(self) -> None:
        result = self._run()
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertEqual("", result.stdout.strip(), "PreCompact should be silent without task_plan.md")

    def test_emits_reminder_when_plan_exists(self) -> None:
        (self.tmp / "task_plan.md").write_text("# Plan\n", encoding="utf-8")
        result = self._run()
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertIn("[planning-with-files] PreCompact", result.stdout)
        self.assertIn("progress.md", result.stdout, "reminder must mention progress.md")

    def test_emits_plan_sha256_when_legacy_attestation_set(self) -> None:
        (self.tmp / "task_plan.md").write_text("# Plan\n", encoding="utf-8")
        (self.tmp / ".plan-attestation").write_text(
            "abc123def456" + "0" * 52 + "\n", encoding="utf-8"
        )
        result = self._run()
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertIn("Plan-SHA256", result.stdout)

    def test_no_sha256_line_when_no_attestation(self) -> None:
        (self.tmp / "task_plan.md").write_text("# Plan\n", encoding="utf-8")
        result = self._run()
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertNotIn("Plan-SHA256", result.stdout)


if __name__ == "__main__":
    unittest.main()
