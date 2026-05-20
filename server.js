const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const db = require('./server/db');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Initialize JSON database
db.init();

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- REST API ENDPOINTS ---

// Register
app.post('/api/auth/register', (req, res) => {
  try {
    const { username, password } = req.body;
    const user = db.registerUser(username, password);
    res.status(201).json({ success: true, user });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// Login
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.loginUser(username, password);
  if (user) {
    res.json({ success: true, user });
  } else {
    res.status(401).json({ success: false, message: 'Invalid username or password' });
  }
});

// Leaderboard
app.get('/api/leaderboard', (req, res) => {
  try {
    const leaderboard = db.getLeaderboard();
    res.json({ success: true, leaderboard });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Match History
app.get('/api/matches', (req, res) => {
  try {
    const history = db.getMatchHistory();
    res.json({ success: true, history });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Save custom match result (e.g. for offline matches)
app.post('/api/matches', (req, res) => {
  try {
    const { winner, score } = req.body;
    if (!winner) {
      return res.status(400).json({ success: false, message: 'Winner name is required' });
    }
    const match = db.addMatch(winner, score);
    res.status(201).json({ success: true, match });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});


// --- REAL-TIME MULTIPLAYER STATE (Socket.io) ---

const rooms = {}; // RoomId -> RoomState
const socketToUser = {}; // SocketId -> { username, roomId }

// Generate full standard UNO Deck (108 cards)
function createDeck() {
  const colors = ['red', 'yellow', 'green', 'blue'];
  const deck = [];

  colors.forEach(color => {
    // One '0' card per color
    deck.push({ id: `0_${color}_0`, color, value: '0', score: 0 });
    
    // Two of each '1'-'9' cards per color
    for (let i = 1; i <= 9; i++) {
      deck.push({ id: `${i}_${color}_a`, color, value: i.toString(), score: i });
      deck.push({ id: `${i}_${color}_b`, color, value: i.toString(), score: i });
    }

    // Two of each Action Cards per color: Skip, Reverse, Draw Two
    deck.push({ id: `skip_${color}_a`, color, value: 'skip', score: 20 });
    deck.push({ id: `skip_${color}_b`, color, value: 'skip', score: 20 });
    
    deck.push({ id: `reverse_${color}_a`, color, value: 'reverse', score: 20 });
    deck.push({ id: `reverse_${color}_b`, color, value: 'reverse', score: 20 });
    
    deck.push({ id: `draw2_${color}_a`, color, value: 'draw2', score: 20 });
    deck.push({ id: `draw2_${color}_b`, color, value: 'draw2', score: 20 });
  });

  // Wild and Wild Draw Four (4 of each)
  for (let i = 0; i < 4; i++) {
    deck.push({ id: `wild_${i}`, color: 'wild', value: 'wild', score: 50 });
    deck.push({ id: `wild4_${i}`, color: 'wild', value: 'wild4', score: 50 });
  }

  return deck;
}

// Shuffle deck
function shuffle(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

// Calculate score for the winner based on remaining cards in others' hands
function calculateWinnerScore(losers) {
  let score = 0;
  losers.forEach(player => {
    player.hand.forEach(card => {
      score += card.score || 0;
    });
  });
  return score === 0 ? 100 : score; // Fallback score to give credit
}

io.on('connection', (socket) => {
  console.log(`Socket connected: ${socket.id}`);

  // Send list of active, non-started, non-full rooms
  socket.on('get_lobbies', () => {
    const lobbies = Object.values(rooms)
      .filter(r => !r.gameStarted && r.players.length < 4)
      .map(r => ({
        roomId: r.roomId,
        playerCount: r.players.length,
        host: r.players[0] ? r.players[0].username : 'Unknown'
      }));
    socket.emit('lobbies_list', lobbies);
  });

  // Join Room
  socket.on('join_room', ({ username, roomId }) => {
    let targetRoomId = roomId ? roomId.trim().toUpperCase() : null;
    
    if (!targetRoomId) {
      // Find or create a random lobby
      const availableRoom = Object.values(rooms).find(r => !r.gameStarted && r.players.length < 4);
      if (availableRoom) {
        targetRoomId = availableRoom.roomId;
      } else {
        targetRoomId = Math.random().toString(36).substring(2, 7).toUpperCase();
      }
    }

    if (!rooms[targetRoomId]) {
      rooms[targetRoomId] = {
        roomId: targetRoomId,
        players: [],
        deck: [],
        discardPile: [],
        activePlayerIndex: 0,
        direction: 1, // 1 for clockwise, -1 for counter-clockwise
        currentActiveColor: '',
        gameStarted: false,
        unoDeclared: {}, // socketId -> boolean
        hasPlayedThisTurn: false,
        pendingUnoShoutPenalty: {}, // socketId -> boolean (requires UNO but haven't yelled yet)
        turnTimer: null
      };
    }

    const room = rooms[targetRoomId];

    if (room.gameStarted) {
      socket.emit('error_message', 'Game in this room has already started.');
      return;
    }

    if (room.players.length >= 4) {
      socket.emit('error_message', 'Room is full. Max 4 players.');
      return;
    }

    // Join Socket.io room channel
    socket.join(targetRoomId);
    
    const newPlayer = {
      socketId: socket.id,
      username,
      hand: []
    };

    room.players.push(newPlayer);
    socketToUser[socket.id] = { username, roomId: targetRoomId };

    console.log(`User ${username} (${socket.id}) joined room ${targetRoomId}`);

    // Notify room of updated player list
    io.to(targetRoomId).emit('room_update', {
      roomId: targetRoomId,
      players: room.players.map(p => ({ username: p.username, socketId: p.socketId, handCount: p.hand.length })),
      hostSocketId: room.players[0].socketId
    });

    // Send success join notification
    socket.emit('joined_room_success', { roomId: targetRoomId, myUsername: username });
  });

  // Start Game
  socket.on('start_game', () => {
    const user = socketToUser[socket.id];
    if (!user) return;

    const room = rooms[user.roomId];
    if (!room) return;

    // Only host (first player in list) can start the game
    if (room.players[0].socketId !== socket.id) {
      socket.emit('error_message', 'Only the room host can start the game.');
      return;
    }

    if (room.players.length < 2) {
      socket.emit('error_message', 'Need at least 2 players to start UNO.');
      return;
    }

    // Setup Deck
    room.deck = shuffle(createDeck());
    room.discardPile = [];
    room.direction = 1;
    room.activePlayerIndex = 0;
    room.gameStarted = true;
    room.unoDeclared = {};
    room.pendingUnoShoutPenalty = {};

    // Deal 7 cards to each player
    room.players.forEach(player => {
      player.hand = [];
      for (let i = 0; i < 7; i++) {
        player.hand.push(room.deck.pop());
      }
    });

    // Turn up the first card (must not be a wild card)
    let firstCard = room.deck.pop();
    while (firstCard.color === 'wild') {
      room.deck.unshift(firstCard); // put back in pile
      room.deck = shuffle(room.deck);
      firstCard = room.deck.pop();
    }

    room.discardPile.push(firstCard);
    room.currentActiveColor = firstCard.color;

    console.log(`Game started in room ${room.roomId}. First card: ${firstCard.color} ${firstCard.value}`);

    // If first card is reverse/skip/draw2, apply immediately!
    if (firstCard.value === 'skip') {
      room.activePlayerIndex = (room.activePlayerIndex + 1) % room.players.length;
    } else if (firstCard.value === 'reverse') {
      if (room.players.length === 2) {
        room.activePlayerIndex = (room.activePlayerIndex + 1) % room.players.length;
      } else {
        room.direction = -1;
        room.activePlayerIndex = room.players.length - 1; // start turns from back
      }
    } else if (firstCard.value === 'draw2') {
      // Draw 2 for the starting active player
      const initialActive = room.players[room.activePlayerIndex];
      initialActive.hand.push(room.deck.pop());
      initialActive.hand.push(room.deck.pop());
      // Skip their turn
      room.activePlayerIndex = (room.activePlayerIndex + 1) % room.players.length;
    }

    sendGameState(room);
  });

  // Helper to send synced state
  function sendGameState(room) {
    room.players.forEach(p => {
      // Create customized game states for each player (hiding other player hands)
      const state = {
        roomId: room.roomId,
        activePlayerIndex: room.activePlayerIndex,
        direction: room.direction,
        topCard: room.discardPile[room.discardPile.length - 1],
        activeColor: room.currentActiveColor,
        players: room.players.map((otherPlayer, idx) => ({
          username: otherPlayer.username,
          socketId: otherPlayer.socketId,
          isMe: otherPlayer.socketId === p.socketId,
          handCount: otherPlayer.hand.length,
          hasUno: otherPlayer.hand.length === 1 && room.unoDeclared[otherPlayer.socketId]
        })),
        myHand: p.hand,
        drawPileCount: room.deck.length,
        discardPileCount: room.discardPile.length
      };
      io.to(p.socketId).emit('game_state', state);
    });
  }

  // Play Card
  socket.on('play_card', ({ cardId, chosenColor }) => {
    const user = socketToUser[socket.id];
    if (!user) return;

    const room = rooms[user.roomId];
    if (!room) return;

    if (!room.gameStarted) return;

    const activePlayer = room.players[room.activePlayerIndex];
    if (activePlayer.socketId !== socket.id) {
      socket.emit('error_message', 'Not your turn!');
      return;
    }

    const cardIdx = activePlayer.hand.findIndex(c => c.id === cardId);
    if (cardIdx === -1) {
      socket.emit('error_message', 'Card not in hand.');
      return;
    }

    const card = activePlayer.hand[cardIdx];
    const topCard = room.discardPile[room.discardPile.length - 1];

    // Validation
    const isColorMatch = card.color === 'wild' || card.color === room.currentActiveColor;
    const isValueMatch = card.value === topCard.value;
    
    if (!isColorMatch && !isValueMatch) {
      socket.emit('error_message', 'Invalid move! Match the color or number/type.');
      return;
    }

    // Play card
    activePlayer.hand.splice(cardIdx, 1);
    room.discardPile.push(card);
    room.currentActiveColor = card.color === 'wild' || card.color === 'wild4' ? chosenColor : card.color;

    console.log(`Player ${activePlayer.username} played ${card.color} ${card.value} (chosen: ${chosenColor || 'none'})`);

    // Handle UNO Rules & Shout Checks
    const remainingHandCount = activePlayer.hand.length;
    let unoTriggered = false;

    // Check if player has 1 card left and hasn't shouted UNO yet
    if (remainingHandCount === 1) {
      if (!room.unoDeclared[socket.id]) {
        // Flag player as pending penalty
        room.pendingUnoShoutPenalty[socket.id] = true;
        // Schedule a 2.5-second timeout window for another player to "Challenge"
        // Or for the active player to press the "UNO" shout button
        setTimeout(() => {
          if (room.pendingUnoShoutPenalty[socket.id] && rooms[room.roomId]) {
            // Auto penalty if they haven't shouted it
            console.log(`Auto Penalty applied to ${activePlayer.username} for not shouting UNO`);
            applyUnoDrawPenalty(room, activePlayer.socketId);
            sendGameState(room);
          }
        }, 2500);
      }
    } else {
      // Clear declaration if player goes up or down from 1 card
      delete room.unoDeclared[socket.id];
      delete room.pendingUnoShoutPenalty[socket.id];
    }

    // Handle Winner
    if (remainingHandCount === 0) {
      // Winner declared!
      const losers = room.players.filter(p => p.socketId !== socket.id);
      const winScore = calculateWinnerScore(losers);

      console.log(`Player ${activePlayer.username} won in room ${room.roomId} with score ${winScore}`);

      // Save match to database
      db.addMatch(activePlayer.username, winScore);

      io.to(room.roomId).emit('game_over', {
        winner: activePlayer.username,
        winnerSocketId: activePlayer.socketId,
        score: winScore
      });

      // Reset Room state
      room.gameStarted = false;
      return;
    }

    // Advance turns and execute card actions
    let jumpCount = 1;
    const countPlayers = room.players.length;

    if (card.value === 'skip') {
      jumpCount = 2; // skip next player
      io.to(room.roomId).emit('game_event', `${activePlayer.username} skipped the next player.`);
    } else if (card.value === 'reverse') {
      if (countPlayers === 2) {
        jumpCount = 2; // reverse in 2-player is skip
        io.to(room.roomId).emit('game_event', `${activePlayer.username} played Reverse (acting as Skip).`);
      } else {
        room.direction *= -1;
        io.to(room.roomId).emit('game_event', `${activePlayer.username} reversed the game order.`);
      }
    } else if (card.value === 'draw2') {
      // Find next player to draw
      const targetIdx = (room.activePlayerIndex + room.direction * 1 + countPlayers) % countPlayers;
      const targetPlayer = room.players[targetIdx];
      
      // Draw 2
      drawCardsForPlayer(room, targetPlayer, 2);
      jumpCount = 2; // skip target player turn

      io.to(room.roomId).emit('game_event', `${targetPlayer.username} draws 2 and is skipped.`);
    } else if (card.value === 'wild4') {
      // Find next player to draw
      const targetIdx = (room.activePlayerIndex + room.direction * 1 + countPlayers) % countPlayers;
      const targetPlayer = room.players[targetIdx];
      
      // Draw 4
      drawCardsForPlayer(room, targetPlayer, 4);
      jumpCount = 2; // skip target player

      io.to(room.roomId).emit('game_event', `${targetPlayer.username} draws 4 (Wild) and is skipped. Color changed to ${room.currentActiveColor}.`);
    } else if (card.value === 'wild') {
      io.to(room.roomId).emit('game_event', `${activePlayer.username} changed color to ${room.currentActiveColor}.`);
    }

    // Advance turn
    room.activePlayerIndex = (room.activePlayerIndex + room.direction * jumpCount + countPlayers * 2) % countPlayers;

    sendGameState(room);
  });

  // Draw Card
  socket.on('draw_card', () => {
    const user = socketToUser[socket.id];
    if (!user) return;

    const room = rooms[user.roomId];
    if (!room) return;

    if (!room.gameStarted) return;

    const activePlayer = room.players[room.activePlayerIndex];
    if (activePlayer.socketId !== socket.id) {
      socket.emit('error_message', 'Not your turn!');
      return;
    }

    // Recycles deck if empty
    recycleDeckIfNeeded(room);

    if (room.deck.length === 0) {
      socket.emit('error_message', 'No cards left in the draw deck.');
      return;
    }

    // Draw 1 card
    const drawn = room.deck.pop();
    activePlayer.hand.push(drawn);

    console.log(`Player ${activePlayer.username} drew card ${drawn.color} ${drawn.value}`);
    io.to(room.roomId).emit('game_event', `${activePlayer.username} drew a card.`);

    // Clear UNO pending flag since hand count increased
    delete room.unoDeclared[socket.id];
    delete room.pendingUnoShoutPenalty[socket.id];

    // Standard rule: after drawing, if they can play the drawn card, they may choose to play it.
    // To make socket gameplay seamless: we notify client of drawn card, and wait for them to either play it or PASS turn.
    socket.emit('drawn_card_pending_decision', {
      card: drawn,
      canPlay: isCardPlayable(drawn, room.currentActiveColor, room.discardPile[room.discardPile.length - 1])
    });

    sendGameState(room);
  });

  // Pass Turn (only allowed after drawing)
  socket.on('pass_turn', () => {
    const user = socketToUser[socket.id];
    if (!user) return;

    const room = rooms[user.roomId];
    if (!room) return;

    if (!room.gameStarted) return;

    const activePlayer = room.players[room.activePlayerIndex];
    if (activePlayer.socketId !== socket.id) {
      return;
    }

    const countPlayers = room.players.length;
    room.activePlayerIndex = (room.activePlayerIndex + room.direction * 1 + countPlayers) % countPlayers;

    console.log(`Player ${activePlayer.username} passed turn`);
    io.to(room.roomId).emit('game_event', `${activePlayer.username} passed their turn.`);

    sendGameState(room);
  });

  // Call UNO / Shout UNO
  socket.on('shout_uno', () => {
    const user = socketToUser[socket.id];
    if (!user) return;

    const room = rooms[user.roomId];
    if (!room) return;

    const player = room.players.find(p => p.socketId === socket.id);
    if (!player) return;

    if (player.hand.length <= 2) {
      room.unoDeclared[socket.id] = true;
      delete room.pendingUnoShoutPenalty[socket.id];

      console.log(`Player ${player.username} shouted UNO!`);
      io.to(room.roomId).emit('uno_shouted', { username: player.username, success: true });
      sendGameState(room);
    }
  });

  // Challenge player (if they have 1 card and forgot to shout UNO!)
  socket.on('challenge_uno', ({ targetSocketId }) => {
    const user = socketToUser[socket.id];
    if (!user) return;

    const room = rooms[user.roomId];
    if (!room) return;

    const challenger = room.players.find(p => p.socketId === socket.id);
    const targetPlayer = room.players.find(p => p.socketId === targetSocketId);

    if (!challenger || !targetPlayer) return;

    // Target must have 1 card and has not declared UNO, with pending penalty
    if (targetPlayer.hand.length === 1 && room.pendingUnoShoutPenalty[targetSocketId]) {
      console.log(`Challenger ${challenger.username} caught ${targetPlayer.username} without shouting UNO!`);
      
      applyUnoDrawPenalty(room, targetSocketId);
      
      io.to(room.roomId).emit('game_event', `${challenger.username} caught ${targetPlayer.username} without shouting UNO! 2 card penalty applied.`);
      io.to(room.roomId).emit('uno_challenge_success', { challenger: challenger.username, victim: targetPlayer.username });
      
      sendGameState(room);
    } else {
      socket.emit('error_message', 'Invalid challenge! They have already declared UNO or have more than 1 card.');
    }
  });

  // Room Chat Message
  socket.on('chat_message', (msg) => {
    const user = socketToUser[socket.id];
    if (!user) return;
    io.to(user.roomId).emit('chat_broadcast', { username: user.username, text: msg });
  });

  // Disconnection
  socket.on('disconnect', () => {
    console.log(`Socket disconnected: ${socket.id}`);
    const user = socketToUser[socket.id];
    if (!user) return;

    const room = rooms[user.roomId];
    delete socketToUser[socket.id];

    if (room) {
      // Remove player
      room.players = room.players.filter(p => p.socketId !== socket.id);
      
      // Cleanup shout flags
      delete room.unoDeclared[socket.id];
      delete room.pendingUnoShoutPenalty[socket.id];

      console.log(`User ${user.username} left room ${user.roomId}`);

      // If room is empty, delete it
      if (room.players.length === 0) {
        delete rooms[user.roomId];
      } else {
        // If host left, assign new host and update game state
        if (room.gameStarted) {
          // If game is active, end it due to player leaving
          io.to(user.roomId).emit('game_event', `${user.username} disconnected. Game ended.`);
          io.to(user.roomId).emit('game_over', {
            winner: room.players[0].username,
            winnerSocketId: room.players[0].socketId,
            score: 50,
            message: 'Game ended early because a player disconnected.'
          });
          room.gameStarted = false;
        }

        io.to(user.roomId).emit('room_update', {
          roomId: room.roomId,
          players: room.players.map(p => ({ username: p.username, socketId: p.socketId, handCount: p.hand.length })),
          hostSocketId: room.players[0].socketId
        });
      }
    }
  });
});

// Helper: check if a card is playable
function isCardPlayable(card, activeColor, topCard) {
  if (card.color === 'wild' || card.color === 'wild4') return true;
  return card.color === activeColor || card.value === topCard.value;
}

// Helper: draws N cards for a player
function drawCardsForPlayer(room, player, count) {
  for (let i = 0; i < count; i++) {
    recycleDeckIfNeeded(room);
    if (room.deck.length > 0) {
      player.hand.push(room.deck.pop());
    }
  }
  // Clear UNO flags
  delete room.unoDeclared[player.socketId];
  delete room.pendingUnoShoutPenalty[player.socketId];
}

// Helper: apply UNO draw penalty (2 cards)
function applyUnoDrawPenalty(room, socketId) {
  const player = room.players.find(p => p.socketId === socketId);
  if (player && room.pendingUnoShoutPenalty[socketId]) {
    drawCardsForPlayer(room, player, 2);
    delete room.pendingUnoShoutPenalty[socketId];
    console.log(`UNO penalty applied to ${player.username}. 2 cards drawn.`);
  }
}

// Helper: recycle discard pile into draw deck
function recycleDeckIfNeeded(room) {
  if (room.deck.length === 0) {
    const topCard = room.discardPile.pop();
    // Move all others back to deck and shuffle
    room.deck = shuffle([...room.discardPile]);
    // Reset discard pile to just top card
    room.discardPile = [topCard];
    console.log(`Recycled deck. Draw pile count: ${room.deck.length}`);
    io.to(room.roomId).emit('game_event', 'The draw deck has been recycled.');
  }
}

// Start Server
server.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`UNO CARD GAME SERVER RUNNING ON http://localhost:${PORT}`);
  console.log(`====================================================`);
});
