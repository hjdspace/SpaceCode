#!/usr/bin/env python3
"""
Session Catchup Script for planning-with-files

Session-agnostic scanning: finds the most recent planning file update across
ALL sessions, then collects all conversation from that point forward through
all subsequent sessions until now.

Supports multiple AI IDEs:
- Claude Code (.claude/projects/)
- OpenCode (.local/share/opencode/storage/)

Usage: python3 session-catchup.py [project-path]
"""

import json
import sys
import os
from pathlib import Path
from typing import List, Dict, Optional, Tuple

PLANNING_FILES = ['task_plan.md', 'progress.md', 'findings.md']


def detect_ide() -> str:
    """
    Detect which IDE is being used based on environment and file structure.
    Returns 'claude-code', 'opencode', or 'unknown'.
    """
    # Check for OpenCode environment
    if os.environ.get('OPENCODE_DATA_DIR'):
        return 'opencode'

    # Check for Claude Code directory
    claude_dir = Path.home() / '.claude'
    if claude_dir.exists():
        return 'claude-code'

    # Check for OpenCode directory
    opencode_dir = Path.home() / '.local' / 'share' / 'opencode'
    if opencode_dir.exists():
        return 'opencode'

    return 'unknown'


def get_project_dir_claude(project_path: str) -> Path:
    """Convert project path to Claude's storage path format."""
    sanitized = project_path.replace('/', '-')
    if not sanitized.startswith('-'):
        sanitized = '-' + sanitized
    sanitized = sanitized.replace('_', '-')
    return Path.home() / '.claude' / 'projects' / sanitized


def get_project_dir_opencode(project_path: str) -> Optional[Path]:
    """
    Get OpenCode session storage directory.
    OpenCode uses: ~/.local/share/opencode/storage/session/{projectHash}/

    Note: OpenCode's structure is different - this function returns the storage root.
    Session discovery happens differently in OpenCode.
    """
    data_dir = os.environ.get('OPENCODE_DATA_DIR',
                               str(Path.home() / '.local' / 'share' / 'opencode'))
    storage_dir = Path(data_dir) / 'storage'

    if not storage_dir.exists():
        return None

    return storage_dir


def get_sessions_sorted(project_dir: Path) -> List[Path]:
    """Get all session files sorted by modification time (newest first)."""
    sessions = list(project_dir.glob('*.jsonl'))
    main_sessions = [s for s in sessions if not s.name.startswith('agent-')]
    return sorted(main_sessions, key=lambda p: p.stat().st_mtime, reverse=True)


def get_sessions_sorted_opencode(storage_dir: Path) -> List[Path]:
    """
    Get all OpenCode session files sorted by modification time.
    OpenCode stores sessions at: storage/session/{projectHash}/{sessionID}.json
    """
    session_dir = storage_dir / 'session'
    if not session_dir.exists():
        return []

    sessions = []
    for project_hash_dir in session_dir.iterdir():
        if project_hash_dir.is_dir():
            for session_file in project_hash_dir.glob('*.json'):
                sessions.append(session_file)

    return sorted(sessions, key=lambda p: p.stat().st_mtime, reverse=True)


def get_session_first_timestamp(session_file: Path) -> Optional[str]:
    """Get the timestamp of the first message in a session."""
    try:
        with open(session_file, 'r') as f:
            for line in f:
                try:
                    data = json.loads(line)
                    ts = data.get('timestamp')
                    if ts:
                        return ts
                except:
                    continue
    except:
        pass
    return None


def scan_for_planning_update(session_file: Path) -> Tuple[int, Optional[str]]:
    """
    Quickly scan a session file for planning file updates.
    Returns (line_number, filename) of last update, or (-1, None) if none found.
    """
    last_update_line = -1
    last_update_file = None

    try:
        with open(session_file, 'r') as f:
            for line_num, line in enumerate(f):
                if '"Write"' not in line and '"Edit"' not in line:
                    continue

                try:
                    data = json.loads(line)
                    if data.get('type') != 'assistant':
                        continue

                    content = data.get('message', {}).get('content', [])
                    if not isinstance(content, list):
                        continue

                    for item in content:
                        if item.get('type') != 'tool_use':
                            continue
                        tool_name = item.get('name', '')
                        if tool_name not in ('Write', 'Edit'):
                            continue

                        file_path = item.get('input', {}).get('file_path', '')
                        for pf in PLANNING_FILES:
                            if file_path.endswith(pf):
                                last_update_line = line_num
                                last_update_file = pf
                                break
                except json.JSONDecodeError:
                    continue
    except Exception:
        pass

    return last_update_line, last_update_file


