// server.js
// Turn-based Impostor Word server: one player submits per turn, no duplicates.
// Random player starts; order follows lobby insertion order. Robust advancing on submit/timeout/leave.

const http = require('http');
const WebSocket = require('ws');
const crypto = require('crypto');

const PORT = process.env.PORT || 8080;
const REVEAL_SECONDS = 5;
const CLUE_SECONDS = 30; // per-turn seconds
const VOTE_SECONDS = 30;
const MAX_PLAYERS = 8;

const WORDS = [
  'apple','ocean','mountain','piano','rocket','coffee','forest','castle',
  'river','guitar','banana','dragon','island','mirror','sunset','planet'
];

const lobbies = {};

function makeId() { return crypto.randomBytes(6).toString('hex'); }
function send(ws, obj) { try { ws.send(JSON.stringify(obj)); } catch (e) {} }
function broadcastToRoom(roomId, obj) {
  const room = lobbies[roomId];
  if (!room) return;
  for (const [, p] of room.players) send(p.ws, obj);
}
function broadcastToRoomExcept(roomId, obj, excludeId) {
  const room = lobbies[roomId];
  if (!room) return;
  for (const [, p] of room.players) {
    if (p.id === excludeId) continue;
    send(p.ws, obj);
  }
}
function broadcastLobbyCounts() {
  const arr = Object.keys(lobbies).map(id => ({ id, count: lobbies[id].players.size }));
  wss.clients.forEach(c => {
    if (c.readyState === WebSocket.OPEN) send(c, { type: 'lobbyList', lobbies: arr });
  });
}

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Impostor Word server\n');
});

const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  const id = makeId();
  ws._id = id;
  ws._room = null;
  ws._name = null;
  ws._ready = false;
  ws._score = 0;

  send(ws, { type: 'id', id });

  ws.on('message', (raw) => {
    let data;
    try { data = JSON.parse(raw); } catch (e) { return; }
    handleMessage(ws, data);
  });

  ws.on('close', () => {
    if (!ws._room) return;
    const roomId = ws._room;
    const room = lobbies[roomId];
    if (!room) return;

    // remove player
    room.players.delete(ws._id);
    if (room.alive && room.alive[ws._id] !== undefined) delete room.alive[ws._id];
    if (room.scores && room.scores[ws._id] !== undefined) delete room.scores[ws._id];

    // if it was their turn, mark as submitted and advance
    if (room.started && room.currentTurnId === ws._id) {
      clearTurnTimeout(room);
      room.submittedSet.add(ws._id); // consume their turn
      advanceTurn(roomId);
    }

    // notify remaining players
    broadcastToRoomExcept(roomId, { type: 'playerLeft', room: roomId, id: ws._id }, ws._id);
    broadcastLobbyCounts();

    // reassign host if needed
    if (room.hostId === ws._id) {
      const next = room.players.keys().next();
      room.hostId = next.done ? null : next.value;
      broadcastToRoom(roomId, { type: 'hostChanged', hostId: room.hostId });
      broadcastToRoom(roomId, { type: 'lobbyInfo', room: roomId, count: room.players.size });
    }

    // cleanup empty room
    if (room.players.size === 0) {
      delete lobbies[roomId];
      broadcastLobbyCounts();
    }
  });
});

