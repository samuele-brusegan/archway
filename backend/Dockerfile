FROM node:22-alpine

WORKDIR /app
COPY server.js ./server.js
COPY package.json ./package.json

RUN mkdir -p /app/data
COPY src ./src
COPY test ./test
RUN chown -R node:node /app/data /app/src
USER node

ENV NODE_ENV=production
EXPOSE 3001
CMD ["node", "server.js"]
