FROM alpine:latest

WORKDIR /

RUN mkdir hubot

RUN apk add --update --no-cache \
        nodejs && \
        rm -rf /var/cache/apk /usr/share/man

WORKDIR /hubot

COPY package-lock.json package.json ./

RUN npm install

RUN mkdir bin scripts
COPY external-scripts.json .
COPY bin ./bin
COPY scripts ./scripts

ENV PATH="node_modules/.bin:node_modules/hubot/node_modules/.bin:$PATH"

ENTRYPOINT ["node_modules/.bin/hubot", "--name", "heimdall", "--adapter", "flowdock"]
