const fs = require('fs');
const path = require('path');

const DB_DIR = path.join(__dirname, '..', 'data');
const USERS_FILE = path.join(DB_DIR, 'users.json');
const MATCHES_FILE = path.join(DB_DIR, 'matches.json');

// Ensure database files exist
function init() {
  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }
  if (!fs.existsSync(USERS_FILE)) {
    fs.writeFileSync(USERS_FILE, JSON.stringify([]));
  }
  if (!fs.existsSync(MATCHES_FILE)) {
    fs.writeFileSync(MATCHES_FILE, JSON.stringify([]));
  }
}

// Helper to read database file
function readData(file) {
  try {
    const data = fs.readFileSync(file, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error(`Error reading database file ${file}:`, error);
    return [];
  }
}

// Helper to write database file
function writeData(file, data) {
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error(`Error writing database file ${file}:`, error);
    return false;
  }
}

// Generate unique ID
function generateId() {
  return Math.random().toString(36).substring(2, 9);
}

// --- USER OPERATIONS ---

function registerUser(username, password) {
  init();
  const users = readData(USERS_FILE);
  
  const cleanedUsername = username.trim();
  if (!cleanedUsername || !password) {
    throw new Error('Username and password are required');
  }

  // Case-insensitive check
  const exists = users.find(u => u.Username.toLowerCase() === cleanedUsername.toLowerCase());
  if (exists) {
    throw new Error('Username already exists');
  }

  const newUser = {
    User_ID: generateId(),
    Username: cleanedUsername,
    Password: password, // For simplicity and mock db purposes, plain text or simple encoding is used
    CreatedAt: new Date().toISOString()
  };

  users.push(newUser);
  writeData(USERS_FILE, users);

  return { User_ID: newUser.User_ID, Username: newUser.Username };
}

function loginUser(username, password) {
  init();
  const users = readData(USERS_FILE);
  const cleanedUsername = username.trim().toLowerCase();

  const user = users.find(u => u.Username.toLowerCase() === cleanedUsername && u.Password === password);
  if (!user) {
    return null;
  }

  return { User_ID: user.User_ID, Username: user.Username };
}

// --- MATCH OPERATIONS ---

function addMatch(winner, score) {
  init();
  const matches = readData(MATCHES_FILE);

  const newMatch = {
    Match_ID: generateId(),
    Winner: winner.trim(),
    Score: parseInt(score) || 0,
    PlayedAt: new Date().toISOString()
  };

  matches.push(newMatch);
  writeData(MATCHES_FILE, matches);
  return newMatch;
}

function getMatchHistory(limit = 20) {
  init();
  const matches = readData(MATCHES_FILE);
  // Return sorted matches, most recent first
  return matches
    .sort((a, b) => new Date(b.PlayedAt) - new Date(a.PlayedAt))
    .slice(0, limit);
}

function getLeaderboard() {
  init();
  const matches = readData(MATCHES_FILE);
  
  // Calculate total scores and wins per player
  const stats = {};

  matches.forEach(match => {
    const winner = match.Winner;
    if (!stats[winner]) {
      stats[winner] = { Username: winner, Wins: 0, TotalScore: 0 };
    }
    stats[winner].Wins += 1;
    stats[winner].TotalScore += match.Score;
  });

  // Convert to array and sort by Wins first, then TotalScore
  return Object.values(stats)
    .sort((a, b) => {
      if (b.Wins !== a.Wins) {
        return b.Wins - a.Wins;
      }
      return b.TotalScore - a.TotalScore;
    })
    .slice(0, 10); // Top 10
}

module.exports = {
  init,
  registerUser,
  loginUser,
  addMatch,
  getMatchHistory,
  getLeaderboard
};
