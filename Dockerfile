FROM node:20-slim

RUN apt-get update && apt-get install -y \
    python3 python3-pip curl ffmpeg \
    && rm -rf /var/lib/apt/lists/*

RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
    -o /usr/local/bin/yt-dlp && chmod a+rx /usr/local/bin/yt-dlp

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY requirements.txt ./
RUN pip3 install -r requirements.txt --break-system-packages

COPY . .
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000
ENV PORT=3000

CMD ["npm", "start"]
