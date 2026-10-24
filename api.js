// Crate data layer. Two implementations with the same shape:
//   live: Supabase (accounts, database, Discogs lookups through the edge function)
//   demo: sample data in memory, nothing saved (add ?demo=1 to the address)

export async function makeApi(config, demo, opts = {}) {
  if (demo) return makeDemoApi();
  let sb = opts.client;
  if (!sb) {
    const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm");
    sb = createClient(config.SUPABASE_URL, config.SUPABASE_KEY);
  }
  return makeLiveApi(sb);
}

/* ======================================================================
   LIVE
   ====================================================================== */

function friendly(error) {
  const msg = String(error?.message ?? error ?? "Something went wrong.");
  if (error?.code === "23505") return "That already exists.";
  if (error?.code === "42501" || /row-level security|permission denied/i.test(msg)) return "You can't do that.";
  if (/invalid login credentials/i.test(msg)) return "Wrong email or password.";
  if (/email not confirmed/i.test(msg)) return "Confirm your email first, then log in.";
  if (/rate limit/i.test(msg)) return "Too many attempts. Wait a minute and try again.";
  if (/failed to fetch|networkerror/i.test(msg)) return "Can't reach the server. Check your connection.";
  return msg;
}

function fail(error) {
  const e = new Error(friendly(error));
  e.code = error?.code;
  return e;
}

