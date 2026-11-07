# Instructions for coding agents

## Project context

- Itloe is played once, at Élodie's birthday party ("the evening"), hosted on Konstantin's server. Hard deadline: Friday 13 November 2026.
- Until then the game is in development, and nothing needs backward compatibility unless explicitly stated otherwise: not saves, configuration, environment variables, messages, clients or the production deployment. Make the change asked for directly. Don't keep old forms working, add transition paths, or soften or sequence a change to keep production running; breaking production before the evening is fine.

## Before editing

- `docs/planning/` contains ideas and backlog items.
- Read the README's “For developers” section for architecture, code conventions, and test commands. Inspect the neighboring implementation and relevant tests before choosing an approach.
- When adding or changing a minigame, read `docs/minigames.md` first.
- When adding or changing story content, the campaign engine (`shared/campaign/`), or code that reads the campaign (server, phone, TV), read `docs/story-engine.md` first and follow its rule: the story is data, the code is generic.
- Read the relevant sections of `PROTOCOL.md` when touching messages, HTTP endpoints or what a view carries. No contract is frozen: change one when a change makes sense, and update its documentation with the code.
- Check the working tree and preserve unrelated local changes. Follow file ownership assigned for the current task; coordinate changes to files owned by another active contributor.

## While implementing

- Keep changes scoped to the requested behavior. Reuse the current modules, helpers, data tables, and stack. Avoid unrelated refactoring, reformatting, new dependencies, or speculative extension machinery.
- Follow the README's conventions and preserve the documented state, authority, persistence, and session behavior. Reuse existing JSDoc/TypeScript types and shared rules rather than duplicating them.
- Keep trusted identity, timing, and judging inputs on the server. Route persistent changes through the existing reducer/change-hook path. Preserve quiz view filtering in every outgoing representation and silently ignore unknown incoming message types in clients.
- Keep question-bank attribution when editing or importing questions.
- Update the relevant documentation when an agreed change alters a documented contract or contributor workflow.

## Validation and handoff

- Before handoff, run `npm run check`, `npm test` and the e2e suites your change can affect, once each. While working, run only the test file or suite part you're changing; after a fix, rerun only what the fix can affect. Add or adjust focused behavioral tests where needed; documentation and cosmetic changes do not need new tests.
- A permanent test guards a behaviour that matters on the evening and could plausibly break. Checks made to confirm a change (each branch of a validation, a refactor's equivalence, exact wording, the shape of a fix) go in the report, not the suite.
- Never run state-changing tests against the interactive server on port 3131 or its `var/` save. Use a free port and scratch `BLOKO_VAR`.
- Run e2e tests only with `npm run e2e [suites]`, in the foreground: a full run takes about 3 minutes. Screen comparisons (`--shots` and `--compare`), the storyboard and scripts using `scripts/drive.mts` are for when the task asks for them or no suite reaches the screen, not a second check of what the suites already cover (README, "Development commands and testing").
- When a visual interaction is easy for Pierre to assess and browser testing would require extra setup, ask him to test it directly. Start the game on a free port with a scratch `BLOKO_VAR` first, and give him the screen, phone, or simulator URL he needs. Do not change test infrastructure solely for that visual check.
- Review the diff and remove unrelated changes or additions unnecessary for the requested outcome. Keep generated saves, screenshots, and dependencies out of commits.
- Report the resulting behavior, checks run, and any checks that could not run. If work elsewhere already breaks a check, report it without expanding the task into unrelated fixes.

## Local command authorization

- Pierre has authorized commands beginning with `CHROME=` for this project. Treat them as already approved; retain the scratch-save and port restrictions above.
