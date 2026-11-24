/** A release as the list names it. */
type Listed = { name: string; shippedAt: string | null };

/**
 * The release a question is about: by its name exactly, else one whose name
 * holds the words, shipped or not; with no name, the next still to ship
 * (the list comes still-to-ship first, by the day aimed at).
 */
export function releaseAsked<T extends Listed>(list: readonly T[], name: string | null): T | null {
  if (!name) return list.find((release) => !release.shippedAt) ?? null;
  const wanted = name.trim().toLowerCase();
  return (
    list.find((release) => release.name.toLowerCase() === wanted) ??
    list.find((release) => release.name.toLowerCase().includes(wanted)) ??
    null
  );
}
