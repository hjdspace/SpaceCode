# Workflow Pipeline

Detailed stage-by-stage pipeline with commands and decision points.

## Skill locations

All three skills are installed as siblings under `.claude/skills/` in the
session working directory:

```
.claude/skills/
├── ppt-office-assistant/     ← this orchestrator skill
│   ├── SKILL.md
│   └── references/
├── ppt-workflow/             ← content planning methodology
│   └── references/prompts.md
└── html-slide-to-pptx/       ← HTML-to-PPTX conversion engine
    ├── scripts/
    └── references/
```

When the engine invokes a skill, it prepends a `Base directory for this skill:`
line — use that path to locate scripts and reference files.

For commands below, `HTML_TO_PPTX_DIR` refers to the `html-slide-to-pptx` skill
directory (typically `.claude/skills/html-slide-to-pptx/`).

## Stage 1: Clarify Brief

### Input modes

| Mode | Description | Action |
|------|-------------|--------|
| Topic-only | User gives just a topic | Ask for audience, purpose, page count, style |
| Topic + brief | User provides audience, purpose, style, page count | Proceed directly |
| Source-driven | User provides URLs, reports, PDFs, notes | Treat as primary context |
| Existing outline | User has structure or partial draft | Improve rather than regenerate |

### Minimum fields to collect

- topic
- audience
- purpose
- page-count range
- style or tone
- must-have sections
- must-avoid claims
- fast output vs staged confirmation

### Output

A brief summary confirming the task parameters before proceeding.

---

## Stage 2: Research / Context

### When to research

- Topic depends on current events, market data, or statistics
- User explicitly requests research-backed content
- User-provided material is incomplete

### When to skip

- User provided sufficient material
- Topic is well-known or evergreen
- User wants fast output

### Output: Research brief

Compact document with:
- Key facts
- Supporting evidence
- Audience-relevant context
- Risks, caveats, unresolved questions
- Source references

Use the "Research Brief" prompt from the `ppt-workflow` skill's
`references/prompts.md`.

---

## Stage 3: Outline

### Method

Use the "Outline Architect" prompt from the `ppt-workflow` skill's
`references/prompts.md`.

Apply the pyramid principle:
1. Conclusion first
2. Top-down support
3. Grouped categorization
4. Logical progression

### Output format

JSON wrapped in `[PPT_OUTLINE]` / `[/PPT_OUTLINE]`:

```json
{
  "ppt_outline": {
    "cover": { "title": "...", "sub_title": "..." },
    "table_of_contents": { "title": "目录", "content": ["...", "..."] },
    "parts": [
      {
        "part_title": "...",
        "part_goal": "...",
        "pages": [
          { "title": "...", "goal": "...", "content": ["...", "..."] }
        ]
      }
    ],
    "end_page": { "title": "总结与展望", "content": [] }
  }
}
```

### Review checkpoint

For high-stakes decks (external-facing, board, sales), pause here for user
review of the outline before proceeding.

---

## Stage 4: Planning Draft (策划稿)

### Method

Use the "Planning Draft" prompt from the `ppt-workflow` skill's
`references/prompts.md`.

### Per-page planning card

Each page must specify:
1. Page title
2. Page goal (what the audience should remember)
3. Core messages (3-6 points)
4. Evidence/data/case sources
5. Recommended visual treatment:
   - comparison / flow / timeline / data card / quadrant / big image + annotations / card grid
6. Information hierarchy
7. Keywords to emphasize
8. Design notes (what must not be weakened, what can be decorative)

### Slide family classification

During planning, classify each page into a slide family:

