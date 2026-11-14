/**
 * 提醒事项的 JXA 脚本源与载荷构造。
 *
 * 为什么是 osascript 而不是原生 EventKit 插件：Proma 用 Obj-C++ N-API addon 直连
 * EventKit，那需要随平台编译；这里走系统自带的 `osascript -l JavaScript`，
 * 无需构建步骤，代价是首次访问会弹「自动化」授权而不是「提醒事项」授权。
 *
 * 安全口径：脚本源是常量，用户数据一律经 argv 以 JSON 传入（JXA 的 run(argv)），
 * 绝不拼进脚本文本 —— 否则一个标题就能改写脚本。
 */
import type { NativeReminder, NativeWrite } from './remindersMapping'

export interface ScriptError {
  message: string
  number?: number
}

export type ScriptResult<T> = ({ ok: true } & T) | { ok: false; error: ScriptError }

export interface NativeList {
  id: string
  title: string
}

export interface ListsPayload {
  lists: NativeList[]
}

export interface FetchPayload {
  reminders: NativeReminder[]
}

export interface NativeCreate extends NativeWrite {
  /** 本地待办 id，回执用它把系统 id 认领回去 */
  key: string
}

export interface NativeUpdate extends NativeWrite {
  /** 系统提醒事项 id */
  id: string
}

export interface PushOps {
  listId: string
  creates: NativeCreate[]
  updates: NativeUpdate[]
  deletes: string[]
}

export interface PushPayload {
  created: Array<{ key: string; id: string }>
  updated: string[]
  deleted: string[]
  errors: Array<{ key: string; message: string }>
}

/** 脚本里共用的错误包装：把 AppleScript 的 errorNumber 一起带回来供授权判定。 */
const ERROR_HELPER = `
function fail(e) {
  return JSON.stringify({ ok: false, error: {
    message: String((e && e.message) || e),
    number: (e && typeof e.errorNumber === 'number') ? e.errorNumber : undefined
  } });
}
function findList(app, listId) {
  var lists = app.lists();
  for (var i = 0; i < lists.length; i++) {
    if (String(lists[i].id()) === String(listId)) return lists[i];
  }
  throw new Error('list-not-found:' + listId);
}
`

export const LISTS_SCRIPT = `${ERROR_HELPER}
function run() {
  try {
    var app = Application('Reminders');
    var lists = app.lists();
    var out = [];
    for (var i = 0; i < lists.length; i++) {
      out.push({ id: String(lists[i].id()), title: String(lists[i].name()) });
    }
    return JSON.stringify({ ok: true, lists: out });
  } catch (e) { return fail(e); }
}
`

/**
 * 读取一个列表里的全部提醒事项。
 * properties() 一次取回所有字段（一次 Apple Event），比逐条读属性快一个量级；
 * 某些系统版本上它会抛错，那时退回逐条读取。
 */
export const FETCH_SCRIPT = `${ERROR_HELPER}
function toMillis(value) {
  if (!value) return undefined;
  try { return new Date(value).getTime(); } catch (e) { return undefined; }
}
function mapOne(props) {
  var allday = toMillis(props.alldayDueDate);
  var due = toMillis(props.dueDate);
  var out = {
    id: String(props.id),
    title: String(props.name || ''),
    completed: props.completed === true,
    priority: typeof props.priority === 'number' ? props.priority : 0
  };
  if (props.body) out.notes = String(props.body);
  if (allday !== undefined) { out.dueAt = allday; out.dueDateOnly = true; }
  else if (due !== undefined) { out.dueAt = due; }
  return out;
}
function run(argv) {
  try {
    var args = JSON.parse(argv[0]);
    var app = Application('Reminders');
    var list = findList(app, args.listId);
    var rows = [];
    try {
      rows = list.reminders.properties();
    } catch (e) {
      var refs = list.reminders();
      rows = [];
      for (var i = 0; i < refs.length; i++) {
        var r = refs[i];
        rows.push({
          id: r.id(), name: r.name(), body: r.body(), completed: r.completed(),
          priority: r.priority(), dueDate: r.dueDate(), alldayDueDate: r.alldayDueDate()
        });
      }
    }
    var out = [];
    for (var j = 0; j < rows.length; j++) out.push(mapOne(rows[j]));
    return JSON.stringify({ ok: true, reminders: out });
  } catch (e) { return fail(e); }
}
`

export const PUSH_SCRIPT = `${ERROR_HELPER}
function applyWrite(reminder, write) {
  reminder.name = write.title;
  reminder.body = write.notes;
  if (write.dueAt === null) {
    reminder.dueDate = null;
    try { reminder.alldayDueDate = null; } catch (e) {}
  } else if (write.dueDateOnly) {
    try { reminder.alldayDueDate = new Date(write.dueAt); reminder.dueDate = null; }
    catch (e) { reminder.dueDate = new Date(write.dueAt); }
  } else {
    reminder.dueDate = new Date(write.dueAt);
    try { reminder.alldayDueDate = null; } catch (e) {}
  }
  reminder.priority = write.priority;
  reminder.completed = write.completed === true;
}
function run(argv) {
  try {
    var args = JSON.parse(argv[0]);
    var app = Application('Reminders');
    var list = findList(app, args.listId);
    var created = [], updated = [], deleted = [], errors = [];

    var refs = list.reminders();
    var ids = list.reminders.id();
    var byId = {};
    for (var i = 0; i < ids.length; i++) byId[String(ids[i])] = refs[i];

    for (var c = 0; c < args.creates.length; c++) {
      var spec = args.creates[c];
      try {
        var made = app.Reminder({ name: spec.title, body: spec.notes });
        list.reminders.push(made);
        applyWrite(made, spec);
        created.push({ key: spec.key, id: String(made.id()) });
      } catch (e) { errors.push({ key: spec.key, message: String((e && e.message) || e) }); }
    }
    for (var u = 0; u < args.updates.length; u++) {
      var patch = args.updates[u];
      try {
        var target = byId[String(patch.id)];
        if (!target) throw new Error('reminder-not-found:' + patch.id);
        applyWrite(target, patch);
        updated.push(String(patch.id));
      } catch (e2) { errors.push({ key: String(patch.id), message: String((e2 && e2.message) || e2) }); }
    }
    for (var d = 0; d < args.deletes.length; d++) {
      var externalId = String(args.deletes[d]);
      try {
        var doomed = byId[externalId];
        if (!doomed) throw new Error('reminder-not-found:' + externalId);
        app.delete(doomed);
        deleted.push(externalId);
      } catch (e3) { errors.push({ key: externalId, message: String((e3 && e3.message) || e3) }); }
    }
    return JSON.stringify({ ok: true, created: created, updated: updated, deleted: deleted, errors: errors });
  } catch (e) { return fail(e); }
}
`

export function buildFetchPayload(listId: string): string {
  return JSON.stringify({ listId })
}

export function buildPushPayload(ops: PushOps): string {
  return JSON.stringify(ops)
}

/** osascript 的 stdout 只应是脚本返回的那一行 JSON；别的一律当脚本失败。 */
export function parseScriptResult<T>(stdout: string): ScriptResult<T> {
  const trimmed = stdout.trim()
  if (!trimmed) return { ok: false, error: { message: 'empty-script-output' } }
  try {
    const parsed = JSON.parse(trimmed) as ScriptResult<T>
    if (parsed && parsed.ok === true) return parsed
    if (parsed && parsed.ok === false && parsed.error) return parsed
    return { ok: false, error: { message: 'unexpected-script-output' } }
  } catch {
    return { ok: false, error: { message: `unparsable-script-output: ${trimmed.slice(0, 200)}` } }
  }
}