# Preset Extension Guide

How to add a new preset to the `html-slide-to-pptx` skill when existing presets
do not fit the incoming HTML slide family.

This guide complements the built-in documentation in the `html-slide-to-pptx`
skill's `references/` directory:
- `preset-decision-rules.md`
- `preset-template.md`
- `presets.md`
- `qa-heuristics.md`

All file paths below are relative to the `html-slide-to-pptx` skill directory
(e.g., `.claude/skills/html-slide-to-pptx/`).

## When to extend

Create a new preset when **any** of these are true:
- The slide tells a different kind of story (e.g., timeline vs. architecture)
- Major semantic regions are missing, merged, reordered, or replaced
- The object grammar changed (e.g., chips → timeline nodes)
- Existing layout would need many conditional branches to survive
- QA rules would need a substantially different checklist

Do **not** create a new preset when:
- Only text, labels, or card counts changed slightly → reuse
- One local panel grew modestly → extend as bounded variant

## Extension process

### Step 1: Copy template files

```bash
cd .claude/skills/html-slide-to-pptx

cp scripts/preset_template.js scripts/<name>_preset.js
cp scripts/layout_template.js scripts/layout_<name>.js
```

Example names:
- `cover_preset.js` + `layout_cover.js`
- `comparison_preset.js` + `layout_comparison.js`
- `timeline_preset.js` + `layout_timeline.js`
- `card_grid_preset.js` + `layout_card_grid.js`

### Step 2: Define the preset name

In `scripts/<name>_preset.js`, replace:

```javascript
const PRESET = 'replace-me-preset';
```

with:

```javascript
const PRESET = '<name>';  // e.g., 'cover', 'comparison', 'timeline'
```

Also rename functions:
- `extractTemplatePage` → `extract<Name>` (e.g., `extractCover`)
- `renderTemplatePage` → `render<Name>` (e.g., `renderCover`)

### Step 3: Implement DOM extraction

Write the extraction function that parses HTML into a compact model.

```javascript
function extract<Name>(htmlPath) {
  const $ = cheerio.load(fs.readFileSync(htmlPath, 'utf8'));
  return {
    preset: PRESET,
    eyebrow: normalizeText($('.eyebrow').first().text()),
    brand: normalizeText($('.brand').first().text()),
    title: normalizeText($('.title').first().text()),
    // ... add slide-specific fields
  };
}
```

#### Extraction principles

1. **Select by meaning, not by visual styling**
   - Good: `.milestone-title`, `.metric-value`
   - Bad: `.blue-text`, `.large-font`

2. **Use `.first()` for singleton elements** to avoid accidental multi-match

3. **Normalize all text** with the `normalizeText` helper:
   ```javascript
   function normalizeText(text) {
     return String(text || '')
       .replace(/\u00a0/g, ' ')
       .replace(/[\t\r\n]+/g, ' ')
       .replace(/\s+/g, ' ')
       .trim();
   }
   ```

4. **Extract arrays** for repeated elements:
   ```javascript
   cards: $('.card').toArray().map((el) => ({
     title: normalizeText($(el).find('.card-title').first().text()),
     body: normalizeText($(el).find('.card-body').first().text()),
   })),
   ```

### Step 4: Implement layout mapping

In `scripts/layout_<name>.js`, define:
1. A `MAIN` coordinate map (fixed positions in inches)
2. A `compute<Name>Layout(model)` function that computes dynamic sizes

```javascript
const MAIN = {
  headerX: 0.73,
  eyebrowY: 0.44,
  titleY: 0.86,
  // ... fixed coordinates in inches
};

function compute<Name>Layout(model) {
  const titleFont = fitFontSize({
    text: model.title,
    widthIn: 8.5,
    heightIn: 0.34,
    startSizePt: 26,
    minSizePt: 20,
    lineSpacing: 1.0,
    charFactor: 0.98,
  });
  // ... compute fonts for all text elements
  return { main: MAIN, titleFont, /* ... */ };
}
```

#### Layout principles

1. **Fixed coordinates in inches** — PPTX uses inches, not pixels
2. **Wide layout** — `pptx.layout = 'LAYOUT_WIDE'` means 13.33 × 7.5 inches
3. **Use `fitFontSize`** for all dynamic text — it shrinks font size to fit
4. **Use `clamp`** to keep dimensions within safe bounds
5. **Keep coordinates stable** — avoid computed positions that cascade

Available utilities from `layout_utils.js`:
- `clamp(n, min, max)`
- `weightedLen(text)` — character width weighting (CJK vs ASCII)
- `estimateLines(text, widthIn, fontSizePt, opts)` — estimate line count
- `requiredTextHeightIn(text, widthIn, fontSizePt, opts)` — height needed
- `fitFontSize({ text, widthIn, heightIn, startSizePt, minSizePt, ... })` — auto-shrink
- `bulletBlock(items)` — join items with bullet prefixes

### Step 5: Implement rendering

In `scripts/<name>_preset.js`, write the render function:

