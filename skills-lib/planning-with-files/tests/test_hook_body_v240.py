"""Behavioral tests for the canonical SKILL.md hook bodies (v2.40).

The canonical hook bodies live as YAML-embedded bash inside the frontmatter.
v2.40 changes three things about them:

  1. Plan-dir resolution now prefers slug-mode (PLAN_ID env > .active_plan >
     newest mtime) over the legacy root task_plan.md. (item #1)
  2. SHA-256 attestation check is mtime-keyed cached in ${TMPDIR}/pwf-sha.
     (item #6)
  3. Injected progress.md tail has its sub-second + timezone-suffix timestamps
     normalized so the KV-cache prefix stays stable. (item #7)

These tests extract the UserPromptSubmit and PreToolUse hook bodies from
skills/planning-with-files/SKILL.md and exercise them in a temp project. They
do NOT touch the YAML parser; they unescape the inline bash and run it
directly with `sh`, the same way Claude Code invokes hook commands.
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
SCRIPTS_DIR = REPO_ROOT / "skills" / "planning-with-files" / "scripts"

# Match a single `command: "<bash>"` value inside the named hook event block.
HOOK_RE_TEMPLATE = r'{event}:\n(?:.*?\n)*?\s*command: "((?:[^"\\]|\\.)*)"'


def extract_hook_body(event_name: str) -> str:
    """Return the bash one-liner for the named hook event, fully unescaped."""
    text = CANONICAL_SKILL.read_text(encoding="utf-8")
    match = re.search(HOOK_RE_TEMPLATE.format(event=event_name), text)
    assert match, f"hook body for {event_name} not found in canonical SKILL.md"
    # The frontmatter uses YAML flow-scalar escaping: \" for literal ", \\ for
    # literal \. We need to undo just those two so the resulting string is real
    # bash. We deliberately do NOT use `unicode_escape`, which would
    # mis-interpret single backslashes in the regex sed pattern.
    raw = match.group(1)
    raw = raw.replace('\\"', '"').replace("\\\\", "\\")
    return raw


def have_sh() -> bool:
    return shutil.which("sh") is not None


@unittest.skipUnless(have_sh(), "sh not available on this platform")
class HookBodyV240Tests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="pwf-hook-"))
        # Tests that exercise the SHA cache need a writable TMPDIR pointing
        # somewhere that bash can find. We use a per-test cache subdir.
        self.cache_dir = self.tmp / "_cache"
        self.cache_dir.mkdir()
        self.env = os.environ.copy()
        self.env["TMPDIR"] = str(self.cache_dir)
        self.env.pop("PLAN_ID", None)

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _run_hook(self, event: str) -> subprocess.CompletedProcess[str]:
        body = extract_hook_body(event)
        script = self.tmp / f"_hook_{event}.sh"
        script.write_text(body, encoding="utf-8")
        return subprocess.run(
            ["sh", str(script)],
            cwd=str(self.tmp),
            text=True,
            capture_output=True,
            env=self.env,
            check=False,
        )

    def test_slug_plan_beats_root_task_plan(self) -> None:
        # v2.40 item #1: when both exist, slug-mode wins. v2.39.0 silently
        # injected the root plan; this regression closes that gap.
        plan_dir = self.tmp / ".planning" / "2026-05-21-slug-target"
        plan_dir.mkdir(parents=True)
        slug_marker = "SLUG-PLAN-CONTENT-MARKER"
        root_marker = "ROOT-PLAN-DECOY-MARKER"
        (plan_dir / "task_plan.md").write_text(f"# {slug_marker}\n", encoding="utf-8")
        (plan_dir / "progress.md").write_text("# progress\n", encoding="utf-8")
        (self.tmp / "task_plan.md").write_text(f"# {root_marker}\n", encoding="utf-8")
        (self.tmp / ".planning" / ".active_plan").write_text(
            "2026-05-21-slug-target\n", encoding="utf-8"
        )

        result = self._run_hook("UserPromptSubmit")
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertIn(slug_marker, result.stdout, "slug plan content must be injected")
        self.assertNotIn(root_marker, result.stdout, "root plan must not leak through")

    def test_legacy_root_only_still_works(self) -> None:
        # Backward compat: no .planning/ dir at all, just root task_plan.md.
        (self.tmp / "task_plan.md").write_text("# Legacy Root Plan\n", encoding="utf-8")
        (self.tmp / "progress.md").write_text("# progress\n", encoding="utf-8")
        result = self._run_hook("UserPromptSubmit")
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertIn("Legacy Root Plan", result.stdout)
        self.assertIn("ACTIVE PLAN", result.stdout)

    def test_no_plan_anywhere_silent_exit_zero(self) -> None:
        # No plan, no .planning/. Hook exits 0 silently — never break agent.
        result = self._run_hook("UserPromptSubmit")
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertEqual("", result.stdout.strip())

    def test_corrupt_active_plan_falls_through_to_newest(self) -> None:
        # v2.40 item #3: garbage in .active_plan must not break the hook.
        plan_dir = self.tmp / ".planning" / "2026-05-21-real"
        plan_dir.mkdir(parents=True)
        (plan_dir / "task_plan.md").write_text("# Real Plan\n", encoding="utf-8")
        (plan_dir / "progress.md").write_text("# progress\n", encoding="utf-8")
        # Whitespace-only .active_plan content
        (self.tmp / ".planning" / ".active_plan").write_text("   \n\n   \n", encoding="utf-8")
        result = self._run_hook("UserPromptSubmit")
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertIn("Real Plan", result.stdout, "must fall through to newest valid plan")

    def test_sha_cache_populates_after_attested_fire(self) -> None:
        # v2.40 item #6: attested injection should write a cache entry under
        # ${TMPDIR}/pwf-sha so subsequent fires can skip the sha256 step.
        import hashlib

        plan_dir = self.tmp / ".planning" / "2026-05-21-cached"
        plan_dir.mkdir(parents=True)
        plan_content = "# Plan with attestation\nphase 1\n"
        (plan_dir / "task_plan.md").write_bytes(plan_content.encode("utf-8"))
        (plan_dir / "progress.md").write_text("# progress\n", encoding="utf-8")
        digest = hashlib.sha256(plan_content.encode("utf-8")).hexdigest()
        (plan_dir / ".attestation").write_text(digest, encoding="utf-8")
        (self.tmp / ".planning" / ".active_plan").write_text(
            "2026-05-21-cached\n", encoding="utf-8"
        )

        result = self._run_hook("UserPromptSubmit")
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertIn(f"Plan-SHA256: {digest}", result.stdout)
        # Cache dir should now contain at least one file.
        cache_root = self.cache_dir / "pwf-sha"
        self.assertTrue(
            cache_root.is_dir(),
            f"expected SHA cache at {cache_root}, dir not created",
        )
        cache_entries = list(cache_root.iterdir())
        self.assertTrue(cache_entries, "expected at least one cache entry after attested fire")
        # Cache entry must have two lines: mtime then SHA.
        cached = cache_entries[0].read_text(encoding="utf-8").splitlines()
        self.assertEqual(2, len(cached), f"cache file malformed: {cached!r}")
        self.assertEqual(digest, cached[1])

    def test_tamper_still_blocks_with_inverted_order(self) -> None:
        # Inverted resolution order must not weaken tamper detection.
        import hashlib

        plan_dir = self.tmp / ".planning" / "2026-05-21-tamper"
        plan_dir.mkdir(parents=True)
        original = "# Approved Plan\nphase 1\n"
        (plan_dir / "task_plan.md").write_text(original, encoding="utf-8")
        (plan_dir / "progress.md").write_text("# progress\n", encoding="utf-8")
        digest = hashlib.sha256(original.encode("utf-8")).hexdigest()
        (plan_dir / ".attestation").write_text(digest, encoding="utf-8")
        (self.tmp / ".planning" / ".active_plan").write_text(
            "2026-05-21-tamper\n", encoding="utf-8"
        )

        # Now tamper.
        (plan_dir / "task_plan.md").write_text(original + "INJECTED LINE\n", encoding="utf-8")
        result = self._run_hook("UserPromptSubmit")
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertIn("PLAN TAMPERED", result.stdout)
        self.assertIn(f"expected={digest}", result.stdout)
        # Plan content must NOT be in the output when tampered.
        self.assertNotIn("INJECTED LINE", result.stdout)

    def test_progress_tail_timestamps_normalized(self) -> None:
        # v2.40 item #7: sub-second timestamps in injected progress tail are
        # collapsed to a stable epoch-zero form so KV-cache prefix stays warm.
        plan_dir = self.tmp / ".planning" / "2026-05-21-cache-hygiene"
        plan_dir.mkdir(parents=True)
        (plan_dir / "task_plan.md").write_text("# Plan\n", encoding="utf-8")
        progress = (
            "## Session 2026-05-21T19:15:42.317Z\n"
            "did some work at 2026-05-21T20:01:09Z\n"
            "and then more at 2026-05-21T21:30:37.000+02:00\n"
        )
        (plan_dir / "progress.md").write_text(progress, encoding="utf-8")
        (self.tmp / ".planning" / ".active_plan").write_text(
            "2026-05-21-cache-hygiene\n", encoding="utf-8"
        )

        result = self._run_hook("UserPromptSubmit")
        self.assertEqual(0, result.returncode, result.stderr)
        # Original timestamps must NOT appear (they were the source of cache invalidation)
        self.assertNotIn("T19:15:42", result.stdout)
        self.assertNotIn("T20:01:09", result.stdout)
        self.assertNotIn("T21:30:37", result.stdout)
        # Normalized form must appear at least once
        self.assertIn("T00:00:00", result.stdout)

    def test_pretooluse_injects_plan_data(self) -> None:
        # PreToolUse uses the same resolution chain and emits head -30.
        plan_dir = self.tmp / ".planning" / "2026-05-21-pretool"
        plan_dir.mkdir(parents=True)
        (plan_dir / "task_plan.md").write_text("# Pre Tool Plan\nphase 1\n", encoding="utf-8")
        (plan_dir / "progress.md").write_text("# progress\n", encoding="utf-8")
        (self.tmp / ".planning" / ".active_plan").write_text(
            "2026-05-21-pretool\n", encoding="utf-8"
        )

        result = self._run_hook("PreToolUse")
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertIn("===BEGIN PLAN DATA===", result.stdout)
        self.assertIn("Pre Tool Plan", result.stdout)
        self.assertIn("===END PLAN DATA===", result.stdout)


if __name__ == "__main__":
    unittest.main()
