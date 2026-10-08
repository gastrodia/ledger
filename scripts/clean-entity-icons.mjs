/**
 * Preview: node --env-file=.env.local --experimental-strip-types scripts/clean-entity-icons.mjs
 * Apply:   node --env-file=.env.local --experimental-strip-types scripts/clean-entity-icons.mjs --apply
 *
 * The apply query clears only unsupported icon/avatar values, across all users.
 * Both tables change in one atomic SQL statement. Valid selections stay intact,
 * so rerunning the script after users choose new icons is safe.
 */
import { pathToFileURL } from 'node:url';
import { neon } from '@neondatabase/serverless';
import { CATEGORY_ICON_IDS, MEMBER_AVATAR_IDS } from '../lib/entity-icon-catalog.ts';

export async function cleanEntityIcons(sql, { apply = false } = {}) {
  if (!CATEGORY_ICON_IDS.length || !MEMBER_AVATAR_IDS.length) {
    throw new Error('Icon catalogs must not be empty');
  }

  const categoryIds = JSON.stringify(CATEGORY_ICON_IDS);
  const avatarIds = JSON.stringify(MEMBER_AVATAR_IDS);
  const [counts] = apply
    ? await sql`
      WITH cleaned_categories AS (
        UPDATE categories SET icon = NULL
        WHERE icon IS NOT NULL
          AND icon NOT IN (SELECT jsonb_array_elements_text(${categoryIds}::jsonb))
        RETURNING 1
      ), cleaned_members AS (
        UPDATE members SET avatar = NULL
        WHERE avatar IS NOT NULL
          AND avatar NOT IN (SELECT jsonb_array_elements_text(${avatarIds}::jsonb))
        RETURNING 1
      )
      SELECT
        (SELECT COUNT(*) FROM cleaned_categories) AS categories,
        (SELECT COUNT(*) FROM cleaned_members) AS members
    `
    : await sql`
      SELECT
        (SELECT COUNT(*) FROM categories
          WHERE icon IS NOT NULL
            AND icon NOT IN (SELECT jsonb_array_elements_text(${categoryIds}::jsonb))) AS categories,
        (SELECT COUNT(*) FROM members
          WHERE avatar IS NOT NULL
            AND avatar NOT IN (SELECT jsonb_array_elements_text(${avatarIds}::jsonb))) AS members
    `;

  return { categories: Number(counts.categories), members: Number(counts.members) };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('Preview: node --env-file=.env.local --experimental-strip-types scripts/clean-entity-icons.mjs');
    console.log('Apply:   node --env-file=.env.local --experimental-strip-types scripts/clean-entity-icons.mjs --apply');
    return;
  }
  if (args.some((arg) => arg !== '--apply') || args.length > 1) {
    console.error('Unsupported arguments. Use --help for usage.');
    process.exitCode = 1;
    return;
  }
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required. Load the intended environment with --env-file.');
    process.exitCode = 1;
    return;
  }

  const apply = args.includes('--apply');
  const counts = await cleanEntityIcons(neon(process.env.DATABASE_URL), { apply });
  console.log(`${apply ? 'Cleared' : 'Would clear'}: categories.icon=${counts.categories}, members.avatar=${counts.members}`);
  if (!apply) console.log('Preview only. Add --apply to clear these values.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    // Connection errors can contain credentials; never print the original error.
    console.error('Cleanup could not be confirmed. Check the database connection, then preview again.');
    process.exitCode = 1;
  });
}
