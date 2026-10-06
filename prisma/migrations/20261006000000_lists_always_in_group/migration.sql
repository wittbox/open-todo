-- Lists always live in a group from here on (the inbox aside). Gather every owner's ungrouped
-- lists into a new group at the bottom of their groups, named in the owner's language when it is
-- known ("기타" otherwise — the install default is Korean unless DEFAULT_LOCALE says so).
--
-- Order values are fractional-indexing keys. Appending 'V' to the largest one gives a valid key
-- that sorts after it (the fractional part must just not end in '0'); compare bytewise, as the app
-- does. The lists keep their own order values, so they stay in the order they had.
WITH owners AS (
  SELECT DISTINCT l."ownerId", u."settings"->>'locale' AS locale
  FROM "List" l JOIN "User" u ON u."id" = l."ownerId"
  WHERE l."groupId" IS NULL AND NOT l."isInbox"
), made AS (
  INSERT INTO "Group" ("id", "ownerId", "name", "order", "isCollapsed", "createdAt", "updatedAt")
  SELECT
    'etc' || replace(gen_random_uuid()::text, '-', ''),
    o."ownerId",
    CASE WHEN o.locale = 'en' THEN 'Other' ELSE '기타' END,
    COALESCE((SELECT max(g."order" COLLATE "C") FROM "Group" g WHERE g."ownerId" = o."ownerId") || 'V', 'a0'),
    false,
    now(),
    now()
  FROM owners o
  RETURNING "id", "ownerId"
)
UPDATE "List" l
SET "groupId" = made."id", "updatedAt" = now()
FROM made
WHERE l."ownerId" = made."ownerId" AND l."groupId" IS NULL AND NOT l."isInbox";
