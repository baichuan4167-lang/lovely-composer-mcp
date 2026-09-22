#!/usr/bin/env node
'use strict';
/**
 * Lovely Composer MCP server (stdio transport, zero dependencies).
 *
 * Speaks JSON-RPC 2.0 over newline-delimited JSON on stdin/stdout, which is what
 * the MCP stdio transport uses. Nothing except protocol messages is ever written
 * to stdout; diagnostics go to stderr.
 */

const readline = require('readline');

const { TOOLS, callTool, SERVER_NOTE } = require('./tools');

const SERVER_INFO = { name: 'lovely-composer', version: '1.0.0', title: 'Lovely Composer' };

/**
 * Protocol revisions we are happy to speak. The tool surface only uses
 * `tools/list` and `tools/call`, which exist unchanged in every revision, so a
 * legacy revision is the safest common ground: newer clients fall back to it.
 */
const LEGACY_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05', '2024-10-07'];
const DEFAULT_PROTOCOL_VERSION = process.env.LC_MCP_PROTOCOL_VERSION || '2025-06-18';

const INSTRUCTIONS =
  'Compose chiptune music in Lovely Composer. ' +
  'Start with lc_status, then lc_list_instruments, then lc_create_song / lc_write_page / lc_set_notes. ' +
  SERVER_NOTE;

function log(...args) {
  process.stderr.write(`[lovely-composer-mcp] ${args.join(' ')}\n`);
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function reply(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function replyError(id, code, message, data) {
  const error = { code, message };
  if (data !== undefined) error.data = data;
  send({ jsonrpc: '2.0', id, error });
}

function negotiateVersion(requested) {
  if (typeof requested === 'string' && LEGACY_VERSIONS.includes(requested)) return requested;
  return DEFAULT_PROTOCOL_VERSION;
}

function handleInitialize(id, params) {
  const requested = params && params.protocolVersion;
  const version = negotiateVersion(requested);
  log(`initialize: client=${requested || 'none'} -> negotiated=${version}`);
  reply(id, {
    protocolVersion: version,
    capabilities: { tools: { listChanged: false } },
    serverInfo: SERVER_INFO,
    instructions: INSTRUCTIONS,
  });
}

function handleToolsList(id, params) {
  const cursor = params && params.cursor;
  if (cursor) {
    reply(id, { tools: [] });
    return;
  }
  reply(id, {
    tools: TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  });
}

function handleToolsCall(id, params) {
  const name = params && params.name;
  const args = (params && params.arguments) || {};
  if (!name) {
    replyError(id, -32602, 'tools/call requires a tool name');
    return;
  }
  let result;
  try {
    result = callTool(name, args);
  } catch (error) {
    result = { content: [{ type: 'text', text: `Error: ${(error && error.message) || error}` }], isError: true };
  }
  reply(id, result);
}

function dispatch(message) {
  const { id, method, params } = message;
  const isNotification = id === undefined || id === null;

  switch (method) {
    case 'initialize':
      handleInitialize(id, params);
      return;
    case 'notifications/initialized':
    case 'initialized':
      log('client initialized');
      return;
    case 'ping':
      if (!isNotification) reply(id, {});
      return;
    case 'tools/list':
      handleToolsList(id, params);
      return;
    case 'tools/call':
      handleToolsCall(id, params);
      return;
    case 'resources/list':
      if (!isNotification) reply(id, { resources: [] });
      return;
    case 'resources/templates/list':
      if (!isNotification) reply(id, { resourceTemplates: [] });
      return;
    case 'prompts/list':
      if (!isNotification) reply(id, { prompts: [] });
      return;
    case 'logging/setLevel':
      if (!isNotification) reply(id, {});
      return;
    case 'notifications/cancelled':
    case 'notifications/progress':
    case 'notifications/roots/list_changed':
      return;
    default:
      if (!isNotification) replyError(id, -32601, `Method not found: ${method}`);
  }
}

function main() {
  log(`started pid=${process.pid} node=${process.version}`);

  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    // Tolerate LSP-style Content-Length framing headers just in case.
    if (/^content-length:/i.test(trimmed)) return;

    let message;
    try {
      message = JSON.parse(trimmed);
    } catch (error) {
      log(`dropped unparsable line: ${trimmed.slice(0, 200)}`);
      return;
    }

    try {
      dispatch(message);
    } catch (error) {
      log(`dispatch failed for ${message && message.method}: ${(error && error.stack) || error}`);
      if (message && message.id !== undefined && message.id !== null) {
        replyError(message.id, -32603, `Internal error: ${(error && error.message) || error}`);
      }
    }
  });

  rl.on('close', () => {
    log('stdin closed, exiting');
    process.exit(0);
  });

  process.on('uncaughtException', (error) => {
    log(`uncaught: ${(error && error.stack) || error}`);
  });
  process.on('unhandledRejection', (error) => {
    log(`unhandled rejection: ${(error && error.stack) || error}`);
  });
}

main();
