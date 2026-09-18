const test = require('node:test');
const assert = require('node:assert/strict');
const { isPrivateAddress, validatePublicUrl } = require('../electron/urlResolver.cjs');

test('identifica rangos IPv4 e IPv6 privados', () => {
  assert.equal(isPrivateAddress('127.0.0.1'), true);
  assert.equal(isPrivateAddress('192.168.1.4'), true);
  assert.equal(isPrivateAddress('::1'), true);
  assert.equal(isPrivateAddress('8.8.8.8'), false);
});

test('rechaza protocolos y hosts locales', async () => {
  await assert.rejects(validatePublicUrl('file:///etc/passwd'), /HTTP o HTTPS/);
  await assert.rejects(validatePublicUrl('http://localhost/test'), /direcciones locales/);
});
