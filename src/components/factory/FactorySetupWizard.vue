<template>
  <div class="factory-overlay" role="dialog" aria-modal="true" @click.self="store.closeWizard()">
    <div class="factory-wizard">
      <header class="wizard-header">
        <h2>{{ t('factory.wizardTitle') }}</h2>
        <button class="icon-btn" :aria-label="t('factory.cancel')" @click="store.closeWizard()">
          <X :size="16" />
        </button>
      </header>

      <ol class="stepper">
        <li
          v-for="(label, index) in stepLabels"
          :key="label"
          class="step"
          :class="{ active: store.step === index + 1, done: store.step > index + 1 }"
        >
          <span class="step-dot">{{ index + 1 }}</span>
          <span class="step-label">{{ label }}</span>
        </li>
      </ol>

      <div class="wizard-body">
        <!-- Step 1: engine -->
        <section v-if="store.step === 1" class="step-panel">
          <h3>{{ t('factory.engineTitle') }}</h3>
          <p class="hint">{{ t('factory.engineDescription') }}</p>
          <div class="opt-list">
            <button
              v-for="engine in visibleEngines"
              :key="engine.engineType"
              class="opt-card"
              :class="{ selected: agent.engineType === engine.engineType }"
              :disabled="!engine.available"
              @click="selectEngine(engine.engineType)"
            >
              <span class="opt-title">{{ engineLabel(engine.engineType) }}</span>
              <span class="opt-sub">
                {{ engine.available ? t('factory.engineAvailable') : t('factory.engineUnavailable') }}
                <template v-if="engine.version"> · {{ t('factory.engineVersion', { version: engine.version }) }}</template>
              </span>
            </button>
          </div>
          <div class="model-note">
            <strong>{{ t('factory.modelTitle') }}</strong>
            <span v-if="context?.modelProfile.model">
              {{ t('factory.modelResolved', { model: context.modelProfile.model }) }}
            </span>
            <span v-else>{{ t('factory.modelMissing') }}</span>
          </div>
        </section>

        <!-- Step 2: isolation -->
        <section v-else-if="store.step === 2" class="step-panel">
          <h3>{{ t('factory.sandboxTitle') }}</h3>
          <p class="hint">{{ t('factory.sandboxDescription') }}</p>
          <div class="opt-list">
            <button
              class="opt-card"
              :class="{ selected: sandbox.type === 'worktree' }"
              @click="selectSandbox('worktree')"
            >
              <span class="opt-title">{{ t('factory.sandboxWorktree') }}</span>
              <span class="opt-sub">{{ t('factory.sandboxWorktreeDesc') }}</span>
            </button>
            <button
              class="opt-card"
              :class="{ selected: sandbox.type === 'docker' }"
              :disabled="!context?.dockerAvailable"
              @click="selectSandbox('docker')"
            >
              <span class="opt-title">
                {{ t('factory.sandboxDocker') }}
                <span v-if="!context?.dockerAvailable" class="badge">{{ t('factory.dockerMissing') }}</span>
              </span>
              <span class="opt-sub">{{ t('factory.sandboxDockerDesc') }}</span>
            </button>
            <button class="opt-card" disabled>
              <span class="opt-title">
                {{ t('factory.sandboxPodman') }}
                <span class="badge">{{ t('factory.comingSoon') }}</span>
              </span>
              <span class="opt-sub">{{ t('factory.sandboxPodmanDesc') }}</span>
            </button>
          </div>
          <label v-if="sandbox.type === 'docker'" class="field">
            <span>{{ t('factory.sandboxImageLabel') }}</span>
            <input
              :value="sandbox.imageName ?? ''"
              :placeholder="t('factory.sandboxImagePlaceholder')"
              @input="patchSandboxImage(($event.target as HTMLInputElement).value)"
            />
            <span class="hint">{{ t('factory.sandboxDockerHint') }}</span>
          </label>
          <p v-if="context && !context.repo.isGitRepo" class="error-text">{{ t('factory.notGitRepo') }}</p>
        </section>

        <!-- Step 3: task source -->
        <section v-else-if="store.step === 3" class="step-panel">
          <h3>{{ t('factory.trackerTitle') }}</h3>
          <p class="hint">{{ t('factory.trackerDescription') }}</p>
          <div class="opt-list">
            <button
              class="opt-card"
              :class="{ selected: tracker.type === 'local' }"
              @click="setTrackerType('local')"
            >
              <span class="opt-title">{{ t('factory.trackerLocal') }}</span>
              <span class="opt-sub">{{ t('factory.trackerLocalDesc') }}</span>
            </button>
            <button
              class="opt-card"
              :class="{ selected: tracker.type === 'github-issues' }"
              @click="setTrackerType('github-issues')"
            >
              <span class="opt-title">{{ t('factory.trackerGithub') }}</span>
              <span class="opt-sub">{{ t('factory.trackerGithubDesc') }}</span>
            </button>
          </div>

          <div v-if="tracker.type === 'github-issues'" class="field-group">
            <label class="field">
              <span>{{ t('factory.repoLabel') }}</span>
              <input
                :value="tracker.repo ?? ''"
                :placeholder="t('factory.repoPlaceholder')"
                @input="patchTracker({ repo: ($event.target as HTMLInputElement).value })"
              />
            </label>
            <label class="field">
              <span>{{ t('factory.labelLabel') }}</span>
              <input
                :value="tracker.label ?? ''"
                :placeholder="t('factory.labelPlaceholder')"
                @input="patchTracker({ label: ($event.target as HTMLInputElement).value })"
              />
            </label>

            <div class="field">
              <span>{{ t('factory.authLabel') }}</span>
              <div class="segmented">
                <button :class="{ active: (tracker.auth ?? 'gh') === 'gh' }" @click="patchTracker({ auth: 'gh' })">
                  {{ t('factory.authGh') }}
                </button>
                <button
                  :class="{ active: tracker.auth === 'token' }"
                  :disabled="!context?.encryptionAvailable"
                  @click="patchTracker({ auth: 'token' })"
                >
                  {{ t('factory.authToken') }}
                </button>
              </div>
              <p class="hint">
                <template v-if="(tracker.auth ?? 'gh') === 'gh'">
                  {{ context?.ghLoggedIn ? t('factory.authGhOk') : t('factory.authGhMissing') }}
                </template>
                <template v-else-if="!context?.encryptionAvailable">{{ t('factory.tokenEncryption') }}</template>
              </p>
              <button v-if="(tracker.auth ?? 'gh') === 'gh'" class="gh-check" @click="store.checkGhAuth()">
                {{ t('factory.refresh') }}
              </button>
            </div>

            <div v-if="tracker.auth === 'token'" class="field">
              <span>{{ t('factory.tokenLabel') }}</span>
              <div class="token-row">
                <input v-model="tokenInput" type="password" :placeholder="t('factory.tokenPlaceholder')" />
                <button
                  class="gh-check"
                  :disabled="store.tokenTesting || !tokenInput || !tracker.repo"
                  @click="verifyToken"
                >
                  {{ store.tokenTesting ? t('factory.testing') : t('factory.testToken') }}
                </button>
              </div>
              <p v-if="tokenMessage" class="hint" :class="{ 'error-text': !store.tokenResult?.ok }">
                {{ tokenMessage }}
              </p>
            </div>

            <div class="field">
              <span>{{ t('factory.mergeModeLabel') }}</span>
              <div class="segmented">
                <button
                  :class="{ active: (tracker.mergeMode ?? 'local') === 'local' }"
                  @click="patchTracker({ mergeMode: 'local' })"
                >
                  {{ t('factory.mergeLocal') }}
                </button>
                <button
                  :class="{ active: (tracker.mergeMode ?? 'local') === 'pr' }"
                  @click="patchTracker({ mergeMode: 'pr' })"
                >
                  {{ t('factory.mergePr') }}
                </button>
              </div>
              <p class="hint">{{ t('factory.mergeModeHint') }}</p>
            </div>

            <label class="checkbox-row">
              <input
                type="checkbox"
                :checked="tracker.commentIssue ?? true"
                @change="patchTracker({ commentIssue: ($event.target as HTMLInputElement).checked })"
              />
              <span>{{ t('factory.commentIssue') }}</span>
            </label>
            <label class="checkbox-row">
              <input
                type="checkbox"
                :checked="tracker.closeIssue ?? true"
                @change="patchTracker({ closeIssue: ($event.target as HTMLInputElement).checked })"
              />
              <span>{{ t('factory.closeIssue') }}</span>
            </label>
          </div>
        </section>

        <!-- Step 4: preflight -->
        <section v-else class="step-panel">
          <h3>{{ t('factory.preflightTitle') }}</h3>
          <p class="hint">{{ t('factory.preflightDescription') }}</p>

          <label class="field">
            <span>{{ t('factory.verifyCommandLabel') }}</span>
            <input v-model="verifyCommand" :placeholder="t('factory.verifyCommandPlaceholder')" @change="rerunPreflight" />
          </label>
          <label class="field">
            <span>{{ t('factory.installCommandLabel') }}</span>
            <input v-model="installCommand" :placeholder="t('factory.installCommandPlaceholder')" />
          </label>

          <div class="preflight-head">
            <span>{{ store.preflight ? t('factory.preflightDone') : t('factory.preflightEmpty') }}</span>
            <button class="gh-check" :disabled="store.saving" @click="store.runPreflight(root)">
              {{ t('factory.refreshPreflight') }}
            </button>
          </div>

          <ul v-if="store.preflight" class="preflight-list">
            <li v-for="item in store.preflight.items" :key="item.id" class="preflight-item" :class="item.level">
              <CheckCircle v-if="item.level === 'ok'" :size="15" />
              <AlertTriangle v-else-if="item.level === 'warn'" :size="15" />
              <XCircle v-else :size="15" />
              <span class="item-name">{{ t(`factory.item${itemLabelSuffix[item.id]}`) }}</span>
              <span v-if="itemDetail(item)" class="item-detail">{{ itemDetail(item) }}</span>
              <span class="level">{{ t(`factory.level${item.level[0].toUpperCase()}${item.level.slice(1)}`) }}</span>
            </li>
          </ul>

          <p v-if="store.preflight" class="hint" :class="{ 'error-text': store.blocking }">
            {{ store.blocking ? t('factory.blockingHint') : t('factory.readyHint') }}
          </p>
          <p v-if="store.saveError" class="error-text">{{ saveErrorText }}</p>
        </section>
      </div>

      <footer class="wizard-footer">
        <button v-if="store.step > 1" class="ghost-btn" @click="store.back()">{{ t('factory.back') }}</button>
        <span v-if="store.stepErrors.length" class="error-text">{{ errorText(store.stepErrors[0]) }}</span>
        <button v-if="store.step < 4" class="primary-btn" :disabled="!store.canGoNext" @click="store.next(root)">
          {{ t('factory.next') }}
        </button>
        <button
          v-else
          class="primary-btn"
          :disabled="store.blocking || store.saving"
          @click="finish"
        >
          {{ store.saving ? t('factory.saving') : t('factory.finish') }}
        </button>
      </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { X, CheckCircle, AlertTriangle, XCircle } from 'lucide-vue-next'
