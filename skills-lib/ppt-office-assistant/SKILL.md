---
name: ppt-office-assistant
description: >-
  Office mode assistant that orchestrates a full PPT creation pipeline from topic
  to editable PPTX. Combines ppt-workflow (staged content planning and HTML slide
  generation) with html-slide-to-pptx (preset-driven HTML-to-PPTX conversion).
  Use when the user wants to create a presentation, deck, or slides and expects a
  final editable PowerPoint file, not just an outline or preview. Handles the
  complete flow: clarify brief, research, outline, planning draft, HTML slide
  generation, preview review, preset matching, preset extension when needed,
  PPTX conversion, QA, and delivery.
---

# PPT Office Assistant

## Overview

This skill is the orchestrator for a complete PPT creation pipeline. It chains
two sub-skills into one seamless workflow:

1. **ppt-workflow** — staged content work: brief → research → outline → planning
   draft → HTML slide generation → preview.
2. **html-slide-to-pptx** — preset-driven conversion: HTML → editable PPTX with
   native text boxes, shapes, and QA.

All three skills are installed as siblings under `.claude/skills/` in the
session working directory. Reference sub-skills by name, not by absolute path.

The assistant decides **when to stop for review**, **when to extend presets**,
and **how to bridge content planning with preset-compatible HTML structure**.

## When to use

- User wants a final editable PPTX (not just an outline or plan).
- User says "做个 PPT", "生成演示文稿", "make a deck", "create slides".
- User provides a topic, brief, or source material and expects a deliverable.
- User wants to iterate on slides with preview before committing to PPTX.

## Pipeline stages

```
Stage 1: Clarify Brief          ─── ppt-workflow
Stage 2: Research / Context     ─── ppt-workflow
Stage 3: Outline                ─── ppt-workflow
Stage 4: Planning Draft         ─── ppt-workflow
Stage 5: HTML Slide Generation  ─── ppt-workflow + preset-awareness
Stage 6: Preview & Review Gate  ─── manual checkpoint
Stage 7: Preset Match Check     ─── html-slide-to-pptx
Stage 8: Preset Extension       ─── html-slide-to-pptx (if needed)
Stage 9: PPTX Conversion        ─── html-slide-to-pptx
Stage 10: QA & Delivery         ─── html-slide-to-pptx
```

## Core rules

### Rule 1: Content first, conversion second
Never skip the planning stages to jump to PPTX. The quality of the final PPT
depends on the outline and planning draft, not on the converter.

### Rule 2: Generate preset-aware HTML
When generating HTML slides in Stage 5, structure the HTML so it can be
converted later. Read `references/html-preset-bridge.md` before generating
HTML to understand which semantic structures map to existing presets.

### Rule 3: Always preview before converting
Stage 6 is a hard gate. Export HTML or PNG, let the user review layout,
hierarchy, and content, and only proceed to conversion after confirmation.

### Rule 4: No preset, no conversion
If the HTML structure does not match any existing preset, do not force
conversion. First add a new preset (Stage 8), then convert. Read
`references/preset-extension-guide.md` for the extension process.

### Rule 5: QA every output
Every generated PPTX must pass through `preflight_qa.js`. Address fail-level
issues before delivery.

## Sub-skills

This orchestrator coordinates two sub-skills. Both are installed alongside
this skill in `.claude/skills/`:

- **ppt-workflow** — read its `SKILL.md` and `references/prompts.md` for
  content planning methodology and reusable prompts.
- **html-slide-to-pptx** — read its `SKILL.md` for conversion commands.
  Its scripts are in its own `scripts/` directory; run `npm ci` there on
  first use, then execute scripts with `node scripts/html_to_pptx.js ...`
  from that directory.

To find a sub-skill's directory, look for the `Base directory for this skill:`
line that the engine prepends when the skill is invoked, or locate
`.claude/skills/<skill-name>/` in the session working directory.

## Detailed workflow

### Stage 1 — Clarify the brief

Collect minimum necessary inputs:
- topic, audience, purpose
- page-count range
- style or tone
- must-have sections
- whether research is needed
- whether the user wants staged review or fast output

