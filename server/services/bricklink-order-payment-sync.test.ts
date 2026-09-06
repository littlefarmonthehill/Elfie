import assert from 'node:assert/strict';
import test from 'node:test';
import { hasBrickLinkPaymentAfterLastSync } from './bricklink-order-sync';

test('detects payment received after the last sync regardless of local workflow', () => {
  assert.equal(
    hasBrickLinkPaymentAfterLastSync(
      { status: 'Received', date_paid: '2026-09-06T20:00:00.000Z' },
      new Date('2026-05-17T17:57:46.580Z')
    ),
    true
  );
});

test('does not repeatedly process a payment already included in a later sync', () => {
  assert.equal(
    hasBrickLinkPaymentAfterLastSync(
      { status: 'Received', date_paid: '2026-09-06T20:00:00.000Z' },
      new Date('2026-09-06T21:14:15.004Z')
    ),
    false
  );
});

test('does not treat unpaid or returned payment states as a new payment', () => {
  assert.equal(
    hasBrickLinkPaymentAfterLastSync(
      { status: 'None', date_paid: null },
      new Date('2026-05-17T17:57:46.580Z')
    ),
    false
  );
  assert.equal(
    hasBrickLinkPaymentAfterLastSync(
      { status: 'Returned', date_paid: '2026-09-06T20:00:00.000Z' },
      new Date('2026-05-17T17:57:46.580Z')
    ),
    false
  );
});