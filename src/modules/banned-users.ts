/**
 * Site-wide (forum-level) ban list.
 *
 * Accounts listed here are treated as if they don't exist anywhere in the app:
 * their posts and comments never appear in any list, activity feed, or
 * profile page - for ANY viewer, including owners/admins/mods. This is
 * separate from and stronger than community-level muting/banning, which is
 * scoped to a single community and always remains visible to that
 * community's admin.
 *
 * Use this only for extreme cases (illegal content, doxxing, etc.) where the
 * content must not be rendered under any circumstances, even though it still
 * technically exists on the blockchain.
 *
 * Adding a name here takes effect the next time the app is built/deployed -
 * there is no on-chain component, so it cannot be undone by anyone through
 * the UI.
 */

const RAW_LIST: string[] = [
  'blurt.rewards',
  'blurt-rewards',
];

export const GLOBAL_BANNED_USERS: Set<string> = new Set(
  RAW_LIST.map(name => name.toLowerCase())
);

export function isGloballyBanned(username: string | null | undefined): boolean {
  if (!username) return false;
  return GLOBAL_BANNED_USERS.has(username.toLowerCase());
}
