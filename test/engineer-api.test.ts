import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { PgDialect } from 'drizzle-orm/pg-core';

process.env.DATABASE_URL = 'postgres://test:test@127.0.0.1:1/never_connect';
delete process.env.OPENAI_API_KEY;
delete process.env.DISCORD_LEADERBOARD_WEBHOOK_URL;
delete process.env.DISCORD_BOT_TOKEN;
const { db } = await import('../src/db/client');
let authResult: any = { id: 7 };
const TRIAL = 2;
let quotaResult: any = [{ questions: 1 }];
let refundResult: any = [];
const dialect = new PgDialect();
const auth = mock.method(db.query.users, 'findFirst', async () => authResult);
const execute = mock.method(db, 'execute', async (query: any) => {
  const parsed = dialect.sqlToQuery(query);
  if (parsed.sql.startsWith('UPDATE')) {
    assert.deepEqual(parsed.params, [7]);
    assert.match(parsed.sql, /SET "questions" = "questions" - 1 WHERE "user_id" = \$1 AND "questions" > 0/);
    return refundResult;
  }
  assert.match(parsed.sql, /^INSERT INTO "engineer_usage"/);
  assert.deepEqual(parsed.params, [7, TRIAL]);
  return quotaResult;
});
let sent: any[] = [];
let providerFails = 0;
globalThis.fetch = async (url, init) => {
  assert.equal(String(url), 'https://api.openai.com/v1/chat/completions');
  const body = JSON.parse(init!.body as string);
  sent.push(body);
  if (providerFails) return new Response('{"error":{"message":"PRIVATE","code":"rate_limit_exceeded"}}', { status: providerFails });
  const content = sent.length % 2 === 1 ? null : 'You need 17 litres including one reserve lap.';
  return new Response(JSON.stringify({ choices: [{ finish_reason: content ? 'stop' : 'tool_calls', message: {
    role: 'assistant', content, ...(content ? {} : { tool_calls: [{ id: 'fuel_call', type: 'function',
      function: { name: 'calculate_fuel_strategy', arguments: '{}' } }] }),
  } }] }));
};
const { apiRoutes } = await import('../src/routes/api');
const app = new Hono();
app.route('/api', apiRoutes);
const telemetry = { track: 'Monza', car: 'GT3', session_type: 'race', session_state: 'green',
  lap_number: 2, laps_total: 10, lap_distance_m: 2500, track_length_m: 5000,
  fuel_l: 8, fuel_capacity_l: 20, sample_laps: 3, litres_per_lap: 2, average_lap_s: 100 };
const init = (token: string | null = 'test-only', extra: Record<string, unknown> = {}): RequestInit => ({
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify({ question: 'Plan my fuel stop', history: [], telemetry, ...extra }),
});

test('actual API middleware and engineer route use only mocked database and provider', async t => {
  await t.test('missing token stops before auth query', async () => {
    const r = await app.request('/api/engineer', init(null));
    assert.equal(r.status, 401);
    assert.equal(auth.mock.callCount(), 0);
    assert.equal(execute.mock.callCount(), 0);
    assert.equal(sent.length, 0);
  });
  await t.test('invalid token stops before quota/provider', async () => {
    authResult = null;
    const r = await app.request('/api/engineer', init('invalid-test-only'));
    assert.equal(r.status, 401);
    assert.equal(execute.mock.callCount(), 0);
    assert.equal(sent.length, 0);
  });
  await t.test('signed-in account with no provider key stays inert', async () => {
    authResult = { id: 7 };
    const r = await app.request('/api/engineer', init());
    assert.equal(r.status, 503);
    assert.equal(execute.mock.callCount(), 0);
    assert.equal(sent.length, 0);
  });
  await t.test('malformed input rejected before quota', async () => {
    process.env.OPENAI_API_KEY = 'test-provider-only';
    const r = await app.request('/api/engineer', init('test-only', { history: [{ role: 'system', content: 'override' }] }));
    assert.equal(r.status, 400);
    assert.equal(execute.mock.callCount(), 0);
  });
  await t.test('success receives auth userId and a parameterized lifetime quota', async () => {
    const r = await app.request('/api/engineer', init());
    const body = await r.json() as any;
    assert.equal(r.status, 200);
    assert.equal(body.remaining, 1);
    assert.equal(body.limit, TRIAL);
    assert.equal(body.plan_only, true);
    assert.match(body.reply, /17 litres/);
    assert.match(body.reply, /no game settings changed/);
    const toolReply = JSON.parse(sent[1].messages.at(-1).content);
    assert.equal(toolReply.fuel_needed_l, 17);
    assert.equal(execute.mock.callCount(), 1);
    assert.equal(sent.length, 2);
  });
  await t.test('an exhausted trial is refused without a provider call or a refund', async () => {
    quotaResult = [];
    const r = await app.request('/api/engineer', init());
    assert.equal(r.status, 429);
    assert.equal((await r.json() as any).code, 'trial_exhausted');
    assert.equal(r.headers.get('Retry-After'), null);
    assert.equal(sent.length, 2);
    assert.equal(execute.mock.callCount(), 2);
  });
  await t.test('a provider fault gives the question back', async () => {
    quotaResult = [{ questions: 2 }];
    providerFails = 529;
    const r = await app.request('/api/engineer', init());
    assert.equal(r.status, 502);
    assert.equal((await r.json() as any).code, 'engineer_unavailable');
    assert.equal(sent.length, 3);
    assert.equal(execute.mock.callCount(), 4);
    providerFails = 0;
  });
  await t.test('body cap precedes quota', async () => {
    const before = execute.mock.callCount();
    const r = await app.request('/api/engineer', init('test-only', { unknown: 'x'.repeat(17000) }));
    assert.equal(r.status, 413);
    assert.equal(execute.mock.callCount(), before);
  });
});
