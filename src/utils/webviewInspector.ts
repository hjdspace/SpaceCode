/**
 * Webview 元素检查器 (注入到客体页面内运行)。
 *
 * 设计要点:
 *  - 高频的 hover 高亮与 tooltip 完全在客体页内绘制, 不回传宿主, 避免跨进程刷屏。
 *  - 仅在「锁定选中」时, 通过 console.log(带魔法前缀) 把结构化数据回传宿主。
 *    宿主端监听 <webview> 的 console-message 事件解析, 因此无需为 webview 配置 preload。
 *
 * 宿主 -> 客体 控制: 通过 webview.executeJavaScript() 调用 window.__SPACECODE_INSPECTOR__.{enable,disable,moveSelection}。
 */

export const INSPECTOR_SELECT_PREFIX = 'SPACECODE_INSPECTOR_SELECT:'
export const INSPECTOR_CLEAR_PREFIX = 'SPACECODE_INSPECTOR_CLEAR:'

/** 注入脚本源码 (IIFE, 可重复注入, 幂等)。 */
export const INSPECTOR_SCRIPT = `(() => {
  if (window.__SPACECODE_INSPECTOR__) { window.__SPACECODE_INSPECTOR__.enable(); return; }

  const SELECT_PREFIX = ${JSON.stringify(INSPECTOR_SELECT_PREFIX)};
  const CLEAR_PREFIX = ${JSON.stringify(INSPECTOR_CLEAR_PREFIX)};

  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;z-index:2147483646;pointer-events:none;border:2px solid #1677ff;background:rgba(22,119,255,0.12);border-radius:2px;display:none;transition:all .04s ease;';
  const tip = document.createElement('div');
  tip.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;background:#fff;color:#222;font:12px/1.5 -apple-system,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.18);border-radius:8px;padding:8px 10px;display:none;min-width:160px;';
  const sizeTag = document.createElement('div');
  sizeTag.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;background:#1677ff;color:#fff;font:11px/1 monospace;padding:2px 6px;border-radius:4px;display:none;';

  let enabled = false;
  let current = null;
  let locked = false;

  function ensureMounted() {
    [box, tip, sizeTag].forEach(el => { if (!el.parentNode) document.documentElement.appendChild(el); });
  }

  function describe(el) {
    const cs = getComputedStyle(el);
    return {
      tagName: el.tagName.toLowerCase(),
      color: cs.color,
      font: cs.fontSize + ' ' + cs.fontFamily.split(',')[0].replace(/['"]/g,'').trim(),
      fontSize: cs.fontSize,
      fontFamily: cs.fontFamily,
      backgroundColor: cs.backgroundColor,
    };
  }

  function selectorOf(el) {
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== document.body && parts.length < 6) {
      let part = node.tagName.toLowerCase();
      if (node.id) { part += '#' + node.id; parts.unshift(part); break; }
      const cls = (node.className && typeof node.className === 'string')
        ? '.' + node.className.trim().split(/\\s+/).slice(0,2).join('.') : '';
      if (cls && cls !== '.') part += cls;
      const parent = node.parentElement;
      if (parent) {
        const sameTag = Array.from(parent.children).filter(c => c.tagName === node.tagName);
        if (sameTag.length > 1) part += ':nth-of-type(' + (sameTag.indexOf(node)+1) + ')';
      }
      parts.unshift(part);
      node = node.parentElement;
    }
    return parts.join(' > ');
  }

  function idClassOf(el) {
    let s = '';
    if (el.id) s += '#' + el.id;
    if (el.className && typeof el.className === 'string') {
      const c = el.className.trim().split(/\\s+/).filter(Boolean);
      if (c.length) s += '.' + c.join('.');
    }
    return s;
  }

  function paint(el) {
    const r = el.getBoundingClientRect();
    const d = describe(el);
    box.style.display = 'block';
    box.style.left = r.left + 'px';
    box.style.top = r.top + 'px';
    box.style.width = r.width + 'px';
    box.style.height = r.height + 'px';
    box.style.borderColor = locked ? '#fa541c' : '#1677ff';

    sizeTag.style.display = 'block';
    sizeTag.style.background = locked ? '#fa541c' : '#1677ff';
    sizeTag.textContent = Math.round(r.width) + ' x ' + Math.round(r.height);
    const stTop = r.top > 22 ? r.top - 20 : r.bottom + 4;
    sizeTag.style.left = r.left + 'px';
    sizeTag.style.top = stTop + 'px';

    tip.style.display = 'block';
    tip.innerHTML =
      '<div style="display:flex;justify-content:space-between;gap:16px;font-weight:600"><span>' + d.tagName + '</span><span style="color:#888">' + Math.round(r.width) + 'x' + Math.round(r.height) + '</span></div>' +
      '<div style="display:flex;justify-content:space-between;gap:16px;color:#666"><span>color</span><span>' + d.color + '</span></div>' +
      '<div style="display:flex;justify-content:space-between;gap:16px;color:#666"><span>font</span><span>' + d.font + '</span></div>';
    let tipTop = r.bottom + 8;
    if (tipTop + 80 > window.innerHeight) tipTop = Math.max(8, r.top - 88);
    tip.style.left = Math.min(r.left, window.innerWidth - 220) + 'px';
    tip.style.top = tipTop + 'px';
  }

  function emit(el) {
    const r = el.getBoundingClientRect();
    const d = describe(el);
    const payload = {
      selector: selectorOf(el),
      tagName: d.tagName,
      idClass: idClassOf(el),
      rect: { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) },
      styles: { color: d.color, font: d.font, fontSize: d.fontSize, fontFamily: d.fontFamily, backgroundColor: d.backgroundColor },
      textSnippet: (el.textContent || '').trim().slice(0, 120),
      outerHTMLSnippet: el.outerHTML.slice(0, 240),
      pageUrl: location.href,
      devicePixelRatio: window.devicePixelRatio || 1,
    };
    console.log(SELECT_PREFIX + JSON.stringify(payload));
  }

  function onMove(e) {
    if (!enabled || locked) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el === current) return;
    current = el;
    paint(el);
  }
  function onClick(e) {
    if (!enabled) return;
    e.preventDefault(); e.stopPropagation();
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el) return;
    current = el; locked = true; paint(el); emit(el);
  }
  function onKey(e) {
    if (!enabled || !locked || !current) return;
    let next = null;
    if (e.key === 'ArrowUp') next = current.parentElement;
    else if (e.key === 'ArrowDown') next = current.firstElementChild;
    else if (e.key === 'Escape') { window.__SPACECODE_INSPECTOR__.disable(); return; }
    if (next && next.nodeType === 1 && next !== document.body) {
      e.preventDefault(); current = next; paint(next); emit(next);
    }
  }

  window.__SPACECODE_INSPECTOR__ = {
    enable() {
      if (enabled) return;
      enabled = true; locked = false; current = null;
      ensureMounted();
      document.addEventListener('mousemove', onMove, true);
      document.addEventListener('click', onClick, true);
      document.addEventListener('keydown', onKey, true);
    },
    disable() {
      enabled = false; locked = false; current = null;
      box.style.display = tip.style.display = sizeTag.style.display = 'none';
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKey, true);
      console.log(CLEAR_PREFIX + '1');
    },
    moveSelection(dir) {
      if (!current) return;
      const next = dir === 'up' ? current.parentElement : current.firstElementChild;
      if (next && next.nodeType === 1 && next !== document.body) { current = next; locked = true; paint(next); emit(next); }
    },
  };

  window.__SPACECODE_INSPECTOR__.enable();
})();`

export interface InspectorSelection {
  selector: string
  tagName: string
  idClass: string
  rect: { x: number; y: number; width: number; height: number }
  styles: {
    color: string
    font: string
    fontSize: string
    fontFamily: string
    backgroundColor: string
  }
  textSnippet: string
  outerHTMLSnippet: string
  pageUrl: string
  devicePixelRatio: number
}

/** 把选中元素整合成发给 Agent 的结构化文字块。 */
export function buildSelectionMessage(sel: InspectorSelection, comment: string): string {
  const lines = [
    '【可视化改稿】',
    `元素: <${sel.tagName}${sel.idClass}>`,
    `定位: ${sel.selector}`,
    `尺寸: ${sel.rect.width}×${sel.rect.height}    样式: color ${sel.styles.color}; font ${sel.styles.font}`,
    `页面: ${sel.pageUrl}`,
  ]
  if (sel.textSnippet) lines.push(`文本: ${sel.textSnippet}`)
  lines.push(`修改需求: ${comment.trim() || '(见附图)'}`)
  return lines.join('\n')
}
