<template>
  <section class="setup-page" data-setup-page>
    <div v-if="store.wizardDone" class="setup-done" data-setup-done>
      <div class="done-icon"><CheckCircle :size="28" /></div>
      <h2>{{ t('factory.wizardDone.title') }}</h2>
      <p class="done-note">{{ t('factory.wizardDone.description') }}</p>

      <div class="summary-row">
        <span class="sum-item" data-done-summary>{{ summaryEngineLabel }}</span>
        <span class="sum-item" data-done-summary>{{ summarySandboxLabel }}</span>
        <span class="sum-item" data-done-summary>{{ summaryTrackerLabel }}</span>
      </div>

      <dl class="facts">
        <div v-for="fact in writeFacts" :key="fact.id" class="kv" :data-done-fact="fact.id">
          <dt>{{ fact.label }}</dt>
          <dd :class="{ mono: fact.mono }">{{ fact.value }}</dd>
        </div>
      </dl>

      <div class="done-actions">
        <button class="primary-btn" data-done-plan @click="emit('new-run')">
          {{ t('factory.wizardDone.plan') }}
        </button>
        <button class="ghost-btn" data-done-board @click="store.closeWizard()">
          {{ t('factory.wizardDone.board') }}
        </button>
      </div>
    </div>

    <template v-else>
      <header class="wizard-head">
        <div class="wizard-headings">
          <h2>{{ t('factory.configurePipeline') }}</h2>
          <p data-setup-heading>{{ t('factory.wizardDescription') }}</p>
        </div>
        <span v-if="repoLabel" class="repo-chip" data-setup-repo>{{ repoLabel }}</span>
        <button class="icon-btn" :aria-label="t('factory.cancel')" @click="store.cancelWizard()">
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
          <button
            type="button"
            class="step-link"
            data-step-link
            :disabled="!jumpableTo((index + 1) as SetupStep)"
            :aria-current="store.step === index + 1 ? 'step' : undefined"
            @click="store.goToStep((index + 1) as SetupStep, root)"
          >
            <span class="step-dot">{{ index + 1 }}</span>
            <span class="step-label">{{ label }}</span>
          </button>
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
          <div class="role-models">
            <div class="role-head">
              <strong>{{ t('factory.roleModelTitle') }}</strong>
              <span>{{ t('factory.roleModelHint') }}</span>
            </div>
            <div v-for="role in roleStages" :key="role" class="role-row">
              <span class="role-name">{{ t(`factory.config.stages.${role}`) }}</span>
              <select
                class="role-select"
                :value="stageModel(role)"
                :disabled="modelOptions.length === 0"
                @change="setStageModel(role, ($event.target as HTMLSelectElement).value)"
              >
                <option value="">{{ defaultModelOption }}</option>
                <option v-for="model in modelOptions" :key="model.value" :value="model.value">
                  {{ model.label }}
                </option>
              </select>
            </div>
            <p v-if="modelOptions.length === 0" class="hint">{{ t('factory.modelNoOptions') }}</p>
          </div>
        </section>

        <!-- Step 2: isolation -->
        <section v-else-if="store.step === 2" class="step-panel">
          <h3>{{ t('factory.sandboxTitle') }}</h3>
          <p class="hint">{{ t('factory.sandboxDescription') }}</p>
          <div class="opt-list">
            <button
              class="opt-card"
              data-sandbox-option="worktree"
              :class="{ selected: sandbox.type === 'worktree' }"
              @click="selectSandbox('worktree')"
            >
              <span class="opt-title">{{ t('factory.sandboxWorktree') }}</span>
              <span class="opt-sub">{{ t('factory.sandboxWorktreeDesc') }}</span>
            </button>
            <button
              class="opt-card"
              data-sandbox-option="docker"
              :class="{ selected: sandbox.type === 'docker' }"
              :disabled="!dockerAvailable"
              @click="selectSandbox('docker')"
            >
              <span class="opt-title">
                {{ t('factory.sandboxDocker') }}
                <span class="badge" :class="dockerAvailable ? 'ok' : 'err'">
                  {{ dockerAvailable ? t('factory.dockerRunning') : t('factory.dockerMissing') }}
                </span>
              </span>
              <span class="opt-sub">{{ t('factory.sandboxDockerDesc') }}</span>
            </button>
            <button class="opt-card" data-sandbox-option="podman" disabled>
              <span class="opt-title">
                {{ t('factory.sandboxPodman') }}
                <span class="badge">{{ t('factory.sandboxPodmanMissing') }}</span>
              </span>
              <span class="opt-sub">{{ t('factory.sandboxPodmanDesc') }}</span>
            </button>
          </div>
          <div class="docker-status-bar">
            <span class="opt-status" data-docker-status :class="{ err: !dockerAvailable }">
              <template v-if="dockerChecking">{{ t('factory.dockerChecking') }}</template>
              <template v-else-if="dockerAvailable">{{ t('factory.dockerRunning') }}</template>
              <template v-else>{{ t('factory.dockerMissing') }}</template>
            </span>
            <button class="link-btn" data-docker-recheck :disabled="dockerChecking" @click="recheckDocker">
              {{ dockerChecking ? t('factory.dockerChecking') : t('factory.recheck') }}
            </button>
          </div>
          <div v-if="!dockerAvailable" class="hint-box" data-docker-guidance>
            <AlertTriangle :size="14" />
            <span>{{ t('factory.dockerNotRunningHint') }}</span>
            <button class="link-btn" data-docker-download @click="openDockerDownload">
              {{ t('factory.dockerDownload') }}
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
              data-tracker-option="local"
              :class="{ selected: tracker.type === 'local' }"
              @click="setTrackerType('local')"
            >
              <span class="opt-title">{{ t('factory.trackerLocal') }}</span>
              <span class="opt-sub">{{ t('factory.trackerLocalDesc') }}</span>
            </button>
            <button
              class="opt-card"
              data-tracker-option="github-issues"
              :class="{ selected: tracker.type === 'github-issues' }"
              @click="setTrackerType('github-issues')"
            >
              <span class="opt-title">{{ t('factory.trackerGithub') }}</span>
              <span class="opt-sub">{{ t('factory.trackerGithubDesc') }}</span>
            </button>
            <button class="opt-card" data-tracker-option="custom" disabled>
              <span class="opt-title">
                {{ t('factory.trackerCustom') }}
                <span class="badge">{{ t('factory.comingSoon') }}</span>
              </span>
              <span class="opt-sub">{{ t('factory.trackerCustomDesc') }}</span>
            </button>
          </div>

          <div v-if="tracker.type === 'local'" class="sub-panel" data-local-backlog>
            <div class="sub-panel-head">
              <strong>{{ t('factory.backlogPanelTitle') }}</strong>
              <span class="hint">{{ t('factory.backlogPanelDesc') }}</span>
            </div>
            <dl class="facts">
              <div class="kv" data-backlog-fact="storage">
                <dt>{{ t('factory.backlogStorage') }}</dt>
                <dd class="mono">{{ backlogPath }}</dd>
              </div>
              <div class="kv" data-backlog-fact="credentials">
                <dt>{{ t('factory.backlogCredentials') }}</dt>
                <dd>{{ t('factory.backlogNoCredentials') }}</dd>
              </div>
              <div class="kv" data-backlog-fact="claim">
                <dt>{{ t('factory.backlogClaim') }}</dt>
                <dd>{{ t('factory.backlogClaimManual') }}</dd>
              </div>
            </dl>
          </div>

          <div v-if="tracker.type === 'github-issues'" class="field-group">
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
              <div v-if="(tracker.auth ?? 'gh') === 'gh'" class="auth-actions">
                <button class="gh-check" :disabled="store.ghChecking || store.ghLogin.running" @click="refreshGh">
                  {{ store.ghChecking ? t('factory.ghChecking') : t('factory.refresh') }}
                </button>
                <button
                  v-if="!context?.ghLoggedIn"
                  class="gh-check primary-gh"
                  data-gh-login
                  :disabled="store.ghLogin.running"
                  @click="store.startGhLogin()"
                >
                  {{ store.ghLogin.running ? t('factory.ghLoggingIn') : t('factory.ghLogin') }}
                </button>
              </div>
              <p v-if="store.ghLogin.code" class="hint login-code">
                {{ t('factory.ghLoginCode', { code: store.ghLogin.code }) }}
                <button class="link-btn" @click="openLoginPage">{{ t('factory.ghLoginOpen') }}</button>
              </p>
              <p v-else-if="store.ghLogin.running" class="hint">{{ t('factory.ghWaiting') }}</p>
              <p v-if="store.ghLogin.error" class="error-text">{{ ghLoginErrorText }}</p>
            </div>

            <div class="guide">
              <button
                class="guide-head"
                data-token-guide
                :aria-expanded="showTokenGuide"
                @click="showTokenGuide = !showTokenGuide"
              >
                <ChevronRight :size="14" class="guide-caret" :class="{ open: showTokenGuide }" />
                <span>{{ t('factory.tokenGuideTitle') }}</span>
                <span class="guide-toggle">
                  {{ showTokenGuide ? t('factory.tokenGuideCollapse') : t('factory.tokenGuideExpand') }}
                </span>
              </button>
              <div v-if="showTokenGuide" class="guide-body" data-token-guide-body>
                <ol class="token-steps">
                  <li>{{ t('factory.tokenStep1') }}</li>
                  <li>{{ t('factory.tokenStep2') }}</li>
                  <li>{{ t('factory.tokenStep3') }}</li>
                </ol>
                <div class="perm-table">
                  <div class="perm-row perm-head">
                    <span>{{ t('factory.tokenPermName') }}</span>
                    <span>{{ t('factory.tokenPermScope') }}</span>
                    <span>{{ t('factory.tokenPermPurpose') }}</span>
                  </div>
                  <div v-for="row in tokenPermissions" :key="row.name" class="perm-row" data-token-perm>
                    <b>{{ row.name }}</b>
                    <span>{{ row.scope }}</span>
                    <span>{{ row.purpose }}</span>
                  </div>
                </div>
                <p class="hint">{{ t('factory.tokenGuideNote') }}</p>
                <div>
                  <button class="link-btn" @click="openTokenPage">{{ t('factory.tokenGuideOpen') }}</button>
                </div>
              </div>
            </div>

            <div v-if="tracker.auth === 'token'" class="field">
              <span>{{ t('factory.tokenLabel') }}</span>
              <div class="token-row">
                <input v-model="tokenInput" type="password" :placeholder="t('factory.tokenPlaceholder')" />
                <button class="gh-check" :disabled="store.tokenTesting || !tokenInput" @click="verifyToken">
                  {{ store.tokenTesting ? t('factory.testing') : t('factory.testToken') }}
                </button>
              </div>

              <div v-if="store.tokenResult?.ok" class="test-result ok" data-token-result>
                <div class="tr-title">
                  <CheckCircle :size="14" />
                  {{ t('factory.tokenResultOkTitle') }}
                </div>
                <dl class="tr-rows">
                  <div class="kv">
                    <dt>{{ t('factory.tokenIdentity') }}</dt>
                    <dd>@{{ store.tokenResult.login ?? t('factory.tokenIdentityUnknown') }}</dd>
                  </div>
                  <div v-if="tokenRepoLabel" class="kv">
                    <dt>{{ t('factory.tokenRepo') }}</dt>
                    <dd>{{ tokenRepoLabel }}</dd>
                  </div>
                  <div v-if="tokenIssuesLabel" class="kv">
                    <dt>{{ t('factory.tokenIssues') }}</dt>
                    <dd>{{ tokenIssuesLabel }}</dd>
                  </div>
                </dl>
                <p class="hint">{{ t('factory.tokenWriteNote') }}</p>
              </div>
              <div v-else-if="store.tokenResult" class="test-result err" data-token-error>
                <div class="tr-title">
                  <AlertTriangle :size="14" />
                  {{ t('factory.tokenResultFailTitle') }}
                </div>
                <p>{{ tokenMessage }}</p>
                <p v-if="store.tokenResult.status" class="hint">
                  {{ t('factory.tokenStatusFromGithub', { status: store.tokenResult.status }) }}
                </p>
                <ul v-if="tokenHints.length" class="hint-list">
                  <li v-for="hint in tokenHints" :key="hint">{{ hint }}</li>
                </ul>
              </div>
            </div>

            <label class="field">
              <span>{{ t('factory.repoLabel') }}</span>
              <div v-if="repoSelectVisible && !customRepo" class="repo-picker">
                <select
                  :value="tracker.repo ?? ''"
                  :disabled="store.githubReposLoading"
                  @change="patchTracker({ repo: ($event.target as HTMLSelectElement).value })"
                >
                  <option value="">
                    {{ store.githubReposLoading ? t('factory.repoLoading') : t('factory.repoChoose') }}
                  </option>
                  <option v-for="candidate in repoChoices" :key="candidate.repo" :value="candidate.repo">
                    {{ candidate.repo }}{{ candidate.private ? ` · ${t('factory.repoPrivate')}` : '' }}
                  </option>
                </select>
                <button class="link-btn" @click="customRepo = true">{{ t('factory.repoManual') }}</button>
              </div>
              <div v-else class="repo-picker">
                <input
                  :value="tracker.repo ?? ''"
                  :placeholder="t('factory.repoPlaceholder')"
                  @input="patchTracker({ repo: ($event.target as HTMLInputElement).value })"
                />
                <button v-if="repoSelectVisible" class="link-btn" @click="customRepo = false">
                  {{ t('factory.repoPickExisting') }}
                </button>
              </div>
              <span v-if="detectedRepo" class="hint">
                {{ t('factory.repoDetected', { repo: detectedRepo }) }}
              </span>
              <span v-else-if="repoListErrorText" class="hint error-text">{{ repoListErrorText }}</span>
              <span v-else-if="repoOptions.length" class="hint">{{ t('factory.repoFromGithub') }}</span>
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

          <div class="summary-row" data-setup-summary>
            <span v-for="chip in summaryChips" :key="chip.id" class="sum-item" :data-summary="chip.id">
              <span class="sum-key">{{ chip.key }}</span>
              <span class="sum-value">{{ chip.value }}</span>
            </span>
          </div>

          <label class="field">
            <span>{{ t('factory.verifyCommandLabel') }}</span>
            <input v-model="verifyCommand" data-verify-command :placeholder="t('factory.verifyCommandPlaceholder')" />
          </label>
          <label class="field">
            <span>{{ t('factory.installCommandLabel') }}</span>
            <input v-model="installCommand" :placeholder="t('factory.installCommandPlaceholder')" />
          </label>

          <div class="preflight-head">
            <span>
              {{ rerunning ? t('factory.preflightRunning') : store.preflight ? t('factory.preflightDone') : t('factory.preflightEmpty') }}
            </span>
            <button
              class="gh-check"
              :disabled="rerunning || store.saving"
              @click="rerunPreflight"
            >
              {{ rerunning ? t('factory.preflightRunning') : t('factory.refreshPreflight') }}
            </button>
          </div>

          <p v-if="store.preflightError" class="error-text">{{ t('factory.preflightFailed') }}</p>

          <ul v-if="store.preflight" class="preflight-list">
            <li
              v-for="row in preflightRows"
              :key="row.item.id"
              class="preflight-item"
              :class="row.item.level"
              :data-preflight-item="row.item.id"
            >
              <div class="item-row">
                <CheckCircle v-if="row.item.level === 'ok'" :size="15" />
                <AlertTriangle v-else-if="row.item.level === 'warn'" :size="15" />
                <XCircle v-else :size="15" />
                <span class="item-name">{{ t(`factory.item${itemLabelSuffix[row.item.id]}`) }}</span>
                <span v-if="row.text.detail" class="item-detail">{{ row.text.detail }}</span>
                <span class="level">{{ t(`factory.level${row.item.level[0].toUpperCase()}${row.item.level.slice(1)}`) }}</span>
                <button
                  v-if="row.fix"
                  class="link-btn item-fix"
                  data-preflight-fix
                  :disabled="!isFixAvailable(row.fix)"
                  @click="applyFix(row.fix)"
                >
                  {{ fixLabel(row.fix) }}
                </button>
              </div>
              <p v-if="row.text.hint" class="item-hint">{{ row.text.hint }}</p>
            </li>
          </ul>

          <p v-if="store.preflight && store.blocking" class="block-note" data-blocking-note>
            <AlertTriangle :size="14" />
            <span>{{ t('factory.blockingHint') }}</span>
          </p>
          <p v-else-if="store.preflight" class="hint" data-ready-note>{{ t('factory.readyHint') }}</p>
          <p v-if="store.saveError" class="error-text">{{ saveErrorText }}</p>

          <div class="write-panel">
            <div class="write-head">
              <strong>{{ t('factory.writeTitle') }}</strong>
              <span class="hint">{{ t('factory.writeDescription') }}</span>
            </div>
            <dl class="facts">
              <div v-for="fact in writeFacts" :key="fact.id" class="kv" :data-write-fact="fact.id">
                <dt>{{ fact.label }}</dt>
                <dd :class="{ mono: fact.mono }">{{ fact.value }}</dd>
              </div>
            </dl>
          </div>
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
          :disabled="store.blocking || store.saving || rerunning"
          @click="finish"
        >
          {{ store.saving ? t('factory.saving') : t('factory.finish') }}
        </button>
      </footer>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { X, CheckCircle, AlertTriangle, XCircle, ChevronRight } from 'lucide-vue-next'