def extract_messages_from_session(session_file: Path, after_line: int = -1) -> List[Dict]:
    """
    Extract conversation messages from a session file.
    If after_line >= 0, only extract messages after that line.
    If after_line < 0, extract all messages.
    """
    result = []

    try:
        with open(session_file, 'r') as f:
            for line_num, line in enumerate(f):
                if after_line >= 0 and line_num <= after_line:
                    continue

                try:
                    msg = json.loads(line)
                except json.JSONDecodeError:
                    continue

                msg_type = msg.get('type')
                is_meta = msg.get('isMeta', False)

                if msg_type == 'user' and not is_meta:
                    content = msg.get('message', {}).get('content', '')
                    if isinstance(content, list):
                        for item in content:
                            if isinstance(item, dict) and item.get('type') == 'text':
                                content = item.get('text', '')
                                break
                        else:
                            content = ''

                    if content and isinstance(content, str):
                        # Skip system/command messages
                        if content.startswith(('<local-command', '<command-', '<task-notification')):
                            continue
                        if len(content) > 20:
                            result.append({
                                'role': 'user',
                                'content': content,
                                'line': line_num,
                                'session': session_file.stem[:8]
                            })

                elif msg_type == 'assistant':
                    msg_content = msg.get('message', {}).get('content', '')
                    text_content = ''
                    tool_uses = []

                    if isinstance(msg_content, str):
                        text_content = msg_content
                    elif isinstance(msg_content, list):
                        for item in msg_content:
                            if item.get('type') == 'text':
                                text_content = item.get('text', '')
                            elif item.get('type') == 'tool_use':
                                tool_name = item.get('name', '')
                                tool_input = item.get('input', {})
                                if tool_name == 'Edit':
                                    tool_uses.append(f"Edit: {tool_input.get('file_path', 'unknown')}")
                                elif tool_name == 'Write':
                                    tool_uses.append(f"Write: {tool_input.get('file_path', 'unknown')}")
                                elif tool_name == 'Bash':
                                    cmd = tool_input.get('command', '')[:80]
                                    tool_uses.append(f"Bash: {cmd}")
                                elif tool_name == 'AskUserQuestion':
                                    tool_uses.append("AskUserQuestion")
                                else:
                                    tool_uses.append(f"{tool_name}")

                    if text_content or tool_uses:
                        result.append({
                            'role': 'assistant',
                            'content': text_content[:600] if text_content else '',
                            'tools': tool_uses,
                            'line': line_num,
                            'session': session_file.stem[:8]
                        })
    except Exception:
        pass

    return result


PLANNING_LIKE = ('%task_plan.md', '%findings.md', '%progress.md')


def get_opencode_db_path() -> Optional[Path]:
    """Resolve OpenCode SQLite path.

    xdg-basedir resolution is the same on every OS (Linux, macOS, Windows):
    ${XDG_DATA_HOME ?? ~/.local/share}/opencode/opencode.db. The legacy
    OPENCODE_DATA_DIR env var is honored as a fallback for users who set
    it under the pre-SQLite scheme.
    """
    xdg = os.environ.get('XDG_DATA_HOME')
    if xdg:
        base = Path(xdg) / 'opencode'
    elif os.environ.get('OPENCODE_DATA_DIR'):
        base = Path(os.environ['OPENCODE_DATA_DIR'])
    else:
        base = Path.home() / '.local' / 'share' / 'opencode'
    db = base / 'opencode.db'
    return db if db.exists() else None


