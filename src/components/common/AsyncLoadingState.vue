<template>
  <div class="async-loading-state" role="status" aria-busy="true">
    <span class="loading-line loading-line--wide"></span>
    <span class="loading-line loading-line--medium"></span>
    <span class="loading-line loading-line--short"></span>
  </div>
</template>

<style scoped lang="scss">
.async-loading-state {
  width: 100%;
  height: 100%;
  min-height: 160px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 12px;
  padding: 32px;
  box-sizing: border-box;
}

.loading-line {
  display: block;
  height: 12px;
  border-radius: 6px;
  background: var(--surface-hover, rgba(127, 127, 127, 0.12));
  animation: loading-pulse 1.2s ease-in-out infinite;
}

.loading-line--wide { width: min(420px, 80%); }
.loading-line--medium { width: min(300px, 60%); }
.loading-line--short { width: min(180px, 36%); }

@keyframes loading-pulse {
  0%, 100% { opacity: 0.45; }
  50% { opacity: 0.9; }
}
</style>
