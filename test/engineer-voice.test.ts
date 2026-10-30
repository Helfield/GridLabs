import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  handleVoiceRequest, validateClip,
  VOICE_MAX_BYTES, CLIP_MIN_BYTES, ASR_TIMEOUT_MS, ASR_MAX_BYTES, TRANSCRIPT_MAX_CHARS,
  type VoiceDeps,
} from "../src/engineer";

const initialFetch = globalThis.fetch;
beforeEach(() => {
  process.env.OPENAI_API_KEY = "draft-test-key";
  delete process.env.GRIDLABS_ASR_MODEL;
  globalThis.fetch = async () => { throw new Error("Unmocked fetch forbidden"); };
});
afterEach(() => {
  delete process.env.OPENAI_API_KEY;
  delete process.env.GRIDLABS_ASR_MODEL;
  globalThis.fetch = initialFetch;
});

// 16 kHz mono 16-bit, the format the desktop app records in.
function wav(seconds: number): Uint8Array {
  const samples = 16000 * seconds;
  const bytes = new Uint8Array(44 + samples * 2);
  const view = new DataView(bytes.buffer);
  const tag = (at: number, text: string) => { for (let i = 0; i < text.length; i++) bytes[at + i] = text.charCodeAt(i); };
  tag(0, "RIFF"); view.setUint32(4, 36 + samples * 2, true); tag(8, "WAVE"); tag(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true);
  view.setUint16(34, 16, true); tag(36, "data"); view.setUint32(40, samples * 2, true);
  return bytes;
}
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
const clip = (audio: Uint8Array = wav(2)) => JSON.stringify({ audio: b64(audio) });
function request(body: string): Request {
  return new Request("http://draft.invalid/api/engineer/voice", {
    method: "POST", headers: { "Content-Type": "application/json" }, body,
  });
}
const spoken = (text: unknown) => new Response(JSON.stringify({ text }));

function harness(responses: (Response | ((init: RequestInit) => Response | Promise<Response>))[] = [spoken(" how hot are my rear tyres? ")]) {
  const sent: { url: string; init: RequestInit }[] = [];
  const logs: { reason: string; status: number; code: string }[] = [];
  const deps: VoiceDeps = {
    log: (entry) => { logs.push(entry); },
    fetch: async (url, init) => {
      assert.ok(init);
      sent.push({ url: String(url), init });
      const response = responses.shift();
      assert.ok(response, "Unexpected provider call");
      return typeof response === "function" ? response(init) : response;
    },
  };
  return { deps, sent, logs };
}

test("a recording comes back as words", async () => {
  const h = harness();
  const result = await handleVoiceRequest(request(clip()), 7, h.deps);
  assert.deepEqual(result, { status: 200, body: { transcript: "how hot are my rear tyres?" } });
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].url, "https://api.openai.com/v1/audio/transcriptions");
  assert.equal(h.sent[0].init.headers.Authorization, "Bearer draft-test-key");
  assert.equal(h.sent[0].init.redirect, "error");
  const form = h.sent[0].init.body as FormData;
  assert.ok(form instanceof FormData, "the clip must go up as multipart");
  assert.equal(form.get("model"), "gpt-4o-mini-transcribe");
  assert.equal(form.get("language"), "en");
  const file = form.get("file") as Blob;
  assert.equal(file.size, 44 + 16000 * 2 * 2);
  assert.equal(h.logs.length, 0);
});

test("the model name is a server setting", async () => {
  process.env.GRIDLABS_ASR_MODEL = "whisper-1";
  const h = harness();
  await handleVoiceRequest(request(clip()), 7, h.deps);
  assert.equal((h.sent[0].init.body as FormData).get("model"), "whisper-1");
});

test("words are trimmed and cut to the question limit", async () => {
  const h = harness([spoken(`  ${"u".repeat(900)}\u0007  `)]);
  const result = await handleVoiceRequest(request(clip()), 7, h.deps);
  assert.deepEqual(result, { status: 200, body: { transcript: "u".repeat(TRANSCRIPT_MAX_CHARS) } });
});

test("silence is refused without an answer", async () => {
  for (const text of ["", "   ", "\n\t "]) {
    const h = harness([spoken(text)]);
    assert.deepEqual(await handleVoiceRequest(request(clip()), 7, h.deps),
      { status: 400, body: { code: "no_speech", error: "No words in that recording." } });
    assert.equal(h.logs.length, 0);
  }
});

