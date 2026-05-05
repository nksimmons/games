# Boggle Party 🎲

A local network multiplayer Boggle game inspired by Netflix Games' Boggle Party. Runs on a Raspberry Pi — one screen shows the board and scores (TV/host), players join from their phones.

## How It Works

- **Host display** (`/host`) — shows on the TV/Pi. Displays the 4×4 letter board, timer, scores, and round results. The host controls game flow (start, next round, restart).
- **Player page** (`/`) — players open this on their phones. They create a name + avatar, then play by swiping across letters on the board or typing words.

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

## Quick Start

```bash
cd boggle
npm install
node download-dictionary.js   # one-time: downloads word list
npm start
```

Then:
- Open `http://<your-ip>:3000/host` on the TV/main screen
- Players go to `http://<your-ip>:3000` on their phones

### Experimental Hybrid WebRTC Mode

This build includes an experimental signaling path for WebRTC DataChannels while the game server remains authoritative over WebSocket.

1. Open host using WebRTC transport: `http://<your-ip>:3000/host?transport=webrtc`
2. Copy the join URL shown on host (includes `?transport=webrtc&room=...`)
3. Players open that join URL

Notes:
- Gameplay state/timing still uses WebSocket in this phase.
- In `transport=webrtc` mode, player gameplay/control actions (`submit-path`, `submit-word`, `start-game`, `next-round`, `restart`) go over the WebRTC DataChannel and are relayed by the host to the game server.
- In `transport=webrtc` mode, players consume gameplay updates (`state`, `players`, `timer`, `word-result`) from RTC relays forwarded through the host.
- If RTC is unavailable, clients fall back to direct WebSocket submit behavior.

## Deploy to Pi

```bash
./deploy-to-pi.sh pi@raspberrypi.local
```

This will:
1. Rsync the app to the Pi
2. Install dependencies
3. Download the dictionary
4. Set up a systemd service that auto-starts on boot

## Tech Stack

- **Node.js** + **Express** (HTTP server)
- **WebSocket** (`ws`) for real-time communication
- Vanilla HTML/CSS/JS — no build step, no framework
- Works offline on local network (no internet needed after setup)
