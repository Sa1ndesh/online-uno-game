/* ==========================================================================
   UNO REST API CLIENT - GATEWAY TO BACKEND ENDPOINTS
   ========================================================================== */

const UnoAPI = {
  async register(username, password) {
    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      return await response.json();
    } catch (error) {
      console.error('Registration API failure:', error);
      return { success: false, message: 'Server connection failed.' };
    }
  },

  async login(username, password) {
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      return await response.json();
    } catch (error) {
      console.error('Login API failure:', error);
      return { success: false, message: 'Server connection failed.' };
    }
  },

  async getLeaderboard() {
    try {
      const response = await fetch('/api/leaderboard');
      return await response.json();
    } catch (error) {
      console.error('Leaderboard fetch failure:', error);
      return { success: false, leaderboard: [] };
    }
  },

  async getMatchHistory() {
    try {
      const response = await fetch('/api/matches');
      return await response.json();
    } catch (error) {
      console.error('Match history fetch failure:', error);
      return { success: false, history: [] };
    }
  },

  async saveMatch(winner, score) {
    try {
      const response = await fetch('/api/matches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ winner, score })
      });
      return await response.json();
    } catch (error) {
      console.error('Save match API failure:', error);
      return { success: false };
    }
  }
};