function handleMessage(ws, data) {
  const type = data.type;

  if (type === 'listLobbies') {
    const arr = Object.keys(lobbies).map(id => ({ id, count: lobbies[id].players.size }));
    send(ws, { type: 'lobbyList', lobbies: arr });
    return;
  }

  if (type === 'join') {
    const roomId = data.room;
    const name = (data.name || 'Player').slice(0, 32);
    if (!roomId) { send(ws, { type: 'error', message: 'Missing room' }); return; }

    if (!lobbies[roomId]) {
      lobbies[roomId] = {
        players: new Map(),
        hostId: null,
        started: false,
        word: null,
        impostorId: null,
        clues: new Map(),
        votesByVoter: new Map(),
        phase: 'lobby',
        alive: {},
        scores: {},
        // turn-related
        turnOrder: [],
        currentTurnIndex: 0,
        currentTurnId: null,
        submittedSet: new Set(),
        turnTimeout: null
      };
    }
    const room = lobbies[roomId];
    if (room.players.size >= MAX_PLAYERS) { send(ws, { type: 'error', message: 'Lobby full' }); return; }

    ws._room = roomId;
    ws._name = name;
    ws._ready = false;
    ws._score = 0;

    room.players.set(ws._id, { ws, id: ws._id, name, ready: false, score: 0 });

    // ensure alive and scores entries exist for this player
    room.alive[ws._id] = true;
    room.scores[ws._id] = room.scores[ws._id] || 0;

    if (!room.hostId) room.hostId = ws._id;

    const playersArr = Array.from(room.players.values()).map(p => ({ id: p.id, name: p.name, ready: p.ready, score: p.score }));
    send(ws, { type: 'joined', room: roomId, hostId: room.hostId, players: playersArr });

    broadcastToRoomExcept(roomId, { type: 'playerJoined', room: roomId, player: { id: ws._id, name, ready: false, score: 0 } }, ws._id);

    broadcastLobbyCounts();
    return;
  }

  if (type === 'leave') {
    const roomId = data.room || ws._room;
    if (!roomId) return;
    const room = lobbies[roomId];
    if (!room) return;

    room.players.delete(ws._id);
    ws._room = null;

    if (room.alive && room.alive[ws._id] !== undefined) delete room.alive[ws._id];
    if (room.scores && room.scores[ws._id] !== undefined) delete room.scores[ws._id];

    if (room.started && room.currentTurnId === ws._id) {
      clearTurnTimeout(room);
      room.submittedSet.add(ws._id);
      advanceTurn(roomId);
    }

    broadcastToRoomExcept(roomId, { type: 'playerLeft', room: roomId, id: ws._id }, ws._id);
    broadcastLobbyCounts();

    if (room.players.size === 0) {
      delete lobbies[roomId];
      broadcastLobbyCounts();
    } else if (room.hostId === ws._id) {
      room.hostId = room.players.keys().next().value;
      broadcastToRoom(roomId, { type: 'hostChanged', hostId: room.hostId });
      broadcastToRoom(roomId, { type: 'lobbyInfo', room: roomId, count: room.players.size });
    }
    return;
  }

  if (type === 'ready' || type === 'unready') {
    const roomId = ws._room;
    if (!roomId) return;
    const room = lobbies[roomId];
    if (!room) return;
    const p = room.players.get(ws._id);
    if (!p) return;
    p.ready = (type === 'ready');
    broadcastToRoom(roomId, { type: p.ready ? 'playerReady' : 'playerUnready', id: ws._id });

    const allReady = Array.from(room.players.values()).every(x => x.ready);
    if (allReady) broadcastToRoom(roomId, { type: 'allReady' });
    return;
  }

  if (type === 'startGame') {
    const roomId = ws._room;
    if (!roomId) return;
    const room = lobbies[roomId];
    if (!room) return;
    if (room.hostId !== ws._id) { send(ws, { type: 'error', message: 'Only host can start' }); return; }
    if (room.players.size < 3) { send(ws, { type: 'error', message: 'Need at least 3 players' }); return; }

    // initialize game
    room.started = true;
    room.word = WORDS[Math.floor(Math.random() * WORDS.length)];
    const ids = Array.from(new Set(Array.from(room.players.keys()))); // de-dup safety
    room.impostorId = ids[Math.floor(Math.random() * ids.length)];
    room.clues = new Map();
    room.votesByVoter = new Map();
    room.phase = 'reveal';

    // ensure alive and scores are set for all players
    ids.forEach(id => {
      room.alive[id] = true;
      room.scores[id] = room.scores[id] || room.players.get(id).score || 0;
    });

    // build roles array
    const roles = ids.map(id => ({ id, role: id === room.impostorId ? 'IMPOSTOR' : room.word }));

    // broadcast gameStarted
    broadcastToRoom(roomId, {
      type: 'gameStarted',
      roles,
      revealSeconds: REVEAL_SECONDS,
      seconds: CLUE_SECONDS
    });

    // prepare turn order and start first turn after reveal
    setTimeout(() => {
      room.turnOrder = Array.from(new Set(Array.from(room.players.keys()))); // fixed order for the round
      room.currentTurnIndex = Math.floor(Math.random() * room.turnOrder.length); // random start
      room.submittedSet = new Set();
      room.currentTurnId = null;
      room.phase = 'clue-turns';
      startTurn(roomId);
    }, REVEAL_SECONDS * 1000 + 200);

    return;
  }

  if (type === 'submitClue') {
    const roomId = ws._room;
    if (!roomId) return;
    const room = lobbies[roomId];
    if (!room || !room.started) return;
    if (!room.alive[ws._id]) { send(ws, { type: 'error', message: 'You are not allowed to submit' }); return; }
    if (room.phase !== 'clue-turns') { send(ws, { type: 'error', message: 'Not in clue phase' }); return; }
    if (room.currentTurnId !== ws._id) { send(ws, { type: 'error', message: 'Not your turn' }); return; }

    const text = (data.text || '').slice(0, 200);
    room.clues.set(ws._id, text);
    room.submittedSet.add(ws._id);

    broadcastToRoom(roomId, { type: 'clueReceived', from: ws._id, text, count: room.submittedSet.size, total: countAlive(room) });

    clearTurnTimeout(room);
    advanceTurn(roomId); // always advance index so this player is not selected again
    return;
  }

  if (type === 'voteImpostor') {
    const roomId = ws._room;
    if (!roomId) return;
    const room = lobbies[roomId];
    if (!room || !room.started) return;
    if (!room.alive[ws._id]) { send(ws, { type: 'error', message: 'You are not allowed to vote' }); return; }
    if (room.phase !== 'vote') { send(ws, { type: 'error', message: 'Not in voting phase' }); return; }

    const votedId = data.votedId;
    if (!room.players.has(votedId) || !room.alive[votedId]) { send(ws, { type: 'error', message: 'Invalid vote target' }); return; }

    room.votesByVoter.set(ws._id, votedId);
    send(ws, { type: 'voteReceived', from: ws._id });

    if (room.votesByVoter.size >= countAlive(room)) {
      tallyVotesAndProceed(roomId);
    }
    return;
  }

  // unknown type -> ignore
}

