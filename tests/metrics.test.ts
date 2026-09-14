import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { Registry } from '@relay/metrics';
import { closeHarness, createActor, createWorkspace, request, resetDatabase } from './harness.ts';

/**
 * The Prometheus registry.
 *
 * Hand-written rather than `prom-client`, so the format details it would have
 * handled are tested here instead: label ordering, escaping, and cumulative
 * buckets. The cardinality guards get the most attention, because an
 * unbounded label is the failure that costs money rather than the one that
 * throws.
 */

const linesOf = (registry: Registry) =>
  registry
    .render()
    .split('\n')
    .filter((line) => line.length > 0);

describe('counters', () => {
  test('accumulate per label set', () => {
    const registry = new Registry();
    const requests = registry.counter('http_requests_total', 'Requests.', ['status']);

    requests.inc({ status: '200' });
    requests.inc({ status: '200' });
    requests.inc({ status: '500' });

    expect(requests.get({ status: '200' })).toBe(2);
    expect(requests.get({ status: '500' })).toBe(1);
  });

  test('an unobserved series is absent rather than zero', () => {
    const registry = new Registry();
    registry.counter('jobs_total', 'Jobs.', ['kind']);

    // Only the header. A zero here would assert a series that has never
    // happened, which reads as "this ran and produced nothing".
    expect(linesOf(registry)).toEqual(['# HELP jobs_total Jobs.', '# TYPE jobs_total counter']);
  });

  test('cannot decrease', () => {
    const registry = new Registry();
    const counter = registry.counter('errors_total', 'Errors.');

    expect(() => counter.inc({}, -1)).toThrow(/cannot decrease/);
  });
});

describe('label discipline', () => {
  /**
   * The guard that matters. Every distinct label set is a series held
   * forever, so a typo must not open a second one.
   */
  test('an undeclared label is refused', () => {
    const registry = new Registry();
    const counter = registry.counter('http_requests_total', 'Requests.', ['route']);

    expect(() => counter.inc({ rout: '/health' })).toThrow(/no label "rout"/);
  });

  test('a missing label is refused rather than defaulted to empty', () => {
    const registry = new Registry();
    const counter = registry.counter('http_requests_total', 'Requests.', ['route', 'status']);

    // Rendering this as route="/x",status="" would merge it with a genuinely
    // empty status instead of failing.
    expect(() => counter.inc({ route: '/x' })).toThrow(/missing label "status"/);
  });

  test('labels on a metric that declared none are refused', () => {
    const registry = new Registry();
    const counter = registry.counter('ticks_total', 'Ticks.');

    expect(() => counter.inc({ kind: 'a' })).toThrow(/takes no labels/);
  });

  /** Two call sites building the object differently must hit one series. */
  test('label order does not create a second series', () => {
    const registry = new Registry();
    const counter = registry.counter('http_requests_total', 'Requests.', ['method', 'route']);

    counter.inc({ method: 'GET', route: '/health' });
    counter.inc({ route: '/health', method: 'GET' });

    const series = linesOf(registry).filter((line) => !line.startsWith('#'));
    expect(series).toHaveLength(1);
    expect(series[0]).toBe('http_requests_total{method="GET",route="/health"} 2');
  });

  test('a duplicate metric name is refused', () => {
    const registry = new Registry();
    registry.counter('http_requests_total', 'Requests.');

    expect(() => registry.counter('http_requests_total', 'Again.')).toThrow(/already registered/);
  });

  test('names must match the Prometheus grammar', () => {
    const registry = new Registry();

    expect(() => registry.counter('http-requests', 'Dashes are not allowed.')).toThrow(/Invalid/);
    expect(() => registry.counter('9lives', 'Cannot start with a digit.')).toThrow(/Invalid/);
    expect(() => registry.counter('ok_name', 'Fine.', ['bad-label'])).toThrow(/Invalid/);
  });
});

