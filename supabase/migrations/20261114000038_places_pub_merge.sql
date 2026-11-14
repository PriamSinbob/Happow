-- Bars and beer gardens are pubs: `places.kinds` merged them into amenity=pub (its `alsoTags`).
-- The ingest and POST /api/places store the pub tag from now on; this moves what is stored.
update places set kind = 'amenity=pub' where kind in ('amenity=bar', 'amenity=biergarten');
