# HTML ↔ Preset Bridge Guide

This document defines how to generate HTML slides that are both previewable
in a browser and convertible by `html-slide-to-pptx`.

The core idea: **structure HTML with semantic classes that the preset
extraction logic can parse**, while keeping the visual design independent.

## Universal HTML requirements

All slides must follow these rules regardless of preset:

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Slide Title</title>
  <style>
    /* 16:9 fixed canvas */
    body { margin: 0; }
    .slide {
      width: 1280px;   /* or 1920px */
      height: 720px;   /* or 1080px */
      position: relative;
      overflow: hidden;
    }
  </style>
</head>
<body data-preset="preset-name">
  <div class="slide">
    <!-- slide content -->
  </div>
</body>
</html>
```

### Rules

1. **`data-preset` on `<body>`** — tells the converter which preset to use
2. **Fixed canvas** — 1280×720 or 1920×1080, `overflow: hidden`
3. **Self-contained** — all CSS in `<style>`, no external resources
4. **Text in HTML** — no text baked into images
5. **Semantic classes** — use the class names defined per preset below

---

## Preset: `v9-architecture`

Use for three-column analyst slides:
- Left driver panel + center layered architecture + right judgement chain

### Required HTML structure

```html
<body data-preset="v9-architecture">
<div class="slide">

  <!-- Header -->
  <div class="eyebrow">ANALYST REPORT · 2025</div>
  <div class="brand">Brand Name</div>
  <h1 class="title">Slide Title Here</h1>

  <!-- Core summary box -->
  <div class="core-box">
    <span>Core summary text with </span>
    <span style="color: var(--teal); font-weight: bold;">highlighted keywords</span>
    <span> continuing here.</span>
  </div>

  <!-- Main three-column area -->
  <div class="main">

    <!-- Left driver panel -->
    <div class="panel">
      <div class="panel-title">驱动因素</div>
      <div class="drivers-body">
        <div class="section">
          <div class="section-header">外部驱动</div>
          <ul>
            <li><span>•</span><span>External driver item 1</span></li>
            <li><span>•</span><span>External driver item 2</span></li>
          </ul>
        </div>
      </div>
      <div class="driver-bridge-title">共同指向</div>
      <div class="driver-bridge-text">Bridge text describing convergence</div>
      <div class="drivers-body">
        <div class="section">
          <div class="section-header">内部驱动</div>
          <ul>
            <li><span>•</span><span>Internal driver item 1</span></li>
          </ul>
        </div>
      </div>
    </div>

    <!-- Center architecture stack -->
    <div class="center-wrap">
      <!-- Layer 1: Top -->
      <div class="layer">
        <h3><span class="layer-tag">01</span> Layer Title</h3>
        <div class="desc">Layer description text</div>
      </div>

      <!-- Layer 2: Agent frameworks -->
      <div class="layer">
        <h3><span class="layer-tag">02</span> Agent Frameworks</h3>
        <div class="fw-card">
          <strong>Framework Name</strong>
          <span>Framework description</span>
        </div>
        <!-- more fw-card elements -->
      </div>

      <!-- Layer 3: Products -->
      <div class="layer">
        <h3><span class="layer-tag">03</span> Product Layer</h3>
        <div class="mini">
          <strong>Product Name</strong>
          <span>Product description</span>
        </div>
        <!-- more mini elements -->
      </div>

      <!-- Layer 4: Foundation chips -->
      <div class="layer">
        <h3><span class="layer-tag">04</span> Foundation</h3>
        <div class="desc">Foundation description</div>
        <div class="chip">Chip label 1</div>
        <div class="chip">Chip label 2</div>
        <!-- more chips -->
      </div>
    </div>

    <!-- Right judgement panel -->
    <div class="judgement-panel">
      <div class="panel-title">判断链</div>
      <div class="judgement-sub">Subtitle text</div>
      <div class="judgement-item">
        <strong>Item Title</strong>
        <span>核心机制：Mechanism description</span>
        <span>判断产出：Output description</span>
      </div>
      <!-- more judgement-item elements -->
    </div>

  </div>
