import { describe, expect, test } from "bun:test";
import { formatDuration, parseTarget, ytdlpArgument } from "../src/target.ts";
import { explainFailure } from "../src/ytdlp.ts";

describe("parseTarget", () => {
  test.each([
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://youtu.be/dQw4w9WgXcQ",
    "https://music.youtube.com/watch?v=abc",
    "https://m.youtube.com/watch?v=abc",
    "http://youtube.com/watch?v=abc",
    "HTTPS://WWW.YOUTUBE.COM/watch?v=abc",
  ])("accepts %s as a link", (url) => {
    const t = parseTarget(url);
    expect("kind" in t && t.kind).toBe("url");
  });

  test("a bare www. link is treated as a link", () => {
    const t = parseTarget("www.youtube.com/watch?v=abc");
    expect("kind" in t && t.kind === "url" && t.value.startsWith("https://www.youtube.com/")).toBe(true);
  });

  test.each([
    "https://example.com/video.mp4",
    "http://127.0.0.1:8080/secret",
    "http://169.254.169.254/latest/meta-data/",
    "http://localhost/x",
    "file:///etc/passwd",
    "ftp://youtube.com/x",
    "https://youtube.com.evil.com/watch?v=abc",
    "https://evil.com/?u=https://www.youtube.com/watch?v=abc",
    "https://user:pw@www.youtube.com/watch?v=abc",
    "https://soundcloud.com/a/b",
  ])("rejects %s", (url) => {
    expect("error" in parseTarget(url)).toBe(true);
  });

  test("plain words become a search", () => {
    const t = parseTarget("  daft   punk   one more time ");
    expect(t).toEqual({ kind: "search", value: "daft punk one more time" });
  });

  test("empty and over-long input are rejected", () => {
    expect("error" in parseTarget("   ")).toBe(true);
    expect("error" in parseTarget("a".repeat(201))).toBe(true);
  });

  test("search text starting with a dash cannot become an option (it is always prefixed)", () => {
    const t = parseTarget("--exec rm -rf /");
    expect("kind" in t).toBe(true);
    if ("kind" in t) expect(ytdlpArgument(t).startsWith("ytsearch1:")).toBe(true);
  });
});

describe("helpers", () => {
  test("formatDuration", () => {
    expect(formatDuration(65)).toBe("1:05");
    expect(formatDuration(3661)).toBe("1:01:01");
    expect(formatDuration(null)).toBe("live");
  });

  test("explainFailure recognises the bot-check wall", () => {
    expect(explainFailure("ERROR: [youtube] x: Sign in to confirm you're not a bot")).toContain("blocking");
    expect(explainFailure("ERROR: Video unavailable")).toContain("unavailable");
    expect(explainFailure("something odd")).toContain("different link");
  });
});
