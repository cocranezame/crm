FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY package*.json ./
RUN npm install
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
EXPOSE 3010
CMD ["npm", "run", "dev"]
