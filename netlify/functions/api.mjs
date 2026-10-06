import { createClient } from "@supabase/supabase-js";

const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const pick = (items) => items[Math.floor(Math.random() * items.length)];
const uid = () => crypto.randomUUID();
const makeToken = () => Array.from(crypto.getRandomValues(new Uint8Array(24)), (n) => alphabet[n % alphabet.length]).join("");
const json = (data, status = 200) => Response.json(data, { status, headers: { "cache-control": "no-store" } });
const banks = {
  Motive: ["was due to inherit Cheryl's estate.", "had been locked in a defamation lawsuit with Cheryl.", "learned Cheryl changed her will last week.", "never forgave Cheryl for her memoir.", "believed Cheryl had stolen from them.", "had fallen out with Cheryl over a business deal."],
  Means: ["always kept a knife close at hand.", "had a gun in their luggage.", "knew where the manor kept its weapons.", "knew Cheryl hid a private knife beneath her bed.", "had studied toxicology and knew how poisons worked.", "knew where the household poisons were kept."],
  Opportunity: ["was seen outside Cheryl's bedroom shortly before she was found.", "appeared on camera in the hallway just before the murder.", "had fingerprints on a glass inside Cheryl's room.", "knew how to pick the old manor locks.", "had been expected to speak with Cheryl after dinner.", "was staying in the room next to Cheryl's."],
  Counter: ["had recently reconciled with Cheryl.", "had received a sincere apology from Cheryl.", "would have lost money if Cheryl died.", "had a broken leg and could not climb the stairs.", "was asleep in the sitting room around the time of death.", "was seen in the library throughout the murder.", "arrived at the manor after the estimated time of death."],
  Red: ["had been overheard threatening Cheryl.", "was described by Cheryl as her least favorite guest.", "had gone shooting with Cheryl the week before.", "had rejected Cheryl's advances.", "had learned that Cheryl recently increased her life insurance.", "had become secretive with Cheryl lately.", "was owed ten thousand dollars by Cheryl.", "had heard Cheryl say, 'If I die, blame another guest.'"],
};
const fact = (category, name) => ({ id: uid(), category, text: `${name} ${pick(banks[category])}`, original: null });
const db = () => {
  const SUPABASE_SECRET = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  const { SUPABASE_URL } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SECRET) throw new Error("The server database is not configured yet.");
  return createClient(SUPABASE_URL, SUPABASE_SECRET, { auth: { persistSession: false, autoRefreshToken: false } });
};
const cleanPlayers = (room) => room.players.map((p) => ({ id: p.id, name: p.name, host: p.id === room.hostId, bot: p.bot }));

export default async (request) => {
  try {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/api\/?/, "").replace(/\/$/, "");
    const supabase = db();
    if (path === "public" && request.method === "GET") {
      const { data, error } = await supabase.from("ravenstone_rooms").select("code,player_count,updated_at").eq("visibility", "public").eq("status", "lobby").gt("updated_at", new Date(Date.now() - 3600000).toISOString()).lt("player_count", 9).order("updated_at", { ascending: false }).limit(50);
      if (error) throw error;
      return json({ rooms: (data || []).map((r) => ({ code: r.code, count: r.player_count })) });
    }
    if (path === "rooms" && request.method === "POST") return await createRoom(supabase, await request.json());
    const match = path.match(/^rooms\/([A-Z0-9]+)\/(join|state|action)$/);
    if (!match) return json({ error: "Not found." }, 404);
    const [, code, operation] = match;
    const { data: row, error: findError } = await supabase.from("ravenstone_rooms").select("*").eq("code", code).maybeSingle();
    if (findError) throw findError;
    if (!row) return json({ error: "Room not found." }, 404);
    const room = row.state;
    if (operation === "join" && request.method === "POST") return await joinRoom(supabase, row, room, await request.json());
    const auth = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const player = room.players.find((p) => p.token && p.token === auth);
    if (!player) return json({ error: "Room session expired. Rejoin the room." }, 401);
    if (operation === "state" && request.method === "GET") {
      if (room.status === "investigation" && Date.now() >= room.deadline) { room.status = "voting"; await persist(supabase, row, room); }
      return json(view(room, player));
    }
    if (operation === "action" && request.method === "POST") {
      const result = act(room, player, await request.json());
      if (result?.error) return json({ error: result.error }, result.status || 400);
      const saved = await persist(supabase, row, room);
      if (!saved) return json({ error: "The room changed at the same time. Please try that action again." }, 409);
      return json(view(room, player));
    }
    return json({ error: "Method not allowed." }, 405);
  } catch (error) {
    console.error("Ravenstone API:", error.message);
    return json({ error: error.message || "The manor server encountered an error." }, 500);
  }
};

