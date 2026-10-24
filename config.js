// White Whale settings. Both values are safe to publish: the publishable key is meant
// for browsers, and the database rules (row level security) protect the data.
// NEVER put the secret key, the service_role key, the database password, or the
// Discogs token in this file.

export const CONFIG = {
  SUPABASE_URL: "https://zncwmsylujvytbijbxkv.supabase.co",
  SUPABASE_KEY: "sb_publishable_GyArZeHhP7KRyl_gSKRnHw_uWWFGuY3",

  // true = sample data, nothing is saved. You can also add ?demo=1 to the address.
  DEMO: false,
};
