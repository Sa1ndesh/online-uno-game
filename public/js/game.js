/* ==========================================================================
   UNO CORE GAME CLIENT & AI SYSTEM
   ========================================================================== */

const UnoGame = {
  // --- STATE ---
  socket: null,
  isMultiplayer: false,
  myUsername: 'Guest',
  isLoggedIn: false,
  activeRoomId: null,
  isMyTurn: false,
  hand: [],
  selectedCardId: null,
  activeColor: 'red',
  drawnCardDecision: null, // Holds reference to drawn card when deciding to play/pass
  isHost: false,
  soundEnabled: true,

  // Offline Mode Engine State
  offlineState: {
    players: [], // { name, hand: [], isBot: boolean, seatId: string }
    deck: [],
    discardPile: [],
    activeIdx: 0,
    direction: 1,
    currentColor: '',
    topCard: null,
    unoDeclared: {}, // idx -> boolean
    pendingUnoPenalty: {}, // idx -> boolean
    penaltyTimer: null,
    hasDrawnThisTurn: false
  },

  // --- INITIALIZATION ---
  init() {
    this.soundEnabled = UnoAudio.init();
    this.updateSoundButtonUI();
    this.bindEvents();
    this.checkCachedAuth();
    this.refreshDashboardData();
  },

  updateSoundButtonUI() {
    const btn = document.getElementById('btn-toggle-sound');
    if (btn) {
      btn.innerText = this.soundEnabled ? '🔊 Sound On' : '🔇 Mute';
      btn.className = this.soundEnabled ? 'action-btn' : 'action-btn text-danger';
    }
  },

  bindEvents() {
    // Audio toggle
    document.getElementById('btn-toggle-sound').addEventListener('click', () => {
      this.soundEnabled = UnoAudio.toggle();
      this.updateSoundButtonUI();
    });

    // Auth screen tab switches
    const tabLogin = document.getElementById('btn-tab-login');
    const tabRegister = document.getElementById('btn-tab-register');
    const authForm = document.getElementById('auth-form');
    const submitBtn = document.getElementById('btn-auth-submit');
    let currentAuthTab = 'login';

    tabLogin.addEventListener('click', () => {
      currentAuthTab = 'login';
      tabLogin.classList.add('active');
      tabRegister.classList.remove('active');
      submitBtn.innerText = 'Login to Play';
    });

    tabRegister.addEventListener('click', () => {
      currentAuthTab = 'register';
      tabRegister.classList.add('active');
      tabLogin.classList.remove('active');
      submitBtn.innerText = 'Sign Up & Play';
    });

    // Auth Submit
    authForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const usernameInput = document.getElementById('auth-username').value.trim();
      const passwordInput = document.getElementById('auth-password').value;

      if (!usernameInput || !passwordInput) return;

      submitBtn.disabled = true;
      submitBtn.innerText = 'Connecting...';

      let result;
      if (currentAuthTab === 'login') {
        result = await UnoAPI.login(usernameInput, passwordInput);
      } else {
        result = await UnoAPI.register(usernameInput, passwordInput);
      }

      submitBtn.disabled = false;
      submitBtn.innerText = currentAuthTab === 'login' ? 'Login to Play' : 'Sign Up & Play';

      if (result.success) {
        this.setAuthenticatedUser(result.user.Username);
        this.switchScreen('screen-menu');
      } else {
        alert(result.message || 'Authentication failed.');
      }
    });

    // Play as Guest (Offline)
    document.getElementById('btn-guest-play').addEventListener('click', () => {
      this.setAuthenticatedUser('Guest');
      this.switchScreen('screen-menu');
    });

    // Logout
    document.getElementById('btn-logout').addEventListener('click', () => {
      localStorage.removeItem('uno_username');
      this.isLoggedIn = false;
      this.myUsername = 'Guest';
      this.switchScreen('screen-auth');
    });

    // Start offline game button
    document.getElementById('btn-start-singleplayer').addEventListener('click', () => {
      const select = document.getElementById('ai-count-select');
      const botCount = parseInt(select.value) || 3;
      this.startOfflineGame(botCount);
    });

    // Join room button
    document.getElementById('btn-join-room').addEventListener('click', () => {
      const codeInput = document.getElementById('custom-room-input').value.toUpperCase().trim();
      if (!codeInput) {
        alert('Please enter a room code.');
        return;
      }
      this.connectMultiplayer(codeInput);
    });

    // Create room button
    document.getElementById('btn-create-lobby').addEventListener('click', () => {
      this.connectMultiplayer(null); // Server creates random code
    });

    // Exit Game Match
    document.getElementById('btn-exit-game').addEventListener('click', () => {
      if (this.isMultiplayer) {
        if (this.socket) {
          this.socket.disconnect();
          this.socket = null;
        }
      }
      // Stop offline turns
      if (this.offlineState.penaltyTimer) {
        clearTimeout(this.offlineState.penaltyTimer);
      }
      this.switchScreen('screen-menu');
      this.refreshDashboardData();
    });

    // Leave Lobby Room
    document.getElementById('btn-leave-lobby').addEventListener('click', () => {
      if (this.socket) {
        this.socket.disconnect();
        this.socket = null;
      }
      this.switchScreen('screen-menu');
      this.refreshDashboardData();
    });

    // Copy Lobby Code
    document.getElementById('btn-copy-code').addEventListener('click', () => {
      const code = document.getElementById('lobby-room-code').innerText;
      if (code && code !== '----') {
        navigator.clipboard.writeText(code);
        alert(`Room Code ${code} copied to clipboard!`);
      }
    });

    // Start Multiplayer Host Button
    document.getElementById('btn-lobby-start-game').addEventListener('click', () => {
      if (this.socket && this.isHost) {
        this.socket.emit('start_game');
      }
    });

    // Chat Message Form
    document.getElementById('chat-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const input = document.getElementById('chat-input');
      const msg = input.value.trim();
      if (msg && this.socket) {
        this.socket.emit('chat_message', msg);
        input.value = '';
      }
    });

    // GAME CONTROLS IN HUD
    document.getElementById('btn-game-draw').addEventListener('click', () => {
      if (!this.isMyTurn) return;
      if (this.isMultiplayer) {
        this.socket.emit('draw_card');
      } else {
        this.handleOfflineDraw();
      }
    });

    document.getElementById('btn-game-pass').addEventListener('click', () => {
      if (!this.isMyTurn) return;
      if (this.isMultiplayer) {
        this.socket.emit('pass_turn');
      } else {
        this.handleOfflinePass();
      }
    });

    document.getElementById('btn-game-uno').addEventListener('click', () => {
      if (this.isMultiplayer) {
        // Shout UNO
        this.socket.emit('shout_uno');
        // Also automatically checks if someone can be challenged
        this.checkMultiplayerChallengeOpponents();
      } else {
        this.handleOfflineUnoShout();
      }
    });

    // Color Choice sectors
    const sectors = document.querySelectorAll('.color-sector');
    sectors.forEach(s => {
      s.addEventListener('click', (e) => {
        const color = e.target.getAttribute('data-color');
        document.getElementById('popup-color-chooser').classList.add('hidden');
        if (this.isMultiplayer) {
          this.socket.emit('play_card', { cardId: this.selectedCardId, chosenColor: color });
        } else {
          this.executeOfflinePlay(this.selectedCardId, color);
        }
      });
    });

    // Game Over return to menu
    document.getElementById('btn-game-over-close').addEventListener('click', () => {
      document.getElementById('popup-game-over').classList.add('hidden');
      this.switchScreen('screen-menu');
      this.refreshDashboardData();
    });
  },

  checkCachedAuth() {
    const cached = localStorage.getItem('uno_username');
    if (cached) {
      this.setAuthenticatedUser(cached);
      this.switchScreen('screen-menu');
    } else {
      this.switchScreen('screen-auth');
    }
  },

  setAuthenticatedUser(username) {
    this.myUsername = username;
    this.isLoggedIn = username !== 'Guest';
    document.getElementById('display-username').innerText = username;
    document.getElementById('game-my-username').innerText = `${username} (You)`;
  },

  switchScreen(screenId) {
    const screens = document.querySelectorAll('.app-screen');
    screens.forEach(s => s.classList.remove('active'));
    
    const target = document.getElementById(screenId);
    if (target) {
      target.classList.add('active');
    }
  },

  async refreshDashboardData() {
    // Fetch and populate stats
    const leaderboardResult = await UnoAPI.getLeaderboard();
    const body = document.getElementById('leaderboard-body');
    body.innerHTML = '';
    
    if (leaderboardResult.success && leaderboardResult.leaderboard.length > 0) {
      leaderboardResult.leaderboard.forEach((p, idx) => {
        let rankClass = '';
        if (idx === 0) rankClass = 'rank-gold';
        else if (idx === 1) rankClass = 'rank-silver';
        else if (idx === 2) rankClass = 'rank-bronze';

        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td class="${rankClass}">${idx + 1}</td>
          <td style="font-weight:600">${p.Username}</td>
          <td class="text-center">${p.Wins}</td>
          <td class="text-right" style="color:var(--color-yellow); font-weight:800">${p.TotalScore}</td>
        `;
        body.appendChild(tr);
      });
    } else {
      body.innerHTML = `<tr><td colspan="4" class="text-center">No scores yet. Win a match!</td></tr>`;
    }

    // Fetch and populate Match history
    const historyResult = await UnoAPI.getMatchHistory();
    const historyList = document.getElementById('match-history-list');
    historyList.innerHTML = '';

    if (historyResult.success && historyResult.history.length > 0) {
      historyResult.history.forEach(m => {
        const li = document.createElement('li');
        li.className = 'history-item';
        
        const dateStr = new Date(m.PlayedAt).toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        });

        li.innerHTML = `
          <div class="history-winner">
            <span>👑</span>
            <span>${m.Winner}</span>
          </div>
          <div style="display:flex; align-items:center; gap: 15px">
            <span class="history-score">+${m.Score} pts</span>
            <span class="history-date">${dateStr}</span>
          </div>
        `;
        historyList.appendChild(li);
      });
    } else {
      historyList.innerHTML = `<li class="text-center">No matches recorded.</li>`;
    }
  },


  // ==========================================================================
  // REAL-TIME MULTIPLAYER SYSTEM (Socket.io)
  // ==========================================================================
  connectMultiplayer(roomCodeToJoin) {
    this.isMultiplayer = true;
    
    // Connect to websocket server
    const socketUrl = window.location.origin;
    this.socket = io(socketUrl);

    this.socket.on('connect', () => {
      console.log('Connected to socket server');
      this.socket.emit('join_room', { username: this.myUsername, roomId: roomCodeToJoin });
    });

    this.socket.on('joined_room_success', ({ roomId, myUsername }) => {
      this.activeRoomId = roomId;
      document.getElementById('lobby-room-code').innerText = roomId;
      document.getElementById('game-room-code-display').innerText = `Room Code: ${roomId}`;
      document.getElementById('game-mode-tag').innerText = 'MULTIPLAYER';
      document.getElementById('game-mode-tag').className = 'mode-badge-online';
      this.switchScreen('screen-lobby');
    });

    this.socket.on('room_update', ({ roomId, players, hostSocketId }) => {
      document.getElementById('lobby-player-count').innerText = players.length;
      
      const grid = document.getElementById('lobby-players-grid');
      grid.innerHTML = '';

      this.isHost = hostSocketId === this.socket.id;
      
      // Toggle start button for host
      const startBtn = document.getElementById('btn-lobby-start-game');
      if (this.isHost) {
        startBtn.classList.remove('disabled');
        startBtn.disabled = false;
      } else {
        startBtn.classList.add('disabled');
        startBtn.disabled = true;
      }

      // Fill 4 seats visually
      for (let i = 0; i < 4; i++) {
        const slot = document.createElement('div');
        slot.className = 'lobby-player-slot';

        if (players[i]) {
          slot.classList.add('occupied');
          const isUserHost = players[i].socketId === hostSocketId;
          if (isUserHost) slot.classList.add('host');

          slot.innerHTML = `
            <div class="player-slot-avatar">👤</div>
            <div class="player-slot-details">
              <span class="player-slot-name">${players[i].username} ${players[i].socketId === this.socket.id ? '(You)' : ''}</span>
              <span class="player-slot-role">${isUserHost ? '👑 Room Host' : 'Player'}</span>
            </div>
          `;
        } else {
          slot.innerHTML = `
            <div class="player-slot-avatar" style="background:#1e293b; color:#475569">💤</div>
            <div class="player-slot-details">
              <span class="player-slot-name" style="color:#475569">Open Slot</span>
              <span class="player-slot-role">Waiting...</span>
            </div>
          `;
        }
        grid.appendChild(slot);
      }
    });

    this.socket.on('chat_broadcast', ({ username, text }) => {
      const container = document.getElementById('chat-messages');
      const div = document.createElement('div');
      
      const isMe = username === this.myUsername;
      div.className = isMe ? 'chat-msg me' : 'chat-msg';
      div.innerHTML = `
        <span class="chat-sender">${username}</span>
        <span class="chat-text">${text}</span>
      `;
      container.appendChild(div);
      container.scrollTop = container.scrollHeight;
    });

    this.socket.on('game_event', (eventMsg) => {
      this.announceGameEvent(eventMsg);
    });

    this.socket.on('uno_shouted', ({ username }) => {
      this.announceGameEvent(`🎉 ${username} shouted UNO!`);
      UnoAudio.playUnoAlert();
      this.popUnoSpeechBubble(username);
    });

    this.socket.on('uno_challenge_success', ({ challenger, victim }) => {
      this.announceGameEvent(`🚨 ${challenger} caught ${victim} without shouting UNO! 2 card penalty applied.`);
      UnoAudio.playChallengeChime();
    });

    this.socket.on('error_message', (msg) => {
      alert(msg);
    });

    // SYNC FULL STATE
    this.socket.on('game_state', (state) => {
      this.switchScreen('screen-game');
      this.syncMultiplayerGameBoard(state);
    });

    // DRAW DECISION MODAL / ACTIONS
    this.socket.on('drawn_card_pending_decision', ({ card, canPlay }) => {
      UnoAudio.playDraw();
      if (canPlay) {
        // Player drawn a card they can play. Standard rules prompt them
        this.drawnCardDecision = card;
        document.getElementById('btn-game-pass').classList.remove('disabled');
        document.getElementById('btn-game-pass').disabled = false;
        this.announceGameEvent('You drew a playable card! Choose to Play it or Pass turn.');
      } else {
        // Auto-pass decision to keep game fast
        setTimeout(() => {
          this.socket.emit('pass_turn');
        }, 1500);
      }
    });

    this.socket.on('game_over', ({ winner, score, message }) => {
      const isWin = winner === this.myUsername;
      if (isWin) {
        UnoAudio.playWin();
      } else {
        UnoAudio.playLose();
      }

      document.getElementById('game-over-title').innerText = isWin ? 'Victory!' : 'Defeat!';
      document.getElementById('game-over-description').innerText = message || `${winner} has emptied their hand and won the round!`;
      document.getElementById('game-over-score').innerText = score;
      
      document.getElementById('popup-game-over').classList.remove('hidden');
    });
  },

  syncMultiplayerGameBoard(state) {
    this.hand = state.myHand;
    this.activeColor = state.activeColor;
    
    // Check if it's my turn
    const activePlayer = state.players[state.activePlayerIndex];
    this.isMyTurn = activePlayer.socketId === this.socket.id;

    // Reset drawn decisions
    this.drawnCardDecision = null;

    // Direct Action Feeds & audio triggers
    if (this.isMyTurn) {
      document.getElementById('game-my-status').innerText = 'Your Turn!';
      document.getElementById('game-my-status').className = 'hud-status active';
      document.getElementById('btn-game-draw').classList.remove('disabled');
      document.getElementById('btn-game-draw').disabled = false;
      document.getElementById('btn-game-pass').classList.add('disabled');
      document.getElementById('btn-game-pass').disabled = true;
    } else {
      document.getElementById('game-my-status').innerText = `Waiting for ${activePlayer.username}...`;
      document.getElementById('game-my-status').className = 'hud-status';
      document.getElementById('btn-game-draw').classList.add('disabled');
      document.getElementById('btn-game-draw').disabled = true;
      document.getElementById('btn-game-pass').classList.add('disabled');
      document.getElementById('btn-game-pass').disabled = true;
    }

    // Set central card
    this.renderTopDiscardPileCard(state.topCard);
    
    // Set deck draw counts
    document.getElementById('draw-pile-count').innerText = state.drawPileCount;
    
    // Set color indicators
    this.updateFeltColorIndicator(state.activeColor);

    // Direction spin ring direction
    const ring = document.getElementById('direction-indicator-ring');
    if (state.direction === 1) {
      ring.className = 'direction-ring clockwise';
    } else {
      ring.className = 'direction-ring counter-clockwise';
    }

    // Render my hand
    this.renderPlayerHand(this.hand, state.topCard, state.activeColor);

    // Dynamic Seating assignments
    // Arrange active online seats relative to my seating index
    const mySeatIdx = state.players.findIndex(p => p.socketId === this.socket.id);
    const opponents = [];
    
    const totalCount = state.players.length;
    for (let i = 1; i < totalCount; i++) {
      const idx = (mySeatIdx + i) % totalCount;
      opponents.push({ ...state.players[idx], active: idx === state.activePlayerIndex });
    }

    this.positionOpponentSeatsVisuals(opponents);

    // Update player HUD username card count
    const myCount = this.hand.length;
    document.getElementById('game-my-username').innerText = `${this.myUsername} (You) • ${myCount} card${myCount !== 1 ? 's' : ''}`;

  },


  checkMultiplayerChallengeOpponents() {
    // Scans players to see if someone has 1 card left and didn't declare UNO, allowing a quick challenge!
    if (!this.socket) return;
    this.socket.emit('shout_uno'); // Emits my own shout. The server logic checks challenges sequentially inside the socket context automatically on 'shout_uno' or similar. 
  },


  // ==========================================================================
  // OFFLINE GAME ENGINE (VS SMART AI DECK & LOOPS)
  // ==========================================================================
  startOfflineGame(botCount) {
    this.isMultiplayer = false;
    this.isHost = true;
    this.activeRoomId = 'VS-AI';
    
    document.getElementById('game-room-code-display').innerText = 'Room Code: VS-AI';
    document.getElementById('game-mode-tag').innerText = 'OFFLINE PRACTICE';
    document.getElementById('game-mode-tag').className = 'mode-badge-offline';
    
    this.switchScreen('screen-game');
    
    // Setup Engine State
    const deck = this.generateOfflineDeck();
    const players = [];

    // Player (You)
    players.push({
      name: this.myUsername,
      hand: [],
      isBot: false,
      socketId: 'player'
    });

    // AI Bots
    for (let i = 1; i <= botCount; i++) {
      players.push({
        name: `Computer AI ${i}`,
        hand: [],
        isBot: true,
        socketId: `bot_${i}`
      });
    }

    // Deal 7 cards
    players.forEach(p => {
      for (let i = 0; i < 7; i++) {
        p.hand.push(deck.pop());
      }
    });

    // Starting Card
    let top = deck.pop();
    while (top.color === 'wild') {
      deck.unshift(top);
      this.shuffleArray(deck);
      top = deck.pop();
    }

    this.offlineState = {
      players,
      deck,
      discardPile: [top],
      activeIdx: 0,
      direction: 1,
      currentColor: top.color,
      topCard: top,
      unoDeclared: {},
      pendingUnoPenalty: {},
      penaltyTimer: null,
      hasDrawnThisTurn: false
    };

    this.announceGameEvent('Practice match started against smart AI! Your turn first.');
    UnoAudio.playSlide();

    this.syncOfflineGameBoard();
  },

  syncOfflineGameBoard() {
    const state = this.offlineState;
    const player = state.players[0]; // Player is index 0
    this.hand = player.hand;
    this.activeColor = state.currentColor;
    this.isMyTurn = state.activeIdx === 0;

    // Hud adjustments
    if (this.isMyTurn) {
      document.getElementById('game-my-status').innerText = 'Your Turn!';
      document.getElementById('game-my-status').className = 'hud-status active';
      document.getElementById('btn-game-draw').classList.remove('disabled');
      document.getElementById('btn-game-draw').disabled = false;
      
      if (state.hasDrawnThisTurn) {
        document.getElementById('btn-game-pass').classList.remove('disabled');
        document.getElementById('btn-game-pass').disabled = false;
      } else {
        document.getElementById('btn-game-pass').classList.add('disabled');
        document.getElementById('btn-game-pass').disabled = true;
      }
    } else {
      const activeObj = state.players[state.activeIdx];
      document.getElementById('game-my-status').innerText = `Waiting for ${activeObj.name}...`;
      document.getElementById('game-my-status').className = 'hud-status';
      document.getElementById('btn-game-draw').classList.add('disabled');
      document.getElementById('btn-game-draw').disabled = true;
      document.getElementById('btn-game-pass').classList.add('disabled');
      document.getElementById('btn-game-pass').disabled = true;
    }

    this.renderTopDiscardPileCard(state.topCard);
    document.getElementById('draw-pile-count').innerText = state.deck.length;
    this.updateFeltColorIndicator(state.currentColor);

    const ring = document.getElementById('direction-indicator-ring');
    if (state.direction === 1) {
      ring.className = 'direction-ring clockwise';
    } else {
      ring.className = 'direction-ring counter-clockwise';
    }

    this.renderPlayerHand(this.hand, state.topCard, state.currentColor);

    // Seat visual structures
    const opponents = [];
    const total = state.players.length;
    for (let i = 1; i < total; i++) {
      opponents.push({
        username: state.players[i].name,
        socketId: state.players[i].socketId,
        handCount: state.players[i].hand.length,
        active: i === state.activeIdx,
        hasUno: state.players[i].hand.length === 1 && state.unoDeclared[i]
      });
    }

    this.positionOpponentSeatsVisuals(opponents);

    // Update player HUD username card count
    const myCount = this.hand.length;
    document.getElementById('game-my-username').innerText = `${this.myUsername} (You) • ${myCount} card${myCount !== 1 ? 's' : ''}`;


    // If active player is a bot, trigger its turn!
    if (!this.isMyTurn) {
      setTimeout(() => {
        this.executeOfflineBotTurn();
      }, 1500 + Math.random() * 800); // realistic delays
    }
  },

  handleOfflinePlayRequest(cardId) {
    if (!this.isMyTurn) return;
    
    const card = this.hand.find(c => c.id === cardId);
    if (!card) return;

    // Verify rules matching
    const isPlayable = card.color === 'wild' || card.color === this.activeColor || card.value === this.offlineState.topCard.value;
    if (!isPlayable) {
      alert('Invalid move! Card color or type must match.');
      return;
    }

    this.selectedCardId = cardId;

    if (card.color === 'wild') {
      // Open radial chooser
      document.getElementById('popup-color-chooser').classList.remove('hidden');
    } else {
      this.executeOfflinePlay(cardId, null);
    }
  },

  executeOfflinePlay(cardId, chosenColor) {
    const state = this.offlineState;
    const player = state.players[state.activeIdx]; // Active player
    const cardIdx = player.hand.findIndex(c => c.id === cardId);
    const card = player.hand[cardIdx];

    // Pop card and throw on pile
    player.hand.splice(cardIdx, 1);
    state.discardPile.push(card);
    state.topCard = card;
    state.currentColor = (card.color === 'wild' && chosenColor) ? chosenColor : card.color;

    this.announceGameEvent(`${player.name} played ${card.color} ${card.value}${chosenColor ? ' (chosen: ' + chosenColor + ')' : ''}`);
    
    // Synthesise audio based on card value
    this.playAudioForCardValue(card);

    // Penalty triggers for missing UNO shouts
    const remaining = player.hand.length;
    if (remaining === 1) {
      if (!state.unoDeclared[state.activeIdx]) {
        state.pendingUnoPenalty[state.activeIdx] = true;
        // Schedule challenge timer
        state.penaltyTimer = setTimeout(() => {
          if (state.pendingUnoPenalty[state.activeIdx]) {
            this.announceGameEvent(`🚨 ${player.name} forgot to shout UNO! 2 card penalty applied.`);
            this.drawCardsOffline(player, 2);
            delete state.pendingUnoPenalty[state.activeIdx];
            this.syncOfflineGameBoard();
          }
        }, 2200);
      }
    } else {
      delete state.unoDeclared[state.activeIdx];
      delete state.pendingUnoPenalty[state.activeIdx];
    }

    // Check round over
    if (remaining === 0) {
      this.declareOfflineWinner(player);
      return;
    }

    // Apply Actions & turn cycles
    let jumps = 1;
    const count = state.players.length;

    if (card.value === 'skip') {
      jumps = 2;
    } else if (card.value === 'reverse') {
      if (count === 2) {
        jumps = 2; // reverse acts as skip in 2-player
      } else {
        state.direction *= -1;
      }
    } else if (card.value === 'draw2') {
      const nextIdx = (state.activeIdx + state.direction * 1 + count) % count;
      const victim = state.players[nextIdx];
      this.drawCardsOffline(victim, 2);
      jumps = 2;
      this.announceGameEvent(`${victim.name} drew 2 cards and is skipped.`);
    } else if (card.value === 'wild4') {
      const nextIdx = (state.activeIdx + state.direction * 1 + count) % count;
      const victim = state.players[nextIdx];
      this.drawCardsOffline(victim, 4);
      jumps = 2;
      this.announceGameEvent(`${victim.name} drew 4 cards and is skipped. Color is ${state.currentColor}.`);
    }

    // Cycle turns
    state.activeIdx = (state.activeIdx + state.direction * jumps + count * 2) % count;
    state.hasDrawnThisTurn = false;

    this.syncOfflineGameBoard();
  },

  handleOfflineDraw() {
    if (!this.isMyTurn || this.offlineState.hasDrawnThisTurn) return;
    
    const state = this.offlineState;
    const player = state.players[0];

    this.recycleOfflineDeckIfNeeded();
    const drawn = state.deck.pop();
    player.hand.push(drawn);
    state.hasDrawnThisTurn = true;

    // Clear UNO declared since player count has increased
    delete state.unoDeclared[0];
    delete state.pendingUnoPenalty[0];

    UnoAudio.playDraw();
    this.announceGameEvent('You drew a card from the deck.');

    // Rules checking if the card is playable
    const isPlayable = drawn.color === 'wild' || drawn.color === state.currentColor || drawn.value === state.topCard.value;
    
    if (isPlayable) {
      this.announceGameEvent('You drew a playable card! Choose to play it or Pass.');
    } else {
      this.announceGameEvent('Card drawn is not playable. Click Pass to end your turn.');
    }

    this.syncOfflineGameBoard();
  },

  handleOfflinePass() {
    if (!this.isMyTurn || !this.offlineState.hasDrawnThisTurn) return;

    const state = this.offlineState;
    const count = state.players.length;
    
    state.activeIdx = (state.activeIdx + state.direction * 1 + count) % count;
    state.hasDrawnThisTurn = false;
    
    this.announceGameEvent('You passed your turn.');
    this.syncOfflineGameBoard();
  },

  handleOfflineUnoShout() {
    const state = this.offlineState;
    const player = state.players[0];

    // If player has 2 cards and is shouting before playing or within penalty window
    if (player.hand.length <= 2) {
      state.unoDeclared[0] = true;
      delete state.pendingUnoPenalty[0];
      UnoAudio.playUnoAlert();
      this.announceGameEvent('🎉 You shouted UNO!');
      this.popUnoSpeechBubble(player.name);
      this.syncOfflineGameBoard();
    }

    // Challenge check on other bots!
    // Scans if another bot has 1 card, has NOT declared UNO, and we caught them!
    for (let i = 1; i < state.players.length; i++) {
      const botObj = state.players[i];
      if (botObj.hand.length === 1 && state.pendingUnoPenalty[i]) {
        this.announceGameEvent(`🚨 You caught ${botObj.name} without shouting UNO! 2 card penalty applied.`);
        UnoAudio.playChallengeChime();
        this.drawCardsOffline(botObj, 2);
        delete state.pendingUnoPenalty[i];
        this.syncOfflineGameBoard();
        break;
      }
    }
  },

  executeOfflineBotTurn() {
    const state = this.offlineState;
    const bot = state.players[state.activeIdx];
    if (!bot || !bot.isBot) return;

    // Search hand for playable cards
    const playable = bot.hand.filter(c => c.color === 'wild' || c.color === state.currentColor || c.value === state.topCard.value);

    if (playable.length > 0) {
      // Smart bot logic: prefers sabotaging neighbors (action cards) if close to victory, or values matching color/number
      let selectedCard = null;
      
      const actions = playable.filter(c => c.value === 'wild4' || c.value === 'draw2' || c.value === 'skip' || c.value === 'reverse');
      const numbers = playable.filter(c => c.value !== 'wild4' && c.value !== 'draw2' && c.value !== 'skip' && c.value !== 'reverse');

      // AI prioritizes action cards if opponents are low on cards
      const areOpponentsLow = state.players.some((p, idx) => idx !== state.activeIdx && p.hand.length <= 2);
      
      if (areOpponentsLow && actions.length > 0) {
        selectedCard = actions[Math.floor(Math.random() * actions.length)];
      } else if (numbers.length > 0) {
        selectedCard = numbers[Math.floor(Math.random() * numbers.length)];
      } else {
        selectedCard = playable[Math.floor(Math.random() * playable.length)];
      }

      // Choose wild color
      let chosenColor = null;
      if (selectedCard.color === 'wild') {
        chosenColor = this.getSmartBotDominantColor(bot);
      }

      // Bot shout UNO decision (10% chancebot slips up and "forgets", giving the user a QTE target to challenge!)
      if (bot.hand.length === 2) {
        const shoutChance = Math.random() < 0.9; // 90% success rate
        if (shoutChance) {
          state.unoDeclared[state.activeIdx] = true;
          delete state.pendingUnoPenalty[state.activeIdx];
          setTimeout(() => {
            UnoAudio.playUnoAlert();
            this.announceGameEvent(`🎉 ${bot.name} shouted UNO!`);
            this.popUnoSpeechBubble(bot.name);
            this.syncOfflineGameBoard();
          }, 400);
        } else {
          console.log(`${bot.name} slipped up! Forgot to declare UNO.`);
        }
      }

      // Execute play
      setTimeout(() => {
        this.executeOfflinePlay(selectedCard.id, chosenColor);
      }, 800);

    } else {
      // No playable cards, bot must draw
      this.recycleOfflineDeckIfNeeded();
      const drawn = state.deck.pop();
      bot.hand.push(drawn);
      
      this.announceGameEvent(`${bot.name} drew a card.`);
      UnoAudio.playDraw();

      // Clear any pending shouts because hand increased
      delete state.unoDeclared[state.activeIdx];
      delete state.pendingUnoPenalty[state.activeIdx];

      // Can bot play drawn card?
      const isPlayable = drawn.color === 'wild' || drawn.color === state.currentColor || drawn.value === state.topCard.value;
      if (isPlayable) {
        let chosenColor = null;
        if (drawn.color === 'wild') {
          chosenColor = this.getSmartBotDominantColor(bot);
        }
        setTimeout(() => {
          this.executeOfflinePlay(drawn.id, chosenColor);
        }, 1000);
      } else {
        // Pass
        setTimeout(() => {
          const count = state.players.length;
          state.activeIdx = (state.activeIdx + state.direction * 1 + count) % count;
          this.announceGameEvent(`${bot.name} passed turn.`);
          this.syncOfflineGameBoard();
        }, 1000);
      }
    }
  },

  getSmartBotDominantColor(bot) {
    // bot looks at its hand, filters color distributions, and picks its most populated color
    const counts = { red: 0, yellow: 0, green: 0, blue: 0 };
    bot.hand.forEach(c => {
      if (counts[c.color] !== undefined) counts[c.color]++;
    });
    
    let maxColor = 'red';
    let maxVal = -1;
    for (const key in counts) {
      if (counts[key] > maxVal) {
        maxVal = counts[key];
        maxColor = key;
      }
    }
    return maxColor;
  },

  drawCardsOffline(player, count) {
    const state = this.offlineState;
    for (let i = 0; i < count; i++) {
      this.recycleOfflineDeckIfNeeded();
      if (state.deck.length > 0) {
        player.hand.push(state.deck.pop());
      }
    }
    // Clear shout flags
    const idx = state.players.findIndex(p => p.socketId === player.socketId);
    delete state.unoDeclared[idx];
    delete state.pendingUnoPenalty[idx];
  },

  recycleOfflineDeckIfNeeded() {
    const state = this.offlineState;
    if (state.deck.length === 0) {
      const top = state.discardPile.pop();
      state.deck = [...state.discardPile];
      this.shuffleArray(state.deck);
      state.discardPile = [top];
      this.announceGameEvent('The draw deck has been recycled.');
    }
  },

  declareOfflineWinner(player) {
    const isWin = player.socketId === 'player';
    
    if (isWin) {
      UnoAudio.playWin();
    } else {
      UnoAudio.playLose();
    }

    // Calculate official scores (sum of opponent card scores)
    let score = 0;
    this.offlineState.players.forEach(p => {
      p.hand.forEach(c => {
        score += c.score || 0;
      });
    });
    if (score === 0) score = 100; // default minimum award

    // Save match if user is logged in
    if (this.isLoggedIn) {
      UnoAPI.saveMatch(player.name, score);
    }

    document.getElementById('game-over-title').innerText = isWin ? 'Victory!' : 'Defeat!';
    document.getElementById('game-over-description').innerText = isWin ? 'You successfully emptied your hand and conquered the arena!' : `${player.name} has beaten you to the punch. Better luck next time!`;
    document.getElementById('game-over-score').innerText = score;
    
    document.getElementById('popup-game-over').classList.remove('hidden');
  },

  generateOfflineDeck() {
    const colors = ['red', 'yellow', 'green', 'blue'];
    const deck = [];

    colors.forEach(color => {
      deck.push({ id: `0_${color}_0`, color, value: '0', score: 0 });
      for (let i = 1; i <= 9; i++) {
        deck.push({ id: `${i}_${color}_a`, color, value: i.toString(), score: i });
        deck.push({ id: `${i}_${color}_b`, color, value: i.toString(), score: i });
      }
      // Action cards
      deck.push({ id: `skip_${color}_a`, color, value: 'skip', score: 20 });
      deck.push({ id: `skip_${color}_b`, color, value: 'skip', score: 20 });
      deck.push({ id: `reverse_${color}_a`, color, value: 'reverse', score: 20 });
      deck.push({ id: `reverse_${color}_b`, color, value: 'reverse', score: 20 });
      deck.push({ id: `draw2_${color}_a`, color, value: 'draw2', score: 20 });
      deck.push({ id: `draw2_${color}_b`, color, value: 'draw2', score: 20 });
    });

    // Wilds
    for (let i = 0; i < 4; i++) {
      deck.push({ id: `wild_${i}`, color: 'wild', value: 'wild', score: 50 });
      deck.push({ id: `wild4_${i}`, color: 'wild', value: 'wild4', score: 50 });
    }

    this.shuffleArray(deck);
    return deck;
  },


  // ==========================================================================
  // VIEW RENDER ENGINES (CARDS, FELT, GLOWS, SPEECH BUBBLES)
  // ==========================================================================
  renderPlayerHand(hand, topCard, activeColor) {
    const container = document.getElementById('player-hand-container');
    container.innerHTML = '';

    const count = hand.length;
    hand.forEach((card, idx) => {
      // Calculate angular cards fan layout
      const relativePosition = idx - (count - 1) / 2;
      const angle = relativePosition * 4.5; // fan spacing angle
      const offsetY = Math.abs(relativePosition) * 3; // slide depth offset

      // Build premium HTML card vector
      const el = document.createElement('div');
      el.className = `uno-card ${card.color}`;
      el.id = `card-${card.id}`;
      el.style.setProperty('--angle', `${angle}deg`);
      el.style.setProperty('--offset-y', `${offsetY}px`);

      // Match check to apply active styling
      const isPlayable = this.isMyTurn && (card.color === 'wild' || card.color === activeColor || card.value === topCard.value);
      if (isPlayable) {
        el.classList.add('playable');
      }

      // Card structure
      const formattedVal = this.getCardFormatDetails(card.value);
      el.innerHTML = `
        <div class="card-corner top-left">${formattedVal.corner}</div>
        <div class="card-oval">
          <div class="card-center-val">${formattedVal.center}</div>
        </div>
        <div class="card-corner bottom-right">${formattedVal.corner}</div>
      `;

      // Handle card playing triggers
      el.addEventListener('click', () => {
        if (!this.isMyTurn || !isPlayable) return;
        
        if (this.isMultiplayer) {
          this.selectedCardId = card.id;
          if (card.color === 'wild') {
            document.getElementById('popup-color-chooser').classList.remove('hidden');
          } else {
            this.socket.emit('play_card', { cardId: card.id, chosenColor: null });
          }
        } else {
          this.handleOfflinePlayRequest(card.id);
        }
      });

      container.appendChild(el);
    });
  },

  renderTopDiscardPileCard(card) {
    const discard = document.getElementById('deck-discard-pile');
    discard.innerHTML = '';
    
    if (!card) return;

    discard.className = `uno-card discard-pile-card ${card.color}`;
    const formatted = this.getCardFormatDetails(card.value);
    
    discard.innerHTML = `
      <div class="card-corner top-left">${formatted.corner}</div>
      <div class="card-oval">
        <div class="card-center-val">${formatted.center}</div>
      </div>
      <div class="card-corner bottom-right">${formatted.corner}</div>
    `;
  },

  getCardFormatDetails(value) {
    switch (value) {
      case 'skip':
        return { corner: '⊘', center: '⊘' };
      case 'reverse':
        return { corner: '⇅', center: '⇅' };
      case 'draw2':
        return { corner: '+2', center: '+2' };
      case 'wild':
        return { corner: 'W', center: 'Wild' };
      case 'wild4':
        return {
          corner: '+4',
          center: `
            <div class="mini-cards-vector">
              <div class="mini-card-color"></div>
              <div class="mini-card-color"></div>
              <div class="mini-card-color"></div>
              <div class="mini-card-color"></div>
            </div>
          `
        };
      default:
        return { corner: value, center: value };
    }
  },

  updateFeltColorIndicator(color) {
    const textEl = document.getElementById('text-active-color');
    const dotEl = document.getElementById('dot-active-color');
    
    textEl.innerText = color.charAt(0).toUpperCase() + color.slice(1);
    dotEl.className = `color-dot ${color}`;
  },


  positionOpponentSeatsVisuals(opponents) {
    // Helper to hide seats that are not in use
    const leftSeat = document.getElementById('seat-left');
    const topSeat = document.getElementById('seat-top');
    const rightSeat = document.getElementById('seat-right');

    leftSeat.style.display = 'none';
    topSeat.style.display = 'none';
    rightSeat.style.display = 'none';

    leftSeat.classList.remove('active-turn');
    topSeat.classList.remove('active-turn');
    rightSeat.classList.remove('active-turn');

    const totalCount = opponents.length;

    if (totalCount === 1) {
      // 2 players total. Single opponent in Top seat
      this.populateOpponentSeatUI(topSeat, opponents[0]);
    } else if (totalCount === 2) {
      // 3 players total. Left and Right seats
      this.populateOpponentSeatUI(leftSeat, opponents[0]);
      this.populateOpponentSeatUI(rightSeat, opponents[1]);
    } else if (totalCount === 3) {
      // 4 players total. Left, Top, and Right seats
      this.populateOpponentSeatUI(leftSeat, opponents[0]);
      this.populateOpponentSeatUI(topSeat, opponents[1]);
      this.populateOpponentSeatUI(rightSeat, opponents[2]);
    }
  },

  populateOpponentSeatUI(seatElement, opponentData) {
    seatElement.style.display = 'flex';
    
    const countBubble = seatElement.querySelector('.card-count-bubble');
    const nameLabel = seatElement.querySelector('.seat-name');

    countBubble.innerText = opponentData.handCount;
    nameLabel.innerText = opponentData.username;

    if (opponentData.active) {
      seatElement.classList.add('active-turn');
    }
    
    // Set seat visual attributes for target queries
    seatElement.setAttribute('data-socket-id', opponentData.socketId);
    
    // Seat avatar logic
    const avatar = seatElement.querySelector('.seat-avatar');
    if (opponentData.username.includes('Computer AI')) {
      avatar.innerText = '🤖';
    } else {
      avatar.innerText = '👤';
    }

    // UNO Shout Bubble
    const unoBubble = seatElement.querySelector('.uno-bubble');
    if (opponentData.hasUno) {
      unoBubble.classList.add('show');
    } else {
      unoBubble.classList.remove('show');
    }
  },

  popUnoSpeechBubble(username) {
    const seats = document.querySelectorAll('.player-seat');
    seats.forEach(s => {
      const name = s.querySelector('.seat-name');
      if (name && name.innerText === username) {
        const bubble = s.querySelector('.uno-bubble');
        if (bubble) {
          bubble.classList.add('show');
          setTimeout(() => {
            bubble.classList.remove('show');
          }, 3000);
        }
      }
    });
  },

  announceGameEvent(text) {
    const feed = document.getElementById('game-action-announcement');
    feed.innerText = text;
    
    // Trigger quick feed bounce animation
    feed.style.animation = 'none';
    feed.offsetHeight; /* trigger reflow */
    feed.style.animation = 'slideFeed 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards';
  },

  playAudioForCardValue(card) {
    switch (card.value) {
      case 'skip':
        UnoAudio.playSkip();
        break;
      case 'reverse':
        UnoAudio.playReverse();
        break;
      case 'wild':
      case 'wild4':
        UnoAudio.playWild();
        break;
      default:
        UnoAudio.playSlide();
        break;
    }
  },

  // --- UTILS ---
  shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
  }
};

// Start Frontpage client when content finishes loading
window.addEventListener('DOMContentLoaded', () => {
  UnoGame.init();
});
