FROM node:18-alpine3.15 AS runtime

RUN apk add --no-cache \
  pixman \
  cairo \
  pango \
  libjpeg-turbo \
  giflib && \
	rm -rf /usr/share/man/

WORKDIR /

FROM runtime AS build

RUN mkdir hubot

WORKDIR /hubot

RUN apk add --no-cache \
  python2 \
  make \
  g++ \
  gcc \
  openssh \
  pixman-dev \
  pkgconfig \
  python3 \
  cairo-dev \
  pango-dev \
  libjpeg-turbo \
  giflib-dev \
	git && \
	rm -rf /usr/share/man/

# Install pnpm
RUN npm install -g pnpm

COPY pnpm-lock.yaml package.json ./

RUN pnpm install --frozen-lockfile

RUN mkdir web bin discord-scripts scripts lib test
COPY external-scripts.json .
COPY web ./web
COPY bin ./bin
COPY discord-scripts ./discord-scripts
COPY scripts ./scripts
COPY lib ./lib
COPY BUILD ./BUILD
COPY tsconfig.json ./tsconfig.json

FROM runtime

COPY --from=build /hubot /hubot

WORKDIR /hubot

ENV PATH="node_modules/.bin:node_modules/hubot/node_modules/.bin:$PATH"

ENV NODE_OPTIONS="--experimental-vm-modules --experimental-loader ts-node/esm --no-experimental-fetch"

ENTRYPOINT ["bin/hubot", "--name", "valkyrie", "--adapter", "discord"]
