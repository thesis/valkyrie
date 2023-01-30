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

COPY yarn.lock package.json ./

RUN yarn install

RUN mkdir web bin scripts lib test
COPY external-scripts.json .
COPY web ./web
COPY bin ./bin
COPY scripts ./scripts
COPY lib ./lib
COPY BUILD ./BUILD
COPY tsconfig.json ./tsconfig.json

FROM runtime

COPY --from=build /hubot /hubot

WORKDIR /hubot

ENV PATH="node_modules/.bin:node_modules/hubot/node_modules/.bin:$PATH"

ENTRYPOINT ["bin/hubot", "--name", "valkyrie", "--adapter", "matrix"]
