/**
 * The site's public address, for links that leave the site: the Discord
 * leaderboard's "full times & downloads" link and the social-preview
 * tags in every page's <head>.
 *
 * Resolved in order: an explicit SITE_URL, then the origin of
 * DISCORD_REDIRECT_URI (which production already has to set to
 * https://<the site>/auth/discord/callback, so it is always the real
 * address -- unless it still points at localhost for development), and
 * finally the production address. It used to fall back to a placeholder
 * domain nobody owns, which is how a wrong link ended up in Discord.
 */

const PRODUCTION_FALLBACK = "https://gridlabs-production.up.railway.app";

export function siteUrl(env: Record<string, string | undefined> = process.env): string {
  const explicit = env.SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");

  const redirect = env.DISCORD_REDIRECT_URI?.trim();
  if (redirect) {
    try {
      const url = new URL(redirect);
      const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
      if (!local) return url.origin;
    } catch {
      // not a URL: fall through
    }
  }
  return PRODUCTION_FALLBACK;
}
