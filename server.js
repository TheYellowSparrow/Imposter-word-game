// server.js
// WebSocket lobby + game manager (compatible with the provided client)
// npm install express ws

const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const PORT = process.env.PORT || 3000;
const LOBBY_COUNT = 4;
const MAX_PLAYERS = 8;
const WORDS = [
  'planet','ocean','forest','castle','robot','piano','rocket','diamond','shadow','mirror',
  'river','mountain','island','garden','library','bridge','candle','feather','comet','lantern'
];

const app = express();
// Serve static files (assets, index.html) if you host client from same server
app.use(express.static('public'));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Data stores
let nextPlayerId = 1;
const players = new Map(); // playerId -> {id, ws, name, lobbyId, avatar}
const lobbies = Array.from({ length: LOBBY_COUNT }, (_, i) => ({
  id: i + 1,
  players: [], // array of playerIds
  hostId: null,
  state: 'waiting', // waiting | in_game | impostor_guess | voting | results
  roles: {}, // playerId -> 'impostor'|'crewmate'
  word: null,
  clues: {}, // playerId -> clue
  votes: {}, // playerId -> targetId
}));

/* Helpers */

function broadcastAll(obj) {
  const s = JSON.stringify(obj);
  wss.clients.forEach(c => {
    if (c.readyState === WebSocket.OPEN) c.send(s);
  });
}

function sendToPlayer(playerId, obj) {
  const p = players.get(playerId);
  if (!p || !p.ws || p.ws.readyState !== WebSocket.OPEN) return;
  try { p.ws.send(JSON.stringify(obj)); } catch (e) { /* ignore send errors */ }
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
  // send to all players in lobby
  l.players.forEach(pid => sendToPlayer(pid, { type: 'lobby_update', lobby: lobbyInfo }));
  // also update lobby list globally
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

  // pick impostor
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
  const allSubmitted = crewmates.length > 0 && crewmates.every(pid => typeof lobby.clues[pid] === 'string');
  if (allSubmitted) {
    const impostorId = lobby.players.find(pid => lobby.roles[pid] === 'impostor');
    const clues = crewmates.map(pid => ({ playerId: pid, clue: lobby.clues[pid] }));
    sendToPlayer(impostorId, { type: 'clues_for_impostor', clues });
    lobby.state = 'impostor_guess';
    sendLobbyUpdate(lobby.id);
  }
}

function tallyVotes(lobby) {
  if (!lobby) return;
  const counts = {};
  Object.values(lobby.votes).forEach(tid => {
    counts[tid] = (counts[tid] || 0) + 1;
  });

  // find max and detect ties
  let max = 0;
  for (const tid in counts) {
    if (counts[tid] > max) max = counts[tid];
  }
  const top = Object.keys(counts).filter(tid => counts[tid] === max);

  let eliminatedId = null;
  if (top.length === 1) eliminatedId = Number(top[0]); // unique top
  // else tie -> no elimination (eliminatedId stays null)

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

  // reset after short delay so players remain in lobby
  setTimeout(() => {
    lobby.state = 'waiting';
    lobby.word = null;
    lobby.roles = {};
    lobby.clues = {};
    lobby.votes = {};
    sendLobbyUpdate(lobby.id);
  }, 8000);
}

/* WebSocket handling */

wss.on('connection', (ws) => {
  const pid = nextPlayerId++;
  players.set(pid, { id: pid, ws, name: `Player${pid}`, lobbyId: null, avatar: null });
  try { ws.send(JSON.stringify({ type: 'connected', playerId: pid })); } catch (e) {}
  sendLobbyList();

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { try { ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' })); } catch (e2) {} return; }

    const player = players.get(pid);
    if (!player) return;

    switch (msg.type) {
      case 'hello':
        // no-op
        break;

      case 'ping':
        // optional heartbeat from client; ignore
        break;

      case 'set_username':
        player.name = String(msg.username || '').slice(0, 40) || player.name;
        if (player.lobbyId) sendLobbyUpdate(player.lobbyId);
        break;

      case 'set_avatar':
        player.avatar = msg.avatarUrl ? String(msg.avatarUrl).slice(0, 1000) : null;
        if (player.lobbyId) sendLobbyUpdate(player.lobbyId);
        break;

      case 'join_lobby': {
        const lobbyId = Number(msg.lobbyId);
        const lobby = lobbies.find(l => l.id === lobbyId);
        if (!lobby) { try { ws.send(JSON.stringify({ type: 'error', message: 'Invalid lobby' })); } catch (e) {} break; }
        if (lobby.players.length >= MAX_PLAYERS) { try { ws.send(JSON.stringify({ type: 'error', message: 'Lobby full' })); } catch (e) {} break; }

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
        if (!lobby) { try { ws.send(JSON.stringify({ type: 'error', message: 'Not in a lobby' })); } catch (e) {} break; }
        if (lobby.hostId !== pid) { try { ws.send(JSON.stringify({ type: 'error', message: 'Only host can start' })); } catch (e) {} break; }
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

      case 'request_lobby_list':
        sendLobbyList();
        break;

      default:
        try { ws.send(JSON.stringify({ type: 'error', message: 'Unknown message type' })); } catch (e) {}
    }
  });

  ws.on('close', () => {
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
    // ignore individual socket errors; close handler will clean up
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
