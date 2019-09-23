FROM node:10.9.0-alpine AS runtime

WORKDIR /

FROM runtime AS build

RUN mkdir hubot

WORKDIR /hubot

RUN apk add --no-cache \
	git && \
	rm -rf /usr/share/man/

COPY package-lock.json package.json ./

RUN npm install

RUN mkdir bin scripts lib test
COPY external-scripts.json .
COPY bin ./bin
COPY scripts ./scripts
COPY lib ./lib
COPY BUILD ./BUILD
COPY test ./test

RUN npm test
RUN rm -r test
RUN echo $?

FROM runtime

COPY --from=build /hubot /hubot

WORKDIR /hubot

ENV PATH="node_modules/.bin:node_modules/hubot/node_modules/.bin:$PATH"

ENTRYPOINT ["bin/hubot", "--name", "heimdall", "--adapter", "reload-flowdock"]