import type { FactoryEngineType, FactoryPreflightItem, FactorySandboxConfig, FactorySetupDraft } from '@/shared/factory'
import { useFactoryStore } from '@/stores/factory'
import { DEFAULT_DOCKER_IMAGE } from '@/stores/factory/setup'

const props = defineProps<{ root: string }>()
const { t } = useI18n()
const store = useFactoryStore()

const stepLabels = computed(() => [
  t('factory.stepEngine'),
  t('factory.stepSandbox'),
  t('factory.stepTracker'),
  t('factory.stepPreflight'),
])

const context = computed(() => store.context)
const visibleEngines = computed(() => (context.value?.engines ?? []).filter((engine) => engine.exposed))
const agent = computed<NonNullable<FactorySetupDraft['agent']>>(() => store.draft.agent ?? {})
const sandbox = computed<NonNullable<FactorySetupDraft['sandbox']>>(
  () => store.draft.sandbox ?? { type: 'worktree' },
)
type TrackerDraft = NonNullable<FactorySetupDraft['tracker']>
const tracker = computed<TrackerDraft>(
  () => store.draft.tracker ?? { type: 'local', mergeMode: 'local' },
)

const tokenInput = ref('')

function engineLabel(type: FactoryEngineType): string {
  return type === 'claude-code' ? 'Claude Code' : 'Pi'
}