| Family | Typical structure | Existing preset? |
|--------|-------------------|-----------------|
| Cover | Title + subtitle + brand | No (needs new preset) |
| Architecture | Left panel + center stack + right panel | `v9-architecture` |
| AI Runtime | Input chips + modules + support + output chips | `ai-runtime-page` |
| Comparison | Two or more columns side by side | No (needs new preset) |
| Timeline | Horizontal or vertical milestone sequence | No (needs new preset) |
| Data dashboard | Multiple data cards / charts | No (needs new preset) |
| Text + image | Text block + supporting image | No (needs new preset) |
| Card grid | N cards in a grid layout | No (needs new preset) |
| Conclusion | Summary points + takeaway | No (needs new preset) |

This classification determines HTML structure in Stage 5 and preset matching
in Stage 7.

---

## Stage 5: HTML Slide Generation

### Bridge principle

The HTML generated here must be:
1. **Previewable** — renders correctly in a browser
2. **Preset-compatible** — uses semantic structure that can be extracted

### Before generating HTML

Read `references/html-preset-bridge.md` for:
- Semantic CSS class conventions per preset
- `data-preset` attribute usage
- Structural requirements for each slide family

### HTML generation rules

1. **16:9 aspect ratio** — target 1280×720 or 1920×1080
2. **Self-contained** — all CSS inline or in `<style>`, no external resources
3. **Semantic structure** — use meaningful class names, not just visual names
4. **Fixed layout** — use `position: absolute` or flexbox with fixed dimensions
5. **Text-first** — all text content in HTML elements, not in images
6. **`data-preset` attribute** — add to `<body>` when targeting a known preset

### Output

All output files must be written under the session working directory's
`outputs/` folder so they appear in the product panel. For each slide,
generate:
- `outputs/slides/slide-01-cover.html`
- `outputs/slides/slide-02-outline.html`
- `outputs/slides/slide-03-architecture.html`
- etc.

### Multi-slide export

If the environment supports PNG export, also generate:
- `outputs/slides/slide-01-cover.png`
- `outputs/slides/slide-02-outline.png`
- etc.

---

## Stage 6: Preview & Review Gate

### What to present

- HTML files opened in browser, or
- PNG screenshots if rendering is available

### Review checklist for user

- [ ] Is the overall layout correct?
- [ ] Is the information hierarchy clear?
- [ ] Is the content expression appropriate?
- [ ] Are there text overflow or spacing issues?
- [ ] Does the visual style match expectations?
- [ ] Are all pages consistent in design language?

### Gate behavior

- **User confirms** → proceed to Stage 7
- **User requests changes** → loop back to Stage 5 with specific feedback
- **User wants structural changes** → loop back to Stage 3 or 4

---

## Stage 7: Preset Match Check

### Decision process

For each HTML slide, follow the decision tree in the `html-slide-to-pptx`
skill's `references/preset-decision-rules.md`.

#### Step 1: Identify the slide family

Check the page's story type:
- Architecture stack / judgement chain? → candidate for `v9-architecture`
- Runtime process / support / outputs? → candidate for `ai-runtime-page`
- Other? → likely needs new preset

#### Step 2: Check semantic regions

Compare the HTML's major regions against preset expectations:

**v9-architecture regions:**
1. topbar (eyebrow + brand)
2. title
3. core summary box
4. left driver panel
5. center layered architecture stack
6. right judgement chain

**ai-runtime-page regions:**
1. header (eyebrow + brand)
2. title + lead box
3. input chip row
4. runtime title + main process modules
5. support layer cards
6. output chip row
7. base layer
8. takeaway

#### Step 3: Decision output

State explicitly:
- `Decision: reuse existing preset <name>.` → Stage 9
- `Decision: extend existing preset <name> as a bounded variant.` → Stage 8
- `Decision: create a new preset for this slide family.` → Stage 8

---

## Stage 8: Preset Extension

Only when Stage 7 decides to extend or create new preset.

Read `references/preset-extension-guide.md` for the complete process.

### Quick summary

