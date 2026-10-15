/**
 * Who may control the music in a voice channel.
 *
 * The website's temporary voice channels give the member who created one a
 * Manage Channel permission on that single channel. So a voice channel that has
 * a *member-specific* Manage Channel permission is somebody's own channel, and
 * that member is its owner. No database lookup is needed: the owner is written
 * into the channel itself.
 *
 *  - An owned channel: only its owner (or a server administrator) controls the music.
 *  - Any other voice channel: unchanged, anyone in it can.
 */

// Discord's permission bits and overwrite types, as plain numbers so this stays easy to test.
export const MANAGE_CHANNELS = 1n << 4n;
export const OVERWRITE_MEMBER = 1; // 0 is a role, 1 is a member

export type Overwrite = { id: string; type: number; allow: { has(permission: bigint): boolean } };

/** The member who owns this channel, or null if it isn't a member-owned channel. */
export function channelOwnerId(overwrites: Iterable<Overwrite>): string | null {
  for (const o of overwrites) {
    if (o.type === OVERWRITE_MEMBER && o.allow.has(MANAGE_CHANNELS)) return o.id;
  }
  return null;
}

/** A message for the member if they may not control this channel's music, otherwise null. */
export function denyControl(
  overwrites: Iterable<Overwrite>,
  memberId: string,
  isAdministrator: boolean,
): string | null {
  const owner = channelOwnerId(overwrites);
  if (!owner || owner === memberId || isAdministrator) return null;
  return `Only <@${owner}>, who created this channel, can control the music here.`;
}