import { FACTORY_BACKLOG_PATH } from '@/shared/factory'
import type {
  FactoryEngineType,
  FactoryPreflightItem,
  FactorySandboxConfig,
  FactorySetupDraft,
  FactoryStageKey,
} from '@/shared/factory'
import { useFactoryStore } from '@/stores/factory'
import { shell } from '@/services/api/shell'
import { preflightFix, preflightText, type PreflightFix } from '@/lib/factory/preflightDisplay'
import { factoryRepoLabel, parseRepoFromRemote } from '@/utils/factoryRepo'
import {
  AGENT_STAGES,
  CLAUDE_CODE_MODEL_ALIASES,
  DEFAULT_DOCKER_IMAGE,
  canJumpToStep,
  type SetupStep,
} from '@/stores/factory/setup'

const props = defineProps<{ root: string }>()
const emit = defineEmits<{ 'new-run': [] }>()
const { t } = useI18n()
const store = useFactoryStore()

const stepLabels = computed(() => [
  t('factory.stepEngine'),
  t('factory.stepSandbox'),
  t('factory.stepTracker'),
  t('factory.stepPreflight'),
])

const context = computed(() => store.context)
const dockerAvailable = computed(() => context.value?.dockerAvailable ?? false)
/** 重检 Docker 期间卡片与按钮都要显示「检测中」，避免重复点击。 */
const dockerChecking = ref(false)
const showTokenGuide = ref(false)
const backlogPath = FACTORY_BACKLOG_PATH
/** 步骤条是导航：当前步始终可点，跳过去则要求它前面的步骤都已通过校验。 */
function jumpableTo(target: SetupStep): boolean {
  if (target === store.step) return true
  if (!context.value) return false
  return canJumpToStep(target, store.draft, context.value)
}
const visibleEngines = computed(() => (context.value?.engines ?? []).filter((engine) => engine.exposed))
const agent = computed<NonNullable<FactorySetupDraft['agent']>>(() => store.draft.agent ?? {})
const sandbox = computed<NonNullable<FactorySetupDraft['sandbox']>>(
  () => store.draft.sandbox ?? { type: 'worktree' },
)
type TrackerDraft = NonNullable<FactorySetupDraft['tracker']>
const tracker = computed<TrackerDraft>(
  () => store.draft.tracker ?? { type: 'local', mergeMode: 'local' },
)

