// Read-only allowlist: no account balances, orders, or live-trading host.
const PAPER = 'https://paper-api.alpaca.markets';
const DATA = 'https://data.alpaca.markets';
const SYMBOL = /^[A-Z0-9][A-Z0-9.\/-]{0,19}$/;

export class AlpacaError extends Error {
  constructor(code, status = null, retryAfterSeconds = null) {
    super(code);
    this.name = 'AlpacaError';
    this.code = code;
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export function configured(env) {
  return typeof env.APCA_API_KEY_ID === 'string' && env.APCA_API_KEY_ID.trim().length > 0
    && typeof env.APCA_API_SECRET_KEY === 'string' && env.APCA_API_SECRET_KEY.trim().length > 0;
}

export function validSymbol(value) {
  return typeof value === 'string' && SYMBOL.test(value);
}

export function createAlpaca(env, fetcher = fetch) {
  async function get(host, path, query = {}) {
    if (!configured(env)) throw new AlpacaError('ALPACA_NOT_CONFIGURED');
    const url = new URL(path, host);
    for (const [name, value] of Object.entries(query)) url.searchParams.set(name, String(value));
    let response;
    try {
      response = await fetcher(url.toString(), {
        method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(8000),
        headers: { Accept: 'application/json', 'APCA-API-KEY-ID': env.APCA_API_KEY_ID, 'APCA-API-SECRET-KEY': env.APCA_API_SECRET_KEY },
      });
    } catch { throw new AlpacaError('ALPACA_NETWORK_ERROR'); }
    if (!response.ok) {
      const status = response.status;
      const retry = Number(response.headers.get('retry-after'));
      await response.body?.cancel();
      const code = status === 401 ? 'ALPACA_AUTH_FAILED' : status === 403 ? 'ALPACA_FORBIDDEN'
        : status === 429 ? 'ALPACA_RATE_LIMITED' : 'ALPACA_HTTP_ERROR';
      throw new AlpacaError(code, status, status === 429 && Number.isFinite(retry) ? Math.max(0, Math.min(3600, retry)) : null);
    }
    try { return await response.json(); }
    catch { throw new AlpacaError('ALPACA_INVALID_RESPONSE'); }
  }
  return {
    assets: () => get(PAPER, '/v2/assets', { status: 'active', asset_class: 'us_equity' }),
    clock: () => get(PAPER, '/v3/clock', { markets: 'NASDAQ' }),
    calendar: (date) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new AlpacaError('INVALID_CALENDAR_DATE');
      const start=new Date(Date.parse(`${date}T12:00:00Z`)-10*86400000).toISOString().slice(0,10);
      return get(PAPER, '/v2/calendar', { start, end: date });
    },
    snapshots: async (symbols) => {
      if (!Array.isArray(symbols) || !symbols.length || symbols.length > 500 || !symbols.every(validSymbol)) throw new AlpacaError('INVALID_SYMBOL_BATCH');
      const result = await get(DATA, '/v2/stocks/snapshots', { symbols: [...new Set(symbols)].join(','), feed: 'iex' });
      if (!result || Array.isArray(result) || typeof result !== 'object') throw new AlpacaError('ALPACA_INVALID_RESPONSE');
      return result;
    },
  };
}

export function normalizeAssets(input) {
  if (!Array.isArray(input) || input.length === 0 || input.length > 50000) throw new AlpacaError('INVALID_ASSET_UNIVERSE');
  const symbols = new Set();
  const assets = [];
  for (const item of input) {
    // Any malformed record invalidates the refresh. Do not replace a good universe with a partial parse.
    if (!item || !validSymbol(item.symbol) || typeof item.id !== 'string' || !item.id
      || typeof item.name !== 'string' || typeof item.exchange !== 'string'
      || typeof item.tradable !== 'boolean' || typeof item.status !== 'string' || typeof item.class !== 'string') {
      throw new AlpacaError('INVALID_ASSET_UNIVERSE');
    }
    if (item.class !== 'us_equity' || item.status !== 'active' || !item.tradable) continue;
    if (symbols.has(item.symbol)) throw new AlpacaError('INVALID_ASSET_UNIVERSE');
    symbols.add(item.symbol);
    assets.push({ symbol: item.symbol, asset_id: item.id, name: item.name.slice(0, 300), exchange: item.exchange.slice(0, 30),
      fractionable: item.fractionable === true, shortable: item.shortable === true,
      attributes: Array.isArray(item.attributes) ? item.attributes.filter((v) => typeof v === 'string').slice(0, 30) : [] });
  }
  if (!assets.length) throw new AlpacaError('EMPTY_TRADABLE_UNIVERSE');
  return assets.sort((a, b) => a.symbol.localeCompare(b.symbol, 'en'));
}