function makeLiveApi(sb) {
  let uidCache = null;

  async function uid() {
    if (uidCache) return uidCache;
    const { data } = await sb.auth.getSession();
    uidCache = data.session?.user?.id ?? null;
    if (!uidCache) throw new Error("Log in first.");
    return uidCache;
  }

  const ok = ({ data, error }) => {
    if (error) throw fail(error);
    return data;
  };

  async function callDiscogs(body) {
    const { data, error } = await sb.functions.invoke("discogs", { body });
    if (error) {
      let msg = error.message;
      try {
        const j = await error.context.json();
        if (j?.error) msg = j.error;
      } catch { /* keep the generic message */ }
      throw new Error(msg || "Discogs lookup failed.");
    }
    return data;
  }

  const ITEM_SELECT =
    "id,user_id,release_id,condition,notes,featured,created_at,releases(*),profiles(username,avatar_url),likes(count)";

  async function decorate(rows) {
    const me = await uid();
    const ids = rows.map((r) => r.id);
    let liked = new Set();
    if (ids.length) {
      const likes = ok(await sb.from("likes").select("item_id").eq("user_id", me).in("item_id", ids));
      liked = new Set(likes.map((l) => l.item_id));
    }
    return rows.map((r) => ({
      id: r.id,
      user_id: r.user_id,
      release_id: Number(r.release_id),
      condition: r.condition,
      notes: r.notes,
      featured: Boolean(r.featured),
      created_at: r.created_at,
      release: r.releases,
      owner: r.profiles,
      like_count: r.likes?.[0]?.count ?? 0,
      liked: liked.has(r.id),
    }));
  }

  const head = (query) => query.select("*", { count: "exact", head: true });

  return {
    mode: "live",

    auth: {
      async session() {
        const { data } = await sb.auth.getSession();
        uidCache = data.session?.user?.id ?? null;
        return data.session;
      },
      onChange(cb) {
        sb.auth.onAuthStateChange((event, session) => {
          uidCache = session?.user?.id ?? null;
          cb(session, event);
        });
      },
      async signUp({ email, password, username, city }) {
        const { data, error } = await sb.auth.signUp({
          email,
          password,
          options: { data: { username, city: city || "" } },
        });
        if (error) throw fail(error);
        return { needsConfirm: !data.session };
      },
      async signIn({ email, password }) {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw fail(error);
      },
      async signOut() {
        await sb.auth.signOut();
        uidCache = null;
      },
      async usernameAvailable(name) {
        return ok(await sb.rpc("username_available", { name }));
      },
    },

    profiles: {
      async me() {
        const id = await uid();
        return ok(await sb.from("profiles").select("*").eq("id", id).maybeSingle());
      },
      async byUsername(name) {
        return ok(await sb.from("profiles").select("*").eq("username", String(name).toLowerCase()).maybeSingle());
      },
      async stats(id) {
        const me = await uid();
        const [records, followers, following, mine] = await Promise.all([
          head(sb.from("collection_items")).eq("user_id", id),
          head(sb.from("follows")).eq("followee_id", id),
          head(sb.from("follows")).eq("follower_id", id),
          me === id
            ? Promise.resolve({ data: null, error: null })
            : sb.from("follows").select("followee_id").eq("follower_id", me).eq("followee_id", id).maybeSingle(),
        ]);
        for (const r of [records, followers, following, mine]) if (r.error) throw fail(r.error);
        return {
          records: records.count ?? 0,
          followers: followers.count ?? 0,
          following: following.count ?? 0,
          isFollowing: Boolean(mine.data),
        };
      },
      async update(patch) {
        const id = await uid();
        return ok(await sb.from("profiles").update(patch).eq("id", id).select().single());
      },
      async uploadAvatar(blob) {
        const id = await uid();
        const path = `${id}/avatar.jpg`;
        const up = await sb.storage.from("avatars").upload(path, blob, { upsert: true, contentType: "image/jpeg" });
        if (up.error) throw fail(up.error);
        const { data } = sb.storage.from("avatars").getPublicUrl(path);
        const url = `${data.publicUrl}?v=${Date.now()}`;
        return ok(await sb.from("profiles").update({ avatar_url: url }).eq("id", id).select().single());
      },
    },

    discogs: {
      search: (q, page = 1) => callDiscogs({ action: "search", q, page }),
      versions: ({ master_id, artist, title, page = 1 }) =>
        callDiscogs({ action: "versions", master_id, artist, title, page }),
      async release(id) {
        const d = await callDiscogs({ action: "release", id });
        return d.release;
      },
    },

    collection: {
      async list(userId) {
        const rows = ok(
          await sb.from("collection_items").select(ITEM_SELECT).eq("user_id", userId).order("created_at", { ascending: false }),
        );
        return decorate(rows);
      },
      async add(releaseId, condition, notes) {
        const { error } = await sb.from("collection_items").insert({ release_id: releaseId, condition, notes });
        if (error) throw error.code === "23505" ? new Error("That pressing is already in your collection.") : fail(error);
      },
      async update(id, patch) {
        ok(await sb.from("collection_items").update(patch).eq("id", id).select().single());
      },
      async remove(id) {
        ok(await sb.from("collection_items").delete().eq("id", id));
      },
    },

    wantlist: {
      async list(userId) {
        return ok(
          await sb
            .from("wantlist_items")
            .select("id,user_id,release_id,master_id,any_pressing,featured,created_at,releases(*)")
            .eq("user_id", userId)
            .order("created_at", { ascending: false }),
        ).map((w) => ({ ...w, release_id: Number(w.release_id), release: w.releases }));
      },
      async add(release, anyPressing) {
        const any = Boolean(anyPressing && release.discogs_master_id);
        const { error } = await sb.from("wantlist_items").insert({
          release_id: release.discogs_release_id,
          master_id: release.discogs_master_id,
          any_pressing: any,
        });
        if (error) throw error.code === "23505" ? new Error("That pressing is already on your wantlist.") : fail(error);
      },
      async setAny(id, any) {
        ok(await sb.from("wantlist_items").update({ any_pressing: any }).eq("id", id).select().single());
      },
      async setFeatured(id, on) {
        ok(await sb.from("wantlist_items").update({ featured: on }).eq("id", id).select().single());
      },
      async remove(id) {
        ok(await sb.from("wantlist_items").delete().eq("id", id));
      },
    },

    async mine() {
      const me = await uid();
      const [c, w] = await Promise.all([
        sb.from("collection_items").select("release_id").eq("user_id", me),
        sb.from("wantlist_items").select("release_id").eq("user_id", me),
      ]);
      return {
        owned: new Set(ok(c).map((r) => Number(r.release_id))),
        wanted: new Set(ok(w).map((r) => Number(r.release_id))),
      };
    },

    async matches() {
      return ok(await sb.rpc("get_matches")).map((m) => ({ ...m, release_id: Number(m.release_id) }));
    },

    async feed(mode) {
      const me = await uid();
      let query = sb.from("collection_items").select(ITEM_SELECT).order("created_at", { ascending: false }).limit(60);
      if (mode === "following") {
        const rows = ok(await sb.from("follows").select("followee_id").eq("follower_id", me));
        if (!rows.length) return [];
        query = query.in("user_id", rows.map((r) => r.followee_id));
      } else {
        query = query.neq("user_id", me);
      }
      return decorate(ok(await query));
    },

    likes: {
      async toggle(itemId, on) {
        const me = await uid();
        if (on) {
          const { error } = await sb.from("likes").insert({ item_id: itemId });
          if (error && error.code !== "23505") throw fail(error);
        } else {
          ok(await sb.from("likes").delete().eq("item_id", itemId).eq("user_id", me));
        }
      },
    },

    follows: {
      async follow(id) {
        const { error } = await sb.from("follows").insert({ followee_id: id });
        if (error && error.code !== "23505") throw fail(error);
      },
      async unfollow(id) {
        const me = await uid();
        ok(await sb.from("follows").delete().eq("follower_id", me).eq("followee_id", id));
      },
    },

    safety: {
      async block(id) {
        const { error } = await sb.from("blocks").insert({ blocked_id: id });
        if (error && error.code !== "23505") throw fail(error);
      },
      async unblock(id) {
        const me = await uid();
        ok(await sb.from("blocks").delete().eq("blocker_id", me).eq("blocked_id", id));
      },
      async blocked() {
        return ok(await sb.rpc("get_blocked_users"));
      },
      async report({ target_user_id, target_item_id, reason, details }) {
        const row = { target_user_id, reason, details: details || "" };
        if (target_item_id) row.target_item_id = target_item_id;
        const { error } = await sb.from("reports").insert(row);
        if (error) throw fail(error);
      },
    },
  };
}

