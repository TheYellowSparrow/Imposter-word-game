// server.js
// Imposed fixes: correct alive tracking and explicit player/alive payloads for voting.

const http = require('http');
const WebSocket = require('ws');
const crypto = require('crypto');

const PORT = process.env.PORT || 8080;
const REVEAL_SECONDS = 5;
const CLUE_SECONDS = 45;
const VOTE_SECONDS = 30;

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

  // send assigned id immediately
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

    // remove player from room
    room.players.delete(ws._id);

    // remove alive entry and scores entry
    if (room.alive && room.alive[ws._id] !== undefined) delete room.alive[ws._id];
    if (room.scores && room.scores[ws._id] !== undefined) delete room.scores[ws._id];

    // notify remaining players (exclude closed socket)
    broadcastToRoomExcept(roomId, { type: 'playerLeft', room: roomId, id: ws._id }, ws._id);
    broadcastLobbyCounts();

    // reassign host if needed
    if (room.hostId === ws._id) {
      const next = room.players.keys().next();
      room.hostId = next.done ? null : next.value;
      // broadcast host change and updated lobby info
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

    // ensure alive and scores entries exist for this player (not ejected by mistake)
    room.alive[ws._id] = true;
    room.scores[ws._id] = room.scores[ws._id] || 0;

    if (!room.hostId) room.hostId = ws._id;

    // send joined to the joining client (full current players list)
    const playersArr = Array.from(room.players.values()).map(p => ({ id: p.id, name: p.name, ready: p.ready, score: p.score }));
    send(ws, { type: 'joined', room: roomId, hostId: room.hostId, players: playersArr });

    // broadcast playerJoined to others in the room (exclude the joining client)
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

    // remove alive and score entries for leaving player
    if (room.alive && room.alive[ws._id] !== undefined) delete room.alive[ws._id];
    if (room.scores && room.scores[ws._id] !== undefined) delete room.scores[ws._id];

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
    const ids = Array.from(room.players.keys());
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

    // start first round after reveal
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

    broadcastToRoom(roomId, { type: 'clueReceived', from: ws._id, text, count: room.clues.size, total: countAlive(room) });

    if (room.clues.size >= countAlive(room)) {
      broadcastToRoom(roomId, { type: 'allCluesSubmitted' });
      setTimeout(() => {
        room.phase = 'vote';
        room.votesByVoter = new Map();
        // send full players list with alive flags so clients can render voting correctly
        broadcastToRoom(roomId, { type: 'votingStarted', players: playersWithAlive(room), seconds: VOTE_SECONDS });
        setTimeout(() => {
          if (room.phase === 'vote') tallyVotesAndProceed(roomId);
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

function playersWithAlive(room) {
  return Array.from(room.players.values()).map(p => ({ id: p.id, name: p.name, alive: !!room.alive[p.id] }));
}

function alivePlayersArray(room) {
  return Array.from(room.players.values()).filter(p => room.alive[p.id]).map(p => ({ id: p.id, name: p.name, alive: true }));
}

function startRound(roomId) {
  const room = lobbies[roomId];
  if (!room) return;
  room.phase = 'clue';
  room.clues = new Map();
  room.votesByVoter = new Map();

  // broadcast roundStarted with explicit players/alive info
  broadcastToRoom(roomId, {
    type: 'roundStarted',
    seconds: CLUE_SECONDS,
    alive: { ...room.alive },
    players: playersWithAlive(room)
  });

  // auto-move to voting if time expires
  setTimeout(() => {
    if (room.phase === 'clue') {
      room.phase = 'vote';
      broadcastToRoom(roomId, { type: 'votingStarted', players: playersWithAlive(room), seconds: VOTE_SECONDS });
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

  // tally only votes recorded
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
    p.score = room.scores[id] || p.score;
  }

  // broadcast results and ejection (include alive map so clients update correctly)
  broadcastToRoom(roomId, { type: 'roundResults', results });
  broadcastToRoom(roomId, { type: 'playerEjected', id: ejectId, wasImpostor, alive: { ...room.alive } });

  // check end conditions
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
    // continue next round
    setTimeout(() => {
      startRound(roomId);
    }, 1500);
  }
}

server.listen(PORT, () => {
  console.log(`Impostor Word server listening on port ${PORT}`);
});
