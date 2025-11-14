// server.js
// Simple WebSocket lobby + game manager
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
const players = new Map(); // playerId -> {id, ws, name, lobbyId}
const lobbies = Array.from({length: LOBBY_COUNT}, (_, i) => ({
  id: i + 1,
  players: [], // array of playerIds
  hostId: null,
  state: 'waiting', // waiting | in_game | voting | results
  roles: {}, // playerId -> 'impostor'|'crewmate'
  word: null,
  clues: {}, // playerId -> clue
  votes: {}, // playerId -> targetId
}));

// Helper: broadcast to all connected clients
function broadcastAll(obj) {
  const s = JSON.stringify(obj);
  wss.clients.forEach(c => {
    if (c.readyState === WebSocket.OPEN) c.send(s);
  });
}

// Helper: send to a specific player
function sendToPlayer(playerId, obj) {
  const p = players.get(playerId);
  if (!p || p.ws.readyState !== WebSocket.OPEN) return;
  p.ws.send(JSON.stringify(obj));
}

// Helper: send lobby list to all
function sendLobbyList() {
  const list = lobbies.map(l => ({
    id: l.id,
    count: l.players.length,
    maxPlayers: MAX_PLAYERS,
    state: l.state
  }));
  broadcastAll({type:'lobby_list', lobbies: list});
}

// Helper: send lobby update to players in that lobby
function sendLobbyUpdate(lobbyId) {
  const l = lobbies.find(x => x.id === lobbyId);
  if (!l) return;
  const lobbyInfo = {
    id: l.id,
    players: l.players.map(pid => {
      const p = players.get(pid);
      return {id: pid, name: p ? p.name : 'Anonymous', avatar: p ? p.avatar : null};
    }),
    hostId: l.hostId,
    state: l.state
  };
  // send to all players in lobby
  l.players.forEach(pid => sendToPlayer(pid, {type:'lobby_update', lobby: lobbyInfo}));
  // also update lobby list globally
  sendLobbyList();
}