/* ======================================================================
   DEMO
   ====================================================================== */

function makeDemoApi() {
  const now = Date.now();
  const ago = (hours) => new Date(now - hours * 3_600_000).toISOString();
  let seq = 1000;
  const nextId = (p) => `${p}${++seq}`;
  const delay = (v) => new Promise((r) => setTimeout(() => r(v), 120));

  const ME = "me";
  const users = [
    { id: ME, username: "tone", city: "Augusta, GA", bio: "Soul, jazz, and anything on a good pressing.", avatar_url: null, created_at: ago(900) },
    { id: "u1", username: "nadia_o", city: "Brooklyn, NY", bio: "Reissue hunter. Half-speed masters are my weakness.", avatar_url: null, created_at: ago(800) },
    { id: "u2", username: "marcus_b", city: "Atlanta, GA", bio: "Crate digger. Saturdays at the record fair.", avatar_url: null, created_at: ago(700) },
    { id: "u3", username: "june_p", city: "Savannah, GA", bio: "", avatar_url: null, created_at: ago(600) },
    { id: "u4", username: "deshawn_r", city: "Charlotte, NC", bio: "Original pressings only.", avatar_url: null, created_at: ago(500) },
  ];

  // [id, master, artist, title, year, label, format, country]
  const R = [
    [100, 10, "Amy Winehouse", "Back to Black", 2006, "Island Records", "Vinyl, LP, Album", "UK"],
    [101, 10, "Amy Winehouse", "Back to Black", 2016, "Island Records", "Vinyl, LP, Album, Reissue, Half Speed Mastered", "Europe"],
    [200, 20, "Björk", "Homogenic", 1997, "One Little Indian", "Vinyl, LP, Album", "UK"],
    [201, 20, "Björk", "Homogenic", 2019, "One Little Indian", "Vinyl, 2x LP, Album, Reissue", "Europe"],
    [300, 30, "Daft Punk", "Discovery", 2001, "Virgin", "Vinyl, 2x LP, Album", "Europe"],
    [400, 40, "Pink Floyd", "The Dark Side of the Moon", 1973, "Harvest", "Vinyl, LP, Album", "UK"],
    [401, 40, "Pink Floyd", "The Dark Side of the Moon", 2016, "Pink Floyd Records", "Vinyl, LP, Album, Reissue, Remastered", "Europe"],
    [500, 50, "Miles Davis", "Kind of Blue", 1959, "Columbia", "Vinyl, LP, Album, Mono", "US"],
    [501, 50, "Miles Davis", "Kind of Blue", 2019, "Columbia", "Vinyl, LP, Album, Reissue, 180g", "US"],
    [600, 60, "The Beatles", "Abbey Road", 1969, "Apple Records", "Vinyl, LP, Album", "UK"],
    [601, 60, "The Beatles", "Abbey Road", 2019, "Apple Records", "Vinyl, LP, Album, Reissue, Stereo", "Europe"],
    [700, 70, "Fleetwood Mac", "Rumours", 1977, "Warner Bros.", "Vinyl, LP, Album", "US"],
    [800, 80, "Stevie Wonder", "Songs in the Key of Life", 1976, "Tamla", "Vinyl, 2x LP, Album", "US"],
    [900, 90, "Radiohead", "OK Computer", 1997, "Parlophone", "Vinyl, 2x LP, Album", "UK"],
    [901, 90, "Radiohead", "OK Computer", 2017, "XL Recordings", "Vinyl, 2x LP, Album, Reissue", "Europe"],
    [1000, 100, "Prince", "Purple Rain", 1984, "Warner Bros.", "Vinyl, LP, Album", "US"],
  ].map(([id, m, artist, title, year, label, format, country]) => ({
    discogs_release_id: id, discogs_master_id: m, artist, title, year, label, format, country, cover_url: null,
  }));
  const rel = (id) => R.find((r) => r.discogs_release_id === Number(id));

  let items = [
    ["me", 401, "Near Mint", "Bought at the Augusta record fair.", 300],
    ["me", 300, "Very Good Plus", "", 290],
    ["me", 500, "Mint", "Sealed.", 280],
    ["me", 101, "Near Mint", "", 270],
    ["me", 900, "Very Good", "", 260],
    ["me", 700, "Good", "Flea market find.", 250],
    ["me", 1000, "Near Mint", "", 240],
    ["u1", 101, "Near Mint", "", 2],
    ["u1", 900, "Very Good", "", 20],
    ["u2", 200, "Very Good Plus", "First UK pressing.", 5],
    ["u2", 700, "Good", "", 30],
    ["u3", 800, "Mint", "", 50],
    ["u3", 1000, "Near Mint", "", 8],
    ["u4", 600, "Very Good", "Original UK pressing, light ring wear.", 12],
    ["u4", 400, "Very Good Plus", "", 60],
  ].filter(([, r]) => rel(r)).map(([user_id, release_id, condition, notes, hrs]) => ({
    id: nextId("i"), user_id, release_id, condition, notes, created_at: ago(hrs), featured: false,
  }));
  items.filter((i) => i.user_id === "me").slice(0, 4).forEach((i) => (i.featured = true));

  let wants = [
    ["me", 100, true, 100],
    ["me", 200, false, 90],
    ["me", 600, true, 80],
    ["u1", 401, false, 40],
    ["u2", 401, true, 35],
    ["u3", 300, false, 30],
    ["u4", 901, true, 25],
  ].map(([user_id, release_id, any, hrs]) => ({
    id: nextId("w"), user_id, release_id, master_id: rel(release_id).discogs_master_id,
    any_pressing: any, created_at: ago(hrs), featured: user_id === "me" || user_id === "u4",
  }));

  const follows = new Set([`${ME}>u1`, `${ME}>u2`, "u1>me"]);
  const likes = new Set(["u1|" + items[5].id, "u3|" + items[0].id]);
  let blocks = [];
  const reports = [];

  let signedIn = true;
  const listeners = [];
  const emit = () => listeners.forEach((cb) => cb(signedIn ? { user: { id: ME } } : null, signedIn ? "SIGNED_IN" : "SIGNED_OUT"));

  const user = (id) => users.find((u) => u.id === id);
  const blockedWith = (id) => blocks.some((b) => (b.blocker === ME && b.blocked === id) || (b.blocker === id && b.blocked === ME));
  const visible = (id) => id === ME || !blockedWith(id);
  const likeCount = (itemId) => [...likes].filter((l) => l.endsWith("|" + itemId)).length;

  const decorate = (it) => ({
    ...it,
    release: rel(it.release_id),
    owner: { username: user(it.user_id).username, avatar_url: user(it.user_id).avatar_url },
    like_count: likeCount(it.id),
    liked: likes.has(`${ME}|${it.id}`),
  });

  function searchShape(r) {
    return {
      id: r.discogs_release_id, master_id: r.discogs_master_id, artist: r.artist, title: r.title,
      year: r.year, country: r.country, label: r.label,
      formats: r.format.split(",").map((s) => s.trim()), cover: null, thumb: null,
    };
  }

  return {
    mode: "demo",

    auth: {
      async session() { return signedIn ? { user: { id: ME } } : null; },
      onChange(cb) { listeners.push(cb); },
      async signUp({ username, city }) {
        const me = user(ME); me.username = username; me.city = city || "";
        signedIn = true; setTimeout(emit, 0);
        return { needsConfirm: false };
      },
      async signIn() { signedIn = true; setTimeout(emit, 0); },
      async signOut() { signedIn = false; setTimeout(emit, 0); },
      async usernameAvailable(name) { return !users.some((u) => u.username === String(name).toLowerCase() && u.id !== ME); },
    },

    profiles: {
      async me() { return delay({ ...user(ME) }); },
      async byUsername(name) {
        const u = users.find((x) => x.username === String(name).toLowerCase());
        return delay(u && visible(u.id) ? { ...u } : null);
      },
      async stats(id) {
        return delay({
          records: items.filter((i) => i.user_id === id).length,
          followers: [...follows].filter((f) => f.endsWith(">" + id)).length,
          following: [...follows].filter((f) => f.startsWith(id + ">")).length,
          isFollowing: follows.has(`${ME}>${id}`),
        });
      },
      async update(patch) { Object.assign(user(ME), patch); return delay({ ...user(ME) }); },
      async uploadAvatar(blob) { user(ME).avatar_url = URL.createObjectURL(blob); return delay({ ...user(ME) }); },
    },

    discogs: {
      async search(q) {
        const tokens = String(q).toLowerCase().split(/\s+/).filter(Boolean);
        const hits = R.filter((r) => tokens.every((t) => `${r.artist} ${r.title}`.toLowerCase().includes(t)));
        return delay({ results: hits.map(searchShape), page: 1, pages: 1 });
      },
      async versions({ master_id }) {
        return delay({ results: R.filter((r) => r.discogs_master_id === Number(master_id)).map(searchShape), page: 1, pages: 1 });
      },
      async release(id) { return delay({ ...rel(id) }); },
    },

    collection: {
      async list(userId) {
        if (!visible(userId)) return [];
        return delay(items.filter((i) => i.user_id === userId).sort((a, b) => b.created_at.localeCompare(a.created_at)).map(decorate));
      },
      async add(releaseId, condition, notes) {
        if (items.some((i) => i.user_id === ME && i.release_id === releaseId)) throw new Error("That pressing is already in your collection.");
        items.push({ id: nextId("i"), user_id: ME, release_id: releaseId, condition, notes, created_at: new Date().toISOString() });
        return delay();
      },
      async update(id, patch) {
        if (patch.featured && items.filter((i) => i.user_id === ME && i.featured && i.id !== id).length >= 6) throw new Error("You can show up to 6 records on the wall. Remove one first.");
        Object.assign(items.find((i) => i.id === id), patch); return delay();
      },
      async remove(id) { items = items.filter((i) => i.id !== id); return delay(); },
    },

    wantlist: {
      async list(userId) {
        if (!visible(userId)) return [];
        return delay(wants.filter((w) => w.user_id === userId).map((w) => ({ ...w, release: rel(w.release_id) })));
      },
      async add(release, anyPressing) {
        if (wants.some((w) => w.user_id === ME && w.release_id === release.discogs_release_id)) throw new Error("That pressing is already on your wantlist.");
        wants.unshift({
          id: nextId("w"), user_id: ME, release_id: release.discogs_release_id, master_id: release.discogs_master_id,
          any_pressing: Boolean(anyPressing && release.discogs_master_id), created_at: new Date().toISOString(), featured: false,
        });
        return delay();
      },
      async setAny(id, any) { wants.find((w) => w.id === id).any_pressing = any; return delay(); },
      async setFeatured(id, on) {
        if (on && wants.filter((w) => w.user_id === ME && w.featured && w.id !== id).length >= 6) throw new Error("You can show up to 6 records on the wall. Remove one first.");
        wants.find((w) => w.id === id).featured = on; return delay();
      },
      async remove(id) { wants = wants.filter((w) => w.id !== id); return delay(); },
    },

    async mine() {
      return delay({
        owned: new Set(items.filter((i) => i.user_id === ME).map((i) => i.release_id)),
        wanted: new Set(wants.filter((w) => w.user_id === ME).map((w) => w.release_id)),
      });
    },

    async matches() {
      const rows = [];
      const shape = (u, r, direction, match_type) => ({
        direction, match_type, other_user_id: u.id, username: u.username, avatar_url: u.avatar_url, city: u.city,
        release_id: r.discogs_release_id, title: r.title, artist: r.artist, year: r.year, label: r.label,
        format: r.format, country: r.country, cover_url: r.cover_url,
      });
      for (const w of wants.filter((x) => x.user_id === ME)) {
        for (const c of items.filter((i) => i.user_id !== ME && visible(i.user_id))) {
          const r = rel(c.release_id);
          if (c.release_id === w.release_id) rows.push(shape(user(c.user_id), r, "has_your_want", "exact"));
          else if (w.any_pressing && w.master_id === r.discogs_master_id) rows.push(shape(user(c.user_id), r, "has_your_want", "any_pressing"));
        }
      }
      for (const mine of items.filter((i) => i.user_id === ME)) {
        const r = rel(mine.release_id);
        for (const w of wants.filter((x) => x.user_id !== ME && visible(x.user_id))) {
          if (w.release_id === mine.release_id) rows.push(shape(user(w.user_id), r, "wants_your_record", "exact"));
          else if (w.any_pressing && w.master_id === r.discogs_master_id) rows.push(shape(user(w.user_id), r, "wants_your_record", "any_pressing"));
        }
      }
      return delay(rows);
    },

    async feed(mode) {
      let list = items.filter((i) => i.user_id !== ME && visible(i.user_id));
      if (mode === "following") list = list.filter((i) => follows.has(`${ME}>${i.user_id}`));
      return delay(list.sort((a, b) => b.created_at.localeCompare(a.created_at)).map(decorate));
    },

    likes: {
      async toggle(itemId, on) { const key = `${ME}|${itemId}`; if (on) likes.add(key); else likes.delete(key); return delay(); },
    },

    follows: {
      async follow(id) { follows.add(`${ME}>${id}`); return delay(); },
      async unfollow(id) { follows.delete(`${ME}>${id}`); return delay(); },
    },

    safety: {
      async block(id) {
        blocks.push({ blocker: ME, blocked: id });
        for (const f of [...follows]) if (f === `${ME}>${id}` || f === `${id}>${ME}`) follows.delete(f);
        return delay();
      },
      async unblock(id) { blocks = blocks.filter((b) => !(b.blocker === ME && b.blocked === id)); return delay(); },
      async blocked() {
        return delay(blocks.filter((b) => b.blocker === ME).map((b) => ({ id: b.blocked, username: user(b.blocked).username, avatar_url: null })));
      },
      async report(r) { reports.push(r); return delay(); },
    },
  };
}
