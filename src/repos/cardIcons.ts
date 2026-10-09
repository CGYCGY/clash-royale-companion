import { getDb } from "../db";

export interface CardOfficialIcons {
  id: number;
  medium: string | null;
  evolutionMedium: string | null;
  heroMedium: string | null;
}

/**
 * Read from the raw API payload: listCards resolves icons to local /cards/ URLs once they are cached,
 * and the downloader needs the Supercell URLs.
 */
export function listCardOfficialIcons(): CardOfficialIcons[] {
  return getDb()
    .query<CardOfficialIcons, []>(
      `SELECT id,
         json_extract(data, '$.iconUrls.medium') AS medium,
         json_extract(data, '$.iconUrls.evolutionMedium') AS evolutionMedium,
         json_extract(data, '$.iconUrls.heroMedium') AS heroMedium
       FROM cards ORDER BY id`,
    )
    .all();
}
