# Fairway Vatos

A mobile-first golf betting PWA for tracking rounds with friends. Supports multiple game types, real-time multiplayer scoring, and a friends system.

**Live app:** https://n333ks.github.io/Fairway-Vatos

---

## Game Types

| Type | Description |
|------|-------------|
| **Hog** | Each hole is worth a pot; the low scorer wins. 2v2 and 3-player variants supported. Carries over on ties. |
| **Scramble** | Team format (2v2). Best shot each hole. Putt-off to settle ties. |
| **Skins** | Individual — unique low score wins the hole skin. |
| **Stroke** | Stroke play scorecard. No money, just scores. |

## Features

- Multi-hole scoring with carryovers, putt-offs, and real-time money tracking
- 6 supported courses (Scholl Canyon, DeBell, Hansen Dam, Woodley, Cimarron, DSGR)
- Multiplayer via join codes — non-scorekeepers follow the live round on their phone
- Round history with editable scores and per-hole result breakdown
- Handicap tracker and leaderboard across all saved rounds
- Friends system — add friends by name/username, player picker shows only your friends
- Account creation with first name, last name, username, and password

## Tech Stack

- **Frontend:** Pure HTML/CSS/JS — no build step, no framework
- **Backend:** Firebase Auth + Firestore (compat SDK v10.12.0)
- **Hosting:** GitHub Pages
- **Offline:** Service worker with network-first strategy for app files, cache-first for assets

## Authentication

Accounts use a fake email scheme: `username@fairwayvatos.app`. Users sign in with their chosen username and password. First name is used everywhere in the UI; full name and username are stored in Firestore.

## Deployment

Push to `main` — GitHub Pages deploys automatically. Bump the SW cache version string in `sw.js` (`fairway-vatos-vN`) on every deploy so clients pick up the update.

## Project Structure

```
index.html      — All screens and overlays
app.js          — All application logic (~2900 lines)
styles.css      — All styles (~1000 lines)
sw.js           — Service worker
manifest.json   — PWA manifest
Photos/         — Course photos and app icons
```