describe('escaping', () => {
  /** A quote in a label value would otherwise end the value early. */
  test('quotes, backslashes and newlines in label values', () => {
    const registry = new Registry();
    const counter = registry.counter('probe_total', 'Probe.', ['value']);

    counter.inc({ value: 'a"b\\c\nd' });

    const series = linesOf(registry).find((line) => !line.startsWith('#'))!;
    expect(series).toBe('probe_total{value="a\\"b\\\\c\\nd"} 1');
  });

  /**
   * Backslash must be escaped before the characters whose escapes introduce
   * backslashes, or the new ones get escaped a second time.
   */
  test('a literal backslash-n is distinguishable from a newline', () => {
    const registry = new Registry();
    const counter = registry.counter('probe_total', 'Probe.', ['value']);

    counter.inc({ value: '\\n' });

    const series = linesOf(registry).find((line) => !line.startsWith('#'))!;
    expect(series).toBe('probe_total{value="\\\\n"} 1');
  });

  test('help text escapes backslashes and newlines but not quotes', () => {
    const registry = new Registry();
    registry.counter('probe_total', 'A "quoted" thing\nwith a break.');

    expect(linesOf(registry)[0]).toBe('# HELP probe_total A "quoted" thing\\nwith a break.');
  });
});

describe('gauges', () => {
  test('go up and down', () => {
    const registry = new Registry();
    const connections = registry.gauge('ws_connections', 'Open sockets.');

    connections.set({}, 10);
    connections.inc();
    connections.dec({}, 3);

    expect(connections.get()).toBe(8);
  });

  test('a collector is read at render time, not at registration', () => {
    const registry = new Registry();
    let current = 1;
    registry.gauge('rooms', 'Rooms.').collect(() => current);

    expect(registry.render()).toContain('rooms 1');
    current = 42;
    expect(registry.render()).toContain('rooms 42');
  });

  test('a labelled gauge cannot use a collector', () => {
    const registry = new Registry();
    const gauge = registry.gauge('rooms', 'Rooms.', ['kind']);

    // The collector returns one number, so there is nothing to attach it to.
    expect(() => gauge.collect(() => 1)).toThrow(/cannot use a collector/);
  });
});

describe('histograms', () => {
  test('buckets are cumulative', () => {
    const registry = new Registry();
    const durations = registry.histogram('op_seconds', 'Durations.', [], [0.1, 0.5, 1]);

    durations.observe({}, 0.05);
    durations.observe({}, 0.3);
    durations.observe({}, 0.7);

    const lines = linesOf(registry);
    expect(lines).toContain('op_seconds_bucket{le="0.1"} 1');
    expect(lines).toContain('op_seconds_bucket{le="0.5"} 2');
    expect(lines).toContain('op_seconds_bucket{le="1"} 3');
  });

  /** Observations above the last boundary are still counted. */
  test('+Inf equals the count, not the last bucket', () => {
    const registry = new Registry();
    const durations = registry.histogram('op_seconds', 'Durations.', [], [0.1]);

    durations.observe({}, 0.05);
    durations.observe({}, 99);

    const lines = linesOf(registry);
    expect(lines).toContain('op_seconds_bucket{le="0.1"} 1');
    expect(lines).toContain('op_seconds_bucket{le="+Inf"} 2');
    expect(lines).toContain('op_seconds_count 2');
  });

  test('sum and count describe every observation', () => {
    const registry = new Registry();
    const durations = registry.histogram('op_seconds', 'Durations.', [], [1]);

    durations.observe({}, 2);
    durations.observe({}, 3);

    const lines = linesOf(registry);
    expect(lines).toContain('op_seconds_sum 5');
    expect(lines).toContain('op_seconds_count 2');
  });

  test('an observation exactly on a boundary falls in that bucket', () => {
    const registry = new Registry();
    const durations = registry.histogram('op_seconds', 'Durations.', [], [0.1, 0.2]);

    durations.observe({}, 0.1);

    // `le` means less-than-or-equal.
    expect(linesOf(registry)).toContain('op_seconds_bucket{le="0.1"} 1');
  });

  test('labels appear alongside le, in a stable order', () => {
    const registry = new Registry();
    const durations = registry.histogram('op_seconds', 'Durations.', ['route'], [1]);

    durations.observe({ route: '/health' }, 0.5);

    const lines = linesOf(registry);
    expect(lines).toContain('op_seconds_bucket{route="/health",le="1"} 1');
    expect(lines).toContain('op_seconds_count{route="/health"} 1');
  });

  /**
   * Descending buckets would render counts that fall as `le` rises, which
   * every quantile estimator treats as impossible.
   */
  test('buckets must ascend', () => {
    const registry = new Registry();

    expect(() => registry.histogram('op_seconds', 'D.', [], [1, 0.5])).toThrow(/must ascend/);
    expect(() => registry.histogram('dupes', 'D.', [], [1, 1])).toThrow(/must ascend/);
  });

  test('le is reserved and cannot be a label name', () => {
    const registry = new Registry();

    expect(() => registry.histogram('op_seconds', 'D.', ['le'], [1])).toThrow(/reserved/);
  });
});