def _format_opencode_part(data: Dict, session_id: str) -> Optional[Dict]:
    """Convert one OpenCode part row's JSON `data` blob into a print-ready summary."""
    ptype = data.get('type')
    short = session_id[:8] if session_id else '????????'
    if ptype == 'tool':
        tool = (data.get('tool') or '').lower()
        state = data.get('state') or {}
        input_ = state.get('input') or {}
        if tool in ('write', 'edit'):
            fp = input_.get('filePath', '')
            return {'session': short, 'summary': f"Tool {tool}: {fp}"}
        if tool == 'patch':
            return {'session': short, 'summary': f"Tool patch: {input_.get('filePath', '')}"}
        if tool == 'bash':
            cmd = (input_.get('command') or '')[:80]
            return {'session': short, 'summary': f"Tool bash: {cmd}"}
        return {'session': short, 'summary': f"Tool {tool}"}
    if ptype == 'text':
        text = (data.get('text') or '')[:300]
        if text.strip():
            return {'session': short, 'summary': f"text: {text}"}
    return None


def opencode_catchup(project_path: str) -> None:
    """Session catchup for OpenCode (SQLite at ~/.local/share/opencode/opencode.db).

    Schema reference (sst/opencode dev @ 2026-05-14):
      session (id, directory, time_created, ...)
      part    (id, session_id, message_id, time_created, data TEXT JSON)

    Tool calls are stored as part rows where data.type='tool',
    data.tool='write'|'edit'|'patch', data.state.input.filePath=<abs path>.
    """
    import sqlite3

    db_path = get_opencode_db_path()
    if not db_path:
        return

    try:
        conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    except sqlite3.OperationalError as exc:
        print(f"\n[planning-with-files] Could not open OpenCode DB read-only: {exc}")
        return

    cur = conn.cursor()

    try:
        cur.execute("PRAGMA table_info(session)")
        session_cols = {row[1] for row in cur.fetchall()}
        cur.execute("PRAGMA table_info(part)")
        part_cols = {row[1] for row in cur.fetchall()}
    except sqlite3.OperationalError:
        conn.close()
        return

    if 'directory' not in session_cols or 'data' not in part_cols:
        conn.close()
        return

    project_abs = str(Path(project_path).resolve())

    cur.execute(
        "SELECT id, time_created FROM session WHERE directory = ? ORDER BY time_created DESC",
        (project_abs,),
    )
    sessions = cur.fetchall()
    if len(sessions) < 2:
        conn.close()
        return

    previous_sessions = sessions[1:]

    update_sid = None
    update_time = None
    update_idx = -1
    for idx, (sid, _) in enumerate(previous_sessions):
        params = (sid,) + PLANNING_LIKE
        cur.execute(
            """
            SELECT time_created FROM part
            WHERE session_id = ?
              AND json_extract(data, '$.type') = 'tool'
              AND lower(json_extract(data, '$.tool')) IN ('write', 'edit', 'patch')
              AND (
                json_extract(data, '$.state.input.filePath') LIKE ?
                OR json_extract(data, '$.state.input.filePath') LIKE ?
                OR json_extract(data, '$.state.input.filePath') LIKE ?
              )
            ORDER BY time_created DESC
            LIMIT 1
            """,
            params,
        )
        row = cur.fetchone()
        if row:
            update_sid = sid
            update_time = row[0]
            update_idx = idx
            break

    if not update_sid:
        conn.close()
        return

    newer_sessions = list(reversed(previous_sessions[:update_idx]))

    all_messages: List[Dict] = []

    cur.execute(
        "SELECT data FROM part WHERE session_id = ? AND time_created > ? ORDER BY time_created ASC, id ASC",
        (update_sid, update_time),
    )
    for (data_str,) in cur.fetchall():
        try:
            data = json.loads(data_str)
        except json.JSONDecodeError:
            continue
        msg = _format_opencode_part(data, update_sid)
        if msg:
            all_messages.append(msg)

    for sid, _ in newer_sessions:
        cur.execute(
            "SELECT data FROM part WHERE session_id = ? ORDER BY time_created ASC, id ASC",
            (sid,),
        )
        for (data_str,) in cur.fetchall():
            try:
                data = json.loads(data_str)
            except json.JSONDecodeError:
                continue
            msg = _format_opencode_part(data, sid)
            if msg:
                all_messages.append(msg)

    conn.close()

    if not all_messages:
        return

    print(f"\n[planning-with-files] SESSION CATCHUP DETECTED (IDE: opencode)")
    print(f"Last planning update in session {update_sid[:8]}...")
    if update_idx + 1 > 1:
        print(f"Scanning {update_idx + 1} previous sessions for unsynced context")
    print(f"Unsynced parts: {len(all_messages)}")
    print("\n--- UNSYNCED CONTEXT ---")

    MAX_PARTS = 100
    if len(all_messages) > MAX_PARTS:
        print(f"(Showing last {MAX_PARTS} of {len(all_messages)} parts)\n")
        to_show = all_messages[-MAX_PARTS:]
    else:
        to_show = all_messages

    current_session = None
    for msg in to_show:
        if msg.get('session') != current_session:
            current_session = msg.get('session')
            print(f"\n[Session: {current_session}...]")
        print(f"  {msg['summary']}")

    print("\n--- RECOMMENDED ---")
    print("1. Run: git diff --stat")
    print("2. Read: task_plan.md, progress.md, findings.md")
    print("3. Update planning files based on above context")
    print("4. Continue with task")


