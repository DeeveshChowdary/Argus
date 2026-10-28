import { AlpacaError, normalizeAssets } from './alpaca.js';

export const UNIVERSE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export async function readUniverse(db) {
  return db.prepare(`SELECT u.id, u.fetched_at, u.asset_count FROM scanner_state s
    JOIN universe_versions u ON u.id = s.universe_id WHERE s.id = 1 AND u.status = 'ready'`).first();
}

export async function refreshUniverse(db, client, now = Date.now()) {
  // Validate upstream fully before any universe write. No price filter excludes penny stocks.
  const assets = normalizeAssets(await client.assets());
  if (assets.length > 20000) throw new AlpacaError('UNIVERSE_BUDGET_EXCEEDED');
  const id = crypto.randomUUID();
  const fetchedAt = new Date(now).toISOString();
  await db.prepare("INSERT INTO universe_versions (id, fetched_at, status) VALUES (?, ?, 'building')").bind(id, fetchedAt).run();
  try {
    // JSON bulk insertion keeps a large universe below D1's per-invocation query limit.
    for (let offset = 0; offset < assets.length; offset += 1000) {
      await db.prepare(`INSERT INTO universe_assets
        (universe_id, symbol, asset_id, name, exchange, fractionable, shortable, attributes_json)
        SELECT ?, json_extract(value, '$.symbol'), json_extract(value, '$.asset_id'),
          json_extract(value, '$.name'), json_extract(value, '$.exchange'),
          json_extract(value, '$.fractionable'), json_extract(value, '$.shortable'),
          json_extract(value, '$.attributes') FROM json_each(?)`)
        .bind(id, JSON.stringify(assets.slice(offset, offset + 1000))).run();
    }
    const count = await db.prepare('SELECT COUNT(*) AS n FROM universe_assets WHERE universe_id = ?').bind(id).first();
    if (count.n !== assets.length) throw new AlpacaError('UNIVERSE_COUNT_MISMATCH');
    // Publish atomically only once every row is durable. A failure keeps the prior version active.
    await db.batch([
      db.prepare("UPDATE universe_versions SET status = 'ready', asset_count = ? WHERE id = ?").bind(assets.length, id),
      db.prepare('UPDATE scanner_state SET universe_id = ?, cursor = 0 WHERE id = 1').bind(id),
    ]);
    return { id, fetched_at: fetchedAt, asset_count: assets.length };
  } catch {
    throw new AlpacaError('UNIVERSE_PERSIST_FAILED');
  }
}

export async function pruneUniverses(db) {
  // Called while holding the scanner lease. Keep the published universe and remove abandoned builds.
  // Explicit child deletion avoids provider differences in FK cascade configuration.
  await db.batch([
    db.prepare('DELETE FROM universe_assets WHERE universe_id != (SELECT universe_id FROM scanner_state WHERE id = 1)'),
    db.prepare('DELETE FROM universe_versions WHERE id != (SELECT universe_id FROM scanner_state WHERE id = 1)'),
  ]);
}
