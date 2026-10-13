# GameVibe 全栈单服务镜像
# 后端(Node/Hono)同源托管前端(dist)，一个容器 = 完整应用
FROM node:24-slim

WORKDIR /app

# 先复制依赖清单以利用 Docker 层缓存
COPY package*.json ./
RUN npm ci

# 复制源码并构建前端（生成 dist/）
COPY . .
RUN npm run build

ENV NODE_ENV=production
EXPOSE 8792

# 运行时通过 --env-file 或环境变量注入密钥（.env 不进镜像，见 .dockerignore）
CMD ["node", "--env-file=.env", "--no-warnings", "server/index.ts"]
