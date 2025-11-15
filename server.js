// server.js
// Imposer Word game server (WebSocket)
// - Full game loop: reveal roles, repeated clue rounds, voting, ejection, continue until impostor ejected or 2 players left.
// - Players who are ejected become spectators and cannot submit clues or vote.

const http = require('http');
const WebSocket = require('ws');
const crypto = require('crypto');

const PORT = process.env.PORT || 8080;
const REVEAL_SECONDS = 5;
const CLUE_SECONDS = 45;
const VOTE_SECONDS = 30;
const DISCUSSION_SECONDS = 0; // not used separately here

const WORDS = [
  'apple','ocean','mountain','piano','rocket','coffee','forest','castle',
  'river','guitar','banana','dragon','island','mirror','sunset','planet'
];

const lobbies = {}; // in-memory

function makeId() { return crypto.randomBytes(6).toString('hex'); }
function send(ws, obj) { try { ws.send(JSON.stringify(obj)); } catch (e) {} }
function broadcastToRoom(roomId, obj) {
  const room = lobbies[roomId];
  if (!room) return;
  for (const [, p] of room.players) {
    send(p.ws, obj);
  }
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
    const room = lobbies[ws._room];
    if (!room) return;
    room.players.delete(ws._id);
    broadcastToRoomExcept(ws._room, { type: 'playerLeft', room: ws._room, id: ws._id }, ws._id);
    broadcastLobbyCounts();

    // reassign host if needed
    if (room.hostId === ws._id) {
      const next = room.players.keys().next();
      room.hostId = next.done ? null : next.value;
      broadcastToRoom(ws._room, { type: 'lobbyInfo', room: ws._room, count: room.players.size });
    }

    if (room.players.size === 0) {
      delete lobbies[ws._room];
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
        clues: new Map(), // playerId -> text for current round
        votesByVoter: new Map(),
        phase: 'lobby',
        alive: {}, // id -> boolean
        scores: {}
      };
    }
    const room = lobbies[roomId];
    if (room.players.size >= 8) { send(ws, { type: 'error', message: 'Lobby full' }); return; }

    ws._room = roomId;
    ws._name = name;
    ws._ready = false;
    ws._score = 0;

    room.players.set(ws._id, { ws, id: ws._id, name, ready: false, score: 0 });
    if (!room.hostId) room.hostId = ws._id;

    // send joined to the joining client
    const playersArr = Array.from(room.players.values()).map(p => ({ id: p.id, name: p.name, ready: p.ready, score: p.score }));
    send(ws, { type: 'joined', room: roomId, hostId: room.hostId, players: playersArr });

    // broadcast playerJoined to others (exclude joining client)
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
    broadcastToRoomExcept(roomId, { type: 'playerLeft', room: roomId, id: ws._id }, ws._id);
    broadcastLobbyCounts();
    if (room.players.size === 0) delete lobbies[roomId];
    else if (room.hostId === ws._id) {
      room.hostId = room.players.keys().next().value;
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
    const ids = Array.from(room.players.keys());
    room.impostorId = ids[Math.floor(Math.random() * ids.length)];
    room.clues = new Map();
    room.votesByVoter = new Map();
    room.phase = 'reveal';
    room.alive = {};
    room.scores = {};
    ids.forEach(id => { room.alive[id] = true; room.scores[id] = room.players.get(id).score || 0; });

    // build roles array
    const roles = ids.map(id => ({ id, role: id === room.impostorId ? 'IMPOSTOR' : room.word }));

    // broadcast gameStarted (clients will reveal their own role)
    broadcastToRoom(roomId, {
      type: 'gameStarted',
      roles,
      revealSeconds: REVEAL_SECONDS,
      seconds: CLUE_SECONDS
    });

    // after reveal, start first round
    setTimeout(() => {
      startRound(roomId);
    }, REVEAL_SECONDS * 1000 + 200);

    return;
  }

  if (type === 'submitClue') {
    const roomId = ws._room;
    if (!roomId) return;
    const room = lobbies[roomId];
    if (!room || !room.started) return;
    if (!room.alive[ws._id]) { send(ws, { type: 'error', message: 'You are not allowed to submit' }); return; }
    if (room.phase !== 'clue') { send(ws, { type: 'error', message: 'Not in clue phase' }); return; }

    const text = (data.text || '').slice(0, 200);
    room.clues.set(ws._id, text);

    // broadcast clueReceived to all (clues are visible)
    broadcastToRoom(roomId, { type: 'clueReceived', from: ws._id, text, count: room.clues.size, total: countAlive(room) });

    // if all alive players submitted, move to voting
    if (room.clues.size >= countAlive(room)) {
      broadcastToRoom(roomId, { type: 'allCluesSubmitted' });
      // small delay then start voting
      setTimeout(() => {
        room.phase = 'vote';
        room.votesByVoter = new Map();
        broadcastToRoom(roomId, { type: 'votingStarted', players: alivePlayersArray(room), seconds: VOTE_SECONDS });
        // set a timeout to auto-tally if not all votes in
        setTimeout(() => {
          if (room.phase === 'vote') {
            tallyVotesAndProceed(roomId);
          }
        }, VOTE_SECONDS * 1000 + 200);
      }, 600);
    }
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

    // if all alive players voted, tally
    if (room.votesByVoter.size >= countAlive(room)) {
      tallyVotesAndProceed(roomId);
    }
    return;
  }

  // unknown type -> ignore
}

