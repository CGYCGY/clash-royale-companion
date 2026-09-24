ALTER TABLE cards ADD COLUMN icon_url_hero TEXT;
UPDATE cards SET icon_url_hero = json_extract(data, '$.iconUrls.heroMedium');
