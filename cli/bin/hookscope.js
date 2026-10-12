#!/usr/bin/env node
const { startListener } = require('../src/listen');

const [, , command, port, ...rest] = process.argv;
const endpointIndex = rest.indexOf('--endpoint'); const tokenIndex = rest.indexOf('--token');
if (command !== 'listen' || !port || endpointIndex < 0 || tokenIndex < 0 || !rest[endpointIndex + 1] || !rest[tokenIndex + 1]) {
  console.error('Usage: hookscope listen <port> --endpoint <endpointId> --token <token>'); process.exitCode = 1;
} else {
  try {
    startListener({ port, endpointId: rest[endpointIndex + 1], token: rest[tokenIndex + 1] });
  } catch (error) {
    console.error(`HookScope: ${error.message}`); process.exitCode = 1;
  }
}
