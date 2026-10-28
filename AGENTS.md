# Argus development

Before every task, read docs/CURRENT_STATE.md and relevant architecture/decisions.
The full project request lives in docs/PROJECT_BRIEF.md. Work one milestone at a time.
Never proceed while current milestone acceptance fails. Do not implement Milestone 1
until Milestone 0 is verified, and stop after the currently requested milestone.

After meaningful changes: test, fix, update docs/state with completed/remaining work,
blockers, bugs, passing/failing tests, deployment evidence and exact next task; commit
working state. Do not claim deployed acceptance from local tests alone.

Paper only. No live-money orders or endpoints. No credentials in source/logs/frontend
or commits. Use ignored .dev.vars locally and Cloudflare secrets in deployment.
Never change unrelated Cloudflare resources or activate paid services without
recording necessity and user authorization. Keep frameworks/dependencies minimal.
