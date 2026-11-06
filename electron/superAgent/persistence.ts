/**
 * T11 #81 领域状态持久化接线：Store（T02）与 Domain（T03）之间的桥。
 *
 * 设计（§9.2）：每条领域命令就是一个事务 —— 命令先在内存 Domain 上生效，
 * 变化经全量状态快照写入 WAL（commit 即落盘点），随后由 Store 周期/顺带
 * 更新 state.json 快照。重启时 openProjectStore 完成「迁移 → 锁 → seq 重放」，
 * 再由 recovery 模块对账。事件负载即完整领域状态（快照式 WAL）：重放无需
 * 逐命令复演，天然免疫命令不唯一/不定向（UUID 生成）的问题。
 */
import { createSuperAgentDomain, type SuperAgentDomain } from './domain'
import { ProjectStoreError, openProjectStore, type ProjectStore, type ProjectStoreDeps } from './store'
import { superAgentError } from './errors'
import type { SuperAgentDomainState } from './model'
import type { SuperAgentSourcesConfig } from './sources/config'

export interface PersistedSuperAgentProject {
  /** 包装后的 Domain：命令变化自动 commit 到 WAL；对外与普通 Domain 同构。 */
  domain: SuperAgentDomain
  store: ProjectStore<SuperAgentDomainState>
}

function isRecordLike(value: unknown): value is SuperAgentDomainState {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 每条命令后比较序列化结果，变化才 commit —— 幂等/未变化的命令不产生
 * WAL 记录；命令与 commit 之间不落盘即视为未发生（崩溃恢复重放一致性）。
 */
function persistingDomain(
  domain: SuperAgentDomain,
  store: ProjectStore<SuperAgentDomainState>,
): SuperAgentDomain {
  let lastSerialized = JSON.stringify(domain.state)
  const commit = (): void => {
    const current = JSON.stringify(domain.state)
    if (current === lastSerialized) return
    store.commit({ events: [domain.state] })
    lastSerialized = current
  }
  const tracked = <T>(run: () => T): T => {
    const result = run()
    commit()
    return result
  }
  return {
    get state() {
      return domain.state
    },
    stageOf: (ticketId) => domain.stageOf(ticketId),
    intakeTrigger: (draft) => tracked(() => domain.intakeTrigger(draft)),
    createTicket: (input) => tracked(() => domain.createTicket(input)),
    dispatch: (input) => tracked(() => domain.dispatch(input)),
    startAssignment: (input) => tracked(() => domain.startAssignment(input)),
    launchAssignment: (input) => tracked(() => domain.launchAssignment(input)),
    endAssignment: (input) => tracked(() => domain.endAssignment(input)),
    addInput: (command) => tracked(() => domain.addInput(command)),
    answerAttention: (command) => tracked(() => domain.answerAttention(command)),
    requestPermission: (command) => tracked(() => domain.requestPermission(command)),
    answerPermission: (command) => tracked(() => domain.answerPermission(command)),
    withdrawPermission: (input) => tracked(() => domain.withdrawPermission(input)),
    requeueInput: (input) => tracked(() => domain.requeueInput(input)),
    deliverInput: (input) => tracked(() => domain.deliverInput(input)),
    markInputUncertain: (input) => tracked(() => domain.markInputUncertain(input)),
    failDelivery: (input) => tracked(() => domain.failDelivery(input)),
    report: (command) => tracked(() => domain.report(command)),
    endTicket: (command) => tracked(() => domain.endTicket(command)),
    ticketAccept: (input) => tracked(() => domain.ticketAccept(input)),
    ticketStop: (input) => tracked(() => domain.ticketStop(input)),
    ticketMessage: (input) => tracked(() => domain.ticketMessage(input)),
    retryTicket: (input) => tracked(() => domain.retryTicket(input)),
    recoverTicket: (input) => tracked(() => domain.recoverTicket(input)),
    markInputRead: (input) => tracked(() => domain.markInputRead(input)),
    pauseProject: (input) => tracked(() => domain.pauseProject(input)),
    resumeProject: (input) => tracked(() => domain.resumeProject(input)),
    markReviewReminded: (input) => tracked(() => domain.markReviewReminded(input)),
    setExecutionPolicy: (input) => tracked(() => domain.setExecutionPolicy(input)),
    setPolicy: (input) => tracked(() => domain.setPolicy(input)),
    filterTrigger: (input) => tracked(() => domain.filterTrigger(input)),
    startEval: (input) => tracked(() => domain.startEval(input)),
    deliverEval: (input) => tracked(() => domain.deliverEval(input)),
    expireEval: (input) => tracked(() => domain.expireEval(input)),
    reevaluateEval: (input) => tracked(() => domain.reevaluateEval(input)),
    dismissEval: (input) => tracked(() => domain.dismissEval(input)),
    submitEvalDecision: (input) => tracked(() => domain.submitEvalDecision(input)),
    revalidateTicket: (ticketId) => domain.revalidateTicket(ticketId),
    followupOwners: (triggerId) => domain.followupOwners(triggerId),
    fastPathConsumed: (triggerId) => domain.fastPathConsumed(triggerId),
    handbackInput: (input) => tracked(() => domain.handbackInput(input)),
    markUnrelated: (input) => tracked(() => domain.markUnrelated(input)),
    followForContext: (input) => tracked(() => domain.followForContext(input)),
    attachTicket: (input) => tracked(() => domain.attachTicket(input)),
    wakeTicket: (input) => tracked(() => domain.wakeTicket(input)),
    pruneExpiredSubscriptions: (input) => tracked(() => domain.pruneExpiredSubscriptions(input)),
    followThread: (input) => tracked(() => domain.followThread(input)),
    followsDone: (input) => tracked(() => domain.followsDone(input)),
    enqueueOutboxMessage: (input) => tracked(() => domain.enqueueOutboxMessage(input)),
    settleOutboxMessage: (input) => tracked(() => domain.settleOutboxMessage(input)),
  }
}

/**
 * 打开持久化项目：迁移 → 锁 → seq 重放由 openProjectStore 完成；
 * Store 打不开（锁被活进程持有、迁移失败、损坏）抛稳定 projectStoreUnavailable，
 * 不静默降级成无持久化双写。
 */
export function openPersistedSuperAgentProject(input: {
  userDataDir: string
  repoRoot: string
  deps?: ProjectStoreDeps
  /** T24 #93：显式传入的项目级 Source 配置；缺省原样保留 project.json 已有值。 */
  sources?: SuperAgentSourcesConfig
}): PersistedSuperAgentProject {
  let opened: ProjectStore<SuperAgentDomainState>
  try {
    opened = openProjectStore<SuperAgentDomainState>({
      userDataDir: input.userDataDir,
      repoRoot: input.repoRoot,
      initialState: createSuperAgentDomain().state,
      reduce: (state, tx) =>
        Array.isArray(tx.events) && isRecordLike(tx.events[0])
          ? (tx.events[0] as SuperAgentDomainState)
          : state,
      deps: input.deps,
      sources: input.sources,
    })
  } catch (err) {
    if (err instanceof ProjectStoreError) {
      throw superAgentError('projectStoreUnavailable', { storeCode: err.code })
    }
    throw err
  }
  const domain = createSuperAgentDomain({ initialState: opened.state })
  return { domain: persistingDomain(domain, opened), store: opened }
}