function countAlive(room) {
  return Object.values(room.alive || {}).filter(Boolean).length;
}

function alivePlayersArray(room) {
  return Array.from(room.players.values()).filter(p => room.alive[p.id]).map(p => ({ id: p.id, name: p.name }));
}

function startRound(roomId) {
  const room = lobbies[roomId];
  if (!room) return;
  room.phase = 'clue';
  room.clues = new Map();
  room.votesByVoter = new Map();
  // broadcast roundStarted with alive map
  broadcastToRoom(roomId, {
    type: 'roundStarted',
    seconds: CLUE_SECONDS,
    alive: room.alive
  });

  // set a timeout to auto-move to voting if not all clues in
  setTimeout(() => {
    if (room.phase === 'clue') {
      // proceed to voting even if some didn't submit
      room.phase = 'vote';
      broadcastToRoom(roomId, { type: 'votingStarted', players: alivePlayersArray(room), seconds: VOTE_SECONDS });
      // auto-tally after vote seconds
      setTimeout(() => {
        if (room.phase === 'vote') tallyVotesAndProceed(roomId);
      }, VOTE_SECONDS * 1000 + 200);
    }
  }, CLUE_SECONDS * 1000 + 200);
}

function tallyVotesAndProceed(roomId) {
  const room = lobbies[roomId];
  if (!room) return;
  room.phase = 'results';

  // tally votes
  const tally = {};
  for (const voted of room.votesByVoter.values()) tally[voted] = (tally[voted] || 0) + 1;

  // if no votes, choose random alive to eject
  let ejectId = null;
  if (Object.keys(tally).length === 0) {
    const aliveIds = Object.keys(room.alive).filter(id => room.alive[id]);
    ejectId = aliveIds[Math.floor(Math.random() * aliveIds.length)];
  } else {
    // find max
    let max = -1;
    let top = [];
    for (const id in tally) {
      if (tally[id] > max) { max = tally[id]; top = [id]; }
      else if (tally[id] === max) top.push(id);
    }
    // tie-breaker random among top
    ejectId = top[Math.floor(Math.random() * top.length)];
  }

  const wasImpostor = ejectId === room.impostorId;
  // mark ejected
  room.alive[ejectId] = false;

  // scoring: voters who picked impostor get +1; if nobody picked impostor, impostor gets +1
  const votersWhoPickedImpostor = [];
  for (const [voter, voted] of room.votesByVoter.entries()) {
    if (voted === room.impostorId) votersWhoPickedImpostor.push(voter);
  }
  if (votersWhoPickedImpostor.length > 0) {
    votersWhoPickedImpostor.forEach(voterId => { room.scores[voterId] = (room.scores[voterId] || 0) + 1; });
  } else {
    room.scores[room.impostorId] = (room.scores[room.impostorId] || 0) + 1;
  }

  // prepare results array
  const results = [];
  for (const [id, p] of room.players) {
    results.push({
      id,
      name: p.name,
      votes: tally[id] || 0,
      wasImpostor: id === room.impostorId,
      score: room.scores[id] || 0
    });
    // update stored player score
    p.score = room.scores[id] || p.score;
  }

  // broadcast round results and ejection
  broadcastToRoom(roomId, { type: 'roundResults', results });
  broadcastToRoom(roomId, { type: 'playerEjected', id: ejectId, wasImpostor });

  // check end conditions
  const aliveCount = countAlive(room);
  if (wasImpostor || aliveCount <= 2) {
    // game over
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
      // reset ready flags
      for (const [, p] of room.players) p.ready = false;
      broadcastToRoom(roomId, { type: 'lobbyInfo', room: roomId, count: room.players.size });
    }, 1200);
  } else {
    // continue next round after short delay
    setTimeout(() => {
      startRound(roomId);
    }, 1500);
  }
}

// start server
server.listen(PORT, () => {
  console.log(`Impostor Word server listening on port ${PORT}`);
});
