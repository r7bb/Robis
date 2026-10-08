/**
 * A Prometheus registry, written out rather than pulled in.
 *
 * `prom-client` is the obvious dependency here. It is not used because the
 * exposition format is a few hundred lines of text generation, and writing it
 * means the parts that are easy to get subtly wrong -- label ordering,
 * escaping, cumulative buckets -- are visible and tested rather than assumed.
 * If this grew histograms-over-time, exemplars or a push gateway, the library
 * would win.
 *
 * The thing this guards hardest against is cardinality. Every distinct set of
 * label values is a separate time series held in memory forever, so a label
 * that takes unbounded values -- an issue id, a raw URL path, an email -- is a
 * memory leak with a monitoring bill attached. Metrics therefore declare their
 * label names up front and reject anything else: a typo produces an error at
 * the call site instead of a silent second series that never merges.
 */

/** Prometheus name grammar. Applied to metric and label names alike. */
const NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export type Labels = Record<string, string>;

/**
 * Buckets in seconds, chosen from this application's measured latency rather
 * than from the library default. The load test puts reads around 6ms and
 * writes around 10ms at p50, so the interesting resolution is 1ms-100ms; the
 * long tail exists to catch a regression, not to describe it precisely.
 */
export const DEFAULT_BUCKETS = [
  0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
] as const;

function assertName(name: string, what: string) {
  if (!NAME_RE.test(name)) throw new Error(`Invalid ${what} "${name}"`);
}

/**
 * Escape a label value.
 *
 * Backslash first, or the backslashes introduced by escaping the other two
 * would themselves be escaped again.
 */
function escapeLabelValue(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n');
}

/** `help` is a different grammar from a label value: no quote escaping. */
function escapeHelp(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('\n', '\\n');
}

/**
 * Render label values into a stable series key.
 *
 * Sorted by name, so `{a,b}` and `{b,a}` are the same series. Without this,
 * call sites that happen to build the object in a different order would
 * quietly produce two series that never add up.
 */
function seriesKey(labelNames: readonly string[], labels: Labels): string {
  if (labelNames.length === 0) return '';

  const parts = [...labelNames]
    .sort()
    .map((name) => `${name}="${escapeLabelValue(labels[name] ?? '')}"`);

  return `{${parts.join(',')}}`;
}

/** Prometheus wants `+Inf`, and integers without a trailing `.0`. */
function formatValue(value: number): string {
  if (value === Number.POSITIVE_INFINITY) return '+Inf';
  if (value === Number.NEGATIVE_INFINITY) return '-Inf';
  if (Number.isNaN(value)) return 'NaN';
  return String(value);
}

abstract class Metric {
  readonly name: string;
  readonly help: string;
  readonly labelNames: readonly string[];

  constructor(name: string, help: string, labelNames: readonly string[] = []) {
    assertName(name, 'metric name');
    for (const label of labelNames) assertName(label, 'label name');

    this.name = name;
    this.help = help;
    this.labelNames = labelNames;
  }

  abstract readonly type: string;
  abstract render(): string[];

  /**
   * Reject label sets that do not match the declaration.
   *
   * Both directions matter. An unexpected key is usually a typo, which would
   * otherwise open a second series. A missing key renders as an empty string,
   * which silently merges series that were meant to be distinct.
   */
  protected key(labels: Labels): string {
    if (this.labelNames.length === 0 && Object.keys(labels).length > 0) {
      throw new Error(`Metric "${this.name}" takes no labels`);
    }

    for (const name of Object.keys(labels)) {
      if (!this.labelNames.includes(name)) {
        throw new Error(`Metric "${this.name}" has no label "${name}"`);
      }
    }

    for (const name of this.labelNames) {
      if (labels[name] === undefined) {
        throw new Error(`Metric "${this.name}" is missing label "${name}"`);
      }
    }

    return seriesKey(this.labelNames, labels);
  }

  protected header(): string[] {
    return [`# HELP ${this.name} ${escapeHelp(this.help)}`, `# TYPE ${this.name} ${this.type}`];
  }
}

export class Counter extends Metric {
  readonly type = 'counter';
  private readonly values = new Map<string, number>();

  inc(labels: Labels = {}, amount = 1): void {
    if (amount < 0) throw new Error(`Counter "${this.name}" cannot decrease`);

    const key = this.key(labels);
    this.values.set(key, (this.values.get(key) ?? 0) + amount);
  }

  get(labels: Labels = {}): number {
    return this.values.get(this.key(labels)) ?? 0;
  }

  render(): string[] {
    // A counter with no observations renders nothing but its header. Emitting
    // a zero would be a lie about a series that has never existed.
    return [...this.header(), ...[...this.values].map(([k, v]) => `${this.name}${k} ${v}`)];
  }
}

export class Gauge extends Metric {
  readonly type = 'gauge';
  private readonly values = new Map<string, number>();
  /** Set when the value is cheaper to read on demand than to track. */
  private collector: (() => number) | null = null;