/** 页面顶部标出这次配置面向的任务源；GitHub 还没填仓库时退回 origin 解析出的仓库。 */
const repoLabel = computed(() => {
  const label = factoryRepoLabel({ type: tracker.value.type ?? 'local', repo: tracker.value.repo }, props.root)
  if (label) return label
  return tracker.value.type === 'github-issues' ? parseRepoFromRemote(context.value?.repo.remote) ?? '' : ''
})

const SANDBOX_LABEL_KEYS: Record<NonNullable<FactorySandboxConfig['type']>, string> = {
  worktree: 'factory.sandboxWorktree',
  docker: 'factory.sandboxDocker',
  podman: 'factory.sandboxPodman',
}

/** 摘要同时服务第 4 步顶部与就绪页：用户不用重开各步去核对自己选了什么。 */
const summaryEngineLabel = computed(() =>
  agent.value.engineType ? engineLabel(agent.value.engineType) : '',
)
const summarySandboxLabel = computed(() => t(SANDBOX_LABEL_KEYS[sandbox.value.type ?? 'worktree']))
const summaryTrackerLabel = computed(() =>
  t(tracker.value.type === 'github-issues' ? 'factory.trackerGithub' : 'factory.trackerLocal'),
)
/** 领取标签只对 GitHub 任务源有意义；合并方式两种任务源都要说清。 */
const summaryChips = computed(() => {
  const chips = [
    { id: 'engine', key: t('factory.stepEngine'), value: summaryEngineLabel.value },
    { id: 'sandbox', key: t('factory.stepSandbox'), value: summarySandboxLabel.value },
    { id: 'tracker', key: t('factory.stepTracker'), value: summaryTrackerLabel.value },
  ]
  if (tracker.value.type === 'github-issues') {
    chips.push({ id: 'label', key: t('factory.labelLabel'), value: tracker.value.label ?? '' })
  }
  chips.push({
    id: 'merge',
    key: t('factory.mergeModeLabel'),
    value: t(tracker.value.mergeMode === 'pr' ? 'factory.mergePr' : 'factory.mergeLocal'),
  })
  return chips
})
/** 只有 token 鉴权才真的往凭据库写；gh 登录沿用本机 CLI 凭据。 */
const tokenLocationLabel = computed(() => {
  if (tracker.value.type !== 'github-issues') return t('factory.wizardDone.tokenUnused')
  return tracker.value.auth === 'token'
    ? t('factory.wizardDone.tokenVault')
    : t('factory.wizardDone.tokenGh')
})
/** 第 4 步的「将写入」和就绪页的事实是同一组，只是时点不同：一份定义，两块面板。 */
const writeFacts = computed(() => [
  { id: 'config', label: t('factory.wizardDone.configLocation'), value: store.configPath, mono: true },
  { id: 'token', label: t('factory.wizardDone.tokenLocation'), value: tokenLocationLabel.value },
  { id: 'model', label: t('factory.wizardDone.modelLocation'), value: t('factory.wizardDone.modelReused') },
])

