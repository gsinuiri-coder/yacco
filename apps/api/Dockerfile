# Imagen de la API para Cloud Run.
#
# Se construye SIEMPRE desde la raíz del monorepo, no desde apps/api:
#     docker build -f apps/api/Dockerfile .
# El lockfile y el workspace viven en la raíz, y los filtros de pnpm resuelven
# contra ella.

FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
# Husky no tiene nada que hacer dentro de una imagen: no hay .git, y su
# "prepare" haría fallar el install.
ENV HUSKY=0
RUN corepack enable

# ---------------------------------------------------------------- dependencias
# Etapa propia sólo para instalar, y copiando ANTES los manifiestos que el
# código: mientras el lockfile no cambie, Docker reutiliza esta capa y el
# install no se vuelve a pagar en cada cambio de una línea de TypeScript.
FROM base AS deps
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @yacco/api...

# ----------------------------------------------------------------------- build
FROM base AS build
WORKDIR /repo
COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/apps/api/node_modules ./apps/api/node_modules
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api apps/api
COPY packages/shared packages/shared

# El cliente de Prisma se genera ANTES de compilar: el build de TypeScript
# importa sus tipos, y sin generar no existen.
RUN pnpm --filter @yacco/api exec prisma generate
RUN pnpm --filter @yacco/api build

# `pnpm deploy` arma en /app un árbol autocontenido con node_modules reales
# (no symlinks al store) y sólo las dependencias de producción.
RUN pnpm deploy --filter @yacco/api --prod /app

# El `deploy --prod` reinstala node_modules desde el store, así que el cliente
# que se generó arriba no viaja: hay que volver a generarlo DENTRO de /app.
#
# El binario sale de apps/api/node_modules/.bin y no de la raíz: pnpm enlaza
# los ejecutables en el paquete que declara la dependencia, y `prisma` es
# devDependency de @yacco/api. En la etapa de build las devDependencies todavía
# están; en la imagen final ya no.
RUN cd /app && /repo/apps/api/node_modules/.bin/prisma generate --schema=./prisma/schema.prisma

# Prisma trae los motores de consulta de TODOS los motores que soporta:
# cockroachdb, mysql, sqlite y sqlserver además de postgresql. Este proyecto
# sólo habla postgresql (`provider = "postgresql"` en schema.prisma), así que
# los otros cuatro son peso muerto: ~130 MB de imagen que Cloud Run descarga
# en cada arranque en frío, y el arranque medido muestra 4,9 s ANTES de que
# Nest imprima su primera línea.
#
# Se borran por nombre de motor, nunca con un comodín sobre "query_engine":
# eso se llevaría también el de postgresql y el cliente dejaría de funcionar
# en runtime, no en el build.
RUN find /app/node_modules -type f \( \
      -name "*query_engine*cockroachdb*" -o \
      -name "*query_engine*mysql*" -o \
      -name "*query_engine*sqlite*" -o \
      -name "*query_engine*sqlserver*" \) -delete

# TypeScript es peer opcional de @prisma/client y `pnpm deploy --prod` lo
# arrastra: 23 MB de compilador dentro de una imagen que sólo ejecuta
# JavaScript ya compilado.
RUN rm -rf /app/node_modules/.pnpm/typescript@*

# --------------------------------------------------------------------- runtime
FROM base AS runtime
WORKDIR /app

# Usuario sin privilegios. La imagen de node ya trae `node` (uid 1000); se
# reutiliza en vez de crear otro, y /app le pertenece para que nada necesite
# escribir como root.
COPY --from=build --chown=node:node /app /app
USER node

ENV NODE_ENV=production
# Cloud Run inyecta PORT y descarta la revisión si el proceso no se ata a
# 0.0.0.0. El valor de acá es sólo el de respaldo para correr la imagen a mano.
ENV PORT=8080
EXPOSE 8080

# Sin shell: `node` queda como PID 1 y recibe el SIGTERM de Cloud Run tal cual,
# que es lo que dispara el enableShutdownHooks de main.ts y cierra el pool de
# Prisma. Con `sh -c`, la señal muere en el shell y la instancia se recicla
# dejando la conexión colgada.
CMD ["node", "dist/main.js"]