// Choose a random element
function choose(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Start game in lobby
function startGame(lobby) {
  if (l.state !== 'waiting') return;
  if (l.players.length < 2) {
    // need at least 2 players
    l.players.forEach(pid => sendToPlayer(pid, {type:'error', message:'Need at least 2 players to start'}));
    return;
  }
  l.state = 'in_game';
  l.word = choose(WORDS);
  // pick impostor
  const impostorId = choose(l.players);
  l.roles = {};
  l.players.forEach(pid => {
    l.roles[pid] = (pid === impostorId) ? 'impostor' : 'crewmate';
  });
  l.clues = {};
  l.votes = {};

  // send role messages
  l.players.forEach(pid => {
    const role = l.roles[pid];
    if (role === 'crewmate') {
      sendToPlayer(pid, {type:'role', role:'crewmate', word: l.word});
    } else {
      sendToPlayer(pid, {type:'role', role:'impostor'});
    }
  });

  // notify lobby update
  sendLobbyUpdate(l.id);
}

// When all crewmates have submitted clues, send clues to impostor
function checkCluesAndNotify(lobby) {
  const l = lobby;
  const crewmates = l.players.filter(pid => l.roles[pid] === 'crewmate');
  const allSubmitted = crewmates.every(pid => typeof l.clues[pid] === 'string');
  if (allSubmitted) {
    // find impostor
    const impostorId = l.players.find(pid => l.roles[pid] === 'impostor');
    const clues = crewmates.map(pid => ({playerId: pid, clue: l.clues[pid]}));
    sendToPlayer(impostorId, {type:'clues_for_impostor', clues});
    // move to next phase
    l.state = 'impostor_guess';
    sendLobbyUpdate(l.id);
  }
}

// Tally votes and decide result
function tallyVotes(lobby) {
  const l = lobby;
  // count votes
  const counts = {};
  Object.values(l.votes).forEach(tid => {
    counts[tid] = (counts[tid] || 0) + 1;
  });
  // find max
  let max = 0;
  let maxId = null;
  for (const tid in counts) {
    if (counts[tid] > max) { max = counts[tid]; maxId = tid; }
  }
  // If tie or no votes, no elimination
  let eliminatedId = null;
  if (maxId) eliminatedId = maxId;

  // Determine impostor id
  const impostorId = l.players.find(pid => l.roles[pid] === 'impostor');

  // Determine winner
  let winner = 'impostor';
  let message = '';
  if (eliminatedId && Number(eliminatedId) === impostorId) {
    winner = 'crewmates';
    message = `Impostor was eliminated (${players.get(Number(eliminatedId)).name}).`;
  } else {
    winner = 'impostor';
    message = `Impostor survived.`;
  }

  // Broadcast result to lobby
  l.players.forEach(pid => {
    sendToPlayer(pid, {
      type: 'voting_result',
      winner,
      message,
      eliminatedId: eliminatedId ? Number(eliminatedId) : null,
      eliminatedName: eliminatedId ? players.get(Number(eliminatedId)).name : null,
      impostorId
    });
  });

  // Reset lobby state to waiting (players remain in lobby)
  l.state = 'results';
  sendLobbyUpdate(l.id);

  // After a short delay, reset to waiting so host can restart
  setTimeout(() => {
    l.state = 'waiting';
    l.word = null;
    l.roles = {};
    l.clues = {};
    l.votes = {};
    sendLobbyUpdate(l.id);
  }, 8000);
}

// WebSocket connection handling
wss.on('connection', (ws) => {
  const pid = nextPlayerId++;
  players.set(pid, {id: pid, ws, name: `Player${pid}`, lobbyId: null, avatar: null});
  ws.send(JSON.stringify({type:'connected', playerId: pid}));
  // send initial lobby list
  sendLobbyList();

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { ws.send(JSON.stringify({type:'error', message:'Invalid JSON'})); return; }

    const player = players.get(pid);
    if (!player) return;

    switch (msg.type) {
      case 'hello':
        // no-op
        break;

      case 'set_username':
        player.name = String(msg.username || '').slice(0, 20) || player.name;
        break;

      case 'join_lobby': {
        const lobbyId = Number(msg.lobbyId);
        const lobby = lobbies.find(l => l.id === lobbyId);
        if (!lobby) { ws.send(JSON.stringify({type:'error', message:'Invalid lobby'})); break; }
        if (lobby.players.length >= MAX_PLAYERS) {
          ws.send(JSON.stringify({type:'error', message:'Lobby full'}));
          break;
        }
        // remove from previous lobby if any
        if (player.lobbyId) {
          const prev = lobbies.find(x => x.id === player.lobbyId);
          if (prev) {
            prev.players = prev.players.filter(x => x !== pid);
            if (prev.hostId === pid) prev.hostId = prev.players[0] || null;
            sendLobbyUpdate(prev.id);
          }
        }
        // add to new lobby
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
        if (!lobby) { ws.send(JSON.stringify({type:'error', message:'Not in a lobby'})); break; }
        if (lobby.hostId !== pid) { ws.send(JSON.stringify({type:'error', message:'Only host can start'})); break; }
        startGame(lobby);
        break;
      }

      case 'submit_clue': {
        const lobby = lobbies.find(l => l.id === player.lobbyId);
        if (!lobby) break;
        if (lobby.state !== 'in_game') break;
        if (lobby.roles[pid] !== 'crewmate') break;
        const clue = String(msg.clue || '').slice(0, 30);
        lobby.clues[pid] = clue;
        // notify lobby update
        sendLobbyUpdate(lobby.id);
        checkCluesAndNotify(lobby);
        break;
      }

      case 'impostor_guess': {
        const lobby = lobbies.find(l => l.id === player.lobbyId);
        if (!lobby) break;
        if (lobby.roles[pid] !== 'impostor') break;
        const guess = String(msg.guess || '').slice(0, 60);
        // broadcast guess to lobby
        lobby.players.forEach(p => sendToPlayer(p, {type:'impostor_guess_result', guess, by: pid, byName: player.name}));
        // move to voting phase
        lobby.state = 'voting';
        lobby.votes = {};
        lobby.players.forEach(p => sendToPlayer(p, {type:'voting_start', players: lobby.players.map(pid => {
          const pl = players.get(pid);
          return {id: pid, name: pl ? pl.name : 'Anonymous'};
        })}));
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
        // if all players voted, tally
        const allVoted = lobby.players.every(p => lobby.votes[p]);
        if (allVoted) {
          tallyVotes(lobby);
        }
        break;
      }

      case 'request_lobby_list':
        sendLobbyList();
        break;

      default:
        ws.send(JSON.stringify({type:'error', message:'Unknown message type'}));
    }
  });

  ws.on('close', () => {
    // cleanup player from lobby
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
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