function selectEngine(type: FactoryEngineType): void {
  store.draft.agent = { ...store.draft.agent, engineType: type }
}

function selectSandbox(type: FactorySandboxConfig['type']): void {
  if (type === 'podman') return
  if (type === 'docker') {
    if (!context.value?.dockerAvailable) return
    store.draft.sandbox = {
      type: 'docker',
      imageName: sandbox.value.imageName ?? DEFAULT_DOCKER_IMAGE,
    }
    return
  }
  store.draft.sandbox = { type: 'worktree' }
}

function patchSandboxImage(imageName: string): void {
  store.draft.sandbox = { type: 'docker', imageName }
}

function setTrackerType(type: 'local' | 'github-issues'): void {
  if (type === 'local') {
    store.draft.tracker = { type: 'local', mergeMode: 'local' }
    return
  }
  const repo = tracker.value.repo ?? context.value?.repo.remote?.replace(/^.*[:/]/, '').replace(/\.git$/, '')
  store.draft.tracker = {
    type: 'github-issues',
    ...(repo ? { repo } : {}),
    label: tracker.value.label ?? 'ready-for-agent',
    auth: context.value?.encryptionAvailable ? (tracker.value.auth ?? 'gh') : 'gh',
    mergeMode: 'local',
    commentIssue: tracker.value.commentIssue ?? true,
    closeIssue: tracker.value.closeIssue ?? true,
  }
}

