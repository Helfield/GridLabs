# GridLabs music bot

Plays YouTube audio in a member's voice channel. Runs as its own service, using the
same bot account as the website's bot.

| Command | What it does |
|---|---|
| `/play song:<link or words>` | Joins your voice channel and plays a YouTube link, or searches for the words |
| `/skip` `/pause` `/resume` | What they say |
| `/queue` | What is playing and what is next |
| `/volume percent:<0-100>` | Sets the volume for everyone. **Every server starts at 50%.** |
| `/stop` | Stops, clears the queue and leaves |

Anyone can also turn it up or down just for themselves: right-click the bot in the
voice channel → **User Volume**.

It leaves by itself two minutes after the queue ends, or 30 seconds after the last
person leaves its channel. A bot account can only be in one voice channel per server,
so if it is busy in one channel it tells other people so instead of jumping over.

## One-time setup

### 1. Re-invite the bot with slash commands

The first invite only had the `bot` scope; slash commands also need `applications.commands`.
Open this link as someone who can manage the server and authorize it again (nothing is
lost, it only adds permissions):

```
https://discord.com/oauth2/authorize?client_id=1530657771672961205&scope=bot%20applications.commands&permissions=288427088
```

That asks for: Manage Channels, Move Members, Connect, Speak, View Channels, Send Messages,
Read Message History, Add Reactions (the first two are for temporary voice channels).

### 2. Add a second service on Railway

1. In your Railway project, **New → GitHub Repo** and pick the same GridLabs repo.
2. Open the new service → **Settings**:
   - **Root Directory:** `music-bot`
   - Builder: it will detect the `Dockerfile` (choose **Dockerfile** if it asks).
3. Open **Variables** and add:
   - `DISCORD_BOT_TOKEN` — the same token the website uses
   - `DISCORD_GUILD_ID` — your server's ID (same as the website's)
   - `DEFAULT_VOLUME` — optional, `50` if left out
4. Deploy. In the logs you should see `Music bot: connected as ...` and
   `Music bot: slash commands registered.`

This service has no web address and needs none.

### 3. Try it

Join a voice channel and run `/play song:` with a YouTube link.

## If YouTube blocks it

YouTube often refuses cloud servers with "Sign in to confirm you're not a bot". The bot
says so in the channel when it happens. Things to try, in order:

1. Wait and retry, or redeploy the service (it updates `yt-dlp` on every start).
2. Give it a signed-in session: export a `cookies.txt` from a browser (use a spare YouTube
   account, not your main one), base64-encode it, and add it as the `YT_COOKIES` variable.
   YouTube may still limit the account.
3. Run the same program on a home PC instead (`npm install`, then `node src/index.ts` with the
   same variables, with `yt-dlp`, `ffmpeg` and `deno` installed). Home internet connections are
   trusted far more than data centres.

Using YouTube audio this way goes against YouTube's terms, which is why large bots such as
Groovy and Rythm were shut down. It can stop working at any time.

## Development

```
npm install
npm run check   # typecheck
bun test test   # unit tests (link parsing and error messages)
```

Needs Node 24+ (it runs the TypeScript directly), `ffmpeg`, `yt-dlp` and `deno` on the path.