export const config = { path: "/api/*", excludedPath: ["/api/config"] };

async function persist(client, oldRow, room) {
  const updated = {
    state: room,
    version: oldRow.version + 1,
    status: room.status,
    visibility: room.visibility,
    player_count: room.players.filter((p) => !p.bot).length,
    updated_at: new Date().toISOString()
  };
  const { data, error } = await client.from("ravenstone_rooms").update(updated).eq("code", room.code).eq("version", oldRow.version).select("version").maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

async function createRoom(client, body) {
  const mode = body.mode === "practice" ? "practice" : "party";
  const visibility = body.visibility === "public" ? "public" : "private";
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = (mode === "practice" ? "P" : "") + makeToken().slice(0, mode === "practice" ? 4 : 5);
    const room = { code, mode, visibility, status: "lobby", players: [], hostId: null, calls: [], postpones: [], votes: {}, messages: [], deadline: null, case: null, updatedAt: Date.now() };
    const player = { id: uid(), name: String(body.name || "Host").trim().slice(0, 20), token: makeToken(), bot: false, role: null, clues: [], matrix: {}, shares: [], inspected: false, tamperUsed: false };
    room.hostId = player.id; room.players.push(player);
    if (mode === "practice") {
      room.practiceRole = body.practiceRole === "innocent" ? "innocent" : "murderer";
      for (const name of ["Evelyn Vale", "Lord Ashford", "Mira Bell"]) room.players.push({ id: uid(), name, token: "", bot: true, role: null, clues: [], matrix: {}, shares: [], inspected: false, tamperUsed: false });
    }
    const { error } = await client.from("ravenstone_rooms").insert({ code, state: room, version: 1, status: "lobby", visibility, player_count: 1 });
    if (!error) return json({ code, playerId: player.id, token: player.token, mode, host: true, players: cleanPlayers(room) });
    if (error.code !== "23505") throw error;
  }
  return json({ error: "Could not create a room. Please try again." }, 503);
}

async function joinRoom(client, row, room, body) {
  if (room.mode !== "party" || room.status !== "lobby") return json({ error: "That room is not open for guests." }, 409);
  if (room.players.filter((p) => !p.bot).length >= 9) return json({ error: "This room is full." }, 409);
  const name = String(body.name || "Guest").trim().slice(0, 20);
  if (room.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) return json({ error: "That name is already at the manor." }, 409);
  const player = { id: uid(), name, token: makeToken(), bot: false, role: null, clues: [], matrix: {}, shares: [], inspected: false, tamperUsed: false };
  room.players.push(player);
  const saved = await persist(client, row, room);
  if (!saved) return json({ error: "The room changed at the same time. Please try joining again." }, 409);
  return json({ code: room.code, playerId: player.id, token: player.token, mode: room.mode, host: false, players: cleanPlayers(room) });
}