function patchTracker(
  patch: Partial<Pick<TrackerDraft, 'repo' | 'label' | 'auth' | 'mergeMode' | 'commentIssue' | 'closeIssue'>>,
): void {
  store.draft.tracker = { ...tracker.value, ...patch }
}

async function verifyToken(): Promise<void> {
  await store.testToken(props.root, tokenInput.value, tracker.value.repo ?? '')
}

function rerunPreflight(): void {
  void store.runPreflight(props.root)
}

const tokenMessage = computed(() => {
  const result = store.tokenResult
  if (!result) return ''
  if (result.ok) return t('factory.tokenOk')
  if (result.reason === 'invalid-token') return t('factory.tokenInvalid')
  if (result.reason === 'repo-permission') return t('factory.tokenRepoPermission')
  if (result.reason === 'gh-not-logged-in') return t('factory.tokenGhNotLoggedIn')
  return t('factory.tokenNetwork')
})

const verifyCommand = computed({
  get: () => store.draft.commands?.verify ?? '',
  set: (value: string) => {
    store.draft.commands = { ...store.draft.commands, verify: value }
  },
})

const installCommand = computed({
  get: () => store.draft.commands?.install ?? '',
  set: (value: string) => {
    store.draft.commands = { ...store.draft.commands, install: value }
  },
})

const itemLabelSuffix: Record<FactoryPreflightItem['id'], string> = {
  gitRepo: 'GitRepo',
  gitDirty: 'GitDirty',
  gitVersion: 'GitVersion',
  configWritable: 'ConfigWritable',
  engine: 'Engine',
  modelProfile: 'ModelProfile',
  trackerAuth: 'TrackerAuth',
  trackerPush: 'TrackerPush',
  trackerLabel: 'TrackerLabel',
  verifyCommand: 'VerifyCommand',
  sandbox: 'Sandbox',
  dockerImage: 'DockerImage',
  dockerMount: 'DockerMount',
  dockerProxy: 'DockerProxy',
}

function itemDetail(item: FactoryPreflightItem): string {
  const params = item.params
  if (!params) return ''
  if (typeof params.detail === 'string' && params.detail) return params.detail
  if (typeof params.version === 'string' && params.version) return params.version
  if (typeof params.command === 'string' && params.command) return params.command
  if (typeof params.label === 'string' && params.label) return params.label
  if (typeof params.image === 'string' && params.image) return params.image
  if (typeof params.reason === 'string' && params.reason) return params.reason
  return ''
}

const saveErrorText = computed(() => {
  const code = store.saveError
  if (!code) return ''
  const map: Record<string, string> = {
    'preflight-failed': t('factory.errPreflightFailed'),
    'invalid-draft': t('factory.errInvalidDraft'),
    'write-failed': t('factory.errWriteFailed'),
    'secrets-failed': t('factory.errSecretsFailed'),
    'encryption-unavailable': t('factory.errEncryptionUnavailable'),
    'invalid-token': t('factory.tokenInvalid'),
  }
  return map[code] ?? t('factory.errWriteFailed')
})

function errorText(code: string): string {
  const suffix = code.charAt(0).toUpperCase() + code.slice(1)
  const key = `factory.err${suffix}`
  const text = t(key)
  return text === key ? code : text
}

async function finish(): Promise<void> {
  if (tracker.value.type === 'github-issues' && tracker.value.auth === 'token' && tokenInput.value) {
    const stored = await store.storeToken(tokenInput.value)
    if (!stored) return
  }
  await store.save(props.root)
}
</script>

<style lang="scss" scoped>
.factory-overlay {
  position: absolute;
  inset: 0;
  z-index: 30;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(0, 0, 0, 0.45);
}

.factory-wizard {
  display: flex;
  flex-direction: column;
  width: min(720px, 100%);
  max-height: 100%;
  border-radius: var(--radius-lg, 12px);
  border: 1px solid var(--surface-border);
  background: var(--bg-secondary, #1a1a2e);
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.45);
  overflow: hidden;
}

.wizard-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--surface-border);

  h2 {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
    color: var(--text-primary);
  }
}