/** 还没入库的 token 存在 store 的向导会话里，关页签回来不必重敲。 */
const tokenInput = computed({
  get: () => store.wizardToken,
  set: (value: string) => {
    store.wizardToken = value
  },
})
/** 仓库候选存在时默认用下拉；用户仍可切回手填（比如 issue 来自别的仓库）。 */
const customRepo = ref(false)

const roleStages = AGENT_STAGES

/** 角色可选的模型：只列真实模型名，档位作为后缀标记；无模型列表时退回 claude-code 档位。 */
const modelOptions = computed(() => {
  const selectable = context.value?.models.selectable ?? []
  const tiers = context.value?.models.tiers ?? {}
  const list: { value: string; label: string }[] = []
  const seen = new Set<string>()
  const push = (value?: string): void => {
    if (!value || seen.has(value)) return
    seen.add(value)
    const tier = tiers[value]
    list.push({ value, label: tier ? `${value}（${tier}）` : value })
  }
  if (selectable.length > 0) selectable.forEach(push)
  else if (agent.value.engineType === 'claude-code') CLAUDE_CODE_MODEL_ALIASES.forEach(push)
  // 编辑既有配置时，已选模型可能不在当前列表里。
  for (const key of AGENT_STAGES) push(store.draft.stages?.[key]?.model)
  return list
})

