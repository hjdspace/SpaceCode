/**
 * 已打开的浮层栈。必须是真正的模块级单例 —— 写在某个组件的 <script setup> 里
 * 会被编译进 setup()，变成每个实例一份，父浮层就会把子浮层内部的点击误判成
 * 「点击外部」而连带关掉。
 *
 * 浮层都会被 Teleport 到 body，父浮层的 DOM 里查不到子浮层，所以「点击外部」
 * 与 Escape 只认栈内图形的判断只能靠这份共享栈。
 */
export const openPopoverStack: HTMLElement[] = []

export function pushPopover(el: HTMLElement) {
  if (!openPopoverStack.includes(el)) openPopoverStack.push(el)
}

export function removePopover(el: HTMLElement) {
  const i = openPopoverStack.indexOf(el)
  if (i >= 0) openPopoverStack.splice(i, 1)
}

export function isInsideAnyPopover(target: Node): boolean {
  return openPopoverStack.some((el) => el.contains(target))
}

export function isTopmostPopover(el: HTMLElement | null): boolean {
  return el !== null && openPopoverStack[openPopoverStack.length - 1] === el
}
