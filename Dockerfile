# syntax=docker/dockerfile:1

# 앱 이미지.
# 마이그레이션은 builder 단계를 그대로 쓰는 별도 서비스가 돌린다(docker-compose.yml).
# 그래서 runner 에는 Prisma CLI 도, 엔진 바이너리도 넣지 않는다.
# Prisma 7 은 드라이버 어댑터(pg)를 쓰므로 런타임은 순수 JS 다.

FROM node:24-alpine AS base
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

# ── 실행 ────────────────────────────────────────────────────────
FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup -g 1001 -S nodejs && adduser -u 1001 -S nextjs -G nodejs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000

# 컨테이너 자체 상태 확인. compose 의 depends_on 이 이걸 본다.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "server.js"]
