const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const pick = (items) => items[Math.floor(Math.random() * items.length)];
const id = () => crypto.randomUUID();
const token = () => Array.from(crypto.getRandomValues(new Uint8Array(24)), (n) => alphabet[n % alphabet.length]).join("");
const json = (data, status = 200) => Response.json(data, { status, headers: { "cache-control": "no-store" } });

const evidenceBank = {
  Motive: ["was due to inherit Cheryl's estate.", "had been locked in a defamation lawsuit with Cheryl.", "learned Cheryl changed her will last week.", "never forgave Cheryl for her memoir.", "believed Cheryl had stolen from them.", "had recently fallen out with Cheryl over a business deal."],
  Means: ["always kept a knife close at hand.", "had a gun in their luggage.", "knew where the manor kept its weapons.", "knew Cheryl hid a private knife beneath her bed.", "had studied toxicology and knew how poisons worked.", "knew where the household poisons were kept."],
  Opportunity: ["was seen outside Cheryl's bedroom shortly before she was found.", "appeared on camera in the hallway just before the murder.", "had fingerprints on a glass inside Cheryl's room.", "knew how to pick the old manor locks.", "had been expected to speak with Cheryl after dinner.", "was staying in the room next to Cheryl's."],
  Counter: ["had been on better terms with Cheryl than ever.", "had a written apology from Cheryl.", "stood to benefit more from Cheryl being alive.", "had a broken leg and could not climb the stairs.", "fell asleep on the sitting-room couch.", "was speaking with another guest in the drawing room all evening.", "was seen in the library throughout the murder.", "arrived at the manor after the time of death."],
  Red: ["Cheryl said she was going to ruin them.", "Cheryl called them her least favorite friend.", "Cheryl took them shooting last week.", "Cheryl tried to seduce them, but they refused.", "Cheryl had increased her life insurance by fifty percent.", "they and Cheryl had become secretive lately.", "Cheryl owed them ten thousand dollars.", "Cheryl once said that if she died, blame another guest."]
};
const clue = (category, player) => ({ id: id(), category, text: `${player} ${pick(evidenceBank[category])}`, original: null });
const blankRoom = (code, settings) => ({ code, status: "lobby", mode: settings.mode, visibility: settings.visibility, createdAt: Date.now(), hostId: null, players: [], secondsLeft: 600, case: null, calls: [], postpones: [], votes: {}, readyVote: false });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      try {
        if (url.pathname === "/api/public" && request.method === "GET") {
          const stub = env.ROOMS.get(env.ROOMS.idFromName("__lobby__"));
          return stub.fetch("https://room/list");
        }
        if (url.pathname === "/api/rooms" && request.method === "POST") {
          const body = await request.json();
          const settings = { mode: body.mode === "practice" ? "practice" : "party", visibility: body.visibility === "public" ? "public" : "private" };
          const roomCode = settings.mode === "practice" ? `P${token().slice(0, 4)}` : token().slice(0, 5);
          const stub = env.ROOMS.get(env.ROOMS.idFromName(roomCode));
          return stub.fetch("https://room/create", { method: "POST", body: JSON.stringify({ ...body, ...settings, code: roomCode }) });
        }
        const route = url.pathname.match(/^\/api\/rooms\/([A-Z0-9]+)\/(join|socket|action|state)$/);
        if (route) {
          const stub = env.ROOMS.get(env.ROOMS.idFromName(route[1]));
          const headers = new Headers(request.headers);
          headers.set("x-room-code", route[1]);
          return stub.fetch(new Request(`https://room/${route[2]}${url.search}`, { method: request.method, headers, body: request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer() }));
        }
        return json({ error: "Not found" }, 404);
      } catch (error) {
        return json({ error: error.message || "Something went wrong." }, 400);
      }
    }
    if (url.pathname === "/") return env.ASSETS.fetch(new Request(new URL("/play.html", request.url), request));
    return env.ASSETS.fetch(request);
  }
};