</div>
</body>
```

### Extracted fields

| CSS selector | Field | Notes |
|-------------|-------|-------|
| `.eyebrow` | eyebrow | Top-left small label |
| `.brand` | brand | Top-right brand text |
| `.title` | title | Main slide title |
| `.core-box` | coreRuns | Inline spans with style for colored text |
| `.main > .panel` (first) | left panel | Left driver panel |
| `.panel-title` | left.title | Panel heading |
| `.section-header` | externalTitle / internalTitle | Section labels |
| `li span:last-child` | externalItems / internalItems | List item text |
| `.driver-bridge-title` | left.bridgeTitle | Bridge heading |
| `.driver-bridge-text` | left.bridgeText | Bridge body |
| `.center-wrap .layer` (×4) | center.layers | 4 stacked layers |
| `h3 .layer-tag` | layer.tag | Layer number badge |
| `h3` (text only) | layer.title | Layer heading |
| `.desc` | layer.desc | Layer description |
| `.fw-card strong` | framework.title | Card title |
| `.fw-card span` | framework.body | Card body |
| `.mini strong` | product.title | Product card title |
| `.mini span` | product.body | Product card body |
| `.chip` | layer.chips | Foundation chips |
| `.judgement-panel .panel-title` | right.title | Right panel heading |
| `.judgement-sub` | right.subtitle | Right panel subtitle |
| `.judgement-item strong` | item.title | Judgement item title |
| `.judgement-item span` (1st) | item.mechanism | Auto-strips "核心机制：" prefix |
| `.judgement-item span` (2nd) | item.output | Auto-strips "判断产出：" prefix |

### Layout expectations

- 4 layers in the center stack (index 0-3)
- Layer 1: top concept, with desc
- Layer 2: agent frameworks, with `.fw-card` elements
- Layer 3: products, with `.mini` elements (2-column grid)
- Layer 4: foundation, with `.chip` elements (2 rows)

---

## Preset: `ai-runtime-page`

Use for runtime/process slides:
- Input chips → process modules → support cards → output chips

### Required HTML structure

```html
<body data-preset="ai-runtime-page">
<div class="slide">

  <!-- Header -->
  <div class="eyebrow">AI RUNTIME · 2025</div>
  <div class="brand">Brand Name</div>
  <h1 class="title">AI Runtime Architecture</h1>

  <!-- Lead box -->
  <div class="lead">Lead paragraph summarizing the runtime</div>

  <!-- Input chip row -->
  <div class="inputs">
    <div class="chip">Input 1</div>
    <div class="chip">Input 2</div>
    <div class="chip">Input 3</div>
  </div>

  <!-- Runtime main box -->
  <div class="runtime-title">Runtime Layer Title</div>
  <div class="modules">
    <div class="module" data-num="1">
      <div class="module-title">Module Title</div>
      <div class="module-en">English Label</div>
      <div class="module-body">Module description text</div>
    </div>
    <!-- more modules (typically 5) -->
  </div>

  <!-- Support layer -->
  <div class="supports">
    <div class="support">
      <div class="support-title">Support Title</div>
      <div class="support-body">Support description</div>
    </div>
    <!-- more support cards (typically 3) -->
  </div>

  <!-- Output chip row -->
  <div class="outputs">
    <div class="chip">Output 1</div>
    <div class="chip">Output 2</div>
  </div>

  <!-- Base layer -->
  <div class="base-layer">
    <div class="base-item">Base item 1</div>
    <div class="base-item">Base item 2</div>
  </div>

  <!-- Takeaway -->
  <div class="takeaway">Key takeaway sentence</div>

</div>
</body>
```

### Extracted fields

| CSS selector | Field | Notes |
|-------------|-------|-------|
| `.eyebrow` | eyebrow | Top-left label |
| `.brand` | brand | Top-right brand |
| `.title` | title | Slide title |
| `.lead` | lead | Lead paragraph |
| `.inputs .chip` | inputs[] | Input context chips |
| `.runtime-title` | runtimeTitle | Runtime layer heading |
| `.modules .module` | modules[] | Process modules |
| `[data-num]` | module.num | Module number |
| `.module-title` | module.title | Module heading |
| `.module-en` | module.en | English subtitle |
| `.module-body` | module.body | Module description |
| `.supports .support` | supports[] | Support cards |
| `.support-title` | support.title | Card heading |
| `.support-body` | support.body | Card description |
| `.outputs .chip` | outputs[] | Output judgement chips |
| `.base-layer .base-item` | base[] | Foundation items |
| `.takeaway` | takeaway | Bottom summary sentence |

### Layout expectations

- Typically 5 modules in a row with chevron flow
- Typically 3 support cards
- Input chips above runtime, output chips below
- Base layer at bottom with 3 items
- Takeaway as bottom bar

---

## Slide families without existing presets

When a slide does not fit `v9-architecture` or `ai-runtime-page`, generate
HTML with clear semantic structure and **do not** set `data-preset`.

### Recommended semantic structure for common families

#### Cover slide

```html
<div class="slide cover">
  <div class="eyebrow">EVENT · DATE</div>
  <div class="brand">Brand</div>
  <h1 class="title">Main Title</h1>
  <div class="subtitle">Subtitle</div>
  <div class="presenter">Presenter Name · Title</div>
