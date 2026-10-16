# GridLabs music bot. Build context is this folder (Railway: Root Directory = music-bot).
FROM node:24-bookworm-slim

# ffmpeg decodes the audio; curl/unzip fetch the tools below; python3 is not needed
# because yt-dlp is installed as its standalone binary.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg curl ca-certificates unzip \
 && rm -rf /var/lib/apt/lists/*

# yt-dlp needs a JavaScript runtime to get past YouTube's challenges; Deno is the one it uses by default.
COPY --from=denoland/deno:bin /deno /usr/local/bin/deno

# The standalone yt-dlp binary. YouTube changes often, so the entrypoint also updates it on every start.
RUN curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux -o /usr/local/bin/yt-dlp \
 && chmod a+rx /usr/local/bin/yt-dlp

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY src ./src

# Run as a normal user: the bot fetches content from the internet and has no reason to be root.
RUN useradd --create-home bot && chown -R bot /app && chown bot /usr/local/bin/yt-dlp
USER bot

# Update yt-dlp (it replaces itself in place), then start. A failed update must not stop the bot.
CMD ["sh", "-c", "yt-dlp -U || true; exec node src/index.ts"]
