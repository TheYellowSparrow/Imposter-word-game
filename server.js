// server.js
// WebSocket lobby + "impostor card" game manager
// Install: npm install express ws
// Run: node server.js
// Listens on process.env.PORT or 1000 by default

const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const PORT = Number(process.env.PORT) || 1000;
const LOBBY_COUNT = 4;
const MAX_PLAYERS = 8;
const WORDS = [
  'planet','ocean','forest','castle','robot','piano','rocket','diamond','shadow','mirror',
  'river','mountain','island','garden','library','bridge','candle','feather','comet','lantern'
];

const app = express();
// If you serve the client from the same server, put files in ./public
app.use(express.static('public'));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Data stores
let nextPlayerId = 1;
const players = new Map(); // playerId -> { id, ws, name, lobbyId, avatar }
const lobbies = Array.from({ length: LOBBY_COUNT }, (_, i) => ({
  id: i + 1,
  players: [],        // array of playerIds
  hostId: null,
  state: 'waiting',   // waiting | in_game | impostor_guess | voting | results
  roles: {},          // playerId -> 'impostor'|'crewmate'
  word: null,
  clues: {},          // playerId -> clue
  votes: {},          // playerId -> targetId
}));

/* Helpers */

function safeSend(ws, obj) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  try { ws.send(JSON.stringify(obj)); } catch (e) { /* ignore */ }
}

function sendToPlayer(playerId, obj) {
  const p = players.get(playerId);
  if (!p || !p.ws) return;
  safeSend(p.ws, obj);
}

function broadcastAll(obj) {
  const s = JSON.stringify(obj);
  wss.clients.forEach(c => {
    if (c.readyState === WebSocket.OPEN) {
      try { c.send(s); } catch (e) {}
    }
  });
}

function sendLobbyList() {
  const list = lobbies.map(l => ({
    id: l.id,
    count: l.players.length,
    maxPlayers: MAX_PLAYERS,
    state: l.state
  }));
  broadcastAll({ type: 'lobby_list', lobbies: list });
}

function sendLobbyUpdate(lobbyId) {
  const l = lobbies.find(x => x.id === lobbyId);
  if (!l) return;
  const lobbyInfo = {
    id: l.id,
    players: l.players.map(pid => {
      const p = players.get(pid);
      return { id: pid, name: p ? p.name : 'Anonymous', avatar: p ? p.avatar || null : null };
    }),
    hostId: l.hostId,
    state: l.state
  };
  l.players.forEach(pid => sendToPlayer(pid, { type: 'lobby_update', lobby: lobbyInfo }));
  sendLobbyList();
}

