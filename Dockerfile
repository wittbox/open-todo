# syntax=docker/dockerfile:1

# 컨테이너 하나짜리 이미지 — PostgreSQL 과 앱이 같이 들어 있다.
#
#   docker run -v todo-data:/data -p 3000:3000 -e APP_BASE_URL=https://todo.example.com <이미지>
#
# 베이스가 postgres 이미지인 이유: PostgreSQL 메이저를 태그로 못박을 수 있고(알파인 패키지는 알파인
# 릴리스에 끌려다닌다), 기존 compose 설치의 데이터 폴더(uid 70)를 그대로 받아들일 수 있다.
# Node 는 알파인 저장소 것이 22.x 라 `crypto.argon2`(Node 24.7+)가 없어서, node 이미지에서 바이너리만 가져온다.
# 두 베이스는 같은 알파인 마이너로 고정한다 — 어긋나면 musl/openssl 때문에 node 가 실행되지 않는다.

FROM node:24-alpine3.22 AS nodebin

FROM node:24-alpine3.22 AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# ── 의존성 ──────────────────────────────────────────────────────
FROM base AS deps
COPY package.json package-lock.json ./
# package.json 의 allowScripts 목록에 있는 패키지(Prisma 엔진, esbuild)만 설치 스크립트가 돈다.
RUN npm ci

# ── 빌드 ────────────────────────────────────────────────────────
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# prisma generate 후 next build. standalone 산출물이 .next/standalone 에 생긴다.
RUN npm run build

# ── 마이그레이션 도구만 따로 모은다 ─────────────────────────────
FROM base AS migrate-tree
COPY --from=deps /app/node_modules ./node_modules
COPY package.json prisma.config.ts ./
COPY prisma ./prisma
COPY scripts/migrate-tree.mjs ./scripts/migrate-tree.mjs
# 엔진 파일 이름에는 플랫폼이 붙는다(musl·openssl 버전). 이름을 적어 두는 대신 찾아서 한자리에 둔다 —
# 그래야 런타임에 플랫폼을 다시 재지 않고 PRISMA_SCHEMA_ENGINE_BINARY 로 바로 가리킬 수 있다.
RUN node scripts/migrate-tree.mjs /opt/migrate \
  && engine="$(find /opt/migrate/node_modules/@prisma/engines -maxdepth 1 -name 'schema-engine-*' -type f | head -1)" \
  && test -n "$engine" \
  && cp "$engine" /opt/migrate/schema-engine \
  && chmod +x /opt/migrate/schema-engine

# ── 실행 ────────────────────────────────────────────────────────
FROM postgres:16-alpine3.22 AS runner

# libstdc++ 는 node 바이너리가, tini 는 PID 1(좀비 수거·신호 전달)이 쓴다.
RUN apk add --no-cache libstdc++ tini
COPY --from=nodebin /usr/local/bin/node /usr/local/bin/node

ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    LANG=en_US.utf8 \
    PGDATA=/data/postgres \
    PGHOST=/var/run/postgresql \
    PGUSER=todo \
    PGDATABASE=todo \
    UPLOAD_DIR=/data/uploads \
    PRISMA_SCHEMA_ENGINE_BINARY=/opt/migrate/schema-engine \
    CHECKPOINT_DISABLE=1 \
    PRISMA_HIDE_UPDATE_MESSAGE=1

WORKDIR /app

# 앱은 여전히 uid 1001 로 돈다 — 기존 설치의 업로드 폴더를 그대로 쓸 수 있다.
RUN addgroup -g 1001 -S nodejs && adduser -u 1001 -S nextjs -G nodejs

COPY --from=builder /app/public ./public
# standalone 은 통째로 옮긴다. 보고서 PDF 글꼴이 그 안에 들어 있다(next.config.ts 의 outputFileTracingIncludes).
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=migrate-tree /opt/migrate /opt/migrate
COPY docker/entrypoint.mts /app/docker/entrypoint.mts

EXPOSE 3000

# 앱이 서고 DB 에 닿는지까지 본다. 처음 기동은 initdb·마이그레이션이 있어 넉넉히 기다린다.
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --start-interval=2s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

# PID 1 은 tini. 감독자는 root 로 시작해 자식(postgres·앱)의 권한을 낮춘다.
ENTRYPOINT ["/sbin/tini", "--", "node", "--disable-warning=ExperimentalWarning", "/app/docker/entrypoint.mts"]