function view(room, player) {
  return {
    code: room.code, status: room.status, mode: room.mode, visibility: room.visibility, players: cleanPlayers(room),
    me: { id: player.id, name: player.name, role: player.role, clues: player.clues.map((c) => ({ id: c.id, category: c.category, text: c.text, sharedBy: c.sharedBy, inspection: c.inspection })), inspected: player.inspected, shareCount: player.shares.length, tamperUsed: Boolean(player.tamperUsed) },
    messages: (room.messages || []).filter((m) => m.from === player.id || m.to === player.id).slice(-100),
    matrix: player.matrix || {}, secondsLeft: room.status === "investigation" ? Math.max(0, Math.ceil((room.deadline - Date.now()) / 1000)) : 600,
    calls: room.calls.length, postpones: room.postpones.length, votesSubmitted: Object.keys(room.votes).length,
    canStart: player.id === room.hostId && (room.mode === "practice" || room.players.filter((p) => !p.bot).length >= 3),
    caseReveal: room.status === "results" ? { killer: room.case.killer, weapon: room.case.weapon, key: room.case.key, altered: room.case.altered, tally: room.case.tally, winner: room.case.winner } : null
  };
}

function makeCase(room) {
  const humans = room.players.filter((p) => !p.bot), bots = room.players.filter((p) => p.bot);
  const killer = room.mode === "practice" ? (room.practiceRole === "murderer" ? humans[0] : pick(bots)) : pick(humans);
  for (const p of room.players) p.role = p.id === killer.id ? "murderer" : "innocent";
  const weapon = pick(["knife", "gun", "poison"]);
  const key = ["Motive", "Means", "Opportunity"].map((category) => ({ category, text: category === "Means" ? (weapon === "poison" ? `${killer.name} knew where the household poisons were kept.` : weapon === "gun" ? `${killer.name} had a gun in their luggage.` : `${killer.name} knew Cheryl hid a private knife beneath her bed.`) : fact(category, killer.name).text }));
  room.case = { killer: killer.id, weapon, key, altered: [], tally: {}, winner: null };
  for (const p of room.players) {
    const own = key.filter((c) => c.text.startsWith(p.name + " ")).map((c) => ({ id: uid(), category: c.category, text: c.text, original: null }));
    const extras = [fact("Counter", p.name), fact(p.id === killer.id ? "Red" : "Motive", p.name)];
    while (own.length + extras.length < 4) extras.push(fact(p.id === killer.id ? "Red" : pick(["Counter", "Red", "Motive", "Means", "Opportunity"]), p.name));
    p.clues = [...own, ...extras].slice(0, 4);
  }
  if (room.mode === "practice" && room.practiceRole === "innocent") {
    const botKiller = bots.find((p) => p.id === killer.id);
    const target = humans[0];
    const clue = botKiller?.clues.find((c) => !["Counter", "Red"].includes(c.category)) || botKiller?.clues[0];
    if (clue && target) {
      const from = clue.text;
      clue.category = "Opportunity";
      clue.original = from;
      clue.text = target.name + " was seen near Cheryl's bedroom around the time of the murder.";
      room.case.altered.push({ from, to: clue.text });
    }
  }
  if (room.mode === "practice") for (const bot of bots) {
    const sample = bot.id === killer.id ? (bot.clues.find((c) => c.original) || pick(bot.clues)) : pick(bot.clues);
    room.players[0].clues.push({ ...sample, sharedBy: bot.name });
  }
  room.case.killerName = killer.name; room.status = "investigation"; room.deadline = Date.now() + 600000; room.calls = []; room.postpones = []; room.votes = {};
}