function choose(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/* Game flow */

function startGame(lobby) {
  if (!lobby) return;
  if (lobby.state !== 'waiting') return;
  if (lobby.players.length < 2) {
    lobby.players.forEach(pid => sendToPlayer(pid, { type: 'error', message: 'Need at least 2 players to start' }));
    return;
  }

  lobby.state = 'in_game';
  lobby.word = choose(WORDS);
  const impostorId = choose(lobby.players);

  lobby.roles = {};
  lobby.players.forEach(pid => {
    lobby.roles[pid] = (pid === impostorId) ? 'impostor' : 'crewmate';
  });

  lobby.clues = {};
  lobby.votes = {};

  // send role messages
  lobby.players.forEach(pid => {
    const role = lobby.roles[pid];
    if (role === 'crewmate') {
      sendToPlayer(pid, { type: 'role', role: 'crewmate', word: lobby.word });
    } else {
      sendToPlayer(pid, { type: 'role', role: 'impostor' });
    }
  });

  sendLobbyUpdate(lobby.id);
}

function checkCluesAndNotify(lobby) {
  if (!lobby) return;
  const crewmates = lobby.players.filter(pid => lobby.roles[pid] === 'crewmate');
  if (crewmates.length === 0) return;
  const allSubmitted = crewmates.every(pid => typeof lobby.clues[pid] === 'string');
  if (!allSubmitted) return;

  const impostorId = lobby.players.find(pid => lobby.roles[pid] === 'impostor');
  const clues = crewmates.map(pid => ({ playerId: pid, clue: lobby.clues[pid] }));
  sendToPlayer(impostorId, { type: 'clues_for_impostor', clues });
  lobby.state = 'impostor_guess';
  sendLobbyUpdate(lobby.id);
}

function tallyVotes(lobby) {
  if (!lobby) return;
  const counts = {};
  Object.values(lobby.votes).forEach(tid => {
    counts[tid] = (counts[tid] || 0) + 1;
  });

  // find highest count(s)
  let max = 0;
  for (const tid in counts) if (counts[tid] > max) max = counts[tid];
  const top = Object.keys(counts).filter(tid => counts[tid] === max);

  let eliminatedId = null;
  if (top.length === 1) eliminatedId = Number(top[0]); // unique top
  // tie => no elimination

  const impostorId = lobby.players.find(pid => lobby.roles[pid] === 'impostor');

  let winner = 'impostor';
  let message = '';
  if (eliminatedId && eliminatedId === impostorId) {
    winner = 'crewmates';
    message = `Impostor was eliminated (${players.get(eliminatedId).name}).`;
  } else {
    winner = 'impostor';
    message = `Impostor survived.`;
  }

  lobby.players.forEach(pid => {
    sendToPlayer(pid, {
      type: 'voting_result',
      winner,
      message,
      eliminatedId: eliminatedId || null,
      eliminatedName: eliminatedId ? players.get(eliminatedId).name : null,
      impostorId
    });
  });

  lobby.state = 'results';
  sendLobbyUpdate(lobby.id);

  // reset to waiting after short delay
  setTimeout(() => {
    lobby.state = 'waiting';
    lobby.word = null;
    lobby.roles = {};
    lobby.clues = {};
    lobby.votes = {};
    sendLobbyUpdate(lobby.id);
  }, 8000);
}

/* Kick helper */
function kickPlayerFromLobby(requesterId, targetId) {
  const requester = players.get(requesterId);
  const target = players.get(targetId);
  if (!requester || !target) return;
  const lobby = lobbies.find(l => l.id === requester.lobbyId);
  if (!lobby) return;
  if (lobby.hostId !== requesterId) {
    sendToPlayer(requesterId, { type: 'error', message: 'Only host can kick players' });
    return;
  }
  if (!lobby.players.includes(targetId)) {
    sendToPlayer(requesterId, { type: 'error', message: 'Target not in lobby' });
    return;
  }

  // remove target from lobby
  lobby.players = lobby.players.filter(x => x !== targetId);
  if (lobby.hostId === targetId) lobby.hostId = lobby.players[0] || null;
  target.lobbyId = null;

  // notify target
  sendToPlayer(targetId, { type: 'kicked', reason: 'Kicked by host' });

  // update lobby
  sendLobbyUpdate(lobby.id);
}

/* WebSocket handling */

wss.on('connection', (ws) => {
  const pid = nextPlayerId++;
  players.set(pid, { id: pid, ws, name: `Player${pid}`, lobbyId: null, avatar: null });
  console.log(`player connected: ${pid}`);

  safeSend(ws, { type: 'connected', playerId: pid });
  sendLobbyList();

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) {
      safeSend(ws, { type: 'error', message: 'Invalid JSON' });
      return;
    }

    const player = players.get(pid);
    if (!player) return;

    switch (msg.type) {
      case 'hello':
        // no-op
        break;

      case 'ping':
        // heartbeat from client; ignore or optionally respond
        break;

      case 'set_username':
        player.name = String(msg.username || '').slice(0, 40) || player.name;
        if (player.lobbyId) sendLobbyUpdate(player.lobbyId);
        break;

      case 'set_avatar':
        player.avatar = msg.avatarUrl ? String(msg.avatarUrl).slice(0, 1000) : null;
        if (player.lobbyId) sendLobbyUpdate(player.lobbyId);
        break;

      case 'request_lobby_list':
        sendLobbyList();
        break;

      case 'join_lobby': {
        const lobbyId = Number(msg.lobbyId);
        const lobby = lobbies.find(l => l.id === lobbyId);
        if (!lobby) { safeSend(ws, { type: 'error', message: 'Invalid lobby' }); break; }
        if (lobby.players.length >= MAX_PLAYERS) { safeSend(ws, { type: 'error', message: 'Lobby full' }); break; }

        // remove from previous lobby if any
        if (player.lobbyId) {
          const prev = lobbies.find(x => x.id === player.lobbyId);
          if (prev) {
            prev.players = prev.players.filter(x => x !== pid);
            if (prev.hostId === pid) prev.hostId = prev.players[0] || null;
            sendLobbyUpdate(prev.id);
          }
        }

        lobby.players.push(pid);
        player.lobbyId = lobby.id;
        if (!lobby.hostId) lobby.hostId = pid;
        sendLobbyUpdate(lobby.id);
        break;
      }

      case 'leave_lobby': {
        const lobby = lobbies.find(l => l.id === player.lobbyId);
        if (lobby) {
          lobby.players = lobby.players.filter(x => x !== pid);
          if (lobby.hostId === pid) lobby.hostId = lobby.players[0] || null;
          player.lobbyId = null;
          sendLobbyUpdate(lobby.id);
        }
        break;
      }

      case 'start_game': {
        const lobby = lobbies.find(l => l.id === player.lobbyId);
        if (!lobby) { safeSend(ws, { type: 'error', message: 'Not in a lobby' }); break; }
        if (lobby.hostId !== pid) { safeSend(ws, { type: 'error', message: 'Only host can start' }); break; }
        startGame(lobby);
        break;
      }

      case 'submit_clue': {
        const lobby = lobbies.find(l => l.id === player.lobbyId);
        if (!lobby) break;
        if (lobby.state !== 'in_game') break;
        if (lobby.roles[pid] !== 'crewmate') break;
        const clue = String(msg.clue || '').slice(0, 200);
        lobby.clues[pid] = clue;
        sendLobbyUpdate(lobby.id);
        checkCluesAndNotify(lobby);
        break;
      }

      case 'impostor_guess': {
        const lobby = lobbies.find(l => l.id === player.lobbyId);
        if (!lobby) break;
        if (lobby.roles[pid] !== 'impostor') break;
        if (lobby.state !== 'impostor_guess') break;
        const guess = String(msg.guess || '').slice(0, 500);
        lobby.players.forEach(p => sendToPlayer(p, { type: 'impostor_guess_result', guess, by: pid, byName: player.name }));
        lobby.state = 'voting';
        lobby.votes = {};
        lobby.players.forEach(p => sendToPlayer(p, { type: 'voting_start', players: lobby.players.map(pid => {
          const pl = players.get(pid);
          return { id: pid, name: pl ? pl.name : 'Anonymous' };
        }) }));
        sendLobbyUpdate(lobby.id);
        break;
      }

      case 'vote': {
        const lobby = lobbies.find(l => l.id === player.lobbyId);
        if (!lobby) break;
        if (lobby.state !== 'voting') break;
        const targetId = Number(msg.targetId);
        if (!lobby.players.includes(targetId)) break;
        lobby.votes[pid] = targetId;
        const allVoted = lobby.players.every(p => typeof lobby.votes[p] !== 'undefined');
        if (allVoted) tallyVotes(lobby);
        break;
      }

      case 'kick_player': {
        const targetId = Number(msg.targetId);
        kickPlayerFromLobby(pid, targetId);
        break;
      }

      default:
        safeSend(ws, { type: 'error', message: 'Unknown message type' });
    }
  });

  ws.on('close', () => {
    console.log(`player disconnected: ${pid}`);
    const p = players.get(pid);
    if (p && p.lobbyId) {
      const lobby = lobbies.find(l => l.id === p.lobbyId);
      if (lobby) {
        lobby.players = lobby.players.filter(x => x !== pid);
        if (lobby.hostId === pid) lobby.hostId = lobby.players[0] || null;
        sendLobbyUpdate(lobby.id);
      }
    }
    players.delete(pid);
    sendLobbyList();
  });

  ws.on('error', () => {
    // ignore; close handler will clean up
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