// helpers for turn flow
function clearTurnTimeout(room) {
  if (!room) return;
  if (room.turnTimeout) {
    clearTimeout(room.turnTimeout);
    room.turnTimeout = null;
  }
}

function startTurn(roomId) {
  const room = lobbies[roomId];
  if (!room) return;

  // End condition: everyone alive has submitted/skipped
  if (room.submittedSet.size >= countAlive(room)) {
    clearTurnTimeout(room);
    room.phase = 'vote';
    room.votesByVoter = new Map();
    broadcastToRoom(roomId, { type: 'allCluesSubmitted' });
    broadcastToRoom(roomId, { type: 'votingStarted', players: playersWithAlive(room), seconds: VOTE_SECONDS });
    room.turnTimeout = setTimeout(() => {
      if (room.phase === 'vote') tallyVotesAndProceed(roomId);
    }, VOTE_SECONDS * 1000 + 200);
    return;
  }

  const n = room.turnOrder.length;
  let attempts = 0;
  while (attempts < n) {
    const idx = room.currentTurnIndex % n;
    const candidateId = room.turnOrder[idx];

    // Must be alive and not already submitted this round
    if (room.alive[candidateId] && !room.submittedSet.has(candidateId)) {
      room.currentTurnId = candidateId;

      // Announce turn
      broadcastToRoom(roomId, {
        type: 'turnStarted',
        id: candidateId,
        seconds: CLUE_SECONDS,
        remaining: countAlive(room) - room.submittedSet.size
      });

      // Timeout -> mark submitted (skipped) and advance past this candidate
      clearTurnTimeout(room);
      room.turnTimeout = setTimeout(() => {
        room.submittedSet.add(candidateId);
        broadcastToRoom(roomId, {
          type: 'clueReceived',
          from: candidateId,
          text: '', // skipped
          count: room.submittedSet.size,
          total: countAlive(room)
        });
        room.currentTurnIndex = (room.currentTurnIndex + 1) % n; // move past candidate
        startTurn(roomId);
      }, CLUE_SECONDS * 1000);

      return;
    }

    // Not valid: advance index and try next
    room.currentTurnIndex = (room.currentTurnIndex + 1) % n;
    attempts++;
  }

  // No valid candidate found -> proceed to voting
  room.phase = 'vote';
  room.votesByVoter = new Map();
  broadcastToRoom(roomId, { type: 'allCluesSubmitted' });
  broadcastToRoom(roomId, { type: 'votingStarted', players: playersWithAlive(room), seconds: VOTE_SECONDS });
  room.turnTimeout = setTimeout(() => {
    if (room.phase === 'vote') tallyVotesAndProceed(roomId);
  }, VOTE_SECONDS * 1000 + 200);
}

