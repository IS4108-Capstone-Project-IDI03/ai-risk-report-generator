FROM node:26-alpine

# Chromium prints the report export (EX-01), with Liberation Sans standing in
# for Arial at the same metrics, so the PDF breaks its pages where the
# browser's page layout does.
RUN apk add --no-cache chromium font-liberation \
  && ln -sf "$(command -v chromium-browser || command -v chromium)" /usr/local/bin/export-chromium
ENV CHROMIUM_PATH=/usr/local/bin/export-chromium

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 4000

CMD ["npm", "run", "dev"]
