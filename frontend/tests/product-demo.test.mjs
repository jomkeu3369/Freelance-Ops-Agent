import assert from 'node:assert/strict';
import test from 'node:test';
import { demoQuote, demoReducer, initialDemoState, demoProjectSnapshot } from '../features/home/product-demo.mjs';

test('one inquiry retains its identity and moves to negotiation only after the proposal is ready', () => {
  let state = initialDemoState();
  assert.equal(demoProjectSnapshot(state).ready, false);
  for (let tick = 0; tick < 10; tick++) {
    const card = demoProjectSnapshot(state);
    assert.equal(card.id, 'FO-024');
    assert.equal(card.column, tick === 9 ? 1 : 0);
    if (tick > 0) assert.equal(card.ready, true);
    state = demoReducer(state, { type: 'tick' });
  }
  state = demoReducer(state, { type: 'replay' });
  assert.equal(demoProjectSnapshot(state).ready, false);
  assert.equal(demoProjectSnapshot(state).column, 0);
});
test('manual and reduced-motion snapshots are complete previews; ordinary pause does not advance the card', () => {
  const initial = initialDemoState();
  assert.equal(demoProjectSnapshot(initial, true).ready, true);
  let state = demoReducer(initial, { type: 'pause' });
  assert.equal(demoProjectSnapshot(state).ready, false);
  state = demoReducer(state, { type: 'select', step: 4 });
  assert.equal(demoProjectSnapshot(state).column, 1);
  state = demoReducer(state, { type: 'pause' });
  assert.equal(state.selected, state.step);
  assert.equal(demoProjectSnapshot(state).column, 0);
});

test('a demo run alternates running and complete, records each stage once, and stops', () => {
  let state = initialDemoState();
  for (let step = 0; step < 5; step++) {
    assert.equal(state.step, step);
    assert.equal(state.selected, step);
    assert.equal(state.phase, 'running');
    state = demoReducer(state, { type: 'tick' });
    assert.equal(state.phase, 'complete');
    assert.deepEqual(state.history, Array.from({ length: step + 1 }, (_, i) => i));
    if (step < 4) state = demoReducer(state, { type: 'tick' });
  }
  for (let i = 0; i < 100; i++) assert.equal(demoReducer(state, { type: 'tick' }), state);
});
test('manual preview pauses without inventing execution history; resuming retains its cursor', () => {
  let state = demoReducer(initialDemoState(), { type: 'tick' });
  state = demoReducer(state, { type: 'select', step: 4 });
  assert.equal(state.selected, 4);
  assert.equal(state.step, 0);
  assert.deepEqual(state.history, [0]);
  assert.equal(demoReducer(state, { type: 'tick' }), state);
  state = demoReducer(state, { type: 'pause' });
  state = demoReducer(state, { type: 'tick' });
  assert.equal(state.selected, 1);
  assert.deepEqual(state.history, [0]);
  for (const step of [-1, 5, 1.2, NaN, '2']) assert.equal(demoReducer(state, { type: 'select', step }), state);
});
test('scope changes have matching line items, effort, and amount and survive replay', () => {
  for (const scope of ['essential', 'extended']) {
    const quote = demoQuote(scope);
    assert.equal(quote.rows.reduce((sum, row) => sum + row.days, 0), quote.days);
    assert.equal(quote.rows.reduce((sum, row) => sum + row.days * quote.dailyRate, 0), quote.total);
  }
  let state = demoReducer(initialDemoState(), { type: 'scope', scope: 'extended' });
  assert.equal(demoQuote(state.scope).total, 3900000);
  assert.equal(demoReducer(state, { type: 'scope', scope: 'unknown' }), state);
  state = demoReducer(state, { type: 'replay' });
  assert.equal(state.scope, 'extended');
  assert.deepEqual(state.history, []);
  assert.equal(state.paused, false);
  assert.equal(state.run, 2);
});