def main():
    project_path = sys.argv[1] if len(sys.argv) > 1 else os.getcwd()

    ide = detect_ide()

    if ide == 'opencode':
        opencode_catchup(project_path)
        return

    # Claude Code path
    project_dir = get_project_dir_claude(project_path)

    if not project_dir.exists():
        return

    sessions = get_sessions_sorted(project_dir)
    if len(sessions) < 2:
        return

    # Skip the current session (most recently modified = index 0)
    previous_sessions = sessions[1:]

    # Find the most recent planning file update across ALL previous sessions
    # Sessions are sorted newest first, so we scan in order
    update_session = None
    update_line = -1
    update_file = None
    update_session_idx = -1

    for idx, session in enumerate(previous_sessions):
        line, filename = scan_for_planning_update(session)
        if line >= 0:
            update_session = session
            update_line = line
            update_file = filename
            update_session_idx = idx
            break

    if not update_session:
        # No planning file updates found in any previous session
        return

    # Collect ALL messages from the update point forward, across all sessions
    all_messages = []

    # 1. Get messages from the session with the update (after the update line)
    messages_from_update_session = extract_messages_from_session(update_session, after_line=update_line)
    all_messages.extend(messages_from_update_session)

    # 2. Get ALL messages from sessions between update_session and current
    # These are sessions[1:update_session_idx] (newer than update_session)
    intermediate_sessions = previous_sessions[:update_session_idx]

    # Process from oldest to newest for correct chronological order
    for session in reversed(intermediate_sessions):
        messages = extract_messages_from_session(session, after_line=-1)  # Get all messages
        all_messages.extend(messages)

    if not all_messages:
        return

    # Output catchup report
    print(f"\n[planning-with-files] SESSION CATCHUP DETECTED (IDE: {ide})")
    print(f"Last planning update: {update_file} in session {update_session.stem[:8]}...")

    sessions_covered = update_session_idx + 1
    if sessions_covered > 1:
        print(f"Scanning {sessions_covered} sessions for unsynced context")

    print(f"Unsynced messages: {len(all_messages)}")

    print("\n--- UNSYNCED CONTEXT ---")

    # Show up to 100 messages
    MAX_MESSAGES = 100
    if len(all_messages) > MAX_MESSAGES:
        print(f"(Showing last {MAX_MESSAGES} of {len(all_messages)} messages)\n")
        messages_to_show = all_messages[-MAX_MESSAGES:]
    else:
        messages_to_show = all_messages

    current_session = None
    for msg in messages_to_show:
        # Show session marker when it changes
        if msg.get('session') != current_session:
            current_session = msg.get('session')
            print(f"\n[Session: {current_session}...]")

        if msg['role'] == 'user':
            print(f"USER: {msg['content'][:300]}")
        else:
            if msg.get('content'):
                print(f"CLAUDE: {msg['content'][:300]}")
            if msg.get('tools'):
                print(f"  Tools: {', '.join(msg['tools'][:4])}")

    print("\n--- RECOMMENDED ---")
    print("1. Run: git diff --stat")
    print("2. Read: task_plan.md, progress.md, findings.md")
    print("3. Update planning files based on above context")
    print("4. Continue with task")


if __name__ == '__main__':
    main()
