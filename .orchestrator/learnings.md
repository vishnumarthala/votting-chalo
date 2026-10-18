# Learnings

Lessons from reviews and user feedback. Every forge agent reads this before working. Add one with `forge learn add "..." [--tag area]`, and use `--global` for lessons that apply to all projects.

- 2026-10-18 (world) Real towns must not need buildTown's newShopPlot fallback: assert per town that every document shop is an existing house (the fallback exists only for sparse test fixtures).