export class GameRoom {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; this.sockets = new Map(); }
  async getRoom() { return (await this.ctx.storage.get("room")) || null; }
  async save(room) { await this.ctx.storage.put("room", room); }
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/create" && request.method === "POST") return this.create(await request.json());
    if (url.pathname === "/list") return this.list();
    if (url.pathname === "/upsert" && request.method === "POST") {
      const item = await request.json(), rooms = (await this.ctx.storage.get("rooms")) || {};
      rooms[item.code] = item; await this.ctx.storage.put("rooms", rooms); return json({ ok: true });
    }
    if (url.pathname === "/join" && request.method === "POST") return this.join(await request.json());
    if (url.pathname === "/state") return this.state(request);
    if (url.pathname === "/action" && request.method === "POST") return this.action(request, await request.json());
    if (url.pathname === "/socket") return this.socket(request, url);
    return json({ error: "Not found" }, 404);
  }
  async create(body) {
    let room = await this.getRoom();
    if (room && room.status !== "closed") return json({ error: "That room code is already in use." }, 409);
    room = blankRoom(body.code, { mode: body.mode, visibility: body.visibility });
    const host = { id: id(), name: String(body.name || "Host").slice(0, 20), token: token(), bot: false, role: null, clues: [], inspected: false, shares: [] };
    room.hostId = host.id;
    room.players.push(host);
    if (room.mode === "practice") {
      room.practiceRole = body.practiceRole === "innocent" ? "innocent" : "murderer";
      for (let i = 0; i < 3; i++) room.players.push({ id: id(), name: ["Evelyn Vale", "Lord Ashford", "Mira Bell", "Dr. Wren"][i], token: "", bot: true, role: null, clues: [], inspected: false, shares: [] });
    }
    await this.save(room);
    if (room.visibility === "public" && room.mode === "party") await this.updatePublic(room);
    return json({ code: room.code, playerId: host.id, token: host.token, mode: room.mode, host: true, players: this.publicPlayers(room) });
  }
  async join(body) {
    const room = await this.getRoom();
    if (!room || room.status !== "lobby" || room.mode !== "party") return json({ error: "That room is not open for new guests." }, 404);
    if (room.players.length >= 9) return json({ error: "This room is full." }, 409);
    const name = String(body.name || "Guest").trim().slice(0, 20);
    if (room.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) return json({ error: "That name is already at the manor." }, 409);
    const player = { id: id(), name, token: token(), bot: false, role: null, clues: [], inspected: false, shares: [] };
    room.players.push(player);
    await this.save(room);
    if (room.visibility === "public") await this.updatePublic(room);
    this.broadcast(room);
    return json({ code: room.code, playerId: player.id, token: player.token, mode: room.mode, host: false, players: this.publicPlayers(room) });
  }
  publicPlayers(room) { return room.players.filter((p) => !p.bot).map((p) => ({ id: p.id, name: p.name, host: p.id === room.hostId })); }
  async auth(request, room) {
    const auth = request.headers.get("authorization") || "";
    const session = auth.replace(/^Bearer\s+/i, "");
    return room?.players.find((p) => p.token && p.token === session) || null;
  }
  view(room, player) {
    const now = Date.now();
    if (room.status === "investigation" && room.deadline) room.secondsLeft = Math.max(0, Math.ceil((room.deadline - now) / 1000));
    return { code: room.code, status: room.status, mode: room.mode, visibility: room.visibility, players: room.players.map((p) => ({ id: p.id, name: p.name, host: p.id === room.hostId, bot: p.bot })), me: { id: player.id, name: player.name, role: player.role, clues: player.clues, inspected: player.inspected, shareCount: player.shares.length }, matrix: player.matrix || {}, secondsLeft: room.secondsLeft, calls: room.calls.length, postpones: room.postpones.length, votesSubmitted: Object.keys(room.votes).length, canStart: player.id === room.hostId && room.players.filter((p) => !p.bot).length >= 3, caseReveal: room.status === "results" ? { killer: room.case.killer, weapon: room.case.weapon, key: room.case.key, altered: room.case.altered, tally: room.case.tally, winner: room.case.winner } : null };
  }
  async state(request) {
    const room = await this.getRoom(); const player = await this.auth(request, room);
    if (!room || !player) return json({ error: "Room session expired. Rejoin the room." }, 401);
    if (room.status === "investigation" && room.deadline && Date.now() >= room.deadline) { room.status = "voting"; room.calls = []; room.postpones = []; await this.save(room); this.broadcast(room); }
    return json(this.view(room, player));
  }
  async action(request, action) {
    const room = await this.getRoom(); const player = await this.auth(request, room);
    if (!room || !player) return json({ error: "Room session expired. Rejoin the room." }, 401);
    if (action.type === "start") {
      if (player.id !== room.hostId || room.status !== "lobby" || room.players.filter((p) => !p.bot).length < 3) return json({ error: "The host can begin once three guests have joined." }, 400);
      this.makeCase(room); room.status = "investigation"; room.deadline = Date.now() + 600000;
      await this.save(room); this.broadcast(room); return json(this.view(room, player));
    }
    if (action.type === "matrix") { player.matrix ||= {}; player.matrix[action.suspect] ||= {}; player.matrix[action.category] = action.value; await this.save(room); this.broadcast(room); return json({ ok: true }); }
    if (action.type === "share") {
      if (player.shares.length >= 2) return json({ error: "You have used both direct shares." }, 400);
      const target = room.players.find((p) => p.id === action.target && !p.bot);
      const owned = player.clues.find((c) => c.id === action.clueId);
      if (!target || !owned || target.id === player.id) return json({ error: "Choose a guest and one of your clues." }, 400);
      player.shares.push(action.clueId); target.clues.push({ ...owned, sharedBy: player.name }); await this.save(room); this.broadcast(room); return json({ ok: true });
    }
    if (action.type === "inspect") {
      if (player.inspected) return json({ error: "Your inspection has already been used." }, 400);
      const owned = player.clues.find((c) => c.id === action.clueId);
      if (!owned) return json({ error: "That clue is not in your evidence." }, 400);
      player.inspected = true; owned.inspection = owned.original ? { tampered: true, original: owned.original } : { tampered: false };
      await this.save(room); this.broadcast(room); return json({ ok: true });
    }
    if (action.type === "callVote") {
      if (room.status !== "investigation" || room.calls.includes(player.id)) return json({ error: "You cannot call a vote right now." }, 400);
      room.calls.push(player.id);
      if (room.mode === "practice") for (const bot of room.players.filter((p) => p.bot).slice(0, 1)) room.calls.push(bot.id);
      if (room.calls.length >= 2) room.status = "voting";
    } else if (action.type === "postpone") {
      if (room.status !== "voting" || room.postpones.includes(player.id)) return json({ error: "You cannot postpone right now." }, 400);
      room.postpones.push(player.id);
      if (room.mode === "practice") for (const bot of room.players.filter((p) => p.bot).slice(0, 1)) room.postpones.push(bot.id);
      if (room.postpones.length >= 2 && Date.now() < room.deadline) { room.status = "investigation"; room.calls = []; room.postpones = []; }
    } else if (action.type === "vote") {
      if (room.status !== "voting" || !room.players.some((p) => p.id === action.target)) return json({ error: "Voting is not open or that suspect is invalid." }, 400);
      room.votes[player.id] = action.target;
      this.botVotes(room);
      if (Object.keys(room.votes).length >= room.players.length) this.finish(room);
    } else return json({ error: "Unknown action." }, 400);
    await this.save(room); this.broadcast(room); return json(this.view(room, player));
  }
  makeCase(room) {
    const humans = room.players.filter((p) => !p.bot), bots = room.players.filter((p) => p.bot);
    const killer = room.mode === "practice" ? (room.practiceRole === "murderer" ? humans[0] : pick(bots)) : pick(humans);
    for (const p of room.players) p.role = p.id === killer.id ? "murderer" : "innocent";
    const methods = ["knife", "gun", "poison"], weapon = pick(methods);
    const categories = ["Motive", "Means", "Opportunity"];
    const key = categories.map((category) => {
      let text;
      if (category === "Means") text = weapon === "poison" ? `${killer.name} knew where the household poisons were kept.` : weapon === "gun" ? `${killer.name} had a gun in their luggage.` : `${killer.name} knew Cheryl hid a private knife beneath her bed.`;
      else text = clue(category, killer.name).text;
      return { category, text };
    });
    room.case = { killer: killer.id, weapon, key, altered: [], tally: {}, winner: null };
    for (const p of room.players) {
      const own = key.filter((c) => c.text.startsWith(p.name + " ")).map((c) => ({ id: id(), category: c.category, text: c.text, original: null }));
      const other = [clue("Counter", p.name), clue(p.id === killer.id ? "Red" : "Motive", p.name)];
      while (own.length + other.length < 4) other.push(clue(p.id === killer.id ? "Red" : pick(["Counter", "Red", "Motive", "Means", "Opportunity"]), p.name));
      p.clues = [...own, ...other].slice(0, 4);
      p.matrix = {};
    }
    const framed = humans.find((p) => p.id !== killer.id) || bots.find((p) => p.id !== killer.id);
    const ownEvidence = killer.clues.find((c) => c.category !== "Counter" && c.category !== "Red");
    if (ownEvidence && framed) {
      ownEvidence.original = ownEvidence.text; ownEvidence.text = `${framed.name} was seen outside Cheryl's bedroom shortly before she was found.`;
      room.case.altered.push({ playerId: killer.id, clueId: ownEvidence.id, from: ownEvidence.original, to: ownEvidence.text });
    }
    const frameEvidence = framed?.clues.find((c) => !c.original && c.category !== "Counter");
    if (frameEvidence) { frameEvidence.original = frameEvidence.text; frameEvidence.text = `${framed.name} appeared on camera in the hallway just before the murder.`; room.case.altered.push({ playerId: framed.id, clueId: frameEvidence.id, from: frameEvidence.original, to: frameEvidence.text }); }
    for (const p of room.players) if (p.bot) p.botState = "deduces";
  }
  botVotes(room) {
    const humans = room.players.filter((p) => !p.bot), bots = room.players.filter((p) => p.bot);
    for (const bot of bots) if (!room.votes[bot.id]) {
      let target = room.case.killer;
      if (room.mode === "practice" && room.practiceRole === "innocent" && bot !== bots[0]) {
        const decoys = room.players.filter((p) => p.id !== room.case.killer && p.id !== humans[0].id);
        target = decoys[bots.indexOf(bot) - 1] || room.case.killer;
      }
      room.votes[bot.id] = (target || humans[0]).id;
    }
  }
  finish(room) {
    room.case.tally = {};
    for (const target of Object.values(room.votes)) room.case.tally[target] = (room.case.tally[target] || 0) + 1;
    const max = Math.max(...Object.values(room.case.tally), 0), winners = Object.keys(room.case.tally).filter((p) => room.case.tally[p] === max);
    room.case.winner = winners.includes(room.case.killer) ? "investigators" : "murderer";
    room.status = "results";
  }
  async updatePublic(room) {
    const stub = this.env.ROOMS.get(this.env.ROOMS.idFromName("__lobby__"));
    await stub.fetch("https://room/upsert", { method: "POST", body: JSON.stringify({ code: room.code, count: room.players.filter((p) => !p.bot).length, status: room.status, at: Date.now() }) });
  }
  async list() {
    const entries = (await this.ctx.storage.get("rooms")) || {};
    for (const [code, item] of Object.entries(entries)) if (item.status !== "lobby" || Date.now() - item.at > 3600000) delete entries[code];
    await this.ctx.storage.put("rooms", entries);
    return json({ rooms: Object.values(entries).filter((r) => r.count < 9).sort((a, b) => b.at - a.at) });
  }
  async broadcast(room) {
    if (room.visibility === "public" && room.mode === "party") await this.updatePublic(room);
    for (const ws of this.ctx.getWebSockets()) {
      const attached = ws.deserializeAttachment(); const player = room.players.find((p) => p.id === attached?.playerId);
      if (player) try { ws.send(JSON.stringify({ type: "state", state: this.view(room, player) })); } catch { }
    }
  }
  async socket(request, url) {
    const room = await this.getRoom(); const session = url.searchParams.get("token");
    const player = room?.players.find((p) => p.token && p.token === session);
    if (!room || !player || request.headers.get("upgrade") !== "websocket") return json({ error: "Invalid room connection." }, 401);
    const pair = new WebSocketPair(); const [client, server] = Object.values(pair);
    server.accept(); server.serializeAttachment({ playerId: player.id }); server.send(JSON.stringify({ type: "state", state: this.view(room, player) }));
    server.addEventListener("close", () => {});
    return new Response(null, { status: 101, webSocket: client });
  }
}
