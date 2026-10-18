/**
 * Google Calendar connection for league drivers.
 *
 * A member connects their Google account once (OAuth, see the /league/calendar
 * routes). From then on the site can write each league race straight into
 * their calendar -- and update or remove it when an organiser edits or deletes
 * the event -- without them doing anything. This module owns the Google side
 * only: the OAuth dance, refreshing short-lived access tokens, and the
 * calendar-event REST calls. Deciding WHO to sync and WHEN lives in
 * db/league.ts; the (user, event) -> google event id bookkeeping lives in the
 * league_calendar_events table.
 *
 * Everything here is fail-quiet: a Google outage or a revoked grant must
 * never break registering for a league or saving a race. Callers get null /
 * false and log, exactly like the Discord leaderboard sync.
 */

import { siteUrl } from "./siteUrl";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const CALENDAR_API = "https://www.googleapis.com/calendar/v3";

// openid + email so the token response carries an id_token we can read the
// address out of (to show on the account page); calendar.events so we can
// create, edit and delete events we add -- not read the member's whole calendar.
const SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.events",
].join(" ");

export function calendarEnabled(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function calendarRedirectUri(): string {
  const explicit = process.env.GOOGLE_REDIRECT_URI?.trim();
  return explicit || `${siteUrl()}/league/calendar/callback`;
}

/** Where to send a member to grant calendar access. `state` is echoed back. */
export function authorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID ?? "",
    redirect_uri: calendarRedirectUri(),
    response_type: "code",
    scope: SCOPES,
    access_type: "offline", // we need a refresh token to act when they're away
    prompt: "consent", // force a refresh token even if they granted before
    include_granted_scopes: "false",
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

export type GoogleGrant = { refreshToken: string; email: string | null };

/** Turn the authorization code from the callback into a refresh token + email. */
export async function exchangeCode(code: string): Promise<GoogleGrant | null> {
  try {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID ?? "",
        client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
        redirect_uri: calendarRedirectUri(),
        grant_type: "authorization_code",
      }),
    });
    if (!res.ok) {
      console.error("Google token exchange failed:", res.status, await res.text());
      return null;
    }
    const data = (await res.json()) as { refresh_token?: string; id_token?: string };
    if (!data.refresh_token) {
      console.error("Google token exchange returned no refresh_token (already granted? use prompt=consent).");
      return null;
    }
    return { refreshToken: data.refresh_token, email: emailFromIdToken(data.id_token) };
  } catch (err) {
    console.error("Google token exchange error:", err);
    return null;
  }
}

/** The email claim from the id_token JWT, or null. No signature check -- it's
 *  only ever shown back to the person who just completed the flow. */
function emailFromIdToken(idToken?: string): string | null {
  if (!idToken) return null;
  try {
    const payload = idToken.split(".")[1];
    const json = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return typeof json.email === "string" ? json.email : null;
  } catch {
    return null;
  }
}

// Access tokens are short-lived (~1 h). Cache them by refresh token so a burst
// of syncing (backfilling a season) doesn't hit Google's token endpoint per event.
const tokenCache = new Map<string, { accessToken: string; expiresAt: number }>();

async function accessToken(refreshToken: string): Promise<string | null> {
  const cached = tokenCache.get(refreshToken);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.accessToken;
  try {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID ?? "",
        client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });
    if (!res.ok) {
      console.error("Google access-token refresh failed:", res.status, await res.text());
      tokenCache.delete(refreshToken);
      return null;
    }
    const data = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!data.access_token) return null;
    tokenCache.set(refreshToken, {
      accessToken: data.access_token,
      expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    });
    return data.access_token;
  } catch (err) {
    console.error("Google access-token refresh error:", err);
    return null;
  }
}

export type CalendarEventInput = {
  summary: string;
  description: string;
  startUtc: Date;
  endUtc: Date;
  /** The Google event id to overwrite; omit to create a new event. */
  googleEventId?: string | null;
};

/**
 * Create or update one event in the member's primary calendar. Returns the
 * Google event id (new or existing) on success, null on any failure.
 */
export async function upsertCalendarEvent(
  refreshToken: string,
  input: CalendarEventInput,
): Promise<string | null> {
  const token = await accessToken(refreshToken);
  if (!token) return null;

  const body = {
    summary: input.summary,
    description: input.description,
    start: { dateTime: input.startUtc.toISOString(), timeZone: "UTC" },
    end: { dateTime: input.endUtc.toISOString(), timeZone: "UTC" },
    // A 30-minute heads-up, the same for every driver.
    reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 30 }] },
  };

  const url = input.googleEventId
    ? `${CALENDAR_API}/calendars/primary/events/${encodeURIComponent(input.googleEventId)}`
    : `${CALENDAR_API}/calendars/primary/events`;

  try {
    const res = await fetch(url, {
      method: input.googleEventId ? "PUT" : "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.error("Google calendar upsert failed:", res.status, await res.text());
      return null;
    }
    const data = (await res.json()) as { id?: string };
    return data.id ?? input.googleEventId ?? null;
  } catch (err) {
    console.error("Google calendar upsert error:", err);
    return null;
  }
}

/** Remove an event we previously added. True once Google confirms it's gone. */
export async function deleteCalendarEvent(refreshToken: string, googleEventId: string): Promise<boolean> {
  const token = await accessToken(refreshToken);
  if (!token) return false;
  try {
    const res = await fetch(
      `${CALENDAR_API}/calendars/primary/events/${encodeURIComponent(googleEventId)}`,
      { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
    );
    if (res.ok || res.status === 404 || res.status === 410) return true; // already gone counts as gone
    console.error("Google calendar delete failed:", res.status, await res.text());
    return false;
  } catch (err) {
    console.error("Google calendar delete error:", err);
    return false;
  }
}
