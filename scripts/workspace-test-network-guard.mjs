// Loaded only after CI dependencies and browsers are explicitly staged.
import net from 'node:net';
import { appendFileSync } from 'node:fs';
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...input) {
  const args = Array.isArray(input[0]) ? input[0] : input;
  const options = args[0];
  const host = typeof options === 'object' ? options.host ?? 'localhost' : typeof args[1] === 'string' ? args[1] : 'localhost';
  // Local IPC is permitted for test runners/browser drivers, remote hosts are not.
  if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
    if (process.env.ALFRED_TEST_NETWORK_DENIED) appendFileSync(process.env.ALFRED_TEST_NETWORK_DENIED, 'blocked non-loopback test socket\n');
    throw new Error('Workspace tests forbid external network');
  }
  return connect.apply(this, input);
};
