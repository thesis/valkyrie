FROM node:18-alpine3.15 AS runtime

WORKDIR /

FROM runtime AS build

RUN mkdir hubot

WORKDIR /hubot

RUN apk add --no-cache \
  python2 \
  make \
  g++ \
  openssh \
	git && \
	rm -rf /usr/share/man/

COPY yarn.lock package.json ./

RUN yarn install

RUN mkdir bin scripts lib test
COPY external-scripts.json .
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