function advanceTurn(roomId) {
  const room = lobbies[roomId];
  if (!room) return;
  const n = room.turnOrder.length || 1;
  room.currentTurnIndex = (room.currentTurnIndex + 1) % n; // always move forward
  startTurn(roomId);
}

function countAlive(room) {
  return Object.values(room.alive || {}).filter(Boolean).length;
}
function playersWithAlive(room) {
  return Array.from(room.players.values()).map(p => ({ id: p.id, name: p.name, alive: !!room.alive[p.id] }));
}

function tallyVotesAndProceed(roomId) {
  const room = lobbies[roomId];
  if (!room) return;
  room.phase = 'results';
  clearTurnTimeout(room);

  // tally votes
  const tally = {};
  for (const voted of room.votesByVoter.values()) {
    tally[voted] = (tally[voted] || 0) + 1;
  }

  // choose eject target
  let ejectId = null;
  if (Object.keys(tally).length === 0) {
    const aliveIds = Object.keys(room.alive).filter(id => room.alive[id]);
    ejectId = aliveIds[Math.floor(Math.random() * aliveIds.length)];
  } else {
    let max = -1;
    let top = [];
    for (const id in tally) {
      if (tally[id] > max) { max = tally[id]; top = [id]; }
      else if (tally[id] === max) top.push(id);
    }
    ejectId = top[Math.floor(Math.random() * top.length)];
  }

  const wasImpostor = ejectId === room.impostorId;
  room.alive[ejectId] = false;

  // scoring
  const votersWhoPickedImpostor = [];
  for (const [voter, voted] of room.votesByVoter.entries()) {
    if (voted === room.impostorId) votersWhoPickedImpostor.push(voter);
  }
  if (votersWhoPickedImpostor.length > 0) {
    votersWhoPickedImpostor.forEach(voterId => { room.scores[voterId] = (room.scores[voterId] || 0) + 1; });
  } else {
    room.scores[room.impostorId] = (room.scores[room.impostorId] || 0) + 1;
  }

  // prepare results
  const results = [];
  for (const [id, p] of room.players) {
    results.push({
      id,
      name: p.name,
      votes: tally[id] || 0,
      wasImpostor: id === room.impostorId,
      score: room.scores[id] || 0
    });
    p.score = room.scores[id] || p.score;
  }

  broadcastToRoom(roomId, { type: 'roundResults', results });
  broadcastToRoom(roomId, { type: 'playerEjected', id: ejectId, wasImpostor, alive: { ...room.alive } });

  // end or next round
  const aliveCount = countAlive(room);
  if (wasImpostor || aliveCount <= 2) {
    const standings = Array.from(room.players.values())
      .sort((a, b) => (room.scores[b.id] || 0) - (room.scores[a.id] || 0))
      .map(p => ({ id: p.id, name: p.name, score: room.scores[p.id] || 0 }));
    setTimeout(() => {
      broadcastToRoom(roomId, { type: 'gameOver', standings });
      // reset lobby state
      room.started = false;
      room.word = null;
      room.impostorId = null;
      room.clues = new Map();
      room.votesByVoter = new Map();
      room.phase = 'lobby';
      room.alive = {};
      for (const [, p] of room.players) p.ready = false;
      broadcastToRoom(roomId, { type: 'lobbyInfo', room: roomId, count: room.players.size });
    }, 1200);
  } else {
    // next round: reset submissions and start from the player after ejected
    room.submittedSet = new Set();
    const idx = room.turnOrder.indexOf(ejectId);
    if (idx !== -1) {
      room.currentTurnIndex = (idx + 1) % room.turnOrder.length;
    }
    setTimeout(() => {
      room.phase = 'clue-turns';
      startTurn(roomId);
    }, 1500);
  }
}

server.listen(PORT, () => {
  console.log(`Impostor Word server listening on port ${PORT}`);
});
