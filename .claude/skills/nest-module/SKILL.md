---
name: nest-module
description: Standard anatomy for a new NestJS module or endpoint in
  apps/api. Use whenever creating a new module, controller, service or
  endpoint, or adding an endpoint to an existing module.
---

# NestJS module anatomy

## Standard layout

```
apps/api/src/modules/<module-name>/
├── <module-name>.module.ts
├── <module-name>.controller.ts
├── <module-name>.service.ts
├── <module-name>.service.spec.ts
└── dto/
    ├── create-<entity>.dto.ts
    └── update-<entity>.dto.ts
```

## Rules

- Business logic lives in the **service**, never in the controller. The
  controller only validates the request shape (via DTOs) and delegates.
- Every DTO uses `class-validator` decorators (`@IsUUID`, `@IsInt`,
  `@Min(0)`, `@IsEnum(...)`, etc.) — never trust an unvalidated payload,
  especially from `/sync/operations` (see skill `sync-protocol`).
- Every endpoint that isn't public carries a role guard
  (`@Roles(UserRole.ADMIN)`, etc.) matching spec §1.4 / HU-22, HU-23. A
  route with no guard is a bug unless it's `/health` or `/auth/login`.
- Document every endpoint with `@nestjs/swagger` decorators
  (`@ApiOperation`, `@ApiResponse`, DTOs annotated with `@ApiProperty`) so
  `/api/docs` (spec §4.3) stays accurate without a separate write-up.
- Routes are `kebab-case` plural, versioned under `/api/v1`
  (`/production-batches`, not `/lotesProduccion` or `/productionBatch`).
- New module logic is TDD from the Gherkin criteria in spec §2.4: write the
  failing spec that quotes the scenario before implementing.
- Cross-module calls go through injected services, not raw Prisma queries
  reaching into another module's tables — respect the module boundaries from
  the C4 component diagram (spec §3.3).