const defaultModelOption = computed(() =>
  context.value?.models.default
    ? t('factory.roleDefaultWith', { model: context.value.models.default })
    : t('factory.roleDefault'),
)

/** GitHub 仓库下拉：登录凭据能访问的仓库，按最近更新排序。 */
const repoOptions = computed(() => store.githubRepos)
/** 有列表或正在拉取时用下拉；否则退回手填。 */
const repoSelectVisible = computed(() => store.githubReposLoading || repoOptions.value.length > 0)

/** 下拉选项：仓库列表 + 当前值（避免编辑既有配置时选中项在列表外）。 */
const repoChoices = computed(() => {
  const list = [...repoOptions.value]
  const current = tracker.value.repo
  if (current && !list.some((candidate) => candidate.repo === current)) {
    list.unshift({ repo: current, name: current, private: false })
  }
  return list
})

const repoListErrorText = computed(() => {
  const code = store.githubReposError
  if (!code) return ''
  if (code === 'not-logged-in' || code === 'unsupported') return t('factory.repoListNeedsAuth')
  return t('factory.repoListFailed')
})

const detectedRepo = computed(() => parseRepoFromRemote(context.value?.repo.remote))

/** 只报与本次状态码对应的排查方向；未知状态码交给上面的原因文案。 */
const tokenHints = computed(() => {
  const status = store.tokenResult?.status
  if (status === 401) return [t('factory.tokenHint401')]
  if (status === 403) return [t('factory.tokenHint403')]
  if (status === 404) return [t('factory.tokenHint404')]
  return []
})

const tokenRepoLabel = computed(() => {
  const result = store.tokenResult
  const repo = result?.repo ?? tracker.value.repo
  if (!repo) return ''
  if (result?.private === undefined) return repo
  return `${repo} · ${t(result.private ? 'factory.repoPrivate' : 'factory.repoPublic')}`
})

