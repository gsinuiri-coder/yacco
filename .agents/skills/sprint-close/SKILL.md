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

1. **Estado por módulo.** Regenerate `docs/estado-por-modulo.md` from the
   code, not from memory: walk `apps/api/src/modules/**/*.controller.ts` for
   endpoints, `apps/web/src/app.tsx` + `apps/web/src/pages/` +
   `apps/web/src/api/` for which screens exist and consume them. This is the
   last moment the table can reflect this sprint's real code, so it runs
   before the commit is tagged: regenerate first, then verify CI (step 2) on
   the now-complete commit, then tag (step 3). If a domain's state changed
   since the last regeneration, or the code disagrees with this doc or any
   other, that's a real finding for this sprint — carry it into the acta
   (step 7) and validation issues (step 8); don't quietly edit it away.
2. **CI green.** Confirm the full pipeline (lint, typecheck, unit,
   integration with Testcontainers, `prisma validate`, invariants test,
   build, gitleaks, audit) is green on `main` at the commit being tagged.
3. **Tag.** Create the semver tag for this sprint (`v0.1.0-alpha`, `v0.2.0`,
   …) per the schedule in the execution plan §4.
4. **Changelog.** Generate it from the Conventional Commits merged this
   sprint.
5. **Deploy verified.** Confirm the tagged commit is actually live (Render
   API + web, `prisma migrate deploy` applied). Hit `/health`. Smoke-test the
   sprint's headline flow.
6. **Demo seed.** Run the `demo-seed` skill's procedure so the demo
   environment has realistic data for the sprint being shown.
7. **Acta.** Write a short minutes doc of the demo: date, what the owner did
   (not watched — see execution plan principle "the owner runs it"),
   findings, decisions.
8. **Validation issues.** File every piece of owner feedback as a `validation`
   issue; do not fix anything on the spot mid-demo.
9. **Update the spec.** Capítulos IV–VI of `docs/yacco-documentacion.md` are
   a living baseline: replace their "(plan)" placeholders with the real
   evidence for this sprint (commits, tag, deployed URL, acta reference).
10. **Retro.** 15 minutes: what slowed the sprint down, one adjustment for
    next sprint's backlog.
