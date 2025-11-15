// server.js
// Imposer Word game server (WebSocket)
// - Fixes duplicate player entry on join by not broadcasting `playerJoined` to the joining client.
// - Simple in-memory lobby management suitable for local testing / small deployments.

const http = require('http');
const WebSocket = require('ws');
const crypto = require('crypto');

const PORT = process.env.PORT || 8080;
const CLUE_SECONDS = 45;
const DISCUSSION_SECONDS = 30;
const VOTE_SECONDS = 30;

const WORDS = [
  'apple','ocean','mountain','piano','rocket','coffee','forest','castle',
  'river','guitar','banana','dragon','island','mirror','sunset','planet'
];

// In-memory lobbies
// lobbies[roomId] = {
//   players: Map(playerId -> { ws, id, name, ready, score }),
//   hostId, started, word, impostorId, firstClueGiverId,
//   clues: [{from, text}], votesByVoter: Map(voterId -> votedId), phase
// }
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

// Broadcast to everyone in a room except the player with excludeId
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
  // send to all connected clients
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

  // send assigned id
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

    // remove player
    room.players.delete(ws._id);

    // notify remaining players (exclude the closed socket)
    broadcastToRoomExcept(ws._room, { type: 'playerLeft', room: ws._room, id: ws._id }, ws._id);
    broadcastLobbyCounts();

    // reassign host if needed
    if (room.hostId === ws._id) {
      const next = room.players.keys().next();
      room.hostId = next.done ? null : next.value;
      // notify remaining players of new host / lobby info
      broadcastToRoom(ws._room, { type: 'lobbyInfo', room: ws._room, count: room.players.size });
    }

    // cleanup empty room
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
        firstClueGiverId: null,
        clues: [],
        votesByVoter: new Map(),
        phase: 'lobby'
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

    // send joined to the joining client (full current players list)
    const playersArr = Array.from(room.players.values()).map(p => ({ id: p.id, name: p.name, ready: p.ready, score: p.score }));
    send(ws, { type: 'joined', room: roomId, hostId: room.hostId, players: playersArr });

    // broadcast playerJoined to others in the room (exclude the joining client to avoid duplicate)
    broadcastToRoomExcept(roomId, { type: 'playerJoined', room: roomId, player: { id: ws._id, name, ready: false, score: 0 } }, ws._id);

    // update lobby counts globally
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

    // notify remaining players (exclude leaving client)
    broadcastToRoomExcept(roomId, { type: 'playerLeft', room: roomId, id: ws._id }, ws._id);
    broadcastLobbyCounts();

    if (room.players.size === 0) {
      delete lobbies[roomId];
      broadcastLobbyCounts();
    } else if (room.hostId === ws._id) {
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

    // initialize round
    room.started = true;
    room.word = WORDS[Math.floor(Math.random() * WORDS.length)];
    const ids = Array.from(room.players.keys());
    room.impostorId = ids[Math.floor(Math.random() * ids.length)];
    room.firstClueGiverId = ids[Math.floor(Math.random() * ids.length)];
    room.clues = [];
    room.votesByVoter = new Map();
    room.phase = 'clue';

    // build roles array (role text is either 'IMPOSTOR' or the secret word)
    const roles = ids.map(id => ({ id, role: id === room.impostorId ? 'IMPOSTOR' : room.word }));

    // broadcast gameStarted (clients will display only their own role)
    broadcastToRoom(roomId, {
      type: 'gameStarted',
      roles,
      firstClueGiverId: room.firstClueGiverId,
      seconds: CLUE_SECONDS,
      playersCount: room.players.size
    });

    return;
  }

  if (type === 'clue') {
    const roomId = ws._room;
    if (!roomId) return;
    const room = lobbies[roomId];
    if (!room) return;
    if (room.phase !== 'clue') { send(ws, { type: 'error', message: 'Not in clue phase' }); return; }
    if (ws._id !== room.firstClueGiverId) { send(ws, { type: 'error', message: 'Not your turn to give a clue' }); return; }

    const text = (data.text || '').slice(0, 200);
    room.clues.push({ from: ws._id, text });

    // broadcast the clue to everyone (including the clue-giver)
    broadcastToRoom(roomId, { type: 'clueReceived', from: ws._id, text, count: room.clues.length, total: 1 });

    // move to discussion -> voting automatically
    room.phase = 'discussion';

    // small delay to ensure clients process the clue
    setTimeout(() => {
      broadcastToRoom(roomId, { type: 'cluePhaseEnded' });
      broadcastToRoom(roomId, { type: 'discussionStarted', seconds: DISCUSSION_SECONDS });

      // after discussion, start voting
      setTimeout(() => {
        room.phase = 'vote';
        broadcastToRoom(roomId, { type: 'votingStarted', seconds: VOTE_SECONDS });
      }, DISCUSSION_SECONDS * 1000);

    }, 800);

    return;
  }

  if (type === 'voteImpostor') {
    const roomId = ws._room;
    if (!roomId) return;
    const room = lobbies[roomId];
    if (!room) return;
    if (room.phase !== 'vote') { send(ws, { type: 'error', message: 'Not in voting phase' }); return; }

    const votedId = data.votedId;
    if (!room.players.has(votedId)) { send(ws, { type: 'error', message: 'Invalid vote target' }); return; }

    // record or update vote
    room.votesByVoter.set(ws._id, votedId);
    send(ws, { type: 'voteReceived', from: ws._id });

    // if all players have voted, tally immediately
    if (room.votesByVoter.size >= room.players.size) {
      // tally
      const tally = {};
      for (const voted of room.votesByVoter.values()) tally[voted] = (tally[voted] || 0) + 1;

      // compute who voted for impostor (we can award points to voters who voted correctly)
      const impostorId = room.impostorId;
      const votersWhoPickedImpostor = [];
      for (const [voter, voted] of room.votesByVoter.entries()) {
        if (voted === impostorId) votersWhoPickedImpostor.push(voter);
      }

      // scoring:
      // - each voter who correctly picked the impostor gets +1
      // - if nobody picked the impostor, impostor gets +1
      if (votersWhoPickedImpostor.length > 0) {
        for (const voterId of votersWhoPickedImpostor) {
          const p = room.players.get(voterId);
          if (p) p.score = (p.score || 0) + 1;
        }
      } else {
        const imp = room.players.get(impostorId);
        if (imp) imp.score = (imp.score || 0) + 1;
      }

      // prepare results array
      const results = [];
      for (const [id, p] of room.players) {
        results.push({
          id,
          name: p.name,
          votes: tally[id] || 0,
          wasImpostor: id === impostorId,
          score: p.score || 0
        });
      }

      // broadcast round results
      broadcastToRoom(roomId, { type: 'roundResults', results });

      // end of game for this simple server: send gameOver with standings
      const standings = Array.from(room.players.values())
        .sort((a, b) => (b.score || 0) - (a.score || 0))
        .map(p => ({ id: p.id, name: p.name, score: p.score || 0 }));

      setTimeout(() => {
        broadcastToRoom(roomId, { type: 'gameOver', standings });

        // reset lobby state for next game
        room.started = false;
        room.word = null;
        room.impostorId = null;
        room.firstClueGiverId = null;
        room.clues = [];
        room.votesByVoter = new Map();
        room.phase = 'lobby';
        // reset ready flags (players keep their scores)
        for (const [, p] of room.players) p.ready = false;
        broadcastToRoom(roomId, { type: 'lobbyInfo', room: roomId, count: room.players.size });
      }, 1200);
    }

    return;
  }

  // unknown type -> ignore
}

// start server
server.listen(PORT, () => {
  console.log(`Impostor Word server listening on port ${PORT}`);
});
