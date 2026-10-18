# Engineering standards

The standards reviewer and the judge enforce this file at review time, together with the active domain packs (`forge domains list`) and the Fowler smell baseline in `skills/code-review`. Builders are not asked to memorise it: review has the least context pressure, so standards live there (Matt Pocock's retro rule). Edit "Project rules" freely. Every rule should be checkable in a diff, and a rule a linter could check belongs in the linter instead.

## Correctness
- Every acceptance criterion has a test that fails if the behaviour breaks.
- Errors are handled where they can be acted on. Nothing is swallowed silently.
- Every external call has a timeout and a defined failure behaviour.
- Inputs are validated at boundaries (API, CLI, file, network, model output).

## Tests
- Tests go through agreed seams (public interfaces) and describe behaviour, not implementation. Mock only at system boundaries.
- Expected values come from an independent source (a literal, a worked example, the spec), never recomputed the way the code does.
- No skipped/xfail/only tests committed. No sleeps for synchronisation.
- Tests are deterministic: fixed seeds, frozen time, recorded fixtures for network.
- Test names carry the planned case ID (e.g. `T7`) so plan → test traceability holds.

## Design & readability
- Deep modules: a lot of behaviour behind a small interface, at a clean seam (`skills/codebase-design`).
- Names come from GLOSSARY.md. Functions do one thing.
- No dead code, commented-out code, or debugging leftovers.
- No duplication of logic that has a single source of truth.
- Dependencies are justified, maintained, pinned, and minimal.
- Public interfaces are documented with an example.

## Security & data
- No secrets in code, tests, logs, fixtures, or commits. Config comes from the environment.
- Least privilege for credentials, IAM, and tool permissions.
- Personal data is minimised and handled per the recorded decisions.

## Process
- Changes stay inside the active checkpoint's scope.
- Recorded decisions and ADRs are binding. Changing one needs the user.
- Never loosen a gate (lint config, type strictness, thresholds, tests) to get green.

## Project rules
<!-- add project-specific, checkable rules here; the setup skill fills stack conventions -->
