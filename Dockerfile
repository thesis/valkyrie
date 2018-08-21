FROM node:10.9.0-alpine

WORKDIR /

RUN mkdir hubot

WORKDIR /hubot

COPY package-lock.json package.json ./

RUN npm install
# attempt to automagic patch found npm package vulnerabilities
RUN npm audit fix

RUN mkdir bin scripts
COPY external-scripts.json .
COPY bin ./bin
COPY scripts ./scripts
COPY BUILD ./BUILD

ENV PATH="node_modules/.bin:node_modules/hubot/node_modules/.bin:$PATH"

ENTRYPOINT ["node_modules/.bin/hubot", "--name", "heimdall", "--adapter", "flowdock"]
