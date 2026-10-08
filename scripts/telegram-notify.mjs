#!/usr/bin/env node
// Best-effort Telegram notifier for an autopilot run (T160).
//
// -----------------------------------------------------------------------
// WHAT THIS IS FOR
// -----------------------------------------------------------------------
// An unattended autopilot run is hours long and the terminal is not being
// watched. Two moments actually need a human now: a lane closing (a branch
// is ready to merge) and a gate the orchestrator escalates rather than
// decides. This script sends one Telegram message for either event, called
// by `taskrail autopilot notify` at exactly those two points (`[autopilot].notify`
// in .taskrail/config.toml: the message arrives on stdin), and by hand when a
// branch is handed back interactively (CLAUDE.md, "Handing a finished branch
// back"). It is an explicit call rather than a harness hook because a hook
// fires at every subagent turn-end, not at these two business events.
//
// -----------------------------------------------------------------------
// THE CREDENTIAL RULE, IN ONE SENTENCE
// -----------------------------------------------------------------------
// TELEGRAM_BOT_TOKEN is read from process.env ONLY — never from a CLI flag,
// never from an argument, never echoed anywhere this script controls. A
// command-line argument would sit in this process's argv, which `ps` can
// read for the lifetime of the process; an environment variable does not.
//
// -----------------------------------------------------------------------
// FORUM TOPICS
// -----------------------------------------------------------------------
// There is NO `chat_id` format that names a topic. In a forum group `chat_id`
// identifies the GROUP; the topic is a separate `message_thread_id` parameter,
// supplied here as TELEGRAM_TOPIC_ID. This matters because omitting it is not
// an error: Telegram accepts the message and posts it to the group's General
// topic. The send reports success, the human watches the wrong topic, and the
// notification looks lost. TELEGRAM_TOPIC_ID exists to make that destination
// explicit rather than defaulted.
//
// Find it by opening the topic in Telegram and copying a message link: the id
// is the middle segment of `https://t.me/c/<group>/<topic>/<message>`. It is
// not a credential — unlike the token it names a destination, not an
// authorisation — but `--status` still reports presence only, for consistency.
//
// -----------------------------------------------------------------------
// ABSENT CONFIGURATION IS A SILENT NO-OP
// -----------------------------------------------------------------------
// With TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID unset (or empty), or with no
// message to send, this script does nothing: no stdout, no stderr, exit 0.
// A notifier that can fail, delay or abort a lane is worse than no notifier.
// Every other outcome — a successful send, a non-2xx response, a network
// error — is also swallowed to exit 0: Telegram being unreachable must never
// break an autopilot run. Delivery here is best-effort, not guaranteed.
//
// -----------------------------------------------------------------------
// "UNCONFIGURED" VS "MISCONFIGURED"
// -----------------------------------------------------------------------
// The silent no-op above has a sharp edge: a wrong variable name, a chat id
// the bot cannot post to, or a config mechanism that silently does not
// propagate all look EXACTLY like "nobody set this up" — the same silence,
// the same exit 0. `--status` exists so a human can tell those apart without
// ever triggering a send: it reports presence only ("set" / "not set"),
// never a value, a prefix, a suffix, a length, or a masked form — a masked
// token is still a token leaked at low resolution, and a length identifies a
// format.
//
// -----------------------------------------------------------------------
// fetch, NEVER curl
// -----------------------------------------------------------------------
// The token-bearing URL is built and used entirely inside this Node process
// via the built-in `fetch`. Shelling out to `curl`/`wget` with that URL as a
// command-line argument would place the token in a CHILD process's argv,
// which is exactly the exposure this script exists to avoid.
//
// -----------------------------------------------------------------------
// NEVER PRINT THE RAW ERROR
// -----------------------------------------------------------------------
// A network error's `.message` (and Node's `fetch`/undici error objects in
// general) can embed the request URL — and the request URL embeds the
// token. So a failed send is reduced to a single fixed, generic string
// before it is ever reported anywhere; the actual Error object is never
// logged, thrown uncaught, or otherwise allowed to reach stdout/stderr.
//
// -----------------------------------------------------------------------
// USAGE
// -----------------------------------------------------------------------
//   node scripts/telegram-notify.mjs "<message text>"
//   echo "<message text>" | node scripts/telegram-notify.mjs
//   node scripts/telegram-notify.mjs --status      # presence-only, no network call
//   node scripts/telegram-notify.mjs --self-test    # decision-table + no-leak proof
//
// Configuration: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID (both required to send),
// TELEGRAM_TOPIC_ID (optional; required only to reach a TOPIC inside a forum
// group — see "FORUM TOPICS" below).
// TELEGRAM_API_BASE_URL is an internal override (default https://api.telegram.org),
// used only by --self-test to point at a local stub — not an operator-facing
// setting.