/** 统计取不到（限流/网络）时宁可不写，也不显示 0 误导用户。 */
const tokenIssuesLabel = computed(() => {
  const result = store.tokenResult
  if (!result) return ''
  const parts: string[] = []
  if (result.issueCount !== undefined) {
    parts.push(t('factory.tokenOpenCount', { count: result.issueCount }))
  }
  if (result.labelCount !== undefined) {
    parts.push(t('factory.tokenLabelHits', { label: tracker.value.label ?? '', count: result.labelCount }))
  }
  return parts.join(' · ')
})

/** 细粒度 token 的四项权限；名称与级别沿用 GitHub 页面上的原文。 */
const tokenPermissions = computed(() => [
  { name: 'Metadata', scope: 'Read', purpose: t('factory.tokenPermMetadataWhy') },
  { name: 'Issues', scope: 'Read / Write', purpose: t('factory.tokenPermIssuesWhy') },
  { name: 'Contents', scope: 'Read / Write', purpose: t('factory.tokenPermContentsWhy') },
  { name: 'Pull requests', scope: 'Read / Write', purpose: t('factory.tokenPermPrWhy') },
])

const ghLoginErrorText = computed(() => {
  const code = store.ghLogin.error
  if (!code) return ''
  if (code === 'timeout') return t('factory.ghLoginTimeout')
  if (code === 'unsupported') return t('factory.ghLoginUnsupported')
  return t('factory.ghLoginFailed')
})

function stageModel(key: FactoryStageKey): string {
  return store.draft.stages?.[key]?.model ?? ''
}

function setStageModel(key: FactoryStageKey, value: string): void {
  const stages = { ...(store.draft.stages ?? {}) }
  if (value) stages[key] = { model: value }
  else delete stages[key]
  store.draft = { ...store.draft, stages }
}

/** 仓库列表只在「第 3 步 + GitHub 任务源 + gh 已登录」时拉一次。 */
let repoSourceKey = ''
function syncGithubRepos(): void {
  if (store.step !== 3 || tracker.value.type !== 'github-issues') return
  if ((tracker.value.auth ?? 'gh') !== 'gh') {
    // 切到 token 后列表归 token 校验流程管；切回 gh 时要重新拉一次。
    repoSourceKey = ''
    return
  }
  if (!context.value?.ghLoggedIn) return
  if (repoSourceKey === 'gh') return
  repoSourceKey = 'gh'
  void store.loadGithubRepos('gh')
}

watch(
  () => [store.step, tracker.value.type, tracker.value.auth, context.value?.ghLoggedIn] as const,
  () => syncGithubRepos(),
  { immediate: true },
)

/** 换了仓库/标签/鉴权方式或重敲了 token，上一次校验的身份与计数就不再有效。 */
watch(
  () => [tracker.value.repo, tracker.value.label, tracker.value.auth, store.wizardToken] as const,
  () => {
    store.tokenResult = null
  },
)

async function refreshGh(): Promise<void> {
  const ok = await store.checkGhAuth()
  if (!ok) return
  // 手动刷新要重新取列表，即使登录态没变化。
  repoSourceKey = ''
  syncGithubRepos()
}

function openLoginPage(): void {
  void shell.openExternal(store.ghLogin.url ?? 'https://github.com/login/device')
}

/** 直接打开细粒度 token 创建页；权限表按细粒度 token 的模型描述。 */
function openTokenPage(): void {
  void shell.openExternal('https://github.com/settings/personal-access-tokens/new')
}

/** 重检 Docker 复用整份上下文：引擎、gh 登录等事实也一起刷新，语义上不冲突。 */
async function recheckDocker(): Promise<void> {
  if (dockerChecking.value) return
  dockerChecking.value = true
  try {
    await store.loadContext(props.root)
  } finally {
    dockerChecking.value = false
  }
}

function openDockerDownload(): void {
  void shell.openExternal('https://www.docker.com/products/docker-desktop/')
}

function engineLabel(type: FactoryEngineType): string {
  return type === 'claude-code' ? 'Claude Code' : 'Pi'
}