</div>
```

#### Comparison slide

```html
<div class="slide comparison">
  <div class="eyebrow">COMPARISON</div>
  <h1 class="title">Title</h1>
  <div class="lead">Lead text</div>
  <div class="comparison-grid">
    <div class="col">
      <div class="col-header">Option A</div>
      <div class="card"><strong>Point 1</strong><span>Detail</span></div>
    </div>
    <div class="col">
      <div class="col-header">Option B</div>
      <div class="card"><strong>Point 1</strong><span>Detail</span></div>
    </div>
  </div>
  <div class="takeaway">Conclusion</div>
</div>
```

#### Timeline slide

```html
<div class="slide timeline">
  <div class="eyebrow">TIMELINE</div>
  <h1 class="title">Title</h1>
  <div class="timeline-track">
    <div class="milestone">
      <div class="milestone-date">2025 Q1</div>
      <div class="milestone-title">Milestone</div>
      <div class="milestone-body">Description</div>
    </div>
    <!-- more milestones -->
  </div>
  <div class="takeaway">Summary</div>
</div>
```

#### Card grid slide

```html
<div class="slide card-grid">
  <div class="eyebrow">OVERVIEW</div>
  <h1 class="title">Title</h1>
  <div class="lead">Lead text</div>
  <div class="grid">
    <div class="card">
      <div class="card-title">Card Title</div>
      <div class="card-body">Card content</div>
    </div>
    <!-- more cards -->
  </div>
  <div class="takeaway">Summary</div>
</div>
```

#### Data dashboard slide

```html
<div class="slide dashboard">
  <div class="eyebrow">DATA</div>
  <h1 class="title">Title</h1>
  <div class="metrics">
    <div class="metric">
      <div class="metric-value">95%</div>
      <div class="metric-label">Label</div>
    </div>
    <!-- more metrics -->
  </div>
  <div class="takeaway">Key insight</div>
</div>
```

#### Conclusion slide

```html
<div class="slide conclusion">
  <div class="eyebrow">CONCLUSION</div>
  <h1 class="title">总结与展望</h1>
  <div class="summary-points">
    <div class="point"><strong>Point 1</strong><span>Detail</span></div>
    <!-- more points -->
  </div>
  <div class="takeaway">Final takeaway</div>
</div>
```

These structures are **preset-ready**: when a new preset is needed, the
extraction logic can target these semantic classes directly.

---

## HTML generation checklist

Before finalizing HTML for any slide:

- [ ] Canvas is fixed 16:9 (1280×720 or 1920×1080)
- [ ] All CSS is inline or in `<style>`, no external resources
- [ ] `data-preset` is set if targeting a known preset
- [ ] Semantic class names match preset extraction selectors
- [ ] All text is in HTML elements (not images)
- [ ] Slide renders correctly in a browser
- [ ] No text overflow at the target canvas size
- [ ] Consistent visual language across all slides in the deck

## Common mistakes

1. **Using visual class names instead of semantic ones**
   - Bad: `.blue-box`, `.left-thing`
   - Good: `.core-box`, `.judgement-panel`

2. **Forgetting `data-preset`**
   - Without it, the converter falls back to filename heuristics

3. **Nesting chips inside wrong containers**
   - Input chips must be inside `.inputs`, output chips inside `.outputs`
   - Foundation chips must be inside `.layer` (4th layer)

4. **Missing `data-num` on modules**
   - The module number badge uses `data-num` attribute, not text content

5. **Using `<div>` instead of semantic tags for key text**
   - The converter reads `.title` from any element, but `<h1 class="title">`
     is clearer for both preview and extraction
