/* ════════════════════════════════
   FIREBASE
════════════════════════════════ */
const firebaseConfig = {
  apiKey: "AIzaSyCHA73BCTOC9TLGjPmHcqh_6A14wtPsiR4",
  authDomain: "fairway-vatos.firebaseapp.com",
  projectId: "fairway-vatos",
  storageBucket: "fairway-vatos.firebasestorage.app",
  messagingSenderId: "774976718673",
  appId: "1:774976718673:web:c28a5bf0c4d6af27feb570"
};
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db   = firebase.firestore();

let currentUser    = null;
let loginMode      = 'signin';
let joinCode       = null;   // e.g. 'GHT-492'
let isScorekeeper  = false;
let roundListener  = null;   // Firestore unsubscribe fn
let participants   = {};     // { uid: displayName } for all phones in this round

function emailFor(name) {
  return name.trim().toLowerCase().replace(/\s+/g, '.') + '@fairwayvatos.app';
}

function toggleLoginMode() {
  loginMode = loginMode === 'signin' ? 'create' : 'signin';
  const isCreate = loginMode === 'create';
  document.getElementById('login-submit-btn').textContent  = isCreate ? 'Create Account' : 'Sign In';
  document.getElementById('login-toggle-btn').textContent  = isCreate ? 'Back to Sign In' : 'Create Account';
  document.getElementById('login-subtitle').textContent    = isCreate ? 'Create your account' : 'Sign in to continue';
  document.getElementById('login-error').textContent = '';
}

function submitLogin() {
  const name = document.getElementById('login-name').value.trim();
  const pass = document.getElementById('login-password').value;
  const errEl = document.getElementById('login-error');
  errEl.textContent = '';

  if (!name) { errEl.textContent = 'Enter your name.'; return; }
  if (pass.length < 6) { errEl.textContent = 'Password must be at least 6 characters.'; return; }

  const email = emailFor(name);
  const btn   = document.getElementById('login-submit-btn');
  btn.disabled = true;
  btn.textContent = loginMode === 'create' ? 'Creating…' : 'Signing in…';

  const action = loginMode === 'create'
    ? auth.createUserWithEmailAndPassword(email, pass).then(cred => cred.user.updateProfile({ displayName: name }))
    : auth.signInWithEmailAndPassword(email, pass);

  action.catch(err => {
    btn.disabled = false;
    btn.textContent = loginMode === 'create' ? 'Create Account' : 'Sign In';
    const msg = {
      'auth/user-not-found':    'No account found. Create one below.',
      'auth/wrong-password':    'Incorrect password.',
      'auth/email-already-in-use': 'Name already taken. Sign in instead.',
      'auth/invalid-credential':   'Name or password incorrect.',
    }[err.code] || 'Something went wrong. Try again.';
    errEl.textContent = msg;
  });
}

function logoutUser() {
  if (!confirm('Sign out?')) return;
  if (roundListener) { roundListener(); roundListener = null; }
  auth.signOut();
}

/* ════════════════════════════════
   FIRESTORE — MULTIPLAYER
════════════════════════════════ */
function generateJoinCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s.slice(0, 3) + '-' + s.slice(3);
}

function codeKey(code) { return code.replace('-', ''); }

// Firestore doesn't support nested arrays — convert to/from keyed objects
function scoresToFS(arr)  { const o = {}; arr.forEach((r, i) => o[i] = [...r]); return o; }
function touchedToFS(arr) { const o = {}; arr.forEach((r, i) => o[i] = [...r]); return o; }
function fsToScores(o)    { return Object.keys(o).sort((a,b)=>+a - +b).map(k => o[k]); }
function fsToTouched(o)   { return Object.keys(o).sort((a,b)=>+a - +b).map(k => o[k]); }

let _syncSeq = 0;
let _syncTimer = null;
function syncToFirestore() {
  if (!joinCode || !isScorekeeper) return;
  _syncSeq++;
  const seq = _syncSeq;
  clearTimeout(_syncTimer);
  _syncTimer = setTimeout(() => {
    db.collection('activeRounds').doc(codeKey(joinCode)).update({
      scores: scoresToFS(scores), holes, touched: touchedToFS(touched), currentHole, seq,
      gameType, scrambleTeams, scrambleTeamNames
    }).catch(e => console.error('sync error', e));
  }, 300);
}

function listenToRound(key) {
  if (roundListener) { roundListener(); roundListener = null; }
  roundListener = db.collection('activeRounds').doc(key).onSnapshot(snap => {
    if (!snap.exists) return;
    const d = snap.data();

    participants = d.participants || {};
    // Only recalculate isScorekeeper when currentUser is loaded — if it's null
    // (auth hasn't restored yet) we'd incorrectly flip the scorekeeper to viewer
    if (currentUser) {
      isScorekeeper = d.scorekeeperUid === currentUser.uid;
    }

    // Update transfer button & readonly banner
    const transferBtn = document.getElementById('transfer-sk-btn');
    const readonlyBanner = document.getElementById('readonly-banner');
    const skNameEl = document.getElementById('readonly-sk-name');
    if (transferBtn) transferBtn.disabled = !isScorekeeper;
    if (readonlyBanner) readonlyBanner.style.display = isScorekeeper ? 'none' : 'flex';
    if (skNameEl) skNameEl.textContent = participants[d.scorekeeperUid] || 'scorekeeper';

    // Viewers: always sync state from Firestore then re-render
    if (!isScorekeeper) {
      cIdx = d.courseIdx; tIdx = d.teeIdx;
      players = d.players; stake = d.stake;
      holeCount = d.holeCount; nineChoice = d.nineChoice;
      gameType = d.gameType || 'hog'; scrambleTeams = d.scrambleTeams || [[], []]; scrambleTeamNames = d.scrambleTeamNames || ['Team A', 'Team B'];
      scores = fsToScores(d.scores); holes = d.holes; touched = fsToTouched(d.touched);
      currentHole = d.currentHole;
      recomputeAll();

      const seqEl = document.getElementById('readonly-seq');
      if (seqEl) seqEl.textContent = ' #' + (d.seq || 0);

      if (document.getElementById('sc-round').classList.contains('active')) {
        if (document.getElementById('tab-holes-wrap').style.display !== 'none') renderHoles();
        else renderTotals();
      }
    }
  });
}

function showJoincodeOverlay(code) {
  document.getElementById('joincode-display').textContent = code;
  document.getElementById('joincode-overlay').style.display = 'flex';
}

function dismissJoincodeOverlay() {
  document.getElementById('joincode-overlay').style.display = 'none';
}

function openJoinModal() {
  document.getElementById('join-code-input').value = '';
  document.getElementById('join-error').textContent = '';
  document.getElementById('join-submit-btn').disabled = false;
  document.getElementById('join-submit-btn').textContent = 'Join Round';
  document.getElementById('join-modal').style.display = 'flex';
}

function closeJoinModal() {
  document.getElementById('join-modal').style.display = 'none';
}

function formatJoinInput(el) {
  let v = el.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (v.length > 3) v = v.slice(0, 3) + '-' + v.slice(3, 6);
  el.value = v;
}

async function joinRound() {
  const raw  = document.getElementById('join-code-input').value.trim().toUpperCase();
  const key  = raw.replace('-', '').replace(/[^A-Z0-9]/g, '');
  const errEl = document.getElementById('join-error');
  errEl.textContent = '';
  if (key.length !== 6) { errEl.textContent = 'Enter a 6-character code.'; return; }

  const btn = document.getElementById('join-submit-btn');
  btn.disabled = true; btn.textContent = 'Joining…';

  try {
    const snap = await db.collection('activeRounds').doc(key).get();
    if (!snap.exists) {
      errEl.textContent = 'Round not found. Check the code.';
      btn.disabled = false; btn.textContent = 'Join Round';
      return;
    }
    const d = snap.data();
    joinCode      = d.joinCode;
    cIdx          = d.courseIdx; tIdx = d.teeIdx;
    players       = d.players;   stake = d.stake;
    holeCount     = d.holeCount; nineChoice = d.nineChoice;
    scores        = fsToScores(d.scores);  holes = d.holes;
    touched       = fsToTouched(d.touched); currentHole = d.currentHole;
    isScorekeeper = d.scorekeeperUid === currentUser.uid;
    scorecardPage = nineChoice === 'back' ? 1 : 0;

    const myName = currentUser.displayName || currentUser.email.split('@')[0];
    await db.collection('activeRounds').doc(key).update({
      [`participants.${currentUser.uid}`]: myName
    });

    closeJoinModal();
    listenToRound(key);
    clearSession();
    showTab('holes');
    renderHoles();
    show('sc-round');
  } catch (e) {
    errEl.textContent = 'Error joining. Try again.';
    btn.disabled = false; btn.textContent = 'Join Round';
  }
}

function openTransferModal() {
  const list = document.getElementById('transfer-list');
  list.innerHTML = Object.entries(participants)
    .filter(([uid]) => uid !== currentUser.uid)
    .map(([uid, name]) =>
      `<button class="primary-btn" style="background:var(--bg2);color:var(--tx);border:1.5px solid var(--sep)"
               onclick="transferScorekeeper('${uid}','${name}')">${name}</button>`
    ).join('');
  if (!list.innerHTML) list.innerHTML = '<div style="color:var(--tx2);font-size:14px;text-align:center">No other players have joined yet.</div>';
  document.getElementById('transfer-modal').style.display = 'flex';
}

function closeTransferModal() {
  document.getElementById('transfer-modal').style.display = 'none';
}

async function transferScorekeeper(uid, name) {
  if (!isScorekeeper || !joinCode) return;
  await db.collection('activeRounds').doc(codeKey(joinCode)).update({ scorekeeperUid: uid });
  closeTransferModal();
}

/* ════════════════════════════════
   COURSE DATA
════════════════════════════════ */
const COURSES = [{
  name: "Desert Springs Golf Club",
  sub:  "Valley Course",
  location: "Palm Desert, California",
  designer: "Ted Robinson Sr.",
  photo: "Photos/DSGR.png",
  tees: [
    { n:"Black", bg:"#111111", fg:"#ffffff", tot:6622, rating:71.9, slope:130,
      yds:[388,355,508,417,390,222,320,185,543,512,401,169,368,415,221,311,494,403] },
    { n:"Bk/Bl", bg:"#1e2b5e", fg:"#ffffff", tot:6440, rating:70.3, slope:126,
      yds:[388,341,492,393,390,203,320,185,521,512,380,169,354,390,194,311,494,403] },
    { n:"Blue",  bg:"#1d4ed8", fg:"#ffffff", tot:6318, rating:69.1, slope:123,
      yds:[377,341,492,393,380,203,300,170,521,499,380,154,354,390,194,296,485,389] },
    { n:"B/W",   bg:"#4a6fa5", fg:"#ffffff", tot:6146, rating:67.0, slope:117,
      yds:[365,331,492,371,366,203,300,170,501,481,361,154,340,365,194,296,485,371] },
    { n:"White", bg:"#e5e5e5", fg:"#111111", tot:6018, rating:65.7, slope:114,
      yds:[365,331,473,371,366,183,286,154,501,481,361,138,340,365,174,283,475,371] },
  ],
  par: [4,4,5,4,4,3,4,3,5, 5,4,3,4,4,3,4,5,4],
  hcp: [17,13,11,1,7,3,15,9,5, 10,12,18,8,2,4,14,16,6]
},{
  name: "Cimarron Golf Resort",
  sub:  "Boulder Course",
  location: "Cathedral City, California",
  designer: "John Fought & Todd Schroeder",
  photo: "Photos/Cimarron.png",
  tees: [
    { n:"Cimarron",     bg:"#111111", fg:"#ffffff", tot:6732, rating:72.0, slope:124,
      yds:[390,440,590,347,159,502,449,349,160, 440,413,191,548,218,339,474,169,569] },
    { n:"Championship", bg:"#8B0000", fg:"#ffffff", tot:6220, rating:69.5, slope:118,
      yds:[368,416,573,328,141,485,404,312,146, 424,392,172,526,199,316,433,144,549] },
    { n:"Combo",        bg:"#1d4ed8", fg:"#ffffff", tot:5893, rating:68.0, slope:114,
      yds:[368,388,543,328,126,485,378,312,134, 383,335,156,526,175,316,391,118,549] },
    { n:"Middle",       bg:"#e5e5e5", fg:"#111111", tot:5675, rating:66.9, slope:112,
      yds:[336,388,543,303,126,461,378,275,134, 383,335,156,496,175,282,391,118,497] },
  ],
  par: [4,4,5,4,3,5,4,4,3, 4,4,3,5,3,4,4,3,5],
  hcp: [7,1,5,11,15,17,3,9,13, 4,6,16,14,8,18,2,10,12]
},{
  name: "Hansen Dam Golf Course",
  sub:  "Championship Course",
  location: "Lake View Terrace, California",
  designer: "William F. Bell",
  photo: "Photos/Hansen.png",
  tees: [
    { n:"Black", bg:"#111111", fg:"#ffffff", tot:6801, rating:72.1, slope:124,
      yds:[385,505,404,192,426,567,193,390,450, 307,340,549,430,518,167,362,179,437] },
    { n:"Blue",  bg:"#1d4ed8", fg:"#ffffff", tot:6419, rating:70.5, slope:120,
      yds:[372,474,383,172,406,538,185,368,420, 293,310,520,409,501,151,331,169,417] },
    { n:"White", bg:"#e5e5e5", fg:"#111111", tot:6001, rating:68.4, slope:116,
      yds:[370,466,370,148,390,496,157,355,387, 270,297,482,379,465,140,318,162,368] },
  ],
  par: [4,5,4,3,4,5,3,4,4, 4,4,5,4,5,3,4,3,4],
  hcp: [13,17,3,11,5,7,15,9,1, 10,18,6,4,16,12,14,8,2]
}];

