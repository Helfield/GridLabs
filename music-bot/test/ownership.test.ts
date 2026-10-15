import { describe, expect, test } from "bun:test";
import { PermissionFlagsBits, OverwriteType, PermissionsBitField } from "discord.js";
import { MANAGE_CHANNELS, OVERWRITE_MEMBER, channelOwnerId, denyControl, type Overwrite } from "../src/ownership.ts";

const allow = (...bits: bigint[]) => new PermissionsBitField(bits.reduce((a, b) => a | b, 0n));
const member = (id: string, ...bits: bigint[]): Overwrite => ({ id, type: OVERWRITE_MEMBER, allow: allow(...bits) });
const role = (id: string, ...bits: bigint[]): Overwrite => ({ id, type: 0, allow: allow(...bits) });

describe("channel ownership", () => {
  test("constants match Discord's own values", () => {
    expect(MANAGE_CHANNELS).toBe(PermissionFlagsBits.ManageChannels);
    expect(OVERWRITE_MEMBER).toBe(OverwriteType.Member);
  });

  test("the member holding Manage Channel on the channel is its owner", () => {
    expect(channelOwnerId([member("A", PermissionFlagsBits.ManageChannels)])).toBe("A");
  });

  test("an ordinary channel has no owner", () => {
    expect(channelOwnerId([])).toBeNull();
    expect(channelOwnerId([role("everyone", PermissionFlagsBits.ViewChannel)])).toBeNull();
  });

  test("a role with Manage Channel does not make an owner; neither does a member overwrite without it", () => {
    expect(channelOwnerId([role("mods", PermissionFlagsBits.ManageChannels)])).toBeNull();
    expect(channelOwnerId([member("B", PermissionFlagsBits.Connect)])).toBeNull();
  });
});

describe("denyControl", () => {
  const owned = [member("A", PermissionFlagsBits.ManageChannels)];

  test("the owner may control their channel", () => {
    expect(denyControl(owned, "A", false)).toBeNull();
  });

  test("someone else is refused, and told who the owner is", () => {
    const msg = denyControl(owned, "B", false);
    expect(msg).toContain("<@A>");
  });

  test("an administrator may always control it", () => {
    expect(denyControl(owned, "B", true)).toBeNull();
  });

  test("a channel nobody owns stays open to everyone", () => {
    expect(denyControl([], "B", false)).toBeNull();
    expect(denyControl([role("mods", PermissionFlagsBits.ManageChannels)], "B", false)).toBeNull();
  });
});