function act(room, player, action) {
  if (action.type === "message") {
    if (!["lobby", "investigation", "voting"].includes(room.status)) return { error: "Private messages are closed for this round." };
    const target = room.players.find((p) => p.id === action.target && !p.bot && p.id !== player.id);
    const text = String(action.text || "").trim().slice(0, 500);
    if (!target) return { error: "Choose another human guest for your private message." };
    if (!text) return { error: "Type a message before sending." };
    room.messages ||= [];
    room.messages.push({ id: uid(), from: player.id, to: target.id, text, createdAt: Date.now() });
    if (room.messages.length > 300) room.messages.splice(0, room.messages.length - 300);
    return {};
  }
  if (action.type === "tamper") {
    if (room.status !== "investigation") return { error: "Evidence can only be altered during the investigation." };
    if (player.role !== "murderer") return { error: "Only the murderer can alter evidence." };
    if (player.tamperUsed) return { error: "You have already altered a clue this round." };
    const clue = player.clues.find((c) => c.id === action.clueId && !c.sharedBy && !c.original);
    const target = room.players.find((p) => p.id === action.target && p.id !== player.id);
    if (!clue || !target) return { error: "Choose one of your clues and another guest to frame." };
    const category = ["Means", "Motive", "Opportunity"].includes(clue.category) ? clue.category : pick(["Means", "Motive", "Opportunity"]);
    const from = clue.text;
    clue.original = from;
    clue.category = category;
    clue.text = target.name + " " + pick(banks[category]);
    room.case.altered.push({ from, to: clue.text });
    player.tamperUsed = true;
    return {};
  }
  if (action.type === "start") {
    if (player.id !== room.hostId || room.status !== "lobby" || (room.mode === "party" && room.players.filter((p) => !p.bot).length < 3)) return { error: "The host can begin once three guests have joined." };
    makeCase(room); return {};
  }
  if (action.type === "matrix") { player.matrix[action.suspect] ||= {}; player.matrix[action.suspect][action.category] = action.value; return {}; }
  if (action.type === "share") {
    if (player.shares.length >= 2) return { error: "You have used both direct shares." };
    const target = room.players.find((p) => p.id === action.target && !p.bot), clue = player.clues.find((c) => c.id === action.clueId);
    if (!target || !clue || target.id === player.id) return { error: "Choose a guest and one of your clues." };
    player.shares.push(clue.id); target.clues.push({ ...clue, sharedBy: player.name }); return {};
  }
  if (action.type === "inspect") {
    if (player.inspected) return { error: "Your inspection has already been used." };
    const clue = player.clues.find((c) => c.id === action.clueId); if (!clue) return { error: "That clue is not in your evidence." };
    player.inspected = true; clue.inspection = clue.original ? { tampered: true, original: clue.original } : { tampered: false }; return {};
  }
  if (action.type === "callVote") {
    if (room.status !== "investigation" || room.calls.includes(player.id)) return { error: "You cannot call a vote right now." };
    room.calls.push(player.id); if (room.mode === "practice") room.calls.push(room.players.find((p) => p.bot).id);
    if (room.calls.length >= 2) room.status = "voting"; return {};
  }
  if (action.type === "postpone") {
    if (room.status !== "voting" || room.postpones.includes(player.id)) return { error: "You cannot postpone right now." };
    room.postpones.push(player.id); if (room.mode === "practice") room.postpones.push(room.players.find((p) => p.bot).id);
    if (room.postpones.length >= 2 && Date.now() < room.deadline) { room.status = "investigation"; room.calls = []; room.postpones = []; } return {};
  }
  if (action.type === "vote") {
    if (room.status !== "voting" || !room.players.some((p) => p.id === action.target)) return { error: "Voting is not open or that suspect is invalid." };
    room.votes[player.id] = action.target;
    if (room.mode === "practice") {
      const bots = room.players.filter((p) => p.bot), decoys = room.players.filter((p) => p.id !== room.case.killer && p.id !== player.id);
      bots.forEach((bot, i) => { room.votes[bot.id] = room.practiceRole === "murderer" ? decoys[i % decoys.length]?.id || room.case.killer : (i === 0 ? room.case.killer : decoys[i - 1]?.id || room.case.killer); });
    }
    if (Object.keys(room.votes).length >= room.players.length) {
      room.case.tally = {}; for (const target of Object.values(room.votes)) room.case.tally[target] = (room.case.tally[target] || 0) + 1;
      const max = Math.max(...Object.values(room.case.tally)); room.case.winner = room.case.tally[room.case.killer] >= max ? "investigators" : "murderer"; room.status = "results";
    }
    return {};
  }
  return { error: "Unknown action." };
}
