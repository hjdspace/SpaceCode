import json, os
base = os.path.expanduser("~")
f = os.path.join(base, ".claude/projects/D--AI-SpaceCode/1b497d73-d808-4de3-831a-e6d16f9dcd6e.jsonl")
for line in open(f, encoding='utf-8'):
    if 'task-notification' not in line: continue
    try: d = json.loads(line)
    except: continue
    c = d.get('message',{}).get('content') if isinstance(d.get('message'),dict) else None
    preview = c[:60] if isinstance(c,str) else json.dumps(c)[:60]
    print("type=%s isMeta=%s isSidechain=%s isVisInTranscript=%s userType=%s" % (
        d.get('type'), d.get('isMeta'), d.get('isSidechain'), d.get('isVisibleInTranscriptOnly'), d.get('userType')))
    print("  top keys:", list(d.keys()))
    print("  content preview:", repr(preview))
    print()
