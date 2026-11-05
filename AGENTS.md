# Instructions for coding agents

## Project context

- Itloe is played once, at Élodie's birthday party ("the evening"), hosted on Konstantin's server. Hard deadline: Friday 13 November 2026.
- Until then the game is in development: saves need no backward compatibility. Write no new save migrations; a save from an earlier version may start a fresh evening, but must never load into a broken state. A save written by the current version must still resume after a restart.

## Before editing

- Read the README's “For developers” section for architecture, code conventions, and test commands. Inspect the neighboring implementation and relevant tests before choosing an approach.
- When adding or changing a minigame, read `docs/minigames.md` first.
- Read the relevant sections of `PROTOCOL.md` and the contract sections of `BUILD-PLAN.md` when touching messages, shared APIs, or saved state. Do not silently change a contract marked frozen: raise the proposed change for agreement before implementing it. Historical work-package assignments apply when that coordination is in use; draft proposals do not define implemented APIs.
- Check the working tree and preserve unrelated local changes. Follow file ownership assigned for the current task; coordinate changes to files owned by another active contributor.

## While implementing

- Keep changes scoped to the requested behavior. Reuse the current modules, helpers, data tables, and stack. Avoid unrelated refactoring, reformatting, new dependencies, or speculative extension machinery.
- Follow the README's conventions and preserve the documented state, authority, persistence, and session behavior. Reuse existing JSDoc/TypeScript types and shared rules rather than duplicating them.
- Keep trusted identity, timing, and judging inputs on the server. Route persistent changes through the existing reducer/change-hook path. Preserve quiz view filtering in every outgoing representation and silently ignore unknown incoming message types in clients.
- Preserve stable content IDs, existing save migrations, and storage/environment names. Keep question-bank attribution when editing or importing questions.
- Update the relevant documentation when an agreed change alters a documented contract or contributor workflow.

## Validation and handoff

- For implementation changes, run `npm run check` and `npm test`. Add or adjust focused behavioral tests where needed; documentation and cosmetic changes do not need new tests. Select the relevant existing integration/browser suites using the README's instructions.
- Never run state-changing tests against the interactive server on port 3131 or its `var/` save. Use a free port and scratch `BLOKO_VAR`, or the suites that isolate their own server/data. When several agents share a machine, run every e2e suite through `scripts/e2e-slot.sh`, which runs up to three side by side; otherwise run one browser suite at a time.
- Review the diff and remove unrelated changes or additions unnecessary for the requested outcome. Keep generated saves, screenshots, and dependencies out of commits.
- Report the resulting behavior, checks run, and any checks that could not run. If work elsewhere already breaks a check, report it without expanding the task into unrelated fixes.
