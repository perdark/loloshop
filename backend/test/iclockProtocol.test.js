'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseAttlog, zonedToUtc } = require('../lib/iclockProtocol');

test('zonedToUtc reads the device clock as Baghdad time', () => {
  // Asia/Baghdad is UTC+3 with no DST since 2016.
  assert.equal(zonedToUtc('2026-08-29 09:04:00', 'Asia/Baghdad').toISOString(),
    '2026-08-29T06:04:00.000Z');
});

test('zonedToUtc resolves correctly near midnight (two-pass offset check)', () => {
  // A naive one-pass version can miscompute the offset near a day boundary.
  assert.equal(zonedToUtc('2026-08-29 00:30:00', 'Asia/Baghdad').toISOString(),
    '2026-08-28T21:30:00.000Z');
});

test('parseAttlog reads a normal two-punch upload', () => {
  const body = '7\t2026-08-29 09:04:00\t0\t1\t0\t0\n7\t2026-08-29 21:10:00\t1\t1\t0\t0\n';
  const { punches, rejects } = parseAttlog(body);
  assert.equal(rejects.length, 0);
  assert.equal(punches.length, 2);
  assert.equal(punches[0].device_pin, '7');
  assert.equal(punches[0].device_ts, '2026-08-29 09:04:00');
  assert.equal(punches[0].raw_status, 0);
  assert.equal(punches[0].punched_at.toISOString(), '2026-08-29T06:04:00.000Z');
});

test('parseAttlog skips blank lines rather than rejecting them', () => {
  const { punches, rejects } = parseAttlog('\r\n7\t2026-08-29 09:04:00\t0\t1\r\n\r\n');
  assert.equal(punches.length, 1);
  assert.equal(rejects.length, 0);
});

test('parseAttlog quarantines a malformed line and keeps the good ones', () => {
  // One bad row must NOT fail the batch — the device would resend it forever.
  const body = '7\t2026-08-29 09:04:00\t0\nGARBAGE\n8\t2026-08-29 09:06:00\t0\n';
  const { punches, rejects } = parseAttlog(body);
  assert.equal(punches.length, 2);
  assert.equal(rejects.length, 1);
  assert.equal(rejects[0].raw_line, 'GARBAGE');
});

test('parseAttlog quarantines an impossible device clock', () => {
  // A K40 that lost its battery reports 1970 or 2099; such a row would wreck
  // every date-range report it lands in.
  const { punches, rejects } = parseAttlog('7\t1970-01-01 00:00:00\t0\n');
  assert.equal(punches.length, 0);
  assert.equal(rejects.length, 1);
  assert.match(rejects[0].reason, /خارج المدى/);
});

test('parseAttlog tolerates a missing status column', () => {
  const { punches } = parseAttlog('7\t2026-08-29 09:04:00\n');
  assert.equal(punches.length, 1);
  assert.equal(punches[0].raw_status, null);
});

test('parseAttlog fills in :00 seconds when the timestamp omits them (16-char branch)', () => {
  const { punches, rejects } = parseAttlog('7\t2026-08-29 09:04\t0\t1\n');
  assert.equal(rejects.length, 0);
  assert.equal(punches.length, 1);
  assert.equal(punches[0].device_ts, '2026-08-29 09:04:00');
  assert.equal(punches[0].punched_at.toISOString(), '2026-08-29T06:04:00.000Z');
});

test('parseAttlog tolerates trailing empty tab columns from real device padding', () => {
  const { punches, rejects } = parseAttlog('7\t2026-08-29 09:04:00\t0\t1\t\t\t\n');
  assert.equal(rejects.length, 0);
  assert.equal(punches.length, 1);
  assert.equal(punches[0].device_pin, '7');
  assert.equal(punches[0].device_ts, '2026-08-29 09:04:00');
  assert.equal(punches[0].raw_status, 0);
  assert.equal(punches[0].raw_verify, 1);
});
