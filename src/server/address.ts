import { Resolver } from 'node:dns/promises';

const KEEP_MS = 60 * 60_000;
const RETRY_MS = 5 * 60_000;

export function publicAddress(domain: string): () => Promise<string | null> {
  if (!domain) return async () => null;
  const resolver = new Resolver({ timeout: 2000, tries: 2 });
  let known: string | null = null;
  let checkedAt = 0;
  let pending: Promise<string | null> | null = null;
  return () => {
    if (Date.now() - checkedAt < (known ? KEEP_MS : RETRY_MS)) return Promise.resolve(known);
    pending ??= resolver
      .resolve4(domain)
      .then(
        ([first]) => (known = first ?? known),
        () => known,
      )
      .finally(() => {
        checkedAt = Date.now();
        pending = null;
      });
    return pending;
  };
}