function selectEngine(type: FactoryEngineType): void {
  // pi 只认真实模型名：切过去时丢弃仅 claude-code 可用的档位别名。
  if (type === 'pi') {
    const selectable = context.value?.models.selectable ?? []
    const stages = { ...(store.draft.stages ?? {}) }
    for (const key of AGENT_STAGES) {
      const model = stages[key]?.model
      if (model && !selectable.includes(model)) delete stages[key]
    }
    store.draft = { ...store.draft, agent: { ...store.draft.agent, engineType: type }, stages }
    return
  }
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
  const repo = tracker.value.repo ?? parseRepoFromRemote(context.value?.repo.remote)
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
  await store.testToken(props.root, tokenInput.value, tracker.value.repo ?? '', tracker.value.label ?? '')
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

/** 预检要在主进程里跑 git / gh / docker，逐键重跑会把预检打成噪音。 */
const VERIFY_RERUN_DELAY = 300

/**
 * 改过验证命令后，上一条预检结果就不再对应当前选择：从这一刻起算「重跑中」，
 * 直到新结果落地，「完成配置」不能拿旧结论点下去。
 */
const rerunPending = ref(false)
const rerunning = computed(() => rerunPending.value || store.preflightRunning)

watch(verifyCommand, (_next, _previous, onCleanup) => {
  rerunPending.value = true
  const timer = setTimeout(() => {
    // 中途跳去别的步骤或已保存就绪，这一轮就没必要跑了；回到第 4 步会重新预检。
    if (store.step !== 4 || store.wizardDone) {
      rerunPending.value = false
      return
    }
    void store.runPreflight(props.root).finally(() => {
      rerunPending.value = false
    })
  }, VERIFY_RERUN_DELAY)
  onCleanup(() => clearTimeout(timer))
})

function fixLabel(fix: PreflightFix): string {
  return fix.kind === 'recheck'
    ? t('factory.recheck')
    : t('factory.fixAtStep', { step: stepLabels.value[fix.step - 1] })
}

/** 跳回去修和其它步骤同一个规矩：前面还有步骤没填对，就不能越过它。 */
function isFixAvailable(fix: PreflightFix): boolean {
  return fix.kind === 'recheck' || jumpableTo(fix.step)
}

function applyFix(fix: PreflightFix): void {
  if (fix.kind === 'recheck') {
    rerunPreflight()
    return
  }
  void store.goToStep(fix.step, props.root)
}

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

/** 预检项 → 详情、解释与出路；`注意` 项单靠一个黄图标说不清要处理什么。 */
const preflightRows = computed(() =>
  (store.preflight?.items ?? []).map((item) => ({
    item,
    text: preflightText(item, t),
    fix: preflightFix(item),
  })),
)

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
.setup-page {
  display: flex;
  flex-direction: column;
  flex: 1;
  width: 100%;
  max-width: 980px;
  min-height: 0;
  margin: 0 auto;
  gap: 14px;
}

.wizard-head {
  display: flex;
  align-items: flex-start;
  gap: 10px;

  h2 {
    margin: 0;
    font-size: 17px;
    font-weight: 600;
    color: var(--text-primary);
  }

  p {
    margin: 4px 0 0;
    font-size: 12px;
    line-height: 1.5;
    color: var(--text-muted);
  }
}

.wizard-headings {
  flex: 1;
  min-width: 0;
}

.repo-chip {
  flex: 0 0 auto;
  padding: 4px 8px;
  border-radius: var(--radius-sm, 6px);
  background: var(--surface-glass);
  color: var(--text-secondary);
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 11px;
  white-space: nowrap;
}

/* 就绪页占住整页区域并居中：它是这一步的终点，不是看板上的又一块面板。 */
.setup-done {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  width: 100%;
  max-width: 620px;
  margin: 0 auto;
  padding: 24px 0 40px;
  text-align: center;

  h2 {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
    color: var(--text-primary);
  }
}

.done-icon {
  display: grid;
  place-items: center;
  width: 52px;
  height: 52px;
  border-radius: 50%;
  background: var(--success-glow, var(--surface-glass-active));
  color: var(--success, #22c55e);
}

.done-note {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-muted);
}

.summary-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 4px;
}

.setup-done .summary-row {
  justify-content: center;
}

.sum-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 24px;
  padding: 0 10px;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-full, 999px);
  background: var(--surface-glass);
  color: var(--text-secondary);
  font-size: var(--text-2xs, 11px);
}

/* 摘要只写值会读不出维度：引擎/隔离/任务源这些词得留在片上。 */
.sum-key {
  color: var(--text-muted);
}

.sum-value {
  color: var(--text-primary);
}

.facts {
  display: flex;
  flex-direction: column;
  width: 100%;
  margin: 8px 0 0;
  padding: 2px 14px;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-lg, 12px);
  background: var(--bg-elevated, var(--surface-glass));
}

.kv {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  padding: 9px 0;
  font-size: var(--text-2xs, 11px);

  + .kv {
    border-top: 1px solid var(--surface-border);
  }

  dt {
    color: var(--text-muted);
  }

  dd {
    margin: 0;
    color: var(--text-primary);
    text-align: right;
    overflow-wrap: anywhere;

    &.mono {
      font-family: var(--font-mono, ui-monospace, monospace);
    }
  }
}

