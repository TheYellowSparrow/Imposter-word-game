<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Impostor Word — Client (Turn-based)</title>
  <link href="https://fonts.googleapis.com/css2?family=Fredoka:wght@700&family=Poppins:wght@400;600;700&display=swap" rel="stylesheet">
  <style>
    :root{ --bg1:#05021a; --bg2:#081033; --accent:#E91E63; --accent-2:#2196F3; --muted:rgba(255,255,255,0.85);
      --card: rgba(255,255,255,0.06); --glass: rgba(255,255,255,0.04); --success:#2ecc71; --danger:#ff6b6b; }
    html,body{height:100%;margin:0;background:radial-gradient(ellipse at bottom, rgba(255,255,255,0.02) 0%, transparent 40%), linear-gradient(180deg,var(--bg1),var(--bg2));color:#fff;font-family:'Poppins',system-ui,-apple-system,sans-serif;overflow:hidden}
    body::before{content:"";position:fixed;inset:0;background-image:
      radial-gradient(1px 1px at 10% 20%, rgba(255,255,255,0.9) 50%, transparent 51%),
      radial-gradient(1px 1px at 30% 40%, rgba(255,255,255,0.7) 50%, transparent 51%),
      radial-gradient(1px 1px at 70% 10%, rgba(255,255,255,0.6) 50%, transparent 51%),
      radial-gradient(1px 1px at 80% 70%, rgba(255,255,255,0.8) 50%, transparent 51%),
      radial-gradient(1px 1px at 50% 80%, rgba(255,255,255,0.6) 50%, transparent 51%);opacity:0.9;pointer-events:none;z-index:0;}
    .topbar{position:fixed;top:0;left:0;right:0;height:64px;display:grid;grid-template-columns:1fr auto 1fr;align-items:center;padding:0 24px;background:linear-gradient(180deg, rgba(0,0,0,0.35), rgba(0,0,0,0));backdrop-filter: blur(6px);z-index:10000}
    .brand{grid-column:1;justify-self:start;font-family:'Fredoka',Poppins,sans-serif;font-size:26px;font-weight:900}
    .center-area{grid-column:2;justify-self:center;display:flex;align-items:center;gap:12px}
    .status{grid-column:3;justify-self:end;display:flex;align-items:center;gap:10px;color:var(--muted);font-size:14px}
    .dot{width:12px;height:12px;border-radius:50%;background:#b33}.dot.green{background:#2ecc71}.dot.yellow{background:#ffd166}
    .displayname{width:320px;padding:10px 12px;border-radius:10px;border:1px solid rgba(255,255,255,0.12);background:transparent;color:#fff;font-size:15px}
    .role-box{position:fixed;top:70px;left:20px;background:rgba(255,255,255,0.08);color:#fff;padding:10px 14px;border-radius:8px;font-weight:900;font-size:18px;z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,0.4)}
    .hidden{display:none!important}
    .screen{position:fixed;inset:64px 0 0 0;display:flex;align-items:center;justify-content:center;padding:24px;z-index:1}
    .lobby-wrap{max-width:1000px;width:100%;display:flex;flex-direction:column;gap:20px;z-index:2}
    .lobby-buttons{display:grid;grid-template-columns:repeat(2,minmax(240px,1fr));gap:16px}
    .big-btn{height:96px;border:none;border-radius:14px;cursor:pointer;background:linear-gradient(135deg,var(--accent),#C2185B);color:#071021;font-weight:900;font-size:24px;box-shadow:0 18px 60px rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center}
    .panel{background: var(--card);border-radius:16px;padding:16px;box-shadow:0 18px 60px rgba(0,0,0,0.45)}
    .players{display:flex;flex-direction:column;gap:10px;max-height:240px;overflow:auto}
    .player{display:flex;align-items:center;gap:12px;padding:10px;border-radius:12px;background:var(--glass)}
    .name{font-weight:900}
    .meta{margin-left:auto;display:flex;gap:10px;align-items:center}
    .badge{padding:6px 10px;border-radius:999px;font-weight:900;background:#ffd54f;color:#071021;font-size:12px}
    .ready{background:#4caf50}.notready{background:#ffb86b}.score{font-weight:900;color:var(--accent)}
    .controls{display:flex;gap:10px}
    button.action{background:linear-gradient(135deg,var(--accent-2),#1976D2);border:none;color:#071021;padding:12px 14px;border-radius:12px;font-weight:800;cursor:pointer;font-size:15px}
    .game-wrap{max-width:1200px;width:100%;display:flex;flex-direction:column;gap:18px;z-index:2}
    .reveal-card{background: rgba(255,255,255,0.06);border-radius:14px;padding:28px;text-align:center;box-shadow:0 18px 60px rgba(0,0,0,0.45)}
    .role-text{font-family:'Fredoka',Poppins,sans-serif;font-size:36px;font-weight:900}
    .space-stage{width:100%;display:flex;flex-direction:column;gap:12px;align-items:center}
    .players-grid{display:flex;flex-wrap:wrap;gap:12px;justify-content:center;width:100%}
    .player-card{width:220px;background:rgba(255,255,255,0.04);border-radius:12px;padding:12px;display:flex;flex-direction:column;align-items:center;gap:8px;box-shadow:0 10px 30px rgba(0,0,0,0.45);position:relative}
    .player-card.turn { box-shadow:0 0 0 3px rgba(33,150,243,0.18); border:1px solid rgba(33,150,243,0.25); }
    .pfp{width:72px;height:72px;border-radius:999px;background:linear-gradient(180deg,#fff,#eee);display:flex;align-items:center;justify-content:center;color:#081033;font-size:36px}
    .player-name{font-weight:800}
    .clue-box{width:100%;margin-top:6px}
    .clue-input{width:100%;padding:8px;border-radius:8px;border:2px solid rgba(255,255,255,0.06);background:transparent;color:#fff;font-size:14px}
    .clue-submit{margin-top:6px;background:linear-gradient(135deg,var(--accent),#C2185B);border:none;color:#071021;padding:8px 10px;border-radius:8px;font-weight:800;cursor:pointer}
    .clue-text{width:100%;padding:8px;border-radius:8px;background:rgba(0,0,0,0.12);font-size:14px;color:var(--muted);text-align:center}
    .voting-list{display:flex;flex-direction:column;gap:8px;max-width:480px;width:100%}
    .vote-btn{padding:10px;border-radius:10px;background:linear-gradient(135deg,#fff,#eee);color:#081033;font-weight:900;border:none;cursor:pointer}
    .vote-btn.disabled{opacity:0.6;cursor:not-allowed}
    .spectator{opacity:0.45}
    .round-info{color:var(--muted);font-size:14px}
    .results-list{display:flex;flex-direction:column;gap:8px;max-width:640px;width:100%}
    .result-item{padding:10px;border-radius:10px;background:rgba(255,255,255,0.04)}
    @media (max-width:900px){.lobby-buttons{grid-template-columns:1fr}.displayname{width:220px}.player-card{width:160px}}
  </style>
</head>
<body>
  <div class="topbar">
    <div class="brand">Impostor Word</div>
    <div class="center-area">
      <input id="displayNameTop" class="displayname" type="text" placeholder="Your display name" />
    </div>
    <div class="status">
      <div class="dot" id="connDot"></div>
      <div id="connText">Connecting…</div>
    </div>
  </div>

  <!-- Persistent role box (top-left) -->
  <div id="roleBox" class="role-box hidden"></div>

  <div id="lobbyScreen" class="screen">
    <!-- ... lobby markup unchanged ... -->
    <div class="lobby-wrap">
      <div style="font-size:20px;color:var(--muted)">Choose a lobby, ready up, host presses Start</div>
      <div class="lobby-buttons" id="lobbyButtons"></div>
      <div class="panel">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
          <div style="font-weight:900" id="currentLobbyTitle">Lobby — not joined</div>
          <div style="display:flex;gap:10px;align-items:center;">
            <div style="color:var(--muted)">Players</div>
            <div id="playerCount" style="color:var(--muted)">0 / 8</div>
          </div>
        </div>
        <div class="players" id="playersList" aria-live="polite"></div>
        <div class="controls" style="margin-top:12px">
          <button id="readyBtn" class="action" disabled>Ready</button>
          <button id="unreadyBtn" class="action" disabled>Unready</button>
          <button id="startBtn" class="action" disabled>Start (Host)</button>
          <button id="leaveBtn" class="action" disabled style="margin-left:auto">Leave</button>
        </div>
        <div id="lobbyHint" style="color:var(--muted);margin-top:8px">Host starts when everyone is ready</div>
      </div>
    </div>
  </div>

  <div id="gameScreen" class="screen hidden">
    <div class="game-wrap">
      <div id="revealScreen" class="reveal-card">
        <div style="color:var(--muted);font-size:14px">Your role</div>
        <div id="roleReveal" class="role-text">...</div>
        <div style="margin-top:12px;color:var(--muted)">Revealing roles…</div>
      </div>

      <div id="spaceStage" class="space-stage hidden">
        <div style="display:flex;align-items:center;gap:12px;width:100%;justify-content:space-between">
          <div class="round-info" id="roundInfo">Round</div>
          <div class="round-info" id="timerDisplay">30</div>
        </div>

        <div class="players-grid" id="playersGrid"></div>

        <div id="clueStatus" class="round-info" style="margin-top:8px">Waiting for turn</div>

        <div id="votingArea" class="hidden" style="margin-top:12px">
          <div style="color:var(--muted);font-size:16px;margin-bottom:8px">Vote for the player you think is the impostor</div>
          <div class="voting-list" id="votingPlayersList"></div>
          <div id="votingStatus" style="color:var(--muted);margin-top:8px">Waiting for votes</div>
        </div>

        <div id="resultsArea" class="hidden" style="margin-top:12px">
          <div style="color:var(--muted);font-size:16px;margin-bottom:8px">Round results</div>
          <div class="results-list" id="resultsList"></div>
        </div>
      </div>
    </div>
  </div>

  <div id="finalScreen" class="screen hidden">
    <div class="finalcol center" style="z-index:2">
      <div style="font-weight:900;font-size:26px">Game Over</div>
      <div id="finalStandings" class="list" style="width:100%"></div>
      <button id="backToLobbyBtn" class="submitbtn" style="margin-top:12px">Back to Lobby</button>
    </div>
  </div>

  <script>
  (function(){
    const SERVER_WS = 'https://imposter-word-game.onrender.com';
    const REVEAL_SECONDS = 5;
    const CLUE_SECONDS = 30;
    const VOTE_SECONDS = 30;

    // Elements
    const roleBox = document.getElementById('roleBox');
    const connDot = document.getElementById('connDot');
    const connText = document.getElementById('connText');
    const displayNameTop = document.getElementById('displayNameTop');

    const lobbyScreen = document.getElementById('lobbyScreen');
    const gameScreen = document.getElementById('gameScreen');
    const finalScreen = document.getElementById('finalScreen');

    const lobbyButtonsEl = document.getElementById('lobbyButtons');
    const currentLobbyTitle = document.getElementById('currentLobbyTitle');
    const playersListEl = document.getElementById('playersList');
    const playerCountEl = document.getElementById('playerCount');
    const readyBtn = document.getElementById('readyBtn');
    const unreadyBtn = document.getElementById('unreadyBtn');
    const startBtn = document.getElementById('startBtn');
    const leaveBtn = document.getElementById('leaveBtn');
    const lobbyHint = document.getElementById('lobbyHint');

    const revealScreen = document.getElementById('revealScreen');
    const roleReveal = document.getElementById('roleReveal');

    const spaceStage = document.getElementById('spaceStage');
    const playersGrid = document.getElementById('playersGrid');
    const timerDisplay = document.getElementById('timerDisplay');
    const roundInfo = document.getElementById('roundInfo');
    const clueStatus = document.getElementById('clueStatus');

    const votingArea = document.getElementById('votingArea');
    const votingPlayersList = document.getElementById('votingPlayersList');
    const votingStatus = document.getElementById('votingStatus');

    const resultsArea = document.getElementById('resultsArea');
    const resultsList = document.getElementById('resultsList');

    const finalStandings = document.getElementById('finalStandings');
    const backToLobbyBtn = document.getElementById('backToLobbyBtn');

    // State
    let socket = null;
    let myId = null;
    let currentRoom = null;
    let players = []; // {id,name,ready,score,alive}
    let hostId = null;
    let hasJoined = false;

    let phase = 'lobby';
    let timerInterval = null;
    let roundSeconds = 0;

    // Game state
    let rolesMap = {}; // id -> 'IMPOSTOR' or word
    let impostorId = null;
    let secretWord = '';
    let submittedClues = {}; // id -> text
    let aliveMap = {}; // id -> boolean
    let isSpectator = false;
    let currentTurnId = null;

    const lobbyButtonsMap = new Map();
    const lobbyCounts = { lobby1:0, lobby2:0, lobby3:0, lobby4:0 };

    // Helpers
    function setConnState(text, colorClass){ connText.textContent = text; connDot.className = 'dot ' + (colorClass || ''); }
    function normalizeWs(url){
      if (!url) return '';
      if (url.startsWith('ws://') || url.startsWith('wss://')) return url;
      if (url.startsWith('http://')) return 'ws://' + url.slice(7);
      if (url.startsWith('https://')) return 'wss://' + url.slice(8);
      return 'wss://' + url;
    }
    function send(obj){ if (!socket || socket.readyState !== WebSocket.OPEN) return; try { socket.send(JSON.stringify(obj)); } catch(e){} }
    function escapeHtml(s){ return String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

    function updateLobbyButtonCount(roomId, count){
      lobbyCounts[roomId] = Math.max(0, count);
      const btn = lobbyButtonsMap.get(roomId);
      if (btn){ const cnt = btn.querySelector('.count'); if (cnt) cnt.textContent = `${lobbyCounts[roomId]}/8`; }
      if (currentRoom === roomId) playerCountEl.textContent = `${lobbyCounts[roomId]} / 8`;
    }

    function updateStartButton(){
      const enabled = !!(hasJoined && myId && hostId && hostId === myId);
      startBtn.disabled = !enabled;
      if (enabled) lobbyHint.textContent = 'You are host — press Start to begin';
      else if (hasJoined) lobbyHint.textContent = 'Host starts when everyone is ready';
    }

    function showLobby(){ lobbyScreen.classList.remove('hidden'); gameScreen.classList.add('hidden'); finalScreen.classList.add('hidden'); }
    function showGame(){ lobbyScreen.classList.add('hidden'); gameScreen.classList.remove('hidden'); finalScreen.classList.add('hidden'); }
    function showFinal(){ lobbyScreen.classList.add('hidden'); gameScreen.classList.add('hidden'); finalScreen.classList.remove('hidden'); }
    function setPhase(newPhase){ phase = newPhase; roundInfo.textContent = newPhase.charAt(0).toUpperCase() + newPhase.slice(1); }

    function enableLobbyControls(enabled){
      readyBtn.disabled = !enabled;
      unreadyBtn.disabled = !enabled;
      leaveBtn.disabled = !enabled;
      updateStartButton();
    }

    function startTimer(seconds){
      stopTimer();
      roundSeconds = seconds || 60;
      timerDisplay.textContent = roundSeconds;
      timerInterval = setInterval(() => {
        roundSeconds--;
        timerDisplay.textContent = roundSeconds;
        if (roundSeconds <= 0) stopTimer();
      }, 1000);
    }
    function stopTimer(){ if (timerInterval){ clearInterval(timerInterval); timerInterval = null; } }

    function connect(){
      if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
      setConnState('Connecting…','yellow');
      try { socket = new WebSocket(normalizeWs(SERVER_WS)); } catch(err){ setConnState('Connection failed',''); return; }
      socket.onopen = () => { setConnState('Connected','green'); send({ type: 'listLobbies' }); };
      socket.onmessage = (ev) => { let data; try { data = JSON.parse(ev.data); } catch(e){ return; } handleServerMessage(data); };
      socket.onclose = () => {
        hasJoined = false; myId = null;
        setConnState('Disconnected','');
        players = []; hostId = null; currentRoom = null;
        enableLobbyControls(false);
        showLobby();
      };
      socket.onerror = () => { setConnState('Connection error',''); };
    }

    function handleServerMessage(data){
      if (!data || typeof data.type !== 'string') return;
      switch (data.type) {
        case 'id':
          myId = data.id;
          if (hasJoined) { renderPlayers(); enableLobbyControls(true); updateStartButton(); renderPlayersGrid(); }
          break;

        case 'lobbyList':
          if (Array.isArray(data.lobbies)) data.lobbies.forEach(l => updateLobbyButtonCount(l.id, l.count || 0));
          break;

        case 'lobbyInfo':
          if (data.room) updateLobbyButtonCount(data.room, data.count || 0);
          break;

        case 'hostChanged':
          hostId = data.hostId || hostId;
          updateStartButton();
          break;

        case 'joined':
          hasJoined = true;
          currentRoom = data.room;
          hostId = data.hostId;
          players = (data.players || []).map(p => ({ ...p, alive: true }));
          currentLobbyTitle.textContent = 'Lobby ' + currentRoom;
          playerCountEl.textContent = players.length + ' / 8';
          updateLobbyButtonCount(currentRoom, players.length);
          renderPlayers();
          enableLobbyControls(true);
          updateStartButton();
          showLobby();
          break;

        case 'playerJoined':
          if (data.room) updateLobbyButtonCount(data.room, (lobbyCounts[data.room]||0) + 1);
          if (!currentRoom) break;
          if (players.some(p => p.id === data.player.id)) break;
          players.push({ id: data.player.id, name: data.player.name, ready: !!data.player.ready, score: data.player.score || 0, alive: true });
          playerCountEl.textContent = players.length + ' / 8';
          renderPlayers();
          break;

        case 'playerLeft':
          if (data.room) updateLobbyButtonCount(data.room, Math.max(0, (lobbyCounts[data.room]||0) - 1));
          if (!currentRoom) break;
          players = players.filter(p => p.id !== data.id);
          playerCountEl.textContent = players.length + ' / 8';
          if (hostId === data.id) hostId = players.length ? players[0].id : null;
          renderPlayers();
          updateStartButton();
          break;

        case 'playerReady':
          { const p = players.find(x => x.id === data.id); if (p) p.ready = true; renderPlayers(); }
          break;

        case 'playerUnready':
          { const p = players.find(x => x.id === data.id); if (p) p.ready = false; renderPlayers(); }
          break;

        case 'allReady':
          if (myId === hostId) lobbyHint.textContent = 'All players ready. You can start the game.';
          break;

        // Game flow
        case 'gameStarted':
          rolesMap = {}; secretWord = ''; impostorId = null;
          submittedClues = {}; aliveMap = {}; isSpectator = false; currentTurnId = null;

          if (Array.isArray(data.roles)) {
            data.roles.forEach(r => { rolesMap[r.id] = r.role; if (r.role !== 'IMPOSTOR') secretWord = r.role; if (r.role === 'IMPOSTOR') impostorId = r.id; });
          }
          players.forEach(p => { p.alive = true; aliveMap[p.id] = true; });

          const myRole = rolesMap[myId] || (myId === impostorId ? 'IMPOSTOR' : secretWord || '(word)');
          roleReveal.textContent = myRole;
          roleBox.textContent = (myRole === 'IMPOSTOR') ? 'Role: IMPOSTOR' : `Word: ${myRole}`;
          roleBox.classList.remove('hidden');

          revealScreen.classList.remove('hidden');
          spaceStage.classList.add('hidden');
          setPhase('reveal');
          showGame();

          setTimeout(() => {
            revealScreen.classList.add('hidden');
            spaceStage.classList.remove('hidden');
            setPhase('clue-turns');
          }, (data.revealSeconds || REVEAL_SECONDS) * 1000);
          break;

        case 'turnStarted':
          currentTurnId = data.id;
          clueStatus.textContent = (currentTurnId === myId) ? 'Your turn — enter your clue' : `Waiting: ${data.remaining} left`;
          renderPlayersGrid();
          startTimer(data.seconds || CLUE_SECONDS);
          break;

        case 'clueReceived':
          if (data.from !== undefined) {
            submittedClues[data.from] = data.text || '';
            renderPlayersGrid();
          }
          if (data.count !== undefined && data.total !== undefined) {
            clueStatus.textContent = `${data.count} / ${data.total} clues submitted`;
          }
          break;

        case 'allCluesSubmitted':
          currentTurnId = null;
          clueStatus.textContent = 'All clues in — moving to voting';
          break;

        case 'votingStarted':
          stopTimer();
          setPhase('vote');
          votingArea.classList.remove('hidden');
          renderVotingPlayers(data.players || players.map(p => ({ id: p.id, name: p.name, alive: p.alive })));
          startTimer(data.seconds || VOTE_SECONDS);
          break;

        case 'voteReceived':
          if (data.from === myId) votingStatus.textContent = 'Vote recorded';
          break;

        case 'playerEjected':
          const ejectedId = data.id;
          const ejected = players.find(p => p.id === ejectedId);
          if (ejected) { ejected.alive = false; aliveMap[ejectedId] = false; }
          if (data.alive && typeof data.alive === 'object') {
            Object.keys(data.alive).forEach(id => {
              const p = players.find(x => x.id === id);
              if (p) p.alive = !!data.alive[id];
              aliveMap[id] = !!data.alive[id];
            });
          }
          if (ejectedId === myId) { isSpectator = true; clueStatus.textContent = 'You were ejected — spectating'; }
          renderPlayersGrid();
          resultsArea.classList.remove('hidden');
          resultsList.innerHTML = `<div class="result-item">${escapeHtml((ejected && ejected.name) || ejectedId)} was ejected ${data.wasImpostor ? '<strong style="color:#E91E63">and was the IMPOSTOR</strong>' : ''}</div>`;
          break;

        case 'roundResults':
          resultsArea.classList.remove('hidden');
          resultsList.innerHTML = '';
          (data.results || []).forEach(r => {
            const div = document.createElement('div');
            div.className = 'result-item';
            div.innerHTML = `<div style="font-weight:900">${escapeHtml(r.name)} <span style="color:#E91E63;margin-left:8px">${r.votes||0} votes</span></div>
                             <div style="color:var(--muted);margin-top:6px">${r.wasImpostor ? 'Was the IMPOSTOR' : ''} Score: ${r.score||0}</div>`;
            resultsList.appendChild(div);
            const p = players.find(x => x.id === r.id); if (p) p.score = r.score || p.score;
          });
          renderPlayers();
          break;

        case 'gameOver':
          roleBox.classList.add('hidden');
          renderFinalStandings(data.standings || []);
          showFinal();
          stopTimer();
          enableLobbyControls(true);
          lobbyHint.textContent = 'Game finished. Ready up to start again.';
          break;

        case 'error':
          alert(data.message || 'Server error');
          break;
      }
    }

    // Lobby actions
    function joinLobby(roomId){
      if (!socket || socket.readyState !== WebSocket.OPEN) { connect(); setTimeout(() => joinLobby(roomId), 150); return; }
      if (hasJoined && currentRoom && currentRoom !== roomId) {
        send({ type: 'leave', room: currentRoom });
        hasJoined = false; players = []; hostId = null; enableLobbyControls(false);
      }
      const name = (displayNameTop.value || ('Player-' + Math.random().toString(36).slice(2,6))).trim();
      currentRoom = roomId;
      send({ type: 'join', room: roomId, name });
    }

    function leaveLobby(){
      if (!hasJoined || !currentRoom) return;
      const oldRoom = currentRoom;
      send({ type: 'leave', room: oldRoom });
      hasJoined = false; players = []; hostId = null; currentRoom = null;
      currentLobbyTitle.textContent = 'Lobby — not joined';
      playerCountEl.textContent = '0 / 8';
      enableLobbyControls(false);
      showLobby();
    }

    function renderPlayers(){
      playersListEl.innerHTML = '';
      players.forEach(p => {
        const row = document.createElement('div'); row.className = 'player';
        const name = document.createElement('div'); name.className = 'name'; name.textContent = p.name || p.id.slice(-6);
        const meta = document.createElement('div'); meta.className = 'meta';
        if (p.id === hostId){ const host = document.createElement('div'); host.className = 'badge'; host.textContent = 'HOST'; meta.appendChild(host); }
        const rb = document.createElement('div'); rb.className = 'badge ' + (p.ready ? 'ready' : 'notready'); rb.textContent = p.ready ? 'READY' : 'NOT READY';
        const sc = document.createElement('div'); sc.className = 'score'; sc.textContent = p.score || 0;
        meta.appendChild(rb); meta.appendChild(sc);
        row.appendChild(name); row.appendChild(meta);
        playersListEl.appendChild(row);
      });
      playerCountEl.textContent = players.length + ' / 8';
      updateStartButton();
    }

    function startRoundUI(){
      submittedClues = {};
      renderPlayersGrid();
      setPhase('clue-turns');
      votingArea.classList.add('hidden');
      resultsArea.classList.add('hidden');
      clueStatus.textContent = 'Waiting for turn';
    }

    function renderPlayersGrid(){
      playersGrid.innerHTML = '';
      players.forEach(p => {
        const card = document.createElement('div');
        card.className = 'player-card' + (p.alive ? '' : ' spectator') + (p.id === currentTurnId ? ' turn' : '');
        const pfp = document.createElement('div'); pfp.className = 'pfp'; pfp.textContent = p.alive ? '🧑‍🚀' : '👻';
        const name = document.createElement('div'); name.className = 'player-name'; name.textContent = p.name || p.id.slice(-6);

        const clueBox = document.createElement('div'); clueBox.className = 'clue-box';
        if (p.id === myId) {
          if (!p.alive || isSpectator) {
            const txt = document.createElement('div'); txt.className = 'clue-text'; txt.textContent = 'Spectating';
            clueBox.appendChild(txt);
          } else if (currentTurnId === myId) {
            if (submittedClues[myId] !== undefined) {
              const txt = document.createElement('div'); txt.className = 'clue-text'; txt.textContent = submittedClues[myId] || '(skipped)';
              clueBox.appendChild(txt);
            } else {
              const input = document.createElement('input'); input.className = 'clue-input'; input.placeholder = 'Type your clue...'; input.maxLength = 80;
              const btn = document.createElement('button'); btn.className = 'clue-submit'; btn.textContent = 'Submit';
              btn.addEventListener('click', () => {
                const text = (input.value||'').trim();
                if (!text) return;
                send({ type: 'submitClue', room: currentRoom, text });
                submittedClues[myId] = text; // optimistic
                renderPlayersGrid();
              });
              clueBox.appendChild(input); clueBox.appendChild(btn);
            }
          } else {
            // not my turn
            const txt = document.createElement('div'); txt.className = 'clue-text';
            txt.textContent = (submittedClues[myId] !== undefined) ? (submittedClues[myId] || '(skipped)') : 'Waiting for your turn';
            clueBox.appendChild(txt);
          }
        } else {
          const txt = document.createElement('div'); txt.className = 'clue-text';
          if (!p.alive) txt.textContent = 'Ejected';
          else if (submittedClues[p.id] !== undefined) txt.textContent = submittedClues[p.id] || '(skipped)';
          else txt.textContent = (p.id === currentTurnId) ? 'Entering clue now' : 'Waiting...';
          clueBox.appendChild(txt);
        }

        card.appendChild(pfp);
        card.appendChild(name);
        card.appendChild(clueBox);
        playersGrid.appendChild(card);
      });
    }

    function renderVotingPlayers(list){
      votingPlayersList.innerHTML = '';
      const source = list || players.map(p => ({ id: p.id, name: p.name, alive: p.alive }));
      source.forEach(item => {
        const id = item.id;
        const name = item.name || id.slice(-6);
        const alive = (typeof item.alive === 'boolean') ? item.alive : ((players.find(p => p.id === id) || {}).alive ?? true);
        const btn = document.createElement('button'); btn.className = 'vote-btn';
        if (id === myId || !alive || isSpectator) {
          btn.classList.add('disabled'); btn.disabled = true;
          btn.textContent = `${name} ${id === myId ? '— you' : alive ? '' : '(ejected)'}`;
        } else {
          btn.textContent = name;
          btn.addEventListener('click', () => { votingStatus.textContent = 'Voting...'; send({ type: 'voteImpostor', room: currentRoom, votedId: id }); });
        }
        votingPlayersList.appendChild(btn);
      });
    }

    function renderFinalStandings(standings){
      finalStandings.innerHTML = '';
      standings.forEach((s, idx) => {
        const d = document.createElement('div'); d.className = 'choice';
        d.style.padding = '10px'; d.style.background = 'rgba(255,255,255,0.04)'; d.style.borderRadius = '8px';
        d.innerHTML = `<div style="font-weight:900">${idx+1}. ${escapeHtml(s.name)} <span style="color:#E91E63;margin-left:8px">${s.score}</span></div>`;
        finalStandings.appendChild(d);
      });
    }

    // Buttons
    readyBtn.addEventListener('click', () => { if (!hasJoined || !currentRoom) return; send({ type: 'ready', room: currentRoom }); });
    unreadyBtn.addEventListener('click', () => { if (!hasJoined || !currentRoom) return; send({ type: 'unready', room: currentRoom }); });
    startBtn.addEventListener('click', () => { if (!hasJoined || !currentRoom) return; startBtn.disabled = true; send({ type: 'startGame', room: currentRoom }); });
    leaveBtn.addEventListener('click', leaveLobby);
    backToLobbyBtn.addEventListener('click', showLobby);

    // Lobby buttons
    function renderLobbyButtonsInit(){
      lobbyButtonsEl.innerHTML = '';
      ['lobby1','lobby2','lobby3','lobby4'].forEach((id, idx) => {
        const b = document.createElement('button');
        b.className = 'big-btn'; b.type = 'button';
        b.textContent = `Lobby ${idx+1}`;
        b.addEventListener('click', () => joinLobby(id));
        lobbyButtonsEl.appendChild(b);
        lobbyButtonsMap.set(id, b);
      });
    }

    // init
    renderLobbyButtonsInit();
    connect();
    showLobby();
  })();
  </script>
</body>
</html>
