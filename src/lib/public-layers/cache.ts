/** In-process cache. A serverless instance may be new; Cache-Control covers the rest. */

type Slot<T> = { at: number; value: T };

export function memo<T>(ttlMs: number) {
  let slot: Slot<T> | null = null;
  let pending: Promise<T> | null = null;
  return async (load: () => Promise<T>): Promise<T> => {
    if (slot && Date.now() - slot.at < ttlMs) return slot.value;
    if (pending) return pending;
    pending = load()
      .then(value => {
        slot = { at: Date.now(), value };
        return value;
      })
      .finally(() => {
        pending = null;
      });
    return pending;
  };
}

const UA = 'OSIRIS-public-dashboard/1.0 (https://github.com/Maximum-2016/osiris)';

export async function getText(url: string, ms = 20_000, headers: Record<string, string> = {}): Promise<string> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(ms),
    headers: { 'User-Agent': UA, Accept: '*/*', ...headers },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${new URL(url).host}`);
  return res.text();
}

export async function getJson<T = any>(url: string, ms = 20_000, headers: Record<string, string> = {}): Promise<T> {
  return JSON.parse(await getText(url, ms, { Accept: 'application/json', ...headers })) as T;
}

export type FC = {
  type: 'FeatureCollection';
  features: any[];
  error?: string;
  attribution: string;
  license: string;
};

export function fc(features: any[], attribution: string, license: string, error?: string): FC {
  return { type: 'FeatureCollection', features, attribution, license, ...(error ? { error } : {}) };
}