```javascript
function render<Name>(model, outPath, pptx) {
  const layout = compute<Name>Layout(model);
  const slide = pptx.addSlide();
  slide.background = { color: COLORS.bg };

  // Add text boxes
  addText(slide, model.title, {
    x: MAIN.headerX, y: MAIN.titleY,
    w: 8.5, h: 0.30,
    fontSize: layout.titleFont,
    bold: true,
    color: COLORS.navy,
  });

  // Add shapes (rounded rectangles, arrows, etc.)
  addRoundedRect(slide, pptx, {
    x: 0.72, y: 2.04, w: 3.64, h: 3.98,
    fill: { color: COLORS.card },
    line: { color: COLORS.line, width: 1 },
  });

  // ... render all elements

  ensureDir(outPath);
  return { model, layout, write: () => pptx.writeFile({ fileName: outPath }) };
}
```

#### Rendering principles

1. **Prefer native PowerPoint objects** — text boxes, shapes, arrows
2. **Editability over visual fidelity** — the output must be editable in PowerPoint
3. **Explicit fonts** — set `fontFace`, `fontSize`, `color`, `bold` explicitly
4. **No `fit: 'shrink'`** — it's unreliable in PptxGenJS; use `fitFontSize` instead
5. **Set `margin: 0`** and control spacing explicitly

Common shape types:
```javascript
pptx.ShapeType.roundRect    // rounded rectangle
pptx.ShapeType.rect         // sharp rectangle
pptx.ShapeType.ellipse      // circle/ellipse
pptx.ShapeType.line         // line
pptx.ShapeType.downArrow    // downward arrow
pptx.ShapeType.chevron      // chevron arrow
```

### Step 6: Register in the entry script

Update `scripts/html_to_pptx.js` (in the `html-slide-to-pptx` skill directory):

```javascript
// 1. Import the new preset
const { PRESET: COVER_PRESET, extractCover, renderCover } = require('./cover_preset');

// 2. Add to detectPreset
function detectPreset(inputPath, forcedPreset) {
  if (forcedPreset) return forcedPreset;
  const html = fs.readFileSync(inputPath, 'utf8');
  const $ = cheerio.load(html);
  const declared = $('body').attr('data-preset');
  if (declared) return declared;
  // ... existing heuristics
}

// 3. Add dispatch in main()
async function main() {
  // ...
  if (preset === COVER_PRESET) return runCover(opts);
  // ...
}

// 4. Add runner function
async function runCover(opts) {
  const model = extractCover(opts.input);
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'PPT Office Assistant';
  pptx.title = model.title;
  pptx.theme = { headFontFace: 'PingFang SC', bodyFontFace: 'PingFang SC' };

  const rendered = renderCover(model, opts.output, pptx);
  if (opts.dumpModel) {
    ensureDir(opts.dumpModel);
    fs.writeFileSync(opts.dumpModel, JSON.stringify(rendered.model, null, 2), 'utf8');
  }
  await rendered.write();
  console.log(opts.output);
}
```

### Step 7: Add QA support

Update `scripts/preflight_qa.js` (in the `html-slide-to-pptx` skill directory):

```javascript
// 1. Import layout
const { computeCoverLayout, MAIN: COVER_MAIN } = require('./layout_cover');

const COVER_PRESET = 'cover';

// 2. Add detection
function detectPreset(model, forcedPreset) {
  if (forcedPreset) return forcedPreset;
  if (model && model.preset) return model.preset;
  return V9_PRESET;
}

// 3. Add check function
function coverChecks(model) {
  const layout = computeCoverLayout(model);
  const results = [];

  results.push(assessBlock({
    name: 'title',
    text: model.title,
    widthIn: 8.5,
    heightIn: 0.34,
    fontSizePt: layout.titleFont,
    lineSpacing: 1.0,
    charFactor: 0.98,
    severityIfFail: 'high',
    note: 'Title should not overflow.'
  }));

  // ... add more checks for each text element

  return { results, layout };
}

// 4. Add dispatch in main()
if (preset === COVER_PRESET) payload = coverChecks(model);
```

### Step 8: Document the preset

Update the `html-slide-to-pptx` skill's `references/presets.md`:

```markdown
## <preset-name>

Source file used during prototyping:
- `path/to/prototype.html`

Semantic regions:
1. region 1
2. region 2
...

Important styling choices captured in code:
- styling note 1
- styling note 2
```

### Step 9: Test

```bash
cd .claude/skills/html-slide-to-pptx

# Convert
node scripts/html_to_pptx.js test-slide.html output.pptx --preset=<name> --dump-model model.json

# QA
node scripts/preflight_qa.js model.json --preset=<name> --report qa.json

# Open output.pptx and visually inspect
```

## Sanity checklist

Before calling the new preset done:

- [ ] Preset name is unique and consistent across all files
- [ ] Extraction returns meaningful structured data
- [ ] Render output is editable, not screenshot-based
- [ ] `html_to_pptx.js` can detect and dispatch to the new preset
- [ ] `preflight_qa.js` can validate the new preset
- [ ] `references/presets.md` is updated
- [ ] Test command works on a real HTML file
- [ ] QA report has no fail-level issues (or they are addressed)

## Suggested preset names

Based on common slide families:

| Slide family | Suggested preset name | Priority |
|-------------|----------------------|----------|
| Cover | `cover` | High |
| Comparison (2-column) | `comparison` | High |
| Timeline / roadmap | `timeline` | Medium |
| Card grid (3-column) | `card-grid` | Medium |
| Data dashboard | `dashboard` | Medium |
| Conclusion | `conclusion` | Low |
| Text + image | `text-image` | Low |

## Principle

A new preset is cheaper than abusing an old one.

Keep presets small, explicit, and page-family specific. Do not overload an
existing preset with conditional branches to handle structurally different pages.
