import { asBoolean, asString } from "../utils/plugin-settings";
import { getInstanceSettings } from "../utils/server-settings";

export interface IndexerConfig {
  maxPerSearch: number;
  maxUrls: number;
  maxHits: number;
  pruneEnabled: boolean;
  fuzzyEnabled: boolean;
  queryLimit: number;
}

const clampInt = (raw: string | undefined, fallback: number, min: number, max: number): number => {
  const n = parseInt((raw ?? "").trim(), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
};

export const getIndexerConfig = async (): Promise<IndexerConfig> => {
  const s = await getInstanceSettings();
  const maxPerSearch = clampInt(asString(s.degoogIndexerMaxPerSearch), 30, 0, 500);
  const maxUrls = clampInt(asString(s.degoogIndexerMaxUrls), 0, 0, 100_000_000);
  const maxHits = clampInt(asString(s.degoogIndexerMaxHits), 0, 0, 100_000_000);
  const queryLimit = clampInt(asString(s.degoogIndexerQueryLimit), 30, 1, 100);
  const limitsOn = maxUrls > 0 || maxHits > 0;
  const pruneSetting = asString(s.degoogIndexerPruneEnabled);
  const pruneEnabled =
    limitsOn && (pruneSetting === "" || pruneSetting === "true" || asBoolean(s.degoogIndexerPruneEnabled));
  const fuzzyRaw = asString(s.degoogIndexerFuzzyEnabled);
  return {
    maxPerSearch,
    maxUrls,
    maxHits,
    pruneEnabled,
    fuzzyEnabled: fuzzyRaw !== "false",
    queryLimit,
  };
};