test("no provider key leaves the route inert", async () => {
  delete process.env.OPENAI_API_KEY;
  const h = harness();
  const result = await handleVoiceRequest(request(clip()), 7, h.deps);
  assert.equal(result.status, 503);
  assert.deepEqual(h.logs, [{ reason: "no_key", status: 0, code: "" }]);
  assert.equal(h.sent.length, 0);
});

test("a provider fault is reported without the audio or the words", async () => {
  const h = harness([new Response('{"error":{"message":"PRIVATE","code":"rate_limit_exceeded"}}', { status: 429 })]);
  const result = await handleVoiceRequest(request(clip()), 7, h.deps);
  assert.equal(result.status, 502);
  assert.deepEqual(h.logs, [{ reason: "provider", status: 429, code: "rate_limit_exceeded" }]);
  const line = JSON.stringify([result, h.logs]);
  assert.ok(!line.includes("draft-test-key") && !line.includes(b64(wav(2)).slice(0, 24)));
});

test("a hung provider is cut off at the voice deadline", async () => {
  let abort: () => void = () => undefined;
  let stopped = false;
  const h = harness([() => { queueMicrotask(() => abort()); return new Promise<Response>(() => undefined); }]);
  h.deps.scheduleDeadline = (action, ms) => { abort = action; assert.equal(ms, ASR_TIMEOUT_MS); return () => { stopped++; }; };
  const result = await handleVoiceRequest(request(clip()), 7, h.deps);
  assert.equal(result.status, 504);
  assert.equal(h.sent[0].init.signal?.aborted, true);
  assert.equal(stopped, 1);
  assert.deepEqual(h.logs, [{ reason: "timeout", status: 0, code: "" }]);
});

test("anything that isn't a usable clip is refused before the provider", async () => {
  const h = harness();
  const cases: [string, string][] = [
    [JSON.stringify({ audio: b64(wav(0.2)) }), "clip shorter than half a second"],
    [JSON.stringify({ audio: b64(wav(11)) }), "clip longer than the limit"],
    [JSON.stringify({ audio: b64(new Uint8Array(wav(2).length).fill(65)) }), "not a WAV file"],
    [JSON.stringify({ audio: "not base64 at all!!" }), "not base64"],
    [JSON.stringify({ audio: 42 }), "audio isn't a string"],
    [JSON.stringify({ audio: b64(wav(2)), question: "sneaky" }), "extra fields"],
    ["{}", "no audio"],
    ["not json", "body isn't JSON"],
  ];
  for (const [body, why] of cases) {
    assert.equal((await handleVoiceRequest(request(body), 7, h.deps)).status, 400, why);
  }
  assert.equal(h.sent.length, 0);
  assert.deepEqual(await handleVoiceRequest(request(clip()), undefined, h.deps),
    { status: 401, body: { code: "unauthorized", error: "Authentication required." } });
  assert.equal(h.sent.length, 0);
});

test("an oversized upload is stopped while reading it", async () => {
  const h = harness();
  const big = JSON.stringify({ audio: "A".repeat(VOICE_MAX_BYTES + 1024) });
  assert.deepEqual(await handleVoiceRequest(request(big), 7, h.deps),
    { status: 413, body: { code: "body_too_large", error: "That recording is too long." } });
  assert.equal(h.sent.length, 0);
});

test("the clip check accepts the app's own recording and nothing else", () => {
  assert.equal(validateClip(b64(wav(10))).length, 16000 * 10 * 2 + 44);
  assert.equal(validateClip(b64(wav(1))).length, CLIP_MIN_BYTES * 2 + 44);
  for (const value of [undefined, null, 7, "", "A".repeat(43), b64(wav(0.1)), b64(wav(10.1))]) {
    assert.throws(() => validateClip(value));
  }
});

test("a provider reply that isn't words is rejected", async () => {
  for (const body of ['{"text":12}', "{}", "not json", '{"text":null}',
                      `{"text":"${"x".repeat(ASR_MAX_BYTES)}"}`]) {
    const h = harness([new Response(body, { status: 200 })]);
    assert.equal((await handleVoiceRequest(request(clip()), 7, h.deps)).status, 502);
  }
});