/* ════════════════════════════════
   STATE
════════════════════════════════ */
let cIdx        = 0;
let tIdx        = 2;
let players     = []; // [{name, uid}]
let selectedPlayers = []; // picker state for setup screen
let knownUsers  = [];  // [{name, uid}] fetched from Firestore
let stake       = 0;
let scores      = [];
let holes       = [];
let touched     = [];
let currentHole   = 0;
let scorecardPage = 0; // 0=front, 1=back
let currentRoundId = null;
let holeCount  = 18;      // 18 or 9
let nineChoice = 'front'; // 'front' or 'back'
let gameType   = 'hog';   // 'hog' | 'scramble' | 'stroke'
let scrambleTeams     = [[], []]; // [[playerIdx,playerIdx],[playerIdx,playerIdx]] during round
let scrambleTeamAssign = [0, 0, 1, 1]; // team (0/1) for each position in selectedPlayers
let scrambleTeamNames  = ['Team A', 'Team B'];

// Compat helper: players can be {name,uid} objects (new) or strings (old history)
function pname(p) { return typeof p === 'string' ? p : (p && p.name) || 'Player'; }

// First name only for compact display
function initials(p) {
  const parts = pname(p).trim().split(/\s+/);
  return parts.length >= 2 ? parts[0][0] + parts[1][0] : parts[0].slice(0,2);
}

function playerRowHTML(players, money) {
  return `<div class="card-player-row">${players.map((p, i) => {
    const m = money[i];
    const cls = m > 0 ? 'pos' : m < 0 ? 'neg' : 'neu';
    const amt = (m >= 0 ? '+' : '−') + '$' + Math.abs(m).toFixed(0);
    return `<div class="card-player">
      <div class="card-avatar ${cls}">${initials(p)}</div>
      <div class="card-pname">${shortName(p)}</div>
      <div class="card-pamount ${cls}">${amt}</div>
    </div>`;
  }).join('')}</div>`;
}

function shortName(p) {
  return pname(p).trim().split(/\s+/)[0];
}

/* ════════════════════════════════
   CORE LOGIC
════════════════════════════════ */
function activeHoles() {
  if (holeCount === 9) return nineChoice === 'front'
    ? [0,1,2,3,4,5,6,7,8] : [9,10,11,12,13,14,15,16,17];
  return Array.from({length:18}, (_,i) => i);
}
function firstHole() { return activeHoles()[0]; }
function lastHole()  { return activeHoles()[activeHoles().length - 1]; }

function holeAllTouched(h) {
  if (gameType === 'scramble' && scrambleTeams[0].length && scrambleTeams[1].length) {
    return touched[h][scrambleTeams[0][0]] && touched[h][scrambleTeams[1][0]];
  }
  return touched[h].every(t => t);
}

function ord(h) {
  return players.map((_, i) => (i + h) % players.length);
}

function buildChains() {
  const c = Array.from({length:18}, () => ({n:1, carry:false, f:null, p:null, t:null, betHole:0}));
  let cv      = null;
  let betHole = 0;
  for (let h = 0; h < 18; h++) {
    if (cv) {
      c[h].n = cv.n; c[h].carry = true; c[h].f = cv.f; c[h].p = cv.p;
      c[h].t = cv.t; c[h].betHole = cv.betHole;
    } else {
      c[h].betHole = betHole;
    }
    const hole = holes[h], ch = c[h];
    const o  = ord(ch.betHole);
    const fi = ch.carry ? ch.f : o[0];
    const pi = ch.carry ? ch.p : (hole.partner !== null ? hole.partner : o[1]);
    const tp = ch.carry ? ch.t : hole.type;
    if (hole.result === 'tie') {
      cv = { n:ch.n+1, f:fi, p:pi, t:tp, betHole:ch.betHole };
    } else {
      cv = null;
      betHole++;
    }
  }
  return c;
}

function buildScrambleChains() {
  const chains = Array.from({length:18}, () => ({n:1, carry:false}));
  let mult = 1;
  for (const h of activeHoles()) {
    chains[h].n = mult; chains[h].carry = mult > 1;
    if (holes[h].result === 'tie') mult++; else mult = 1;
  }
  return chains;
}

function recomputeScramble() {
  const a0 = scrambleTeams[0][0], b0 = scrambleTeams[1][0];
  for (const h of activeHoles()) {
    if (!touched[h][a0] || !touched[h][b0]) { holes[h].result = null; continue; }
    const aS = scores[h][a0], bS = scores[h][b0];
    holes[h].result = aS < bS ? 'win' : bS < aS ? 'lose' : 'tie';
  }
}

function buildSkinsResults() {
  const results = [];
  let pot = 1;
  for (const h of activeHoles()) {
    if (!holeAllTouched(h)) { results.push({h, pending:true, tied:false, winner:null, n:pot}); continue; }
    const sc = players.map((_, p) => scores[h][p]);
    const min = Math.min(...sc);
    const wIdxs = players.map((_, p) => p).filter(p => sc[p] === min);
    if (wIdxs.length === 1) {
      results.push({h, pending:false, tied:false, winner:wIdxs[0], n:pot});
      pot = 1;
    } else {
      results.push({h, pending:false, tied:true, winner:null, n:pot});
      pot++;
    }
  }
  return results;
}

function recomputeAll() {
  if (gameType === 'scramble') return recomputeScramble();
  if (gameType === 'stroke')   return; // skins computed on-the-fly from scores
  let cv      = null;
  let betHole = 0;
  for (let h = 0; h < 18; h++) {
    const bh   = cv ? cv.betHole : betHole;
    const o    = ord(bh);
    const fi   = cv ? cv.f : o[0];
    const hole = holes[h];
    const type = cv ? cv.t : hole.type;
    const pi   = cv ? cv.p : (hole.partner !== null ? hole.partner : o[1]);

    if (!type || !touched[h].every(t => t)) {
      holes[h].result = null;
      cv = null;
      betHole++;
      continue;
    }

    const sc = scores[h];
    let r;
    if (type === 'hog') {
      const hogScore  = sc[fi];
      const bestOther = Math.min(...o.filter(i => i !== fi).map(i => sc[i]));
      r = hogScore < bestOther ? 'win' : hogScore > bestOther ? 'lose' : 'tie';
    } else {
      const t1 = [fi, pi];
      const t2 = o.filter(i => !t1.includes(i));
      const b1 = Math.min(...t1.map(i => sc[i]));
      const b2 = Math.min(...t2.map(i => sc[i]));
      r = b1 < b2 ? 'win' : b1 > b2 ? 'lose' : 'tie';
    }

    holes[h].result = r;

    if (r === 'tie') {
      cv = { n:(cv ? cv.n+1 : 2), f:fi, p:pi, t:type, betHole:bh };
    } else {
      cv = null;
      betHole++;
    }
  }
}

function calcScrambleMoney() {
  const chains = buildScrambleChains();
  const money  = players.map(() => 0);
  for (const h of activeHoles()) {
    const r = holes[h].result;
    if (!r || r === 'tie') continue;
    const n = chains[h].n;
    const winTeam  = r === 'win' ? scrambleTeams[0] : scrambleTeams[1];
    const loseTeam = r === 'win' ? scrambleTeams[1] : scrambleTeams[0];
    loseTeam.forEach(i => money[i] -= stake * n);
    winTeam.forEach(i  => money[i] += stake * n); // 2v2 symmetric
  }
  return money;
}

function calcStrokeMoney() {
  const money = players.map(() => 0);
  let pot = 1;
  for (const h of activeHoles()) {
    if (!holeAllTouched(h)) continue;
    const sc = players.map((_, p) => scores[h][p]);
    const min = Math.min(...sc);
    const wIdxs = players.map((_, p) => p).filter(p => sc[p] === min);
    if (wIdxs.length === 1) {
      const w = wIdxs[0];
      players.forEach((_, p) => {
        if (p === w) money[p] += stake * pot * (players.length - 1);
        else         money[p] -= stake * pot;
      });
      pot = 1;
    } else { pot++; }
  }
  return money;
}

function calcMoney() {
  if (gameType === 'scramble') return calcScrambleMoney();
  if (gameType === 'stroke')   return calcStrokeMoney();
  const cs  = buildChains();
  const tot = new Array(players.length).fill(0);
  for (let h = 0; h < 18; h++) {
    const hole = holes[h], ch = cs[h];
    if (!hole.result || hole.result === 'tie') continue;
    const s   = stake * ch.n;
    const o   = ord(ch.betHole);
    const fi  = ch.carry ? ch.f : o[0];
    const tp  = ch.carry ? ch.t : hole.type;
    const pi  = ch.carry ? ch.p : (hole.partner !== null ? hole.partner : o[1]);
    const all = players.map((_, i) => i);
    if (tp === 'hog') {
      const others = all.filter(i => i !== fi);
      if (hole.result === 'win') { tot[fi] += s*3; others.forEach(i => tot[i] -= s); }
      else                       { tot[fi] -= s*3; others.forEach(i => tot[i] += s); }
    } else {
      const t1 = [fi, pi], t2 = all.filter(i => !t1.includes(i));
      if (hole.result === 'win') { t1.forEach(i => tot[i] += s); t2.forEach(i => tot[i] -= s); }
      else                       { t1.forEach(i => tot[i] -= s); t2.forEach(i => tot[i] += s); }
    }
  }
  return tot;
}