.icon-btn {
  display: inline-flex;
  padding: 4px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;

  &:hover {
    color: var(--text-primary);
    background: var(--surface-glass-hover);
  }
}

.stepper {
  display: flex;
  gap: 6px;
  margin: 0;
  padding: 14px 20px 0;
  list-style: none;
}

.step {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  font-size: 12px;
  color: var(--text-muted);

  &.active,
  &.done {
    color: var(--text-primary);
  }
}

.step-dot {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 1px solid var(--surface-border);
  font-size: 11px;

  .step.active & {
    border-color: var(--accent-primary);
    background: var(--accent-primary);
    color: #fff;
  }

  .step.done & {
    border-color: var(--accent-primary);
    color: var(--accent-primary);
  }
}

.wizard-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 20px;
  @include scrollbar-overlay;
}

.step-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;

  h3 {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary);
  }
}

.hint {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-muted);
}

.error-text {
  margin: 0;
  font-size: 12px;
  color: var(--danger, #ef4444);
}

.opt-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 4px;
}

.opt-card {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 12px 14px;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-md, 8px);
  background: var(--surface-glass);
  color: var(--text-primary);
  text-align: left;
  cursor: pointer;

  &:hover:not(:disabled) {
    border-color: var(--accent-primary);
  }

  &.selected {
    border-color: var(--accent-primary);
    background: color-mix(in srgb, var(--accent-primary) 10%, transparent);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}

.opt-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 500;
}

.opt-sub {
  font-size: 12px;
  color: var(--text-muted);
}

.badge {
  padding: 1px 6px;
  border-radius: var(--radius-full, 999px);
  background: var(--surface-border);
  color: var(--text-muted);
  font-size: 10px;
  font-weight: 400;
}

.model-note {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 6px;
  padding: 10px 12px;
  border-radius: var(--radius-md, 8px);
  background: var(--surface-glass);
  font-size: 12px;
  color: var(--text-muted);

  strong {
    color: var(--text-primary);
    font-weight: 500;
  }
}

.field-group {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 6px;
  padding-top: 12px;
  border-top: 1px solid var(--surface-border);
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
  color: var(--text-muted);

  input {
    padding: 8px 10px;
    border: 1px solid var(--surface-border);
    border-radius: var(--radius-md, 8px);
    background: var(--surface-glass);
    color: var(--text-primary);
    font-size: 13px;
    outline: none;

    &:focus {
      border-color: var(--accent-primary);
    }
  }
}

.segmented {
  display: inline-flex;
  gap: 4px;

  button {
    padding: 6px 12px;
    border: 1px solid var(--surface-border);
    border-radius: var(--radius-md, 8px);
    background: transparent;
    color: var(--text-muted);
    font-size: 12px;
    cursor: pointer;

    &.active {
      border-color: var(--accent-primary);
      background: color-mix(in srgb, var(--accent-primary) 12%, transparent);
      color: var(--text-primary);
    }

    &:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
  }
}

.token-row {
  display: flex;
  gap: 8px;

  input {
    flex: 1;
  }
}

.gh-check {
  align-self: flex-start;
  padding: 6px 12px;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-md, 8px);
  background: var(--surface-glass);
  color: var(--text-primary);
  font-size: 12px;
  cursor: pointer;

  &:hover:not(:disabled) {
    border-color: var(--accent-primary);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}

.checkbox-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--text-secondary);
  cursor: pointer;
}

.preflight-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 6px;
  font-size: 12px;
  color: var(--text-muted);
}

.preflight-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.preflight-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: var(--radius-md, 8px);
  background: var(--surface-glass);
  font-size: 12px;
  color: var(--text-secondary);

  &.ok svg { color: var(--success, #22c55e); }
  &.warn svg { color: var(--warning, #f59e0b); }
  &.error svg { color: var(--danger, #ef4444); }
}

.item-name {
  flex: 1;
  color: var(--text-primary);
}

.item-detail {
  max-width: 40%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-muted);
}

.level {
  font-size: 11px;
  color: var(--text-muted);
}

.wizard-footer {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 20px;
  border-top: 1px solid var(--surface-border);

  .error-text {
    flex: 1;
  }
}

.ghost-btn,
.primary-btn {
  padding: 8px 16px;
  border-radius: var(--radius-md, 8px);
  font-size: 13px;
  cursor: pointer;
}

.ghost-btn {
  border: 1px solid var(--surface-border);
  background: transparent;
  color: var(--text-primary);
}

.primary-btn {
  margin-left: auto;
  border: 1px solid var(--accent-primary);
  background: var(--accent-primary);
  color: #fff;

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}
</style>