If inputs are sufficient, proceed. If not, ask concise questions.

### Stage 2 — Research / Context

Perform fact-finding if:
- the topic depends on current events, statistics, or technical facts
- the user explicitly requests research-backed content
- supplied material is obviously incomplete

Produce a compact research brief with key facts, evidence, and open questions.

### Stage 3 — Outline

Generate a structured outline using the pyramid principle:
- conclusion first
- each section has a clear goal
- pages have titles and content points

Output as JSON for downstream processing.

### Stage 4 — Planning draft (策划稿)

For each page, produce a planning card:
- page title and goal
- core messages (3-6 points)
- evidence/data sources
- recommended visual treatment (comparison, flow, timeline, data card, card grid, etc.)
- information hierarchy
- keywords to emphasize

### Stage 5 — HTML slide generation

Generate HTML slides based on the planning draft. **This is the bridge stage.**

Before writing HTML:
1. Read `references/html-preset-bridge.md` to understand preset-compatible structures.
2. Classify each page into a slide family (architecture, runtime, cover, comparison, timeline, etc.).
3. Use semantic CSS classes that match preset extraction rules where possible.
4. Add `data-preset` attribute to `<body>` when targeting a specific preset.

HTML requirements:
- 16:9 aspect ratio (1280×720 or equivalent)
- semantic structure with clear regions (header, title, panels, cards, chips)
- self-contained (inline CSS, no external dependencies)
- previewable in a browser

Export options:
- HTML files for browser preview
- PNG screenshots if rendering tools are available

### Stage 6 — Preview & review gate

Present the generated HTML/PNG to the user for review:
- Is the layout correct?
- Is the information hierarchy clear?
- Is the content expression appropriate?
- Are there overflow or spacing issues?

Wait for explicit confirmation before proceeding. If changes are needed,
loop back to Stage 5.

### Stage 7 — Preset match check

For each HTML slide, determine if it matches an existing preset:
- `v9-architecture`: header + title + core box + left panel + center stack + right judgement chain
- `ai-runtime-page`: header + title + lead + input chips + runtime modules + support cards + output chips + base + takeaway

Read the `html-slide-to-pptx` skill's `references/preset-decision-rules.md` for
the full decision framework.

Decision outcomes:
- **Reuse** — same page family, only text/labels changed → proceed to Stage 9
- **Extend** — same family, minor structural variation → extend preset, then convert
- **New preset** — different page family → go to Stage 8

### Stage 8 — Preset extension (if needed)

When the HTML does not fit any existing preset:
1. Read `references/preset-extension-guide.md` for the complete process.
2. Implement all three layers: DOM extraction, layout mapping, QA rules.
3. Register the new preset in the `html-slide-to-pptx` skill's `html_to_pptx.js`.
4. Test with the actual HTML before proceeding.

### Stage 9 — PPTX conversion

First, ensure the `html-slide-to-pptx` skill environment is ready:

```bash
cd .claude/skills/html-slide-to-pptx
npm run check-env
# If dependencies are missing: npm ci
```

Then run the conversion (from the `html-slide-to-pptx` skill directory):

```bash
node scripts/html_to_pptx.js <input.html> <output.pptx> --preset=<preset-name> --dump-model <model.json>
```

For multi-slide decks, convert each HTML file separately and note the output
paths. Merge instructions are in `references/workflow-pipeline.md`.

### Stage 10 — QA & delivery

Run preflight QA (from the `html-slide-to-pptx` skill directory):

```bash
node scripts/preflight_qa.js <model.json> --preset=<preset-name> --report <qa-report.json>
```

Check for:
- text overflow (fail-level)
- title/subtitle collision (high severity)
- chip/card text clipping
- stack height pressure
- insufficient spacing

Address all fail-level issues. Warn-level issues should be reviewed but may
be acceptable. Deliver the final PPTX file path(s) to the user.

## References

- `references/workflow-pipeline.md` — detailed stage-by-stage pipeline with commands
- `references/html-preset-bridge.md` — how to generate HTML that maps to presets
- `references/preset-extension-guide.md` — how to add new presets when needed