describe('exposition format', () => {
  test('ends with a newline', () => {
    const registry = new Registry();
    registry.counter('ticks_total', 'Ticks.').inc();

    expect(registry.render().endsWith('\n')).toBe(true);
  });

  test('every metric declares HELP and TYPE before its samples', () => {
    const registry = new Registry();
    registry.counter('ticks_total', 'Ticks.').inc();

    expect(linesOf(registry)).toEqual([
      '# HELP ticks_total Ticks.',
      '# TYPE ticks_total counter',
      'ticks_total 1',
    ]);
  });

  test('an empty registry renders without throwing', () => {
    expect(new Registry().render()).toBe('\n');
  });
});

/**
 * The API's `/metrics` endpoint.
 *
 * The registry tests above cover the format; these cover the wiring, and in
 * particular the label that decides whether this endpoint is sustainable.
 */
describe('the API endpoint', () => {
  beforeEach(resetDatabase);
  afterAll(closeHarness);

  const scrape = async () => (await request('/metrics')).body as string;

  test('serves the Prometheus content type', async () => {
    const response = await request('/metrics');

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/plain');
    expect(response.headers['content-type']).toContain('version=0.0.4');
  });

  test('needs no session', async () => {
    // Operational shape, no tenant data -- so it is reachable by a scraper
    // that holds no credentials.
    expect((await request('/metrics')).statusCode).toBe(200);
  });

  test('counts requests by route pattern and status', async () => {
    await request('/health');
    await request('/health');

    expect(await scrape()).toContain(
      'relay_http_requests_total{method="GET",route="/health",status="200"} 2',
    );
  });

  /**
   * The property the endpoint lives or dies by.
   *
   * Labelling with the requested path would mint a series per issue id. Two
   * requests for different issues must land on one series.
   */
  test('ids in the path do not become separate series', async () => {
    const owner = await createActor('Owner');
    const workspace = await createWorkspace(owner);

    await request(`/workspaces/${workspace.id}/issues/${crypto.randomUUID()}`, { actor: owner });
    await request(`/workspaces/${workspace.id}/issues/${crypto.randomUUID()}`, { actor: owner });

    const body = await scrape();
    const series = body
      .split('\n')
      .filter((line) => line.startsWith('relay_http_requests_total') && line.includes('/issues/'));

    expect(series).toHaveLength(1);
    expect(series[0]).toContain('route="/workspaces/:workspaceId/issues/:issueId"');
    // And no raw uuid leaked into a label.
    expect(body).not.toContain(workspace.id);
  });

  /** A 404 sweep is exactly the traffic that would otherwise explode cardinality. */
  test('unmatched paths collapse to one series', async () => {
    await request('/nope/one');
    await request('/nope/two');
    await request('/also-missing');

    const body = await scrape();
    expect(body).toContain('route="__unmatched__"');
    expect(body).not.toContain('/nope/one');
  });

  test('records a duration histogram per route', async () => {
    await request('/health');

    const body = await scrape();
    expect(body).toContain(
      'relay_http_request_duration_seconds_count{method="GET",route="/health"}',
    );
    expect(body).toContain('le="+Inf"');
  });

  /**
   * The gauge reads 1, not 0, and that is correct: the scrape is itself a
   * request, and it is still in flight while the registry renders. A 0 here
   * would mean the scrape was not being counted; anything above 1 after a
   * settled run would mean requests are going up without coming back down.
   */
  test('the in-flight gauge counts only the scrape once traffic has settled', async () => {
    for (let i = 0; i < 5; i++) await request('/health');

    expect(await scrape()).toContain('relay_http_requests_in_flight 1');
  });

  test('failed requests are counted with their real status', async () => {
    await request('/workspaces');

    expect(await scrape()).toContain('status="401"');
  });
});
