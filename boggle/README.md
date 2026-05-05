# Boggle Party 🎲

A no-backend browser multiplayer Boggle game inspired by Netflix Games' Boggle Party. One browser acts as host authority (board, timer, scoring), and players connect directly over WebRTC DataChannels.

## How It Works

- **Host display** (`/host`) — authoritative game runtime. Shows board, timer, scores, and round results.
- **Player page** (`/player`) — players join via manual offer/answer code exchange, then create a name + avatar and play by swipe/tap.

### Game Rules

- **Board**: 16 classic Boggle dice are shuffled to create a 4×4 grid each round
- **Timer**: 90 seconds per round, 5 rounds per game
- **Word entry**: Swipe/tap adjacent letters on the board, or type words manually
- **Scoring** (classic Boggle):
  - 3–4 letters: 1 point
  - 5 letters: 2 points
  - 6 letters: 3 points
  - 7 letters: 5 points
  - 8+ letters: 11 points
- **Shared words score 0**: If two players find the same word, neither gets points (classic competitive Boggle rule)
- **Dictionary**: ~370K English words

## Quick Start (No Backend)

Serve the repository as static files (GitHub Pages, `npx serve`, etc). No Node game server is required.

1. Open host page on TV/main device: `/boggle/public/host.html`
2. Click `Create Player Offer` on host and copy the generated code
3. Open player page on phone: `/boggle/public/player.html`
4. Paste host offer code on player, then copy answer code back to host
5. Click `Apply Player Answer` on host and paste the player answer code
6. Player can now join and play

Repeat steps 2-5 for additional players.

## Tech Stack

- **WebRTC DataChannels** for peer-to-peer multiplayer
- **STUN** (public Google STUN) for NAT traversal
- Vanilla HTML/CSS/JS — no build step, no framework
- Host-authoritative game engine runs fully in browser
