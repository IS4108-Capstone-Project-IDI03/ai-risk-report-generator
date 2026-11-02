import type { AddressInfo, Server } from 'net'
import request from 'supertest'

// Sends supertest's requests to the IPv6 loopback when the test server listens
// on IPv6. supertest's listen(0) binds IPv6 "::" but always sends to 127.0.0.1,
// and on macOS that port can already be held by another app on IPv4 (an editor,
// Spotify): without this, random tests reach that app and fail with "socket
// hang up" or its 401/404. Loaded for every test file by vitest.config.mts.
const serverAddress = request.Test.prototype.serverAddress
request.Test.prototype.serverAddress = function (app, path) {
  const url = serverAddress.call(this, app, path)
  const { family } = (app as Server).address() as AddressInfo
  return family === 'IPv6' ? url.replace('://127.0.0.1:', '://[::1]:') : url
}