  set(labels: Labels = {}, value: number): void {
    this.values.set(this.key(labels), value);
  }

  inc(labels: Labels = {}, amount = 1): void {
    const key = this.key(labels);
    this.values.set(key, (this.values.get(key) ?? 0) + amount);
  }

  dec(labels: Labels = {}, amount = 1): void {
    this.inc(labels, -amount);
  }

  /** For values that are read from somewhere else at scrape time. */
  collect(fn: () => number): this {
    if (this.labelNames.length > 0) {
      throw new Error(`Gauge "${this.name}" has labels, so it cannot use a collector`);
    }
    this.collector = fn;
    return this;
  }

  get(labels: Labels = {}): number {
    return this.values.get(this.key(labels)) ?? 0;
  }

  render(): string[] {
    if (this.collector) return [...this.header(), `${this.name} ${formatValue(this.collector())}`];

    return [
      ...this.header(),
      ...[...this.values].map(([k, v]) => `${this.name}${k} ${formatValue(v)}`),
    ];
  }
}

type HistogramSeries = { counts: number[]; sum: number; count: number };

export class Histogram extends Metric {
  readonly type = 'histogram';
  readonly buckets: readonly number[];
  private readonly series = new Map<string, HistogramSeries>();

  constructor(
    name: string,
    help: string,
    labelNames: readonly string[] = [],
    buckets: readonly number[] = DEFAULT_BUCKETS,
  ) {
    super(name, help, labelNames);

    if (buckets.length === 0) throw new Error(`Histogram "${name}" needs at least one bucket`);

    // Ascending order is not cosmetic: the rendered buckets are cumulative, so
    // an out-of-order boundary would produce counts that decrease as `le`
    // rises, which every downstream quantile calculation assumes cannot happen.
    for (let i = 1; i < buckets.length; i++) {
      if (buckets[i]! <= buckets[i - 1]!) {
        throw new Error(`Histogram "${name}" buckets must ascend`);
      }
    }

    if (labelNames.includes('le')) {
      throw new Error(`Histogram "${name}" cannot use "le" as a label; it is reserved`);
    }

    this.buckets = buckets;
  }

  observe(labels: Labels = {}, value: number): void {
    const key = this.key(labels);

    let entry = this.series.get(key);
    if (!entry) {
      entry = { counts: new Array(this.buckets.length).fill(0), sum: 0, count: 0 };
      this.series.set(key, entry);
    }

    entry.sum += value;
    entry.count++;

    // Store per-bucket here and accumulate at render time. The alternative --
    // incrementing every bucket at or above the value on each observation --
    // is O(buckets) per call on the hot path for the same result.
    for (let i = 0; i < this.buckets.length; i++) {
      if (value <= this.buckets[i]!) {
        entry.counts[i]!++;
        break;
      }
    }
  }

  render(): string[] {
    const lines = this.header();

    for (const [key, entry] of this.series) {
      const inner = key.slice(1, -1);
      const withLe = (le: string) => (inner ? `{${inner},le="${le}"}` : `{le="${le}"}`);

      let cumulative = 0;
      for (let i = 0; i < this.buckets.length; i++) {
        cumulative += entry.counts[i]!;
        lines.push(`${this.name}_bucket${withLe(String(this.buckets[i]!))} ${cumulative}`);
      }

      // Everything above the last boundary still has to be counted, which is
      // what makes `+Inf` equal to `_count` rather than to the last bucket.
      lines.push(`${this.name}_bucket${withLe('+Inf')} ${entry.count}`);
      lines.push(`${this.name}_sum${key} ${entry.sum}`);
      lines.push(`${this.name}_count${key} ${entry.count}`);
    }

    return lines;
  }
}

export class Registry {
  private readonly metrics = new Map<string, Metric>();

  private add<T extends Metric>(metric: T): T {
    if (this.metrics.has(metric.name)) {
      throw new Error(`Metric "${metric.name}" is already registered`);
    }
    this.metrics.set(metric.name, metric);
    return metric;
  }

  counter(name: string, help: string, labelNames: readonly string[] = []): Counter {
    return this.add(new Counter(name, help, labelNames));
  }

  gauge(name: string, help: string, labelNames: readonly string[] = []): Gauge {
    return this.add(new Gauge(name, help, labelNames));
  }

  histogram(
    name: string,
    help: string,
    labelNames: readonly string[] = [],
    buckets: readonly number[] = DEFAULT_BUCKETS,
  ): Histogram {
    return this.add(new Histogram(name, help, labelNames, buckets));
  }

  /** The exposition format: a trailing newline is required, not stylistic. */
  render(): string {
    const lines: string[] = [];
    for (const metric of this.metrics.values()) lines.push(...metric.render());
    return `${lines.join('\n')}\n`;
  }

  static readonly CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8';
}
