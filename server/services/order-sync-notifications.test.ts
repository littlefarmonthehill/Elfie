import assert from 'node:assert/strict';
import test from 'node:test';
import { getVerifiedNewOrderIds } from './channel-order-sync-interface';

test('an update-only sync has no candidates for a new-order notification', () => {
  // ordersAdded is an operational counter. A BrickOwl merge delta or other
  // bookkeeping can legitimately increase it even when no customer order was
  // created during this run.
  const updateOnlyBrickOwlSync = {
    ordersAdded: 27,
    ordersUpdated: 27,
    newOrderIds: [],
  };

  assert.deepEqual(getVerifiedNewOrderIds(updateOnlyBrickOwlSync), []);
});

test('notification candidates are limited to explicitly verified order IDs', () => {
  const syncResult = {
    ordersAdded: 3,
    newOrderIds: ['bo-1001', 'bo-1001', 'bo-1002'],
  };

  assert.deepEqual(getVerifiedNewOrderIds(syncResult), ['bo-1001', 'bo-1002']);
});