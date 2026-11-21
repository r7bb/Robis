/** Each check printed as it is made, and a count of the ones that failed. */
export class Checks {
  failures = 0;

  check(name: string, ok: boolean, detail = '') {
    if (!ok) this.failures++;
    process.stdout.write(`  ${ok ? 'ok ' : 'NOT'} ${name}${ok || !detail ? '' : `: ${detail}`}\n`);
    return ok;
  }
}
