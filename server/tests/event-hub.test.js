const { createEventHub } = require('../src/services/event-hub');

describe('SSE event hub isolation and cleanup', () => {
  test('delivers only to matching endpoint subscribers and cleans up disconnects', () => {
    const hub = createEventHub(); const first = []; const second = [];
    const unsubscribeFirst = hub.subscribe('endpoint-a', { send: (event) => first.push(event) });
    hub.subscribe('endpoint-b', { send: (event) => second.push(event) });
    hub.publish('endpoint-a', { sequence: 1 }); expect(first).toEqual([{ sequence: 1 }]); expect(second).toEqual([]);
    unsubscribeFirst(); hub.publish('endpoint-a', { sequence: 2 }); expect(first).toHaveLength(1);
  });
  test('supports ordered delivery after a reconnect cursor', () => {
    const hub = createEventHub(); const received = []; let cursor = 1;
    hub.subscribe('endpoint-a', { send: (event) => { if (event.sequence > cursor) { cursor = event.sequence; received.push(event.sequence); } } });
    [{ sequence: 2 }, { sequence: 2 }, { sequence: 3 }].forEach((event) => hub.publish('endpoint-a', event));
    expect(received).toEqual([2, 3]);
  });
});