import http from 'node:http';
import { spawn } from 'node:child_process';

const DEFAULT_API_BASE = 'https://api.telegram.org';
const FLAGS = new Set(['--status', '--check', '--self-test']);

function readConfig() {
  return {
    token: process.env.TELEGRAM_BOT_TOKEN || '',
    chatId: process.env.TELEGRAM_CHAT_ID || '',
    topicId: process.env.TELEGRAM_TOPIC_ID || '',
    apiBase: process.env.TELEGRAM_API_BASE_URL || DEFAULT_API_BASE,
  };
}

function isConfigured({ token, chatId }) {
  return Boolean(token) && Boolean(chatId);
}

async function readStdin() {
  if (process.stdin.isTTY) return '';
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8').trim();
}

async function resolveMessage() {
  const argvMessage = process.argv
    .slice(2)
    .filter((a) => !FLAGS.has(a))
    .join(' ')
    .trim();
  if (argvMessage) return argvMessage;
  return readStdin();
}

// Presence only. Never a value, a prefix, a suffix, a length, or a masked
// form of either variable — that is the whole point of --status existing.
function printStatus({ token, chatId, topicId }) {
  process.stdout.write(`TELEGRAM_BOT_TOKEN: ${token ? 'set' : 'not set'}\n`);
  process.stdout.write(`TELEGRAM_CHAT_ID: ${chatId ? 'set' : 'not set'}\n`);
  process.stdout.write(`TELEGRAM_TOPIC_ID: ${topicId ? 'set' : 'not set (optional)'}\n`);
}

// Isolated so --self-test can inject a fetchImpl and never touch the real
// network or the real Telegram endpoint. Always resolves; never throws.
async function sendTelegramMessage({ token, chatId, topicId, apiBase, message, fetchImpl = fetch }) {
  if (!isConfigured({ token, chatId }) || !message) {
    return { sent: false, reason: 'not-configured' };
  }
  const url = `${apiBase}/bot${token}/sendMessage`;
  // A forum topic is NOT addressable through `chat_id` — there is no id format that names one.
  // `chat_id` is the group, and the topic is a separate `message_thread_id` parameter. Omitting it
  // in a forum group is not an error: the message lands in the group's General topic instead, which
  // is exactly the silent wrong-destination failure TELEGRAM_TOPIC_ID exists to avoid.
  const payload = { chat_id: chatId, text: message };
  if (topicId) payload.message_thread_id = Number(topicId);
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      return { sent: false, reason: `http-${res.status}` };
    }
    return { sent: true };
  } catch {
    // Deliberately not the caught error: see "NEVER PRINT THE RAW ERROR" above.
    return { sent: false, reason: 'network-error' };
  }
}

async function main() {
  const config = readConfig();

  if (process.argv.includes('--status') || process.argv.includes('--check')) {
    printStatus(config);
    process.exitCode = 0;
    return;
  }

  const message = await resolveMessage();

  // Absent configuration, or nothing to send: silent no-op.
  if (!isConfigured(config) || !message) {
    process.exitCode = 0;
    return;
  }

  await sendTelegramMessage({ ...config, message });
  // Best-effort delivery: whatever happened above, never fail the caller.
  process.exitCode = 0;
}

// ===========================================================================
// SELF-TEST
// ===========================================================================
// No real token, no egress to api.telegram.org. Runs the script itself as a
// child process for the no-op and send cases, so the checks below exercise
// the real CLI entry point (env in, stdout/stderr out) rather than only the
// internal functions.

function startStubServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function closedPortBaseUrl() {
  // Open a server to claim a free port, read it, then close it immediately —
  // guarantees nothing is listening there without hardcoding a port number.
  const server = await startStubServer((_req, res) => res.end());
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return `http://127.0.0.1:${port}`;
}

const SCRIPT_PATH = import.meta.url.replace('file://', '');
const TELEGRAM_ENV_KEYS = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'TELEGRAM_API_BASE_URL'];

// Every child always starts with a clean slate for the three vars this script
// reads — never inherited from this process's own environment — then applies
// exactly the overrides a check asks for. `value: undefined` means "leave
// this one unset", not "set it to the string 'undefined'".
function childEnv(overrides = {}) {
  const env = { ...process.env };
  for (const key of TELEGRAM_ENV_KEYS) delete env[key];
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

function runScriptWithArgs(args, overrides) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT_PATH, ...args], { env: childEnv(overrides) });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

function runScript(overrides) {
  return runScriptWithArgs(['self-test message'], overrides);
}

async function selfTest() {
  const checks = [];
  const expect = (name, ok, detail) => checks.push({ name, ok, detail });

  // --- Pure decision table: what counts as "configured" --------------------
  expect('neither var set is not configured', !isConfigured({ token: '', chatId: '' }));
  expect('token only is not configured', !isConfigured({ token: 't', chatId: '' }));
  expect('chat id only is not configured', !isConfigured({ token: '', chatId: 'c' }));
  expect('both set is configured', isConfigured({ token: 't', chatId: 'c' }));

  // --- Absent-configuration no-op, exercised through the real CLI ----------
  const noVars = await runScript({});
  expect('no env vars: empty stdout', noVars.stdout === '', `got ${JSON.stringify(noVars.stdout)}`);
  expect('no env vars: empty stderr', noVars.stderr === '', `got ${JSON.stringify(noVars.stderr)}`);
  expect('no env vars: exit 0', noVars.code === 0, `got ${noVars.code}`);

  const tokenOnly = await runScript({ TELEGRAM_BOT_TOKEN: 'FAKE:only-token' });
  expect('token only: empty stdout', tokenOnly.stdout === '');
  expect('token only: empty stderr', tokenOnly.stderr === '');
  expect('token only: exit 0', tokenOnly.code === 0);

  const chatOnly = await runScript({ TELEGRAM_CHAT_ID: '12345' });
  expect('chat id only: empty stdout', chatOnly.stdout === '');
  expect('chat id only: empty stderr', chatOnly.stderr === '');
  expect('chat id only: exit 0', chatOnly.code === 0);

  // --- The send path: proves the token reaches the request, and nothing ---
  // --- printed by the script ever contains it -------------------------------
  const FAKE_TOKEN = `FAKE-SELFTEST-TOKEN-DO-NOT-LEAK-${process.pid}`;
  const FAKE_CHAT_ID = '999999';

  let receivedUrl = '';
  let receivedBody = '';
  const stub = await startStubServer((req, res) => {
    receivedUrl = req.url;
    const chunks = [];
    req.on('data', (d) => chunks.push(d));
    req.on('end', () => {
      receivedBody = Buffer.concat(chunks).toString('utf8');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
  });
  const { port: stubPort } = stub.address();

  const sendRun = await runScript({
    TELEGRAM_BOT_TOKEN: FAKE_TOKEN,
    TELEGRAM_CHAT_ID: FAKE_CHAT_ID,
    TELEGRAM_API_BASE_URL: `http://127.0.0.1:${stubPort}`,
  });
  // Captured before the second request overwrites the stub's single slot.
  const bodyWithoutTopic = receivedBody;

  // A forum topic is addressed by `message_thread_id`, never by a `chat_id` format.
  const topicRun = await runScript({
    TELEGRAM_BOT_TOKEN: FAKE_TOKEN,
    TELEGRAM_CHAT_ID: FAKE_CHAT_ID,
    TELEGRAM_TOPIC_ID: '42',
    TELEGRAM_API_BASE_URL: `http://127.0.0.1:${stubPort}`,
  });
  const bodyWithTopic = receivedBody;
  await new Promise((resolve) => stub.close(resolve));

  expect('configured send: exit 0', sendRun.code === 0, `got ${sendRun.code}`);
  expect(
    'configured send: token never in stdout',
    !sendRun.stdout.includes(FAKE_TOKEN),
    `stdout was ${JSON.stringify(sendRun.stdout)}`,
  );
  expect(
    'configured send: token never in stderr',
    !sendRun.stderr.includes(FAKE_TOKEN),
    `stderr was ${JSON.stringify(sendRun.stderr)}`,
  );
  expect('configured send: stub received the token', receivedUrl.includes(FAKE_TOKEN), `stub saw url ${receivedUrl}`);
  expect(
    'configured send: stub received the message',
    receivedBody.includes('self-test message'),
    `stub saw body ${receivedBody}`,
  );

  // --- Forum topics ---------------------------------------------------------
  // Absent TELEGRAM_TOPIC_ID the payload must OMIT the key entirely: sending
  // `message_thread_id: null`/`0` to a non-forum chat is an API error, so "omit"
  // and "send empty" are not interchangeable.
  expect(
    'no topic configured: payload omits message_thread_id',
    !Object.hasOwn(JSON.parse(bodyWithoutTopic || '{}'), 'message_thread_id'),
    `stub saw body ${bodyWithoutTopic}`,
  );
  expect(
    'topic configured: payload carries message_thread_id',
    JSON.parse(bodyWithTopic || '{}').message_thread_id === 42,
    `stub saw body ${bodyWithTopic}`,
  );
  expect(
    'topic configured: sent as a number, not a string',
    typeof JSON.parse(bodyWithTopic || '{}').message_thread_id === 'number',
    `stub saw ${typeof JSON.parse(bodyWithTopic || '{}').message_thread_id}`,
  );
  expect(
    'topic configured: token still never in stdout',
    !topicRun.stdout.includes(FAKE_TOKEN),
    `stdout was ${JSON.stringify(topicRun.stdout)}`,
  );

  // --- The network-error path: token still never leaks ---------------------
  const deadBase = await closedPortBaseUrl();
  const failRun = await runScript({
    TELEGRAM_BOT_TOKEN: FAKE_TOKEN,
    TELEGRAM_CHAT_ID: FAKE_CHAT_ID,
    TELEGRAM_API_BASE_URL: deadBase,
  });
  expect('network error: exit 0', failRun.code === 0, `got ${failRun.code}`);
  expect(
    'network error: token never in stdout',
    !failRun.stdout.includes(FAKE_TOKEN),
    `stdout was ${JSON.stringify(failRun.stdout)}`,
  );
  expect(
    'network error: token never in stderr',
    !failRun.stderr.includes(FAKE_TOKEN),
    `stderr was ${JSON.stringify(failRun.stderr)}`,
  );
  expect(
    'network error: dead base url never in stdout/stderr either',
    !failRun.stdout.includes(deadBase) && !failRun.stderr.includes(deadBase),
    `stdout ${JSON.stringify(failRun.stdout)} stderr ${JSON.stringify(failRun.stderr)}`,
  );

  // --- --status: presence only, never a value, never a network call --------
  const statusResult = await runScriptWithArgs(['--status'], {
    TELEGRAM_BOT_TOKEN: FAKE_TOKEN,
    TELEGRAM_CHAT_ID: undefined,
  });
  expect('status: exit 0', statusResult.code === 0, `got ${statusResult.code}`);
  expect('status: reports token set', statusResult.stdout.includes('TELEGRAM_BOT_TOKEN: set'));
  expect('status: reports chat id not set', statusResult.stdout.includes('TELEGRAM_CHAT_ID: not set'));
  expect(
    'status: never prints the actual token value',
    !statusResult.stdout.includes(FAKE_TOKEN),
    `stdout was ${JSON.stringify(statusResult.stdout)}`,
  );

  const failed = checks.filter((c) => !c.ok);
  for (const check of checks) {
    process.stdout.write(`${check.ok ? 'ok  ' : 'FAIL'}  ${check.name}${check.ok ? '' : `  (${check.detail})`}\n`);
  }
  process.stdout.write(`\n${checks.length - failed.length}/${checks.length} checks passed\n`);
  if (failed.length > 0) process.exitCode = 1;
}

if (process.argv.includes('--self-test')) {
  await selfTest();
} else {
  await main();
}
