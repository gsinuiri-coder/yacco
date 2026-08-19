---
name: sprint-close
description: Checklist to close a sprint. Invoke as /sprint-close at the end
  of each 7-day sprint (day 7), after hardening is done and before the demo
  with the plant owner.
---

# Sprint close checklist

Run through these in order. Don't skip a step to save time — a sprint that
isn't actually closed (no tag, no updated doc) is technical debt on the
process itself, not just the code.

1. **CI green.** Confirm the full pipeline (lint, typecheck, unit,
   integration with Testcontainers, `prisma validate`, invariants test,
   build, gitleaks, audit) is green on `main` at the commit being tagged.
2. **Tag.** Create the semver tag for this sprint (`v0.1.0-alpha`, `v0.2.0`,
   …) per the schedule in the execution plan §4.
3. **Changelog.** Generate it from the Conventional Commits merged this
   sprint.
4. **Deploy verified.** Confirm the tagged commit is actually live (Render
   API + web, `prisma migrate deploy` applied). Hit `/health`. Smoke-test the
   sprint's headline flow.
5. **Demo seed.** Run the `demo-seed` skill's procedure so the demo
   environment has realistic data for the sprint being shown.
6. **Acta.** Write a short minutes doc of the demo: date, what the owner did
   (not watched — see execution plan principle "the owner runs it"),
   findings, decisions.
7. **Validation issues.** File every piece of owner feedback as a `validation`
   issue; do not fix anything on the spot mid-demo.
8. **Update the spec.** Capítulos IV–VI of `docs/yacco-documentacion.md` are
   a living baseline: replace their "(plan)" placeholders with the real
   evidence for this sprint (commits, tag, deployed URL, acta reference).
9. **Retro.** 15 minutes: what slowed the sprint down, one adjustment for
   next sprint's backlog.
