# Collaboration playbook

1. Both agents: `register_agent` / `whoami`
2. Orchestrator: `post_message` with a concrete handoff
3. Implementer: `check_inbox` → `read_message` → work → `reply_message`
4. Orchestrator: `check_inbox` and continue

Keep messages short, include file paths, and mark status `working` / `waiting` / `idle`.
