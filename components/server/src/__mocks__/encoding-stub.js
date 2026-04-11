/**
 * CJS stub for @exodus/bytes (ESM) — used only in Jest test environment.
 * Proxies the real APIs via Node.js built-ins so that the jsdom dependency
 * chain (html-encoding-sniffer → @exodus/bytes) can be loaded without Babel.
 */
'use strict';

const { TextDecoder, TextEncoder } = require('util');

module.exports = {
  TextDecoder,
  TextEncoder,
  // Node 16+ has stream variants; provide no-op classes for older envs
  TextDecoderStream: typeof TextDecoderStream !== 'undefined' ? TextDecoderStream : class TextDecoderStream {},
  TextEncoderStream: typeof TextEncoderStream !== 'undefined' ? TextEncoderStream : class TextEncoderStream {},
  normalizeEncoding: (label) => (label ? label.toLowerCase().replace(/[^a-z0-9]/g, '') : 'utf8'),
  getBOMEncoding:    () => null,
  labelToName:       (label) => label || 'UTF-8',
  legacyHookDecode:  () => '',
};