.done-actions {
  display: flex;
  justify-content: center;
  gap: 8px;
  margin-top: 8px;

  .primary-btn {
    margin-left: 0;
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
  padding: 0;
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

.step-link {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 3px 6px;
  border: none;
  border-radius: var(--radius-sm, 6px);
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;

  &:hover:not(:disabled) {
    color: var(--text-primary);
    background: var(--surface-glass);
  }

  &:disabled {
    cursor: default;
    opacity: 0.65;
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
  padding: 0 0 8px;
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

  &.ok {
    background: color-mix(in srgb, var(--success, #22c55e) 16%, transparent);
    color: var(--success, #22c55e);
  }

  &.err {
    background: color-mix(in srgb, var(--danger, #ef4444) 14%, transparent);
    color: var(--danger, #ef4444);
  }
}

/* 状态与重检独立于被禁用的卡片：Docker 停了之后仍然可以重新检测。 */
.docker-status-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 2px 2px 0;
}

/* 卡片内的状态行：徽标之外再给一句可读结论，选中前也能判断。 */
.opt-status {
  font-size: 11px;
  color: var(--success, #22c55e);

  &.err {
    color: var(--danger, #ef4444);
  }
}

.hint-box {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid color-mix(in srgb, var(--warning, #f59e0b) 40%, transparent);
  border-radius: var(--radius-md, 8px);
  background: color-mix(in srgb, var(--warning, #f59e0b) 8%, transparent);
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-secondary);

  svg {
    flex: 0 0 auto;
    color: var(--warning, #f59e0b);
  }
}

.sub-panel {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-md, 8px);
  background: var(--surface-glass);
}

.sub-panel-head {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 12px;

  strong {
    color: var(--text-primary);
    font-weight: 600;
  }
}

.sub-panel .facts {
  margin-top: 6px;
  padding: 0;
  border: none;
  background: transparent;
}

.role-models {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 8px;
  padding: 12px;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-md, 8px);
}

.role-head {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 12px;
  color: var(--text-muted);

  strong {
    color: var(--text-primary);
    font-weight: 500;
  }
}

.role-row {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
  color: var(--text-secondary);
}

.role-name {
  flex: 1;
  color: var(--text-primary);
}

.role-select {
  min-width: 220px;
  padding: 6px 8px;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-md, 8px);
  background: var(--surface-glass);
  color: var(--text-primary);
  font-size: 12px;
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

.token-steps {
  margin: 0;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  color: var(--text-muted);
}

.guide {
  overflow: hidden;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-md, 8px);
  background: var(--surface-glass);
}

.guide-head {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 8px 10px;
  border: none;
  background: transparent;
  color: var(--text-primary);
  font: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}

.guide-toggle {
  margin-left: auto;
  color: var(--text-muted);
  font-size: 11px;
}

.guide-caret {
  flex: 0 0 auto;
  color: var(--text-muted);
  transition: transform 0.15s;

  &.open {
    transform: rotate(90deg);
  }
}

.guide-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px 10px 10px;
  border-top: 1px solid var(--surface-border);
}

.perm-table {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-sm, 6px);
  font-size: 11px;
}

.perm-row {
  display: grid;
  grid-template-columns: minmax(84px, 0.8fr) minmax(64px, 0.7fr) 1.8fr;
  gap: 8px;
  padding: 6px 8px;
  color: var(--text-secondary);

  + .perm-row {
    border-top: 1px solid var(--surface-border);
  }

  b {
    color: var(--text-primary);
    font-weight: 500;
  }
}

.perm-head {
  background: var(--bg-elevated, var(--surface-glass));
  color: var(--text-muted);
}

.test-result {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border-radius: var(--radius-md, 8px);
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-secondary);

  p {
    margin: 0;
  }

  &.ok {
    border: 1px solid color-mix(in srgb, var(--success, #22c55e) 40%, transparent);
    background: color-mix(in srgb, var(--success, #22c55e) 8%, transparent);

    .tr-title svg {
      color: var(--success, #22c55e);
    }
  }

  &.err {
    border: 1px solid color-mix(in srgb, var(--danger, #ef4444) 45%, transparent);
    background: color-mix(in srgb, var(--danger, #ef4444) 8%, transparent);

    .tr-title svg {
      color: var(--danger, #ef4444);
    }
  }
}

.tr-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
  color: var(--text-primary);
}

.tr-rows {
  display: flex;
  flex-direction: column;
  margin: 0;

  .kv {
    padding: 4px 0;
    font-size: 11px;
  }
}

.hint-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0;
  padding-left: 18px;
  color: var(--text-muted);
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

.repo-picker {
  display: flex;
  align-items: center;
  gap: 10px;

  input,
  select {
    flex: 1;
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

.auth-actions {
  display: flex;
  gap: 8px;
}

.primary-gh {
  border-color: var(--accent-primary);
  background: var(--accent-primary);
  color: #fff;
}

.login-code {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.link-btn {
  padding: 0;
  border: none;
  background: transparent;
  color: var(--accent-primary);
  font-size: 12px;
  cursor: pointer;

  &:hover {
    text-decoration: underline;
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
  flex-direction: column;
  gap: 4px;
  padding: 8px 10px;
  border-radius: var(--radius-md, 8px);
  background: var(--surface-glass);
  font-size: 12px;
  color: var(--text-secondary);

  .item-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  &.ok svg { color: var(--success, #22c55e); }
  &.warn svg { color: var(--warning, #f59e0b); }
  &.error svg { color: var(--danger, #ef4444); }
}

.item-hint {
  margin: 0;
  padding-left: 23px;
  font-size: 11px;
  line-height: 1.5;
  color: var(--text-muted);
  white-space: normal;
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

.item-fix {
  flex: 0 0 auto;
}

/* 阻断说明要比一行 hint 显眼：它是「完成配置」点不动的原因。 */
.block-note {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin: 0;
  padding: 8px 10px;
  border: 1px solid color-mix(in srgb, var(--danger, #ef4444) 45%, transparent);
  border-radius: var(--radius-md, 8px);
  background: color-mix(in srgb, var(--danger, #ef4444) 8%, transparent);
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-secondary);

  svg {
    flex: 0 0 auto;
    margin-top: 1px;
    color: var(--danger, #ef4444);
  }
}

.write-panel {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 4px;
  padding: 12px;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-md, 8px);
  background: var(--surface-glass);
}

.write-head {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 12px;

  strong {
    color: var(--text-primary);
    font-weight: 600;
  }
}

.wizard-footer {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 0;
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
