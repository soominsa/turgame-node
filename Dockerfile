# ── Dockerfile — 게임노드 (운영자 배포용) ──
# 경량 이미지: sqlite/pixi/nginx 없음

FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY tsconfig.json ./
COPY src/ src/

# 7301: 게임 WS (UPnP 직접연결 시 사용)
EXPOSE 7301

CMD ["npx", "tsx", "src/index.ts"]
