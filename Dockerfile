# ── Dockerfile — 게임노드 (운영자 배포용) ──
# 경량 이미지: sqlite/pixi/nginx 없음
# 빌드 컨텍스트: 루트 (context: .)

FROM node:22-alpine

WORKDIR /workspace

# 의존성
COPY node-server/package.json node-server/package-lock.json node-server/
RUN cd node-server && npm ci --omit=dev

# 소스
COPY node-server/tsconfig.json node-server/
COPY node-server/src/ node-server/src/
COPY packages/game-core/src/ packages/game-core/src/

# 7301: 게임 WS (UPnP 직접연결 시 사용)
EXPOSE 7301

CMD ["sh", "-c", "cd node-server && npx tsx src/index.ts"]