1. Copy template files (inside the `html-slide-to-pptx` skill's `scripts/`):
   - `scripts/preset_template.js` → `scripts/<name>_preset.js`
   - `scripts/layout_template.js` → `scripts/layout_<name>.js`

2. Implement three layers:
   - DOM extraction rules (parse HTML → model)
   - Layout/render mapping (model → PPTX coordinates)
   - QA rules (overflow, spacing, collision checks)

3. Register in the `html-slide-to-pptx` skill's `scripts/html_to_pptx.js`:
   - Add preset detection
   - Add dispatch to new renderer

4. Add QA support in `scripts/preflight_qa.js`

5. Document in the `html-slide-to-pptx` skill's `references/presets.md`

6. Test with actual HTML

---

## Stage 9: PPTX Conversion

### Environment check (first run only)

```bash
cd .claude/skills/html-slide-to-pptx
npm run check-env
```

If dependencies are missing:
```bash
npm ci
# or
npm install
```

### Single slide conversion

All output paths are relative to the session working directory and must be
placed under `outputs/`:

```bash
cd .claude/skills/html-slide-to-pptx
node scripts/html_to_pptx.js \
  outputs/slides/slide-01.html \
  outputs/slide-01.pptx \
  --preset=v9-architecture \
  --dump-model outputs/slide-01-model.json
```

### Multi-slide deck conversion

Convert each slide separately. All paths are relative to the session working
directory:

```bash
cd .claude/skills/html-slide-to-pptx
for slide in outputs/slides/slide-*.html; do
  name=$(basename "$slide" .html)
  node scripts/html_to_pptx.js \
    "$slide" \
    "outputs/${name}.pptx" \
    --preset=<preset-name> \
    --dump-model "outputs/${name}-model.json"
done
```

### Multi-slide merge

The current converter produces one PPTX per slide. To merge into a single deck:

1. Convert all slides individually
2. Use a merge step (python-pptx or manual) to combine slides
3. Alternatively, modify the converter to accept multiple HTML inputs

This is a known limitation. See the `html-slide-to-pptx` skill's
`references/roadmap.md`.

---

## Stage 10: QA & Delivery

### Run preflight QA

```bash
cd .claude/skills/html-slide-to-pptx
node scripts/preflight_qa.js \
  outputs/slide-01-model.json \
  --preset=v9-architecture \
  --report outputs/slide-01-qa.json
```

### QA result interpretation

| Status | Severity | Action |
|--------|----------|--------|
| fail | high | Must fix before delivery |
| fail | medium | Should fix, may proceed with warning |
| fail | low | Review, usually acceptable |
| warn | high | Strongly recommended to fix |
| warn | medium | Review and decide |
| warn | low | Informational |
| ok | info | No action needed |

### Common fixes

- **Text overflow**: reduce font size, increase container height, or shorten text
- **Title collision**: increase title-to-subtitle gap
- **Chip clipping**: widen chip or shorten text
- **Stack pressure**: reduce item count or compress spacing
- **Insufficient gaps**: adjust layout coordinates

### Delivery

Present to user:
1. Final PPTX file path(s) under `outputs/`
2. QA summary (pass/warn/fail counts)
3. Any known limitations or recommendations
4. Source HTML files under `outputs/slides/` for future re-conversion

---

## Quick reference: full pipeline command sequence

All paths are relative to the session working directory. All outputs go under
`outputs/` so they are visible in the product panel.

```bash
# 0. Ensure html-slide-to-pptx dependencies (first run only)
cd .claude/skills/html-slide-to-pptx && npm ci

# 1. Convert HTML to PPTX (per slide)
node scripts/html_to_pptx.js outputs/slides/slide-01.html outputs/slide-01.pptx \
  --preset=v9-architecture --dump-model outputs/slide-01-model.json

# 2. Run QA
node scripts/preflight_qa.js outputs/slide-01-model.json \
  --preset=v9-architecture --report outputs/slide-01-qa.json

# 3. Review QA report, fix issues, re-convert if needed
# 4. Deliver final PPTX (path: outputs/slide-01.pptx)
```