/* ════════════════════════════════
   NAVIGATION
════════════════════════════════ */
function show(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function goHome() {
  if (players.length) saveSession();
  renderHomeRecent();
  show('sc-home');
}

function completedHoleCount() {
  return activeHoles().filter(h => holeAllTouched(h)).length;
}

function updateSubmitBtn() {
  const btn = document.getElementById('submit-scores-btn');
  if (!btn) return;
  const show = isScorekeeper && completedHoleCount() >= 9;
  btn.disabled = !show;
}

function submitScores() {
  const done = completedHoleCount();
  if (done < 9) return;
  const msg = done < holeCount
    ? `Submit scores for ${done} completed holes? Only the first 9 will count toward handicap.`
    : `Submit your ${done}-hole round?`;
  if (!confirm(msg)) return;
  saveRound();
  if (roundListener) { roundListener(); roundListener = null; }
  if (joinCode && isScorekeeper) {
    db.collection('activeRounds').doc(codeKey(joinCode)).delete().catch(() => {});
  }
  joinCode = null; isScorekeeper = false; participants = {};
  clearSession();
  players = []; scores = []; holes = []; touched = [];
  currentHole = 0; currentRoundId = null;
  renderHomeRecent();
  show('sc-home');
}

function endRound() {
  if (!confirm('End this round? Scores will not be saved.')) return;
  if (roundListener) { roundListener(); roundListener = null; }
  if (joinCode && isScorekeeper) {
    db.collection('activeRounds').doc(codeKey(joinCode)).delete().catch(() => {});
  }
  joinCode = null; isScorekeeper = false; participants = {};
  clearSession();
  players = [];
  scores = []; holes = []; touched = [];
  currentHole = 0; currentRoundId = null;
  renderHomeRecent();
  show('sc-home');
}

function showTab(t) {
  document.getElementById('tab-holes-wrap').style.display  = t === 'holes'  ? 'flex' : 'none';
  document.getElementById('tab-totals-wrap').style.display = t === 'totals' ? 'flex' : 'none';
  document.getElementById('tb-holes').className  = 'tab-btn' + (t === 'holes'  ? ' on' : '');
  document.getElementById('tb-totals').className = 'tab-btn' + (t === 'totals' ? ' on' : '');
  const btnPrev = document.getElementById('btn-prev');
  const btnNext = document.getElementById('btn-next');
  if (t === 'totals') {
    document.getElementById('round-title').textContent = 'Totals';
    document.getElementById('round-sub').textContent   = '';
    if (btnPrev) btnPrev.disabled = true;
    if (btnNext) btnNext.disabled = true;
    renderTotals();
  } else {
    renderHoles();
  }
}

function prevHole() {
  if (currentHole > firstHole()) goToHole(currentHole - 1);
}
function nextHole() {
  if (currentHole < lastHole() && holeAllTouched(currentHole)) goToHole(currentHole + 1);
}

/* ════════════════════════════════
   SCREEN 1 — COURSE SELECT
════════════════════════════════ */
function renderCourses() {
  document.getElementById('course-list').innerHTML = COURSES.map((c, i) => `
    <div class="course-card${c.photo ? ' course-card-photo' : ''}" onclick="selectCourse(${i})"
         ${c.photo ? `style="background-image:url('${c.photo}')"` : ''}>
      <div class="course-card-inner${c.photo ? ' course-card-inner-overlay' : ''}">
        <div class="course-card-row">
          <div>
            <div class="course-card-name">${c.name}</div>
            <div class="course-card-sub">${c.sub}</div>
          </div>
          <div class="course-card-chevron">›</div>
        </div>
        <div class="course-card-meta">
          <span class="course-meta-location">${c.location || ''}</span>
          ${c.designer ? `<span class="course-meta-divider">|</span><span class="course-meta-designer">${c.designer}</span>` : ''}
          <span class="course-meta-divider">|</span><span class="course-meta-par">Par ${c.par.reduce((a,b)=>a+b,0)}</span>
        </div>
      </div>
    </div>`).join('');
}

function selectCourse(i) {
  cIdx = i; tIdx = 2;
  holeCount = 18; nineChoice = 'front';
  document.getElementById('setup-title').textContent = COURSES[i].name;
  document.getElementById('setup-sub').textContent   = COURSES[i].sub;
  renderTeeScroll();
  renderPlayerInputs();
  // Init hole count buttons
  document.querySelectorAll('.hole-count-btn').forEach((b, idx) => b.classList.toggle('sel', idx === 0));
  document.querySelectorAll('.nine-choice-btn').forEach(b => b.classList.toggle('sel', b.dataset.val === 'front'));
  document.getElementById('nine-choice').style.display = 'none';
  document.querySelectorAll('.game-type-btn').forEach((b, i) => b.classList.toggle('sel', ['hog','scramble','stroke'][i] === gameType));
  scrambleTeamAssign = [0, 0, 1, 1];
  show('sc-setup');
}

/* ════════════════════════════════
   SCREEN 2 — SETUP
════════════════════════════════ */
function renderTeeScroll() {
  const c = COURSES[cIdx];
  document.getElementById('tee-scroll').innerHTML = c.tees.map((t, i) =>
    `<button class="tee-option${i === tIdx ? ' sel' : ''}" style="background:${t.bg};color:${t.fg}" onclick="selTee(${i})">
      ${t.n}<span>${t.tot.toLocaleString()} yds</span>
      ${t.rating != null ? `<span class="tee-rating">${t.rating} / ${t.slope}</span>` : ''}
    </button>`).join('');
}

function selTee(i) { tIdx = i; renderTeeScroll(); }

function adjStake(dir) {
  stake = Math.max(0, stake + dir * 0.25);
  const el = document.getElementById('stake-val');
  if (!el) return;
  if (stake === 0) {
    el.textContent = '0.00';
    el.classList.remove('set');
  } else {
    el.textContent = '$' + stake.toFixed(2);
    el.classList.add('set');
  }
}

function selGameType(type) {
  gameType = type;
  document.querySelectorAll('.game-type-btn').forEach((b, i) => {
    b.classList.toggle('sel', ['hog','scramble','stroke'][i] === type);
  });
  const hdr = document.getElementById('players-section-hdr');
  if (hdr) hdr.textContent = type === 'scramble'
    ? 'Players — tap in tee order (need exactly 4)'
    : 'Players — tap in tee order for hole 1';
  renderTeamAssignment();
}

function renderTeamAssignment() {
  const el = document.getElementById('team-assignment');
  if (!el) return;
  if (gameType !== 'scramble' || selectedPlayers.length !== 4) { el.style.display = 'none'; return; }
  el.style.display = 'block';
  const cols = [0, 1].map(t => {
    const cls    = t === 0 ? 'a' : 'b';
    const btnCls = t === 0 ? 'team-a' : 'team-b';
    const btns   = selectedPlayers.map((p, i) => scrambleTeamAssign[i] === t
      ? `<button class="team-player-btn ${btnCls}" onclick="switchTeam(${i})">${shortName(p)}</button>`
      : '').join('');
    return `<div class="team-assign-col">
      <input class="team-name-input ${cls}" value="${scrambleTeamNames[t]}"
             oninput="setTeamName(${t}, this.value)" placeholder="Team ${t === 0 ? 'A' : 'B'}">
      ${btns}
    </div>`;
  }).join('');
  el.innerHTML = `<div class="team-assign-wrap">
    <div class="team-assign-hdr">Name your teams — tap a player to switch sides</div>
    <div class="team-assign-cols">${cols}</div>
    <div class="team-assign-hint">Each team needs exactly 2 players</div>
  </div>`;
}

function setTeamName(t, name) {
  scrambleTeamNames[t] = name || (t === 0 ? 'Team A' : 'Team B');
}

function switchTeam(i) {
  scrambleTeamAssign[i] = 1 - scrambleTeamAssign[i];
  renderTeamAssignment();
}

async function renderPlayerInputs() {
  selectedPlayers = [];
  const el = document.getElementById('player-inputs');
  el.innerHTML = '<div style="color:var(--tx2);font-size:14px;text-align:center;padding:12px">Loading players…</div>';
  try {
    const snap = await db.collection('users').get();
    knownUsers = snap.docs.map(d => d.data()).sort((a, b) => a.name.localeCompare(b.name));
  } catch (e) {
    knownUsers = [];
  }
  renderPickerUI();
}

function renderPickerUI() {
  const el = document.getElementById('player-inputs');
  const cards = knownUsers.map(u => {
    const idx = selectedPlayers.findIndex(p => p.uid === u.uid);
    const sel = idx >= 0;
    return `<button class="player-pick-btn${sel ? ' sel' : ''}" onclick="togglePlayer('${u.uid}')">
      ${sel ? `<span class="player-pick-num">${idx + 1}</span>` : ''}
      <span class="player-pick-name">${u.name}</span>
    </button>`;
  }).join('');
  const order = selectedPlayers.length
    ? `<div class="player-pick-order">${selectedPlayers.map((p,i) => `<span class="pick-slot">${i+1}. ${p.name}</span>`).join('')}</div>`
    : `<div class="player-pick-hint">Tap players in tee order</div>`;
  el.innerHTML = `<div class="player-pick-grid">${cards}</div>${order}`;
}

function togglePlayer(uid) {
  const user = knownUsers.find(u => u.uid === uid);
  if (!user) return;
  const idx = selectedPlayers.findIndex(p => p.uid === uid);
  if (idx >= 0) {
    selectedPlayers.splice(idx, 1);
    scrambleTeamAssign.splice(idx, 1);
  } else {
    if (selectedPlayers.length >= 4) return;
    // auto-assign: positions 0,1 → team A; 2,3 → team B
    scrambleTeamAssign.push(selectedPlayers.length >= 2 ? 1 : 0);
    selectedPlayers.push({ name: user.name, uid: user.uid });
  }
  renderPickerUI();
  renderTeamAssignment();
}

function saveSession() {
  if (!players.length) return;
  localStorage.setItem('hog_session', JSON.stringify({
    cIdx, tIdx, players, stake, scores, holes, touched, currentHole, currentRoundId,
    holeCount, nineChoice, gameType, scrambleTeams, scrambleTeamNames
  }));
}

function clearSession() {
  localStorage.removeItem('hog_session');
}

function hasActiveSession() {
  return !!localStorage.getItem('hog_session');
}

function continueRound() {
  const s = JSON.parse(localStorage.getItem('hog_session'));
  if (!s) return;
  cIdx = s.cIdx; tIdx = s.tIdx; players = s.players; stake = s.stake;
  scores = s.scores; holes = s.holes; touched = s.touched;
  currentHole = s.currentHole; currentRoundId = s.currentRoundId;
  holeCount = s.holeCount || 18; nineChoice = s.nineChoice || 'front';
  gameType = s.gameType || 'hog'; scrambleTeams = s.scrambleTeams || [[], []];
  scrambleTeamNames = s.scrambleTeamNames || ['Team A', 'Team B'];
  isScorekeeper = true; // local session = always scorekeeper
  showTab('holes');
  renderHoles();
  show('sc-round');
}

function selHoleCount(n) {
  holeCount = n;
  document.querySelectorAll('.hole-count-btn').forEach((b, i) => {
    b.classList.toggle('sel', (i === 0 ? 18 : 9) === n);
  });
  document.getElementById('nine-choice').style.display = n === 9 ? 'flex' : 'none';
}

function selNineChoice(c) {
  nineChoice = c;
  document.querySelectorAll('.nine-choice-btn').forEach(b => {
    b.classList.toggle('sel', b.dataset.val === c);
  });
}

async function startRound() {
  if (gameType === 'scramble') {
    if (selectedPlayers.length !== 4) { alert('Scramble requires exactly 4 players.'); return; }
    const tA = selectedPlayers.map((_, i) => i).filter(i => scrambleTeamAssign[i] === 0);
    const tB = selectedPlayers.map((_, i) => i).filter(i => scrambleTeamAssign[i] === 1);
    if (tA.length !== 2 || tB.length !== 2) { alert('Each team needs exactly 2 players.'); return; }
    scrambleTeams = [tA, tB];
  } else {
    if (selectedPlayers.length < 2) { alert('Select at least 2 players.'); return; }
    scrambleTeams = [[], []];
  }
  players = [...selectedPlayers];
  scores  = Array.from({length:18}, () => players.map(() => null));
  holes   = Array.from({length:18}, () => ({type:null, partner:null, result:null}));
  touched = Array.from({length:18}, () => players.map(() => false));
  currentHole    = firstHole();
  scorecardPage  = nineChoice === 'back' ? 1 : 0;
  currentRoundId = null;
  isScorekeeper  = true;
  clearSession();

  // Create live Firestore round
  joinCode = generateJoinCode();
  const key = codeKey(joinCode);
  const myName = currentUser ? (currentUser.displayName || currentUser.email.split('@')[0]) : pname(players[0]);
  participants = { [currentUser.uid]: myName };

  try {
    await db.collection('activeRounds').doc(key).set({
      joinCode,
      courseIdx: cIdx, teeIdx: tIdx,
      players, stake, holeCount, nineChoice,
      gameType, scrambleTeams, scrambleTeamNames,
      scores: scoresToFS(scores), holes, touched: touchedToFS(touched), currentHole,
      scorekeeperUid: currentUser.uid,
      participants,
      createdBy: currentUser.uid,
      createdAt: new Date().toISOString(),
      status: 'active'
    });
    listenToRound(key);
    showJoincodeOverlay(joinCode);
  } catch (e) {
    console.error('Firestore error:', e);
    joinCode = null;
    isScorekeeper = true;
  }

  showTab('holes');
  renderHoles();
  show('sc-round');
}

/* ════════════════════════════════
   SCREEN 3 — HOLES TAB
════════════════════════════════ */
function renderHoles() {
  updateSubmitBtn();
  const c = COURSES[cIdx], t = c.tees[tIdx];
  const h = currentHole;
  const par = c.par[h], hcp = c.hcp[h], yds = t.yds[h];
  const titleEl = document.getElementById('round-title');
  const subEl   = document.getElementById('round-sub');
  if (titleEl) titleEl.textContent = `Hole ${h+1} · Par ${par}`;
  if (subEl)   subEl.textContent   = `${t.n} · ${yds} yds · HCP ${hcp}`;
  const btnPrev = document.getElementById('btn-prev');
  const btnNext = document.getElementById('btn-next');
  if (btnPrev) btnPrev.disabled = (h === firstHole());
  if (btnNext) btnNext.disabled = (h === lastHole() || !holeAllTouched(h));

  if (gameType === 'scramble') renderHolesBodyScramble(h);
  else if (gameType === 'stroke') renderHolesBodyStroke(h);
  else renderHolesBodyHog(h);

  renderMiniScorecard();
}

function renderHolesBodyHog(h) {
  const cs = buildChains(), ch = cs[h];
  const o  = ord(ch.betHole);
  const fi = ch.carry ? ch.f : o[0];
  const priorDone  = h === 0 || holes[h-1].result !== null;
  const allTouched = touched[h].every(t => t);
  const stakeTag   = ch.n > 1 ? `<span class="carry-tag">$${(stake*ch.n).toFixed(2)}/player</span>` : '';
  const isLastHole    = h === lastHole();
  const effectiveType = ch.carry ? ch.t : holes[h].type;
  const needsPartner  = !ch.carry && effectiveType === '2v2' && holes[h].partner === null;
  const blocked = !allTouched
    ? `<div class="next-hole-blocked">Enter all scores to continue</div>`
    : !effectiveType
      ? `<div class="next-hole-blocked">Choose a game type above</div>`
      : needsPartner
        ? `<div class="next-hole-blocked">Choose teams above</div>`
        : isLastHole ? ''
        : `<div class="next-hole-proceed" onclick="nextHole()">Proceed to next hole →</div>`;
  document.getElementById('holes-body').innerHTML = `
    <div class="hole-card${ch.carry?' carry':''}" id="hole-${h}">
      <div class="hole-card-hdr">
        <div>
          <div class="first-tee-lbl" id="hfl-${h}">${ch.carry ? 'Carryover' : 'First Tee'}</div>
          <div class="first-tee-name" id="hfn-${h}">${priorDone ? pname(players[fi]) : '—'}</div>
        </div>
        ${stakeTag}
      </div>
      <div id="hb-${h}"></div>
    </div>
    ${blocked}
    <div class="totals-section-title">Scorecard</div>
    <div id="mini-sc"></div>`;
  renderHoleBody(h, ch);
}

function renderHolesBodyScramble(h) {
  const chains = buildScrambleChains(), ch = chains[h];
  const a0 = scrambleTeams[0][0], b0 = scrambleTeams[1][0];
  const tA = scrambleTeamNames[0], tB = scrambleTeamNames[1];
  const ready = touched[h][a0] && touched[h][b0];
  const stakeTag = ch.n > 1 ? `<span class="carry-tag">$${(stake*ch.n).toFixed(2)}/team</span>` : '';
  const blocked = !ready
    ? `<div class="next-hole-blocked">Enter both team scores to continue</div>`
    : h === lastHole() ? ''
    : `<div class="next-hole-proceed" onclick="nextHole()">Proceed to next hole →</div>`;
  document.getElementById('holes-body').innerHTML = `
    <div class="hole-card${ch.carry?' carry':''}" id="hole-${h}">
      <div class="hole-card-hdr">
        <div>
          <div class="first-tee-lbl">2-Man Scramble</div>
          <div class="first-tee-name">${tA} <span style="color:var(--tx3);font-size:12px">vs</span> ${tB}</div>
        </div>
        ${stakeTag}
      </div>
      <div id="hb-${h}"></div>
    </div>
    ${blocked}
    <div class="totals-section-title">Scorecard</div>
    <div id="mini-sc"></div>`;
  renderHoleBodyScramble(h, ch);
}

function renderHolesBodyStroke(h) {
  let pot = 1;
  for (const ph of activeHoles()) {
    if (ph >= h) break;
    if (!touched[ph].every(t => t)) continue;
    const sc = players.map((_, p) => scores[ph][p]);
    const min = Math.min(...sc);
    if (players.filter((_, p) => sc[p] === min).length === 1) pot = 1; else pot++;
  }
  const ready = touched[h].every(t => t);
  const stakeTag = pot > 1 ? `<span class="carry-tag">$${(stake*pot).toFixed(2)}/skin</span>` : '';
  const blocked = !ready
    ? `<div class="next-hole-blocked">Enter all scores to continue</div>`
    : h === lastHole() ? ''
    : `<div class="next-hole-proceed" onclick="nextHole()">Proceed to next hole →</div>`;
  document.getElementById('holes-body').innerHTML = `
    <div class="hole-card${pot>1?' carry':''}" id="hole-${h}">
      <div class="hole-card-hdr">
        <div>
          <div class="first-tee-lbl">Skins</div>
          <div class="first-tee-name">${pot>1?'×'+pot+' Carryover':players.map(p=>shortName(p)).join(' · ')}</div>
        </div>
        ${stakeTag}
      </div>
      <div id="hb-${h}"></div>
    </div>
    ${blocked}
    <div class="totals-section-title">Scorecard</div>
    <div id="mini-sc"></div>`;
  renderHoleBodyStroke(h, pot);
}

function goToHole(h) {
  if (!isScorekeeper) return;
  currentHole   = h;
  scorecardPage = h < 9 ? 0 : 1;
  saveSession();
  syncToFirestore();
  renderHoles();
  document.getElementById('tab-holes-wrap').scrollTop = 0;
}

function setSCPage(p) {
  scorecardPage = p;
  const track = document.getElementById('mini-sc-track');
  if (track) track.style.transform = `translateX(${p === 0 ? '0%' : '-50%'})`;
  document.querySelectorAll('.mini-sc-dot').forEach((d, i) => d.classList.toggle('on', i === p));
}

function buildScorecardHalfScramble(startH, endH, halfLabel, colLabel) {
  const c = COURSES[cIdx], par = c.par;
  const isBack = startH === 9;
  const halfPar  = par.slice(startH, endH).reduce((a,b) => a+b, 0);
  const grandPar = par.reduce((a,b) => a+b, 0);
  let thead = `<thead><tr><th class="stk">Hole</th>`;
  for (let h = startH; h < endH; h++) thead += `<th${h===currentHole?' class="mini-cur"':''}>${h+1}</th>`;
  thead += `<th class="sep">${colLabel}</th>${isBack ? '<th class="sep">Tot</th>' : ''}</tr></thead>`;
  let tbody = `<tbody><tr class="par-row"><td class="stk">Par</td>`;
  par.slice(startH, endH).forEach(p => tbody += `<td>${p}</td>`);
  tbody += `<td class="sep">${halfPar}</td>${isBack ? `<td class="sep">${grandPar}</td>` : ''}</tr>`;
  [0, 1].forEach(t => {
    const capIdx = scrambleTeams[t][0];
    const tName  = scrambleTeamNames[t];
    const sc = scores.map(h => h[capIdx]);
    const entered = Array.from({length: endH-startH}, (_,i) => startH+i).filter(h => sc[h] !== null);
    const halfSum  = entered.reduce((a,h) => a + sc[h], 0);
    const halfEntP = entered.reduce((a,h) => a + par[h], 0);
    const halfDiff = halfSum - halfEntP;
    const halfCol  = halfDiff < 0 ? 'var(--green)' : halfDiff > 0 ? 'var(--red)' : 'var(--tx2)';
    const halfDStr = halfDiff === 0 ? 'E' : (halfDiff > 0 ? '+' : '') + halfDiff;
    const halfDisp = entered.length ? `${halfSum}<br><span style="font-size:10px;color:${halfCol}">${halfDStr}</span>` : '—';
    let grandCell = '—';
    if (isBack) {
      const allEnt = Array.from({length:18},(_,i)=>i).filter(h => sc[h] !== null);
      if (allEnt.length) {
        const gTot = allEnt.reduce((a,h) => a+sc[h], 0), gPar = allEnt.reduce((a,h) => a+par[h], 0);
        const gD = gTot - gPar, gCol = gD<0?'var(--green)':gD>0?'var(--red)':'var(--tx2)';
        grandCell = `${gTot}<br><span style="font-size:10px;color:${gCol}">${gD===0?'E':(gD>0?'+':'')+gD}</span>`;
      }
    }
    tbody += `<tr><td class="stk">${tName}</td>`;
    for (let h = startH; h < endH; h++) {
      tbody += sc[h] === null ? `<td style="color:var(--tx3)">—</td>` : `<td>${fmtCell(sc[h], par[h])}</td>`;
    }
    tbody += `<td class="sep" style="font-weight:700">${halfDisp}</td>${isBack?`<td class="sep" style="font-weight:700">${grandCell}</td>`:''}</tr>`;
  });
  tbody += '</tbody>';
  return `<div class="totals-sc-half">
    <div class="sc-half-label">${halfLabel}</div>
    <div class="sc-wrap" style="margin:0 16px"><table class="sct">${thead}${tbody}</table></div>
  </div>`;
}

function buildScorecardHalf(startH, endH, halfLabel, colLabel) {
  if (gameType === 'scramble' && scrambleTeams[0].length && scrambleTeams[1].length) {
    return buildScorecardHalfScramble(startH, endH, halfLabel, colLabel);
  }
  const c      = COURSES[cIdx];
  const par    = c.par;
  const isBack = startH === 9;
  const halfPar  = par.slice(startH, endH).reduce((a, b) => a + b, 0);
  const grandPar = par.reduce((a, b) => a + b, 0);

  let thead = `<thead><tr><th class="stk">Hole</th>`;
  for (let h = startH; h < endH; h++)
    thead += `<th${h===currentHole?' class="mini-cur"':''}>${h+1}</th>`;
  thead += `<th class="sep">${colLabel}</th>`;
  if (isBack) thead += `<th class="sep">Tot</th>`;
  thead += `</tr></thead>`;

  let tbody = `<tbody><tr class="par-row"><td class="stk">Par</td>`;
  par.slice(startH, endH).forEach(p => tbody += `<td>${p}</td>`);
  tbody += `<td class="sep">${halfPar}</td>`;
  if (isBack) tbody += `<td class="sep">${grandPar}</td>`;
  tbody += `</tr>`;

  players.forEach((pl, p) => {
    const name = shortName(pl);
    const sc = scores.map(h => h[p]);
    const enteredHalf = Array.from({length: endH - startH}, (_, i) => startH + i).filter(h => sc[h] !== null);
    const halfSum  = enteredHalf.reduce((a, h) => a + sc[h], 0);
    const halfEntP = enteredHalf.reduce((a, h) => a + par[h], 0);
    const halfDiff = halfSum - halfEntP;
    const halfCol  = halfDiff < 0 ? 'var(--green)' : halfDiff > 0 ? 'var(--red)' : 'var(--tx2)';
    const halfDStr = halfDiff === 0 ? 'E' : (halfDiff > 0 ? '+' : '') + halfDiff;
    const halfDisp = enteredHalf.length
      ? `${halfSum}<br><span style="font-size:10px;color:${halfCol}">${halfDStr}</span>`
      : '—';

    let grandCell = '—';
    if (isBack) {
      const allEntered = Array.from({length:18}, (_,i)=>i).filter(h => sc[h] !== null);
      if (allEntered.length) {
        const grandTot  = allEntered.reduce((a, h) => a + sc[h], 0);
        const grandEntP = allEntered.reduce((a, h) => a + par[h], 0);
        const grandDiff = grandTot - grandEntP;
        const grandCol  = grandDiff < 0 ? 'var(--green)' : grandDiff > 0 ? 'var(--red)' : 'var(--tx2)';
        const grandDStr = grandDiff === 0 ? 'E' : (grandDiff > 0 ? '+' : '') + grandDiff;
        grandCell = `${grandTot}<br><span style="font-size:10px;color:${grandCol}">${grandDStr}</span>`;
      }
    }

    tbody += `<tr><td class="stk">${name}</td>`;
    for (let h = startH; h < endH; h++) {
      if (sc[h] === null) { tbody += `<td style="color:var(--tx3)">—</td>`; continue; }
      tbody += `<td>${fmtCell(sc[h], par[h])}</td>`;
    }
    tbody += `<td class="sep" style="font-weight:700">${halfDisp}</td>`;
    if (isBack) tbody += `<td class="sep" style="font-weight:700">${grandCell}</td>`;
    tbody += `</tr>`;
  });
  tbody += '</tbody>';

  return `<div class="totals-sc-half">
    <div class="sc-half-label">${halfLabel}</div>
    <div class="sc-wrap" style="margin:0 16px"><table class="sct">${thead}${tbody}</table></div>
  </div>`;
}

function renderMiniScorecard() {
  const el = document.getElementById('mini-sc');
  if (!el) return;

  const offset = scorecardPage === 0 ? '0%' : '-50%';
  el.innerHTML = `
    <div class="totals-sc-viewport">
      <div class="mini-sc-track" id="mini-sc-track" style="transform:translateX(${offset})">
        ${buildScorecardHalf(0, 9, 'Front Nine', 'Out')}
        ${buildScorecardHalf(9, 18, 'Back Nine', 'In')}
      </div>
    </div>
    <div class="mini-sc-dots">
      <span class="mini-sc-dot${scorecardPage===0?' on':''}"></span>
      <span class="mini-sc-dot${scorecardPage===1?' on':''}"></span>
    </div>`;

  // Swipe gesture
  const vp = el.querySelector('.totals-sc-viewport');
  let startX = null;
  vp.addEventListener('touchstart', e => { startX = e.touches[0].clientX; }, {passive:true});
  vp.addEventListener('touchend', e => {
    if (startX === null) return;
    const dx = e.changedTouches[0].clientX - startX;
    if (Math.abs(dx) > 40) setSCPage(dx < 0 ? 1 : 0);
    startX = null;
  }, {passive:true});
}


function scoreBadge(sc, par) {
  const d = sc - par;
  if (d <= -3) return {cls:'b-albatross', txt:'Albatross'};
  if (d === -2) return {cls:'b-eagle',    txt:'Eagle'};
  if (d === -1) return {cls:'b-birdie',   txt:'Birdie'};
  if (d ===  0) return {cls:'b-even',     txt:'Par'};
  if (d ===  1) return {cls:'b-over',     txt:'Bogey'};
  if (d ===  2) return {cls:'b-over',     txt:'Double'};
  if (d ===  3) return {cls:'b-over',     txt:'You Suck'};
  if (d >=   4) return {cls:'b-over',     txt:'Just Quit'};
  return {cls:'b-over', txt:'+'+d};
}

function scoreRowHTML(h, pi, name) {
  const sc  = scores[h][pi];
  const par = COURSES[cIdx].par[h];
  const isNull = sc === null;
  const b   = isNull ? null : scoreBadge(sc, par);
  return `<div class="sc-row">
    <span class="sc-name">${name}</span>
    <button class="sc-btn" onclick="adjScore(${h},${pi},-1)">−</button>
    <span class="sc-val${isNull ? ' sc-val-empty' : ''}" id="sv-${h}-${pi}">${isNull ? '—' : sc}</span>
    <button class="sc-btn" onclick="adjScore(${h},${pi},1)">+</button>
    <span class="sc-badge ${isNull ? 'b-empty' : b.cls}" id="sb-${h}-${pi}">${isNull ? '' : b.txt}</span>
  </div>`;
}

function teamBNames(o, fi, pi) {
  return o.filter(i => i !== fi && i !== pi).map(i => shortName(players[i])).join(' + ');
}

function renderHoleBodyScramble(h, ch) {
  const el = document.getElementById('hb-' + h);
  if (!el) return;
  const a0 = scrambleTeams[0][0], b0 = scrambleTeams[1][0];
  const tA = scrambleTeamNames[0], tB = scrambleTeamNames[1];
  const aMembers = scrambleTeams[0].map(i => shortName(players[i])).join(' + ');
  const bMembers = scrambleTeams[1].map(i => shortName(players[i])).join(' + ');
  const s = (stake * ch.n).toFixed(2), ns = (stake * (ch.n + 1)).toFixed(2);
  const r = holes[h].result;
  let html = ch.carry ? `<div class="carry-lock"><span class="carry-lock-badge">🔒 Carryover</span></div>` : '';
  html += `
    <div class="team-section team-a">
      <div class="scr-members scr-members-a">${aMembers}</div>
      ${scoreRowHTML(h, a0, tA)}
    </div>
    <div class="vs-row"><div class="vs-line"></div><span class="vs-txt">VS</span><div class="vs-line"></div></div>
    <div class="team-section team-b">
      <div class="scr-members scr-members-b">${bMembers}</div>
      ${scoreRowHTML(h, b0, tB)}
    </div>`;
  if (touched[h][a0] && touched[h][b0]) {
    let txt = 'Enter scores above', cls = 'rb-pending';
    const nextH = h + 2;
    if (r === 'win')  { txt = `${tA} wins · +$${s} each`; cls = 'rb-win'; }
    else if (r === 'lose') { txt = `${tB} wins · +$${s} each`; cls = 'rb-win'; }
    else if (r === 'tie')  { txt = `Tied · $${ns}/player carries to hole ${nextH}`; cls = 'rb-tie'; }
    html += `<div class="result-banner ${cls}">${txt}</div>`;
  }
  el.innerHTML = html;
}

function renderHoleBodyStroke(h, pot) {
  const el = document.getElementById('hb-' + h);
  if (!el) return;
  const allTouch = touched[h].every(t => t);
  let html = `<div class="team-section">
    <div class="team-label">Individual Scores</div>
    ${players.map((_, p) => scoreRowHTML(h, p, shortName(players[p]))).join('')}
  </div>`;
  if (allTouch) {
    const sc = players.map((_, p) => scores[h][p]);
    const min = Math.min(...sc);
    const wIdxs = players.map((_, p) => p).filter(p => sc[p] === min);
    const s = (stake * pot).toFixed(2), ns = (stake * (pot + 1)).toFixed(2);
    let txt, cls;
    if (wIdxs.length === 1) {
      const winAmt = (stake * pot * (players.length - 1)).toFixed(2);
      txt = `🏆 ${shortName(players[wIdxs[0]])} wins skin · +$${winAmt}`; cls = 'rb-win';
    } else {
      txt = `Tied — $${ns}/skin carries to hole ${h + 2}`; cls = 'rb-tie';
    }
    html += `<div class="result-banner ${cls}">${txt}</div>`;
  }
  el.innerHTML = html;
}

function renderHoleBody(h, ch) {
  if (!ch) ch = buildChains()[h];
  const el = document.getElementById('hb-' + h);
  if (!el) return;

  const hole = holes[h];
  const o    = ord(ch.betHole);
  const fi   = ch.carry ? ch.f : o[0];
  const tp   = ch.carry ? ch.t : hole.type;
  const pi   = ch.carry ? ch.p : (hole.partner !== null ? hole.partner : o[1]);
  const s    = (stake * ch.n).toFixed(2);
  const ns   = (stake * (ch.n + 1)).toFixed(2);

  let html = '';

  // segmented control or carry lock
  if (ch.carry) {
    const label = tp === 'hog' ? '🐷 Hog — Carryover' : '🤝 2v2 — Carryover';
    html += `<div class="carry-lock">
      <span class="carry-lock-badge">🔒 ${label}</span>
    </div>`;
  } else {
    html += `<div class="seg-wrap">
      <div class="seg-ctrl">
        <button class="seg-btn${tp === 'hog' ? ' on' : ''}" onclick="setType(${h},'hog')">🐷 Hog</button>
        <button class="seg-btn${tp === '2v2' ? ' on' : ''}" onclick="setType(${h},'2v2')">🤝 2v2</button>
      </div>
    </div>`;
  }

  // teams
  if (tp === 'hog') {
    const others    = o.filter(i => i !== fi);
    const enteredOther = others.map(i => scores[h][i]).filter(s => s !== null);
    const bestOther = enteredOther.length ? Math.min(...enteredOther) : null;
    html += `
      <div class="team-section team-hog">
        <div class="team-label">🐷 ${shortName(players[fi])} — hogging</div>
        ${scoreRowHTML(h, fi, shortName(players[fi]))}
      </div>
      <div class="vs-row"><div class="vs-line"></div><span class="vs-txt">VS</span><div class="vs-line"></div></div>
      <div class="team-section team-b">
        <div class="team-label">Opponents</div>
        ${others.map(i => scoreRowHTML(h, i, shortName(players[i]))).join('')}
        <div class="best-row">Best ball <b>${bestOther ?? '—'}</b></div>
      </div>`;

  } else if (tp === '2v2') {
    const t1 = [fi, pi];
    const t2 = o.filter(i => !t1.includes(i));
    const e1 = t1.map(i => scores[h][i]).filter(s => s !== null);
    const e2 = t2.map(i => scores[h][i]).filter(s => s !== null);
    const b1 = e1.length ? Math.min(...e1) : null;
    const b2 = e2.length ? Math.min(...e2) : null;

    const partnerPicker = ch.carry ? '' : `
      <div class="partner-row">
        <div class="partner-lbl">Partner for ${shortName(players[fi])}</div>
        <div class="pchip-row">
          ${o.slice(1).map(i =>
            `<button class="pchip${pi === i ? ' sel' : ''}" onclick="setPartner(${h},${i})">${shortName(players[i])}</button>`
          ).join('')}
        </div>
      </div>`;

    html += `
      ${partnerPicker}
      <div class="team-section team-a">
        <div class="team-label">Team A — ${shortName(players[fi])} + ${shortName(players[pi])}</div>
        ${t1.map(i => scoreRowHTML(h, i, shortName(players[i]))).join('')}
        <div class="best-row">Best ball <b>${b1 ?? '—'}</b></div>
      </div>
      <div class="vs-row"><div class="vs-line"></div><span class="vs-txt">VS</span><div class="vs-line"></div></div>
      <div class="team-section team-b">
        <div class="team-label">Team B — ${teamBNames(o, fi, pi)}</div>
        ${t2.map(i => scoreRowHTML(h, i, shortName(players[i]))).join('')}
        <div class="best-row">Best ball <b>${b2 ?? '—'}</b></div>
      </div>`;

  } else {
    html += `
      <div class="team-section">
        <div class="team-label" style="color:var(--tx2)">Choose Hog or 2v2 above</div>
        ${o.map(i => scoreRowHTML(h, i, shortName(players[i]))).join('')}
      </div>`;
  }

  // result banner
  if (tp) {
    const r   = hole.result;
    let txt   = '', cls = 'rb-pending';
    const nextH = h + 2;

    if (tp === 'hog') {
      const hogWin = (stake * ch.n * 3).toFixed(2);
      if      (r === 'win')  { txt = `🐷 ${shortName(players[fi])} wins · +$${hogWin}`; cls = 'rb-win'; }
      else if (r === 'lose') { txt = `🐷 ${shortName(players[fi])} loses · −$${hogWin}`; cls = 'rb-lose'; }
      else if (r === 'tie')  { txt = `Tied · $${ns}/player carries to hole ${nextH}`; cls = 'rb-tie'; }
      else                   { txt = 'Enter scores above'; }
    } else {
      const aName = `${shortName(players[fi])} + ${shortName(players[pi])}`;
      const bName = teamBNames(o, fi, pi);
      if      (r === 'win')  { txt = `${aName} win · +$${s} each`; cls = 'rb-win'; }
      else if (r === 'lose') { txt = `${bName} win · +$${s} each`; cls = 'rb-lose'; }
      else if (r === 'tie')  { txt = `Tied · $${ns}/player carries to hole ${nextH}`; cls = 'rb-tie'; }
      else                   { txt = 'Enter scores above'; }
    }
    html += `<div class="result-banner ${cls}">${txt}</div>`;
  }

  el.innerHTML = html;

  const card = document.getElementById('hole-' + h);
  if (card) card.className = 'hole-card' + (ch.n > 1 ? ' carry' : '');
  const lbl = document.getElementById('hfl-' + h);
  const nm  = document.getElementById('hfn-' + h);
  const priorDone = h === 0 || holes[h-1].result !== null;
  if (lbl) lbl.textContent = ch.carry ? 'Carryover' : 'First Tee';
  if (nm)  nm.textContent  = priorDone ? pname(players[fi]) : '—';
}

function adjScore(h, p, d) {
  if (!isScorekeeper) return;
  const par = COURSES[cIdx].par[h];
  if (scores[h][p] === null) { scores[h][p] = par; }
  else { scores[h][p] = Math.min(10, Math.max(1, scores[h][p] + d)); }
  touched[h][p]  = true;

  const sc = scores[h][p], b = scoreBadge(sc, par);
  const sv = document.getElementById('sv-' + h + '-' + p);
  const sb = document.getElementById('sb-' + h + '-' + p);
  if (sv) sv.textContent = sc;
  if (sb) { sb.textContent = b.txt; sb.className = 'sc-badge ' + b.cls; }

  if (holeAllTouched(h)) recomputeAll();
  saveSession();
  syncToFirestore();
  renderHoles();
  renderMiniScorecard();
}

function setType(h, type) {
  if (!isScorekeeper) return;
  holes[h].type    = type;
  holes[h].partner = null;
  if (type === '2v2') {
    const cs = buildChains();
    holes[h].partner = ord(cs[h].betHole)[1];
  }
  if (holeAllTouched(h)) recomputeAll();
  saveSession();
  syncToFirestore();
  renderHoles();
}

function setPartner(h, idx) {
  if (!isScorekeeper) return;
  holes[h].partner = idx;
  if (holeAllTouched(h)) recomputeAll();
  saveSession();
  syncToFirestore();
  renderHoles();
}

/* ════════════════════════════════
   SCREEN 3 — TOTALS TAB
════════════════════════════════ */
function renderTotals() {
  updateSubmitBtn();
  saveRound();
  const money = calcMoney();
  const c     = COURSES[cIdx];
  const cs    = buildChains();
  const par   = c.par;
  const pout  = par.slice(0,9).reduce((a,b) => a+b, 0);
  const pin   = par.slice(9).reduce((a,b) => a+b, 0);

  document.getElementById('money-grid').innerHTML = players.map((p, i) => {
    const amt = money[i];
    const cls = amt > 0 ? 'pos' : amt < 0 ? 'neg' : 'neu';
    const disp = (amt >= 0 ? '+' : '−') + '$' + Math.abs(amt).toFixed(2);
    return `<div class="money-card">
      <div class="money-name">${pname(p)}</div>
      <div class="money-amt ${cls}">${disp}</div>
    </div>`;
  }).join('');
  renderPayouts(players, money, 'payouts-list');

  function buildTotalsHalf(startH, endH, halfLabel, colLabel) {
    return buildScorecardHalf(startH, endH, halfLabel, colLabel);
  }

  const scPage = scorecardPage;
  const offset = scPage === 0 ? '0%' : '-50%';
  document.getElementById('sc-table').innerHTML = `
    <div class="totals-sc-viewport">
      <div class="totals-sc-track" id="totals-sc-track" style="transform:translateX(${offset})">
        ${buildTotalsHalf(0, 9, 'Front Nine', 'Out')}
        ${buildTotalsHalf(9, 18, 'Back Nine', 'In')}
      </div>
    </div>
    <div class="mini-sc-dots" style="padding:10px 0 4px">
      <span class="mini-sc-dot${scPage===0?' on':''}"></span>
      <span class="mini-sc-dot${scPage===1?' on':''}"></span>
    </div>`;

  // Swipe gesture on totals scorecard
  const tvp = document.querySelector('#sc-table .totals-sc-viewport');
  if (tvp) {
    let startX = null;
    tvp.addEventListener('touchstart', e => { startX = e.touches[0].clientX; }, {passive:true});
    tvp.addEventListener('touchend', e => {
      if (startX === null) return;
      const dx = e.changedTouches[0].clientX - startX;
      if (Math.abs(dx) > 40) {
        scorecardPage = dx < 0 ? 1 : 0;
        const track = document.getElementById('totals-sc-track');
        if (track) track.style.transform = `translateX(${scorecardPage === 0 ? '0%' : '-50%'})`;
        document.querySelectorAll('#sc-table .mini-sc-dot').forEach((d, i) => d.classList.toggle('on', i === scorecardPage));
      }
      startX = null;
    }, {passive:true});
  }

  const myIdx = currentUser ? players.findIndex(p => p && p.uid === currentUser.uid) : -1;
  let hr = '';

  if (gameType === 'scramble') {
    const chains = buildScrambleChains();
    const myTeam = myIdx >= 0 ? scrambleTeams.findIndex(t => t.includes(myIdx)) : -1;
    const aName  = scrambleTeamNames[0];
    const bName  = scrambleTeamNames[1];
    for (let h = lastHole(); h >= firstHole(); h--) {
      const r = holes[h].result, ch = chains[h];
      const s = (stake * ch.n).toFixed(2);
      if (!r) {
        hr += `<div class="hr-row hr-row--inprogress"><span class="hr-num">H${h+1}${ch.n>1?' ×'+ch.n:''}</span><span class="hr-inprogress">⛳ In Progress</span></div>`;
        continue;
      }
      let myResult = r;
      if (myTeam === 1) myResult = r === 'win' ? 'lose' : r === 'lose' ? 'win' : r;
      const teams = r === 'tie' ? '🔄 Carryover' : r === 'win' ? `🏆 ${aName}` : `🏆 ${bName}`;
      const badge = myResult==='win'?'win':myResult==='lose'?'lose':myResult==='tie'?'tie':'pend';
      const label = myResult==='win'?'Win':myResult==='lose'?'Lose':myResult==='tie'?'Tie':'—';
      const moneyStr = r==='tie'?'→ next':myResult==='win'?`+$${s}`:`−$${s}`;
      hr += `<div class="hr-row">
        <span class="hr-num">H${h+1}${ch.n>1?' ×'+ch.n:''}</span>
        <span class="hr-teams">${teams}</span>
        <span class="hr-badge ${badge}">${label}</span>
        <span class="hr-money ${myResult==='win'?'pos':myResult==='lose'?'neg':''}">${moneyStr}</span>
      </div>`;
    }

  } else if (gameType === 'stroke') {
    const skins = buildSkinsResults();
    for (let i = skins.length - 1; i >= 0; i--) {
      const {h, pending, tied, winner, n} = skins[i];
      if (pending) {
        hr += `<div class="hr-row hr-row--inprogress"><span class="hr-num">H${h+1}${n>1?' ×'+n:''}</span><span class="hr-inprogress">⛳ In Progress</span></div>`;
        continue;
      }
      const myResult = tied ? 'tie' : winner === myIdx ? 'win' : myIdx >= 0 ? 'lose' : null;
      const badge = myResult==='win'?'win':myResult==='lose'?'lose':myResult==='tie'?'tie':'pend';
      const label = myResult==='win'?'Win':myResult==='lose'?'Lose':myResult==='tie'?'Tie':'—';
      const winAmt = (stake * n * (players.length - 1)).toFixed(2);
      const loseAmt = (stake * n).toFixed(2);
      const teams    = tied ? '🔄 Carryover' : `🏆 ${shortName(players[winner])}`;
      const moneyStr = tied ? '→ next' : myResult==='win' ? `+$${winAmt}` : myResult==='lose' ? `−$${loseAmt}` : '—';
      hr += `<div class="hr-row">
        <span class="hr-num">H${h+1}${n>1?' ×'+n:''}</span>
        <span class="hr-teams">${teams}</span>
        <span class="hr-badge ${badge}">${label}</span>
        <span class="hr-money ${myResult==='win'?'pos':myResult==='lose'?'neg':''}">${moneyStr}</span>
      </div>`;
    }

  } else {
    for (let h = lastHole(); h >= firstHole(); h--) {
      const hole = holes[h], ch = cs[h];
      const tp   = ch.carry ? ch.t : hole.type;
      if (!tp) continue;
      const o  = ord(ch.betHole);
      const fi = ch.carry ? ch.f : o[0];
      const pi = ch.carry ? ch.p : (hole.partner !== null ? hole.partner : o[1]);
      const s  = (stake * ch.n).toFixed(2);
      const r  = hole.result;
      let myResult = r;
      if (r && myIdx >= 0) {
        if (tp === 'hog') { if (myIdx !== fi) myResult = r==='win'?'lose':r==='lose'?'win':r; }
        else { const onTeamB = myIdx!==fi && myIdx!==pi; if (onTeamB) myResult = r==='win'?'lose':r==='lose'?'win':r; }
      }
      const t1Names = `${shortName(players[fi])} + ${shortName(players[pi])}`;
      const t2Names = o.filter(i=>i!==fi&&i!==pi).map(i=>shortName(players[i])).join(' + ');
      let teams;
      if (r==='tie') teams='🔄 Carryover';
      else if (tp==='hog') teams=`🐷 ${shortName(players[fi])}`;
      else if (r==='win')  teams=`🏆 ${t1Names}`;
      else if (r==='lose') teams=`🏆 ${t2Names}`;
      else teams=`${t1Names} vs ${t2Names}`;
      const badge = myResult==='win'?'win':myResult==='lose'?'lose':myResult==='tie'?'tie':'pend';
      const label = myResult==='win'?'Win':myResult==='lose'?'Lose':myResult==='tie'?'Tie':'—';
      let moneyStr = '—';
      if (myResult==='win')  moneyStr = tp==='hog'?(myIdx===fi?`+$${(stake*ch.n*3).toFixed(2)}`:`+$${s}`):`+$${s}`;
      if (myResult==='lose') moneyStr = tp==='hog'?(myIdx===fi?`−$${(stake*ch.n*3).toFixed(2)}`:`−$${s}`):`−$${s}`;
      if (myResult==='tie')  moneyStr = '→ next';
      if (!r) {
        hr += `<div class="hr-row hr-row--inprogress"><span class="hr-num">H${h+1}${ch.n>1?' ×'+ch.n:''}</span><span class="hr-inprogress">⛳ Hole in Progress</span></div>`;
        continue;
      }
      hr += `<div class="hr-row">
        <span class="hr-num">H${h+1}${ch.n>1?' ×'+ch.n:''}</span>
        <span class="hr-teams">${teams}</span>
        <span class="hr-badge ${badge}">${label}</span>
        <span class="hr-money ${myResult==='win'?'pos':myResult==='lose'?'neg':''}">${moneyStr}</span>
      </div>`;
    }
  }

  document.getElementById('hole-results').innerHTML = hr ||
    '<div class="hr-row"><span style="color:var(--tx2);font-size:14px">No holes entered yet</span></div>';
}

function simplifyDebts(players, money) {
  // Build net balances rounded to cents
  const bal = money.map(m => Math.round(m * 100));
  const txns = [];
  const debtors  = players.map((p, i) => ({p, i, v: bal[i]})).filter(x => x.v < 0).sort((a,b) => a.v - b.v);
  const creditors = players.map((p, i) => ({p, i, v: bal[i]})).filter(x => x.v > 0).sort((a,b) => b.v - a.v);
  let di = 0, ci = 0;
  while (di < debtors.length && ci < creditors.length) {
    const d = debtors[di], c = creditors[ci];
    const amt = Math.min(-d.v, c.v);
    if (amt > 0) txns.push({from: d.p, to: c.p, amt: amt / 100});
    d.v += amt; c.v -= amt;
    if (d.v === 0) di++;
    if (c.v === 0) ci++;
  }
  return txns;
}

function renderPayouts(players, money, containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const txns = simplifyDebts(players, money);
  if (!txns.length) {
    el.innerHTML = `<div class="payout-row"><span class="payout-even">Everyone's even — no payments needed</span></div>`;
    return;
  }
  el.innerHTML = txns.map(t =>
    `<div class="payout-row">
      <span class="payout-from">${shortName(t.from)}</span>
      <span class="payout-arrow">→</span>
      <span class="payout-to">${shortName(t.to)}</span>
      <span class="payout-amt">$${t.amt.toFixed(2)}</span>
    </div>`
  ).join('');
}

function fmtCell(s, par, hlCls = '') {
  if (s === null) return `<span style="color:var(--tx3)">—</span>`;
  const d = s - par;
  const hl = hlCls ? ` ${hlCls}` : '';
  if (d <= -3) return `<span class="ca${hl}">${s}</span>`;
  if (d === -2) return `<span class="ce${hl}">${s}</span>`;
  if (d === -1) return `<span class="cu${hl}">${s}</span>`;
  if (d >= 1)   return `<span class="co${hl}">${s}</span>`;
  return `<span class="cn${hl}">${s}</span>`;
}


/* ════════════════════════════════
   ROUND HISTORY
════════════════════════════════ */
function roundToFS(r) {
  const obj = {...r};
  // Firestore doesn't allow nested arrays — serialize scores as keyed object
  obj.scores = {};
  r.scores.forEach((hole, h) => { obj.scores[h] = [...hole]; });
  return obj;
}

function roundFromFS(obj) {
  const r = {...obj};
  const s = obj.scores || {};
  r.scores = Array.from({length: 18}, (_, h) => s[h] || []);
  return r;
}

function saveRound() {
  if (!players.length) return;
  // Require at least 9 completed holes
  const ah = activeHoles();
  const completedHoles = ah.filter(h => touched[h].every(t => t)).length;
  if (completedHoles < 9) return;

  const money = calcMoney();
  const id    = currentRoundId || Date.now();
  currentRoundId = id;
  const t = COURSES[cIdx].tees[tIdx];
  // Score diff only uses active holes gross score
  // For handicap: use all holes if 9-hole round or full 18 completed;
  // if partial 18, only count the first 9 completed holes
  const hdcpHoles = (() => {
    const completed = ah.filter(h => touched[h].every(t => t));
    if (holeCount === 9 || completed.length >= 18) return completed;
    return completed.slice(0, 9);
  })();
  const scoreDiffs = (t.rating != null && hdcpHoles.length >= 9)
    ? players.map((_, p) => {
        const gross = hdcpHoles.reduce((sum, h) => sum + (scores[h][p] || 0), 0);
        const adjRating = hdcpHoles.length === 9 ? t.rating / 2 : t.rating;
        const adjSlope  = t.slope;
        return parseFloat(((113 / adjSlope) * (gross - adjRating)).toFixed(1));
      })
    : null;
  const round = {
    id,
    date:       new Date().toISOString(),
    courseName: COURSES[cIdx].name,
    courseSub:  COURSES[cIdx].sub,
    tee:        COURSES[cIdx].tees[tIdx].n,
    rating:     t.rating,
    slope:      t.slope,
    holeCount,
    nineChoice: holeCount === 9 ? nineChoice : null,
    gameType,
    scrambleTeams: JSON.parse(JSON.stringify(scrambleTeams)),
    scrambleTeamNames: [...scrambleTeamNames],
    players:    [...players],
    stake,
    scores:     scores.map(h => [...h]),
    holes:      holes.map(h => ({...h})),
    money:      [...money],
    scoreDiffs
  };
  // localStorage cache (fast offline access)
  const hist = JSON.parse(localStorage.getItem('hog_rounds') || '[]');
  const idx  = hist.findIndex(r => r.id === id);
  if (idx >= 0) hist[idx] = round; else hist.unshift(round);
  localStorage.setItem('hog_rounds', JSON.stringify(hist.slice(0, 100)));

  // Firestore (persistent, cross-device)
  if (currentUser) {
    db.collection('users').doc(currentUser.uid)
      .collection('rounds').doc(String(id))
      .set(roundToFS(round));
  }
}

function deleteRound(id, e) {
  e.stopPropagation();
  if (!confirm('Delete this round? This cannot be undone.')) return;
  const hist = JSON.parse(localStorage.getItem('hog_rounds') || '[]');
  localStorage.setItem('hog_rounds', JSON.stringify(hist.filter(r => r.id !== id)));
  if (currentUser) {
    db.collection('users').doc(currentUser.uid).collection('rounds').doc(String(id)).delete();
  }
  showHistory();
}

function renderHistoryList(hist) {
  const el = document.getElementById('history-list');
  if (!hist.length) {
    el.innerHTML = `<div class="history-empty">No rounds saved yet.<br>Finish a hole and check Totals to auto-save.</div>`;
    return;
  }
  el.innerHTML = hist.map(r => {
    const d    = new Date(r.date);
    const date = d.toLocaleDateString('en-US', {month:'short', day:'numeric', year:'numeric'});
    return `<div class="history-card" onclick="viewRound(${r.id})">
      <div class="history-card-top">
        <div class="history-card-course">${r.courseSub}</div>
        <div class="history-card-chevron">›</div>
      </div>
      <div class="history-card-tee">${date} · ${r.tee} tees · $${r.stake.toFixed(2)}/hole</div>
      ${playerRowHTML(r.players, r.money)}
      <div class="history-card-actions">
        <button class="delete-btn" onclick="deleteRound(${r.id}, event)">Delete</button>
      </div>
    </div>`;
  }).join('');
}

async function showHistory() {
  show('sc-history');
  const el = document.getElementById('history-list');

  if (currentUser) {
    el.innerHTML = `<div class="history-empty" style="padding-top:48px">Loading…</div>`;
    try {
      const snap = await db.collection('users').doc(currentUser.uid)
        .collection('rounds').orderBy('date', 'desc').get();
      const hist = snap.docs.map(d => roundFromFS(d.data()));
      // Refresh localStorage cache so viewRound, handicap, leaderboard work
      localStorage.setItem('hog_rounds', JSON.stringify(hist));
      renderHistoryList(hist);
    } catch(err) {
      // Fall back to local cache on network error
      const hist = JSON.parse(localStorage.getItem('hog_rounds') || '[]');
      renderHistoryList(hist);
    }
  } else {
    const hist = JSON.parse(localStorage.getItem('hog_rounds') || '[]');
    renderHistoryList(hist);
  }
}

function viewRound(id) {
  const hist = JSON.parse(localStorage.getItem('hog_rounds') || '[]');
  const r    = hist.find(r => r.id === id);
  if (!r) return;

  const d    = new Date(r.date);
  const date = d.toLocaleDateString('en-US', {month:'long', day:'numeric', year:'numeric'});
  document.getElementById('detail-title').textContent = r.courseSub;
  document.getElementById('detail-sub').textContent   = `${r.tee} · ${date}`;

  // Rebuild the detail body
  const c   = COURSES.find(c => c.name === r.courseName) || COURSES[0];
  const par = c.par;
  const money = r.money;

  // Money cards
  let html = '<div class="money-grid">';
  r.players.forEach((p, i) => {
    const m   = money[i];
    const cls = m > 0 ? 'pos' : m < 0 ? 'neg' : 'neu';
    const disp = (m >= 0 ? '+' : '−') + '$' + Math.abs(m).toFixed(2);
    html += `<div class="money-card">
      <div class="money-name">${pname(p)}</div>
      <div class="money-amt ${cls}">${disp}</div>
    </div>`;
  });
  html += '</div>';

  // Payouts
  const payoutTxns = simplifyDebts(r.players, money);
  if (!payoutTxns.length) {
    html += `<div class="totals-section-title">Payouts</div><div class="payout-row"><span class="payout-even">Everyone's even — no payments needed</span></div>`;
  } else {
    html += `<div class="totals-section-title">Payouts</div>` + payoutTxns.map(t =>
      `<div class="payout-row">
        <span class="payout-from">${shortName(t.from)}</span>
        <span class="payout-arrow">→</span>
        <span class="payout-to">${shortName(t.to)}</span>
        <span class="payout-amt">$${t.amt.toFixed(2)}</span>
      </div>`
    ).join('');
  }

  // Scorecard — use same buildScorecardHalf as live round by temporarily setting globals
  const _cIdx = cIdx, _tIdx = tIdx, _players = players, _scores = scores,
        _currentHole = currentHole, _scPage = scorecardPage,
        _gameType = gameType, _scrambleTeams = scrambleTeams, _scrambleTeamNames = scrambleTeamNames,
        _holeCount = holeCount, _nineChoice = nineChoice;
  cIdx = COURSES.findIndex(x => x.name === r.courseName);
  if (cIdx < 0) cIdx = 0;
  tIdx = COURSES[cIdx].tees.findIndex(t => t.n === r.tee);
  if (tIdx < 0) tIdx = 0;
  players = r.players;
  scores  = r.scores;
  gameType = r.gameType || 'hog';
  scrambleTeams = r.scrambleTeams || [[], []];
  scrambleTeamNames = r.scrambleTeamNames || ['Team A', 'Team B'];
  holeCount = r.holeCount || 18;
  nineChoice = r.nineChoice || 'front';
  currentHole = -1;
  scorecardPage = 0;

  const scFront = buildScorecardHalf(0, 9, 'Front Nine', 'Out');
  const scBack  = buildScorecardHalf(9, 18, 'Back Nine', 'In');

  cIdx = _cIdx; tIdx = _tIdx; players = _players; scores = _scores;
  currentHole = _currentHole; scorecardPage = _scPage;
  gameType = _gameType; scrambleTeams = _scrambleTeams; scrambleTeamNames = _scrambleTeamNames;
  holeCount = _holeCount; nineChoice = _nineChoice;

  html += `<div class="totals-section-title">Scorecard</div>
    <div class="totals-sc-viewport" id="hist-sc-viewport">
      <div class="totals-sc-track" id="hist-sc-track">
        ${scFront}${scBack}
      </div>
    </div>
    <div class="mini-sc-dots" style="padding:10px 0 4px">
      <span class="mini-sc-dot on" id="hist-dot-0"></span>
      <span class="mini-sc-dot" id="hist-dot-1"></span>
    </div>`;

  // Hole results — perspective-based, first names only
  const rPlayers = r.players;
  const myIdxR = currentUser ? rPlayers.findIndex(p => p && p.uid === currentUser.uid) : -1;

  const rChains = (() => {
    function ordR(bh) { return rPlayers.map((_,i)=>(i+bh)%rPlayers.length); }
    const chains = Array.from({length:18},()=>({n:1,carry:false,f:null,p:null,t:null,betHole:0}));
    let cv=null, betHole=0;
    for (let h=0;h<18;h++) {
      if (cv) { chains[h].n=cv.n; chains[h].carry=true; chains[h].f=cv.f; chains[h].p=cv.p; chains[h].t=cv.t; chains[h].betHole=cv.betHole; }
      else { chains[h].betHole=betHole; }
      const hole=r.holes[h], ch=chains[h];
      const o=ordR(ch.betHole);
      const fi=ch.carry?ch.f:o[0];
      const pi=ch.carry?ch.p:(hole.partner!==null?hole.partner:o[1]);
      const tp=ch.carry?ch.t:hole.type;
      if (hole.result==='tie') { cv={n:ch.n+1,f:fi,p:pi,t:tp,betHole:ch.betHole}; }
      else { cv=null; betHole++; }
    }
    return chains;
  })();

  let anyResult = false;
  let hrHtml = '';
  for (let h=17;h>=0;h--) {
    const hole=r.holes[h], ch=rChains[h];
    const tp=ch.carry?ch.t:hole.type;
    if (!tp) continue;
    anyResult = true;
    const ordR = bh => rPlayers.map((_,i)=>(i+bh)%rPlayers.length);
    const o=ordR(ch.betHole);
    const fi=ch.carry?ch.f:o[0];
    const pi=ch.carry?ch.p:(hole.partner!==null?hole.partner:o[1]);
    const s=(r.stake*ch.n).toFixed(2);
    const re=hole.result;

    // Perspective-based result
    let myResult = re;
    if (re && myIdxR >= 0) {
      if (tp === 'hog') {
        if (myIdxR !== fi) myResult = re === 'win' ? 'lose' : re === 'lose' ? 'win' : re;
      } else {
        const onTeamB = myIdxR !== fi && myIdxR !== pi;
        if (onTeamB) myResult = re === 'win' ? 'lose' : re === 'lose' ? 'win' : re;
      }
    }

    const t1n=`${shortName(rPlayers[fi])} + ${shortName(rPlayers[pi])}`;
    const t2n=o.filter(i=>i!==fi&&i!==pi).map(i=>shortName(rPlayers[i])).join(' + ');
    let teams;
    if(re==='tie'){teams=`🔄 Carryover`;}
    else if(tp==='hog'){teams=`🐷 ${shortName(rPlayers[fi])}`;}
    else if(re==='win'){teams=`🏆 ${t1n}`;}
    else if(re==='lose'){teams=`🏆 ${t2n}`;}
    else{teams=`${t1n} vs ${t2n}`;}

    const badge=myResult==='win'?'win':myResult==='lose'?'lose':myResult==='tie'?'tie':'pend';
    const label=myResult==='win'?'Win':myResult==='lose'?'Lose':myResult==='tie'?'Tie':'—';
    let moneyStr='—';
    if(myResult==='win')  moneyStr=tp==='hog'?(myIdxR===fi?`+$${(r.stake*ch.n*3).toFixed(2)}`:`+$${s}`):`+$${s}`;
    if(myResult==='lose') moneyStr=tp==='hog'?(myIdxR===fi?`−$${(r.stake*ch.n*3).toFixed(2)}`:`−$${s}`):`−$${s}`;
    if(myResult==='tie')  moneyStr='→ next';

    hrHtml += `<div class="hr-row">
      <span class="hr-num">H${h+1}${ch.n>1?' ×'+ch.n:''}</span>
      <span class="hr-teams">${teams}</span>
      <span class="hr-badge ${badge}">${label}</span>
      <span class="hr-money ${myResult==='win'?'pos':myResult==='lose'?'neg':''}">${moneyStr}</span>
    </div>`;
  }
  if (!anyResult) hrHtml = `<div class="hr-row"><span style="color:var(--tx2);font-size:14px">No holes recorded</span></div>`;

  html += `<div class="totals-section-title">Hole Results</div><div class="hole-results">${hrHtml}</div>`;
  html += '<div style="height:8px"></div>';

  document.getElementById('history-detail-body').innerHTML = html;

  // Wire up scorecard swipe
  const hvp = document.getElementById('hist-sc-viewport');
  if (hvp) {
    let hPage = 0, startX = null;
    hvp.addEventListener('touchstart', e => { startX = e.touches[0].clientX; }, {passive:true});
    hvp.addEventListener('touchend', e => {
      if (startX === null) return;
      const dx = e.changedTouches[0].clientX - startX;
      if (Math.abs(dx) > 40) {
        hPage = dx < 0 ? 1 : 0;
        const track = document.getElementById('hist-sc-track');
        if (track) track.style.transform = `translateX(${hPage === 0 ? '0%' : '-50%'})`;
        document.getElementById('hist-dot-0').classList.toggle('on', hPage === 0);
        document.getElementById('hist-dot-1').classList.toggle('on', hPage === 1);
      }
      startX = null;
    }, {passive:true});
  }

  show('sc-history-detail');
}

/* ════════════════════════════════
   HANDICAP
════════════════════════════════ */
function calcHandicapIndex(diffs) {
  // WHS: number of best diffs to use based on count
  const n = diffs.length;
  if (n < 3) return null;
  const bestCount = n >= 20 ? 8 : n >= 19 ? 8 : n >= 18 ? 8 : n >= 17 ? 7 : n >= 16 ? 6
    : n >= 15 ? 6 : n >= 14 ? 5 : n >= 13 ? 5 : n >= 12 ? 4 : n >= 11 ? 4
    : n >= 10 ? 3 : n >= 9 ? 3 : n >= 8 ? 2 : n >= 7 ? 2 : n >= 6 ? 2
    : n >= 5 ? 1 : n >= 4 ? 1 : 1;
  const sorted = [...diffs].sort((a, b) => a - b).slice(0, bestCount);
  const avg = sorted.reduce((s, v) => s + v, 0) / bestCount;
  return Math.floor(avg * 0.96 * 10) / 10;
}

function showHandicap() {
  const hist = JSON.parse(localStorage.getItem('hog_rounds') || '[]');

  // Gather all rounds with score diffs, keyed by player name
  const playerData = {};
  hist.forEach(r => {
    if (!r.scoreDiffs) return;
    r.players.forEach((pl, i) => {
      if (r.scoreDiffs[i] == null) return;
      const key = (pl && pl.uid) ? pl.uid : pname(pl);
      if (!playerData[key]) playerData[key] = { name: pname(pl), diffs: [] };
      playerData[key].diffs.push({ diff: r.scoreDiffs[i], date: r.date, course: r.courseSub, tee: r.tee });
    });
  });

  const el = document.getElementById('handicap-body');
  const names = Object.keys(playerData);

  if (!names.length) {
    el.innerHTML = `<div class="history-empty">No rounds with handicap data yet.<br>Finish a round to start building your index.</div>`;
    show('sc-handicap');
    return;
  }

  el.innerHTML = names.map(key => {
    const entry  = playerData[key];
    const rounds = entry.diffs;
    const dname  = entry.name;
    const diffs  = rounds.slice(0, 20).map(r => r.diff);
    const idx    = calcHandicapIndex(diffs);
    const needed = Math.max(0, 3 - diffs.length);
    const idxStr = idx === null
      ? `<span class="hdcp-pending">Need ${needed} more round${needed > 1 ? 's' : ''}</span>`
      : `<span class="hdcp-index">${idx >= 0 ? '+' : ''}${idx.toFixed(1)}</span>`;

    const rows = rounds.slice(0, 20).map((r, i) => {
      const d   = new Date(r.date).toLocaleDateString('en-US', {month:'short', day:'numeric'});
      const best = diffs.slice(0, 20).sort((a,b)=>a-b).slice(0, calcBestCount(Math.min(diffs.length,20)));
      const used = best.includes(r.diff) && (() => { const idx2 = best.indexOf(r.diff); best.splice(idx2,1); return true; })();
      return `<tr class="${used ? 'hdcp-used' : ''}">
        <td>${d}</td><td>${r.tee}</td>
        <td>${r.diff >= 0 ? '+' : ''}${r.diff.toFixed(1)}${used ? ' ✓' : ''}</td>
      </tr>`;
    }).join('');

    return `<div class="hdcp-card">
      <div class="hdcp-card-hdr">
        <div class="hdcp-name">${dname}</div>
        <div>${idxStr}</div>
      </div>
      <div class="hdcp-rounds-label">${diffs.length} round${diffs.length!==1?'s':''} · best ${calcBestCount(Math.min(diffs.length,20))} used</div>
      <div class="sc-wrap"><table class="hdcp-table">
        <thead><tr><th>Date</th><th>Tee</th><th>Diff</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
    </div>`;
  }).join('');

  show('sc-handicap');
}

function calcBestCount(n) {
  return n >= 20 ? 8 : n >= 19 ? 8 : n >= 18 ? 8 : n >= 17 ? 7 : n >= 16 ? 6
    : n >= 15 ? 6 : n >= 14 ? 5 : n >= 13 ? 5 : n >= 12 ? 4 : n >= 11 ? 4
    : n >= 10 ? 3 : n >= 9 ? 3 : n >= 8 ? 2 : n >= 7 ? 2 : n >= 6 ? 2
    : n >= 5 ? 1 : n >= 4 ? 1 : n >= 3 ? 1 : 0;
}

/* ════════════════════════════════
   LEADERBOARD
════════════════════════════════ */
function showLeaderboard() {
  const hist = JSON.parse(localStorage.getItem('hog_rounds') || '[]');
  const el   = document.getElementById('leaderboard-body');

  if (!hist.length) {
    el.innerHTML = `<div class="history-empty">No rounds saved yet.<br>Finish a round to start the leaderboard.</div>`;
    show('sc-leaderboard');
    return;
  }

  // Aggregate per player: total money, rounds played, wins (holes won)
  const stats = {};
  hist.forEach(r => {
    r.players.forEach((pl, i) => {
      const key  = (pl && pl.uid) ? pl.uid : pname(pl);
      const name = pname(pl);
      if (!stats[key]) stats[key] = { name, money: 0, rounds: 0, wins: 0, losses: 0 };
      stats[key].money  += r.money[i];
      stats[key].rounds += 1;
      // count hole wins from holes array
      if (r.holes) {
        r.holes.forEach(h => {
          if (h.result === 'win')  stats[key].wins   += 1;
          if (h.result === 'lose') stats[key].losses += 1;
        });
      }
    });
  });

  const sorted = Object.entries(stats).sort((a, b) => b[1].money - a[1].money);

  const medals = ['🥇', '🥈', '🥉'];

  const rows = sorted.map(([key, s], idx) => {
    const name = s.name;
    const cls    = s.money > 0 ? 'pos' : s.money < 0 ? 'neg' : 'neu';
    const disp   = (s.money >= 0 ? '+' : '−') + '$' + Math.abs(s.money).toFixed(2);
    const avg    = s.rounds ? (s.money / s.rounds) : 0;
    const avgDisp = (avg >= 0 ? '+' : '−') + '$' + Math.abs(avg).toFixed(2);
    const medal  = medals[idx] || `${idx + 1}.`;
    return `<div class="lb-row">
      <div class="lb-rank">${medal}</div>
      <div class="lb-info">
        <div class="lb-name">${name}</div>
        <div class="lb-meta">${s.rounds} round${s.rounds !== 1 ? 's' : ''} · ${avgDisp}/round</div>
      </div>
      <div class="lb-money ${cls}">${disp}</div>
    </div>`;
  }).join('');

  const totalRounds = hist.length;
  el.innerHTML = `
    <div class="lb-subtitle">${totalRounds} round${totalRounds !== 1 ? 's' : ''} played · all-time net winnings</div>
    <div class="lb-list">${rows}</div>`;

  show('sc-leaderboard');
}

/* ════════════════════════════════
   INIT
════════════════════════════════ */
function renderHomeRecent() {
  const primaryEl = document.getElementById('home-primary');
  const recentEl  = document.getElementById('home-recent');

  // Primary button: Continue Round (if session active) or Start a Round
  if (primaryEl) {
    if (hasActiveSession()) {
      const s          = JSON.parse(localStorage.getItem('hog_session'));
      const course     = COURSES[s.cIdx];
      const courseName = course ? course.name : 'Round';
      const courseSub  = course ? course.sub  : '';
      const tee        = course ? course.tees[s.tIdx].n : '';
      const holesIn    = s.touched.filter(h => h.every(t => t)).length;
      const playerList = s.players.map(p => pname(p)).join(', ');
      primaryEl.innerHTML = `<button class="home-primary-btn home-primary-btn--continue" onclick="continueRound()">
        <div class="home-primary-icon">⛳</div>
        <div class="home-primary-text">
          <div class="home-primary-title">Continue Round</div>
          <div class="home-primary-sub">${courseSub} · ${tee} tees · Through hole ${holesIn}</div>
        </div>
        <div class="home-primary-chevron">›</div>
      </button>`;
    } else {
      primaryEl.innerHTML = `<button class="home-primary-btn" onclick="show('sc-courses')">
        <div class="home-primary-icon">⛳</div>
        <div class="home-primary-text">
          <div class="home-primary-title">Start a Round</div>
          <div class="home-primary-sub">Choose course, players &amp; stake</div>
        </div>
        <div class="home-primary-chevron">›</div>
      </button>`;
    }
  }

  // Recent round card
  if (!recentEl) return;
  const hist = JSON.parse(localStorage.getItem('hog_rounds') || '[]');
  if (!hist.length) { recentEl.innerHTML = ''; return; }
  const r    = hist[0];
  const d    = new Date(r.date);
  const date = d.toLocaleDateString('en-US', {month:'short', day:'numeric', year:'numeric'});
  recentEl.innerHTML = `<div class="home-recent-card" onclick="viewRound(${r.id}); show('sc-history-detail')">
    <div class="home-recent-hdr">
      <span class="home-recent-label">Recent Round</span>
      <span class="home-recent-chevron">›</span>
    </div>
    <div class="home-recent-course">${r.courseSub || r.course}</div>
    <div class="home-recent-meta">${date} · ${r.tee} tees · $${r.stake}/hole</div>
    ${playerRowHTML(r.players, r.money)}
  </div>`;
}

(function init() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
  }

  auth.onAuthStateChanged(user => {
    currentUser = user;
    if (user) {
      const displayName = user.displayName || user.email.split('@')[0];
      // Register in users collection so others can pick us in round setup
      db.collection('users').doc(user.uid).set({ name: displayName, uid: user.uid }, { merge: true });
      const signoutBtn = document.getElementById('home-signout');
      if (signoutBtn) signoutBtn.title = `Signed in as ${displayName}`;
      renderCourses();
      renderHomeRecent();
      show('sc-home');
    } else {
      loginMode = 'signin';
      document.getElementById('login-submit-btn').textContent = 'Sign In';
      document.getElementById('login-toggle-btn').textContent = 'Create Account';
      document.getElementById('login-subtitle').textContent   = 'Sign in to continue';
      document.getElementById('login-name').value     = '';
      document.getElementById('login-password').value = '';
      document.getElementById('login-error').textContent = '';
      show('sc-login');
    }
  });
})();
