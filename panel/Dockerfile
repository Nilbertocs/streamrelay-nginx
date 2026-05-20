FROM node:20-alpine

RUN apk add --no-cache ffmpeg python3 make g++

WORKDIR /app

COPY package.json ./
RUN npm install --production

COPY src ./src

RUN mkdir -p /app/data/db /app/data/videos /app/data/nginx

EXPOSE 3000

CMD ["node", "src/index.js"]
