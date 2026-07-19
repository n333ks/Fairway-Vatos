/* ════════════════════════════════
   COURSE DATA
════════════════════════════════ */
const COURSES = [{
  name: "Desert Springs Golf Club",
  sub:  "Valley Course",
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
}];

/* ════════════════════════════════
   STATE
════════════════════════════════ */
let cIdx        = 0;
let tIdx        = 2;
let players     = [];
let stake       = 0;
let scores      = [];
let holes       = [];
let touched     = [];
let currentHole   = 0;
let scorecardPage = 0; // 0=front, 1=back
let currentRoundId = null;
let holeCount  = 18;      // 18 or 9
let nineChoice = 'front'; // 'front' or 'back'

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

function recomputeAll() {
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

function calcMoney() {
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

function endRound() {
  if (!confirm('End this round? Your progress will be lost.')) return;
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
  if (currentHole < lastHole() && touched[currentHole].every(t => t)) goToHole(currentHole + 1);
}

/* ════════════════════════════════
   SCREEN 1 — COURSE SELECT
════════════════════════════════ */
function renderCourses() {
  document.getElementById('course-list').innerHTML = COURSES.map((c, i) => `
    <div class="course-card" onclick="selectCourse(${i})">
      <div class="course-card-inner">
        <div class="course-card-row">
          <div>
            <div class="course-card-name">${c.name}</div>
            <div class="course-card-sub">${c.sub}</div>
          </div>
          <div class="course-card-chevron">›</div>
        </div>
      </div>
      <div class="tee-chips-row">
        ${c.tees.map(t => `<span class="tee-chip-sm" style="background:${t.bg};color:${t.fg}">${t.n} ${t.tot.toLocaleString()}</span>`).join('')}
      </div>
    </div>`).join('');
}

function selectCourse(i) {
  cIdx = i; tIdx = 2;
  holeCount = 18; nineChoice = 'front';
  document.getElementById('setup-sub').textContent = COURSES[i].name + ' · ' + COURSES[i].sub;
  renderTeeScroll();
  renderPlayerInputs();
  // Init hole count buttons
  document.querySelectorAll('.hole-count-btn').forEach((b, idx) => b.classList.toggle('sel', idx === 0));
  document.querySelectorAll('.nine-choice-btn').forEach(b => b.classList.toggle('sel', b.dataset.val === 'front'));
  document.getElementById('nine-choice').style.display = 'none';
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

function renderPlayerInputs() {
  document.getElementById('player-inputs').innerHTML = [0,1,2,3].map(i =>
    `<div class="player-row">
      <div class="player-num">${i+1}</div>
      <input type="text" placeholder="Player ${i+1}"
        oninput="players[${i}]=this.value.trim()||'Player ${i+1}'"
        autocomplete="off">
    </div>`).join('');
}

function saveSession() {
  if (!players.length) return;
  localStorage.setItem('hog_session', JSON.stringify({
    cIdx, tIdx, players, stake, scores, holes, touched, currentHole, currentRoundId,
    holeCount, nineChoice
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

function startRound() {
  const inputs = document.querySelectorAll('#player-inputs input');
  players = [0,1,2,3].map(i => inputs[i].value.trim() || 'Player ' + (i+1));
  scores  = Array.from({length:18}, () => players.map(() => null));
  holes   = Array.from({length:18}, () => ({type:null, partner:null, result:null}));
  touched = Array.from({length:18}, () => players.map(() => false));
  currentHole    = firstHole();
  scorecardPage  = nineChoice === 'back' ? 1 : 0;
  currentRoundId = null;
  clearSession();
  showTab('holes');
  renderHoles();
  show('sc-round');
}

/* ════════════════════════════════
   SCREEN 3 — HOLES TAB
════════════════════════════════ */
function renderHoles() {
  const cs  = buildChains();
  const c   = COURSES[cIdx], t = c.tees[tIdx];
  const h   = currentHole;
  const ch  = cs[h];
  const par = c.par[h], hcp = c.hcp[h], yds = t.yds[h];
  const o   = ord(ch.betHole);
  const fi  = ch.carry ? ch.f : o[0];
  const priorDone   = h === 0 || holes[h-1].result !== null;
  const allTouched  = touched[h].every(t => t);

  // Drive nav bar
  const titleEl = document.getElementById('round-title');
  const subEl   = document.getElementById('round-sub');
  if (titleEl) titleEl.textContent = `Hole ${h+1} · Par ${par}`;
  if (subEl)   subEl.textContent   = `${t.n} · ${yds} yds · HCP ${hcp}`;
  const btnPrev = document.getElementById('btn-prev');
  const btnNext = document.getElementById('btn-next');
  if (btnPrev) btnPrev.disabled = (h === firstHole());
  if (btnNext) btnNext.disabled = (h === lastHole() || !allTouched);

  const stakeTag = ch.n > 1
    ? `<span class="carry-tag">$${(stake * ch.n).toFixed(2)}/player</span>` : '';

  const isLastHole    = h === lastHole();
  const effectiveType = ch.carry ? ch.t : holes[h].type;
  const needsPartner  = !ch.carry && effectiveType === '2v2' && holes[h].partner === null;

  const blocked = !allTouched
    ? `<div class="next-hole-blocked">Enter all scores to continue</div>`
    : !effectiveType
      ? `<div class="next-hole-blocked">Choose a game type above</div>`
      : needsPartner
        ? `<div class="next-hole-blocked">Choose teams above</div>`
        : isLastHole
          ? ''
          : `<div class="next-hole-proceed" onclick="nextHole()">Proceed to next hole →</div>`;
  const body = document.getElementById('holes-body');
  body.innerHTML = `
    <div class="hole-card${ch.carry ? ' carry' : ''}" id="hole-${h}">
      <div class="hole-card-hdr">
        <div>
          <div class="first-tee-lbl" id="hfl-${h}">${ch.carry ? 'Carryover' : 'First Tee'}</div>
          <div class="first-tee-name" id="hfn-${h}">${priorDone ? players[fi] : '—'}</div>
        </div>
        ${stakeTag}
      </div>
      <div id="hb-${h}"></div>
    </div>
    ${blocked}
    <div class="mini-sc-card" id="mini-sc"></div>`;
  renderHoleBody(h, ch);
  renderMiniScorecard();
}

function goToHole(h) {
  currentHole   = h;
  scorecardPage = h < 9 ? 0 : 1;
  renderHoles();
  document.getElementById('tab-holes-wrap').scrollTop = 0;
}

function setSCPage(p) {
  scorecardPage = p;
  const track = document.getElementById('mini-sc-track');
  if (track) track.style.transform = `translateX(${p === 0 ? '0%' : '-50%'})`;
  document.querySelectorAll('.mini-sc-dot').forEach((d, i) => d.classList.toggle('on', i === p));
}

function buildMiniHalf(startH, label) {
  const isBack = startH === 9;
  const c   = COURSES[cIdx];
  const par = c.par;
  const hrs = Array.from({length:9}, (_, i) => startH + i);
  const frontHrs = [0,1,2,3,4,5,6,7,8];
  const parTotal    = hrs.reduce((s, h) => s + par[h], 0);
  const parFrontTot = frontHrs.reduce((s, h) => s + par[h], 0);
  const parGrandTot = par.reduce((s, p) => s + p, 0);

  return `<div class="mini-sc-half">
    <div class="sc-wrap" style="margin:0">
      <table class="sct">
        <thead><tr>
          <th class="stk">Hole</th>
          ${hrs.map(h => `<th${h===currentHole?' class="mini-cur"':''}>${h+1}</th>`).join('')}
          <th class="sep">${label}</th>
          ${isBack ? `<th class="sep">Tot</th>` : ''}
        </tr></thead>
        <tbody>
          <tr class="par-row">
            <td class="stk">Par</td>
            ${hrs.map(h => `<td>${par[h]}</td>`).join('')}
            <td class="sep">${parTotal}</td>
            ${isBack ? `<td class="sep">${parGrandTot}</td>` : ''}
          </tr>
          ${players.map((name, p) => {
            const entered = hrs.filter(h => scores[h][p] !== null);
            const sub     = entered.reduce((s, h) => s + scores[h][p], 0);
            const subPar  = entered.reduce((s, h) => s + par[h], 0);
            const diff    = sub - subPar;
            const diffStr = diff === 0 ? 'E' : (diff > 0 ? '+' : '') + diff;
            const diffCol = diff < 0 ? 'var(--green)' : diff > 0 ? 'var(--red)' : 'var(--tx2)';
            const subCell = entered.length
              ? `<div>${sub}</div><div style="font-size:9px;color:${diffCol}">${diffStr}</div>`
              : `<div>—</div><div style="font-size:9px;color:var(--tx3)">—</div>`;

            let totCell = `<div>—</div><div style="font-size:9px;color:var(--tx3)">—</div>`;
            if (isBack) {
              const frontEntered = frontHrs.filter(h => scores[h][p] !== null);
              const frontSub = frontEntered.reduce((s, h) => s + scores[h][p], 0);
              const allEntered = [...frontHrs, ...hrs].filter(h => scores[h][p] !== null);
              const grandTot = allEntered.reduce((s, h) => s + scores[h][p], 0);
              const grandPar = allEntered.reduce((s, h) => s + par[h], 0);
              const grandDiff = grandTot - grandPar;
              const grandDiffStr = grandDiff === 0 ? 'E' : (grandDiff > 0 ? '+' : '') + grandDiff;
              const grandCol = grandDiff < 0 ? 'var(--green)' : grandDiff > 0 ? 'var(--red)' : 'var(--tx2)';
              if (allEntered.length) totCell = `<div>${grandTot}</div><div style="font-size:9px;color:${grandCol}">${grandDiffStr}</div>`;
            }

            const shortName = name.split(' ')[0].slice(0, 8);
            return `<tr>
              <td class="stk">${shortName}</td>
              ${hrs.map(h => scores[h][p] !== null
                ? `<td>${fmtCell(scores[h][p], par[h])}</td>`
                : `<td><div>—</div><div style="font-size:9px;color:var(--tx3)">—</div></td>`
              ).join('')}
              <td class="sep">${subCell}</td>
              ${isBack ? `<td class="sep">${totCell}</td>` : ''}
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
  </div>`;
}

function renderMiniScorecard() {
  const el = document.getElementById('mini-sc');
  if (!el) return;

  const offset = scorecardPage === 0 ? '0%' : '-50%';
  el.innerHTML = `
    <div class="mini-sc-viewport">
      <div class="mini-sc-track" id="mini-sc-track" style="transform:translateX(${offset})">
        ${buildMiniHalf(0, 'Out')}
        ${buildMiniHalf(9, 'In')}
      </div>
    </div>
    <div class="mini-sc-dots">
      <span class="mini-sc-dot${scorecardPage===0?' on':''}"></span>
      <span class="mini-sc-dot${scorecardPage===1?' on':''}"></span>
    </div>`;

  // Swipe gesture
  const vp = el.querySelector('.mini-sc-viewport');
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
  if (d ===  4) return {cls:'b-over',     txt:'You Really Suck'};
  if (d >=   5) return {cls:'b-over',     txt:'Just Quit'};
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
  return o.filter(i => i !== fi && i !== pi).map(i => players[i]).join(' + ');
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
        <div class="team-label">🐷 ${players[fi]} — hogging</div>
        ${scoreRowHTML(h, fi, players[fi])}
      </div>
      <div class="vs-row"><div class="vs-line"></div><span class="vs-txt">VS</span><div class="vs-line"></div></div>
      <div class="team-section team-b">
        <div class="team-label">Opponents</div>
        ${others.map(i => scoreRowHTML(h, i, players[i])).join('')}
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
        <div class="partner-lbl">Partner for ${players[fi]}</div>
        <div class="pchip-row">
          ${o.slice(1).map(i =>
            `<button class="pchip${pi === i ? ' sel' : ''}" onclick="setPartner(${h},${i})">${players[i]}</button>`
          ).join('')}
        </div>
      </div>`;

    html += `
      ${partnerPicker}
      <div class="team-section team-a">
        <div class="team-label">Team A — ${players[fi]} + ${players[pi]}</div>
        ${t1.map(i => scoreRowHTML(h, i, players[i])).join('')}
        <div class="best-row">Best ball <b>${b1 ?? '—'}</b></div>
      </div>
      <div class="vs-row"><div class="vs-line"></div><span class="vs-txt">VS</span><div class="vs-line"></div></div>
      <div class="team-section team-b">
        <div class="team-label">Team B — ${teamBNames(o, fi, pi)}</div>
        ${t2.map(i => scoreRowHTML(h, i, players[i])).join('')}
        <div class="best-row">Best ball <b>${b2 ?? '—'}</b></div>
      </div>`;

  } else {
    html += `
      <div class="team-section">
        <div class="team-label" style="color:var(--tx2)">Choose Hog or 2v2 above</div>
        ${o.map(i => scoreRowHTML(h, i, players[i])).join('')}
      </div>`;
  }

  // result banner
  if (tp) {
    const r   = hole.result;
    let txt   = '', cls = 'rb-pending';
    const nextH = h + 2;

    if (tp === 'hog') {
      const hogWin = (stake * ch.n * 3).toFixed(2);
      if      (r === 'win')  { txt = `🐷 ${players[fi]} wins · +$${hogWin}`; cls = 'rb-win'; }
      else if (r === 'lose') { txt = `🐷 ${players[fi]} loses · −$${hogWin}`; cls = 'rb-lose'; }
      else if (r === 'tie')  { txt = `Tied · $${ns}/player carries to hole ${nextH}`; cls = 'rb-tie'; }
      else                   { txt = 'Enter scores above'; }
    } else {
      const aName = `${players[fi]} + ${players[pi]}`;
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
  if (nm)  nm.textContent  = priorDone ? players[fi] : '—';
}

function adjScore(h, p, d) {
  const par = COURSES[cIdx].par[h];
  if (scores[h][p] === null) { scores[h][p] = par; }
  else { scores[h][p] = Math.min(par * 2, Math.max(1, scores[h][p] + d)); }
  touched[h][p]  = true;

  const sc = scores[h][p], b = scoreBadge(sc, par);
  const sv = document.getElementById('sv-' + h + '-' + p);
  const sb = document.getElementById('sb-' + h + '-' + p);
  if (sv) sv.textContent = sc;
  if (sb) { sb.textContent = b.txt; sb.className = 'sc-badge ' + b.cls; }

  if (touched[h].every(t => t)) recomputeAll();
  saveSession();
  renderHoles();
  renderMiniScorecard();
}

function setType(h, type) {
  holes[h].type    = type;
  holes[h].partner = null;
  if (type === '2v2') {
    const cs = buildChains();
    holes[h].partner = ord(cs[h].betHole)[1];
  }
  if (touched[h].every(t => t)) recomputeAll();
  saveSession();
  renderHoles();
}

function setPartner(h, idx) {
  holes[h].partner = idx;
  if (touched[h].every(t => t)) recomputeAll();
  saveSession();
  renderHoles();
}

/* ════════════════════════════════
   SCREEN 3 — TOTALS TAB
════════════════════════════════ */
function renderTotals() {
  saveRound();
  const money = calcMoney();
  const c     = COURSES[cIdx];
  const cs    = buildChains();
  const par   = c.par;
  const pout  = par.slice(0,9).reduce((a,b) => a+b, 0);
  const pin   = par.slice(9).reduce((a,b) => a+b, 0);

  document.getElementById('money-grid').innerHTML = players.map((name, i) => {
    const amt = money[i];
    const cls = amt > 0 ? 'pos' : amt < 0 ? 'neg' : 'neu';
    const disp = (amt >= 0 ? '+' : '−') + '$' + Math.abs(amt).toFixed(2);
    return `<div class="money-card">
      <div class="money-name">${name}</div>
      <div class="money-amt ${cls}">${disp}</div>
    </div>`;
  }).join('');

  function buildTotalsHalf(startH, endH, halfLabel, colLabel) {
    const isBack  = startH === 9;
    const halfPar = par.slice(startH, endH).reduce((a, b) => a + b, 0);
    const grandPar = par.reduce((a, b) => a + b, 0);

    let thead2 = `<thead><tr><th class="stk">Player</th>`;
    for (let h = startH; h < endH; h++) thead2 += `<th>${h+1}</th>`;
    thead2 += `<th class="sep">${colLabel}</th>`;
    if (isBack) thead2 += `<th class="sep">Tot</th>`;
    thead2 += `</tr></thead>`;

    let tbody2 = '<tbody>';
    tbody2 += `<tr class="par-row"><td class="stk">Par</td>`;
    par.slice(startH, endH).forEach(p => tbody2 += `<td>${p}</td>`);
    tbody2 += `<td class="sep">${halfPar}</td>`;
    if (isBack) tbody2 += `<td class="sep">${grandPar}</td>`;
    tbody2 += `</tr>`;

    players.forEach((name, p) => {
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

      tbody2 += `<tr><td class="stk">${name}</td>`;
      for (let h = startH; h < endH; h++) {
        if (sc[h] === null) { tbody2 += `<td style="color:var(--tx3)">—</td>`; continue; }
        tbody2 += `<td>${fmtCell(sc[h], par[h])}</td>`;
      }
      tbody2 += `<td class="sep" style="font-weight:700">${halfDisp}</td>`;
      if (isBack) tbody2 += `<td class="sep" style="font-weight:700">${grandCell}</td>`;
      tbody2 += `</tr>`;
    });
    tbody2 += '</tbody>';

    return `<div class="totals-sc-half">
      <div class="sc-half-label">${halfLabel}</div>
      <div class="sc-wrap" style="margin:0 16px"><table class="sct">${thead2}${tbody2}</table></div>
    </div>`;
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
  const tvp = document.querySelector('.totals-sc-viewport');
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

  let hr = '';
  for (let h = 0; h < 18; h++) {
    const hole = holes[h], ch = cs[h];
    const tp   = ch.carry ? ch.t : hole.type;
    if (!tp) continue;
    const o  = ord(ch.betHole);
    const fi = ch.carry ? ch.f : o[0];
    const pi = ch.carry ? ch.p : (hole.partner !== null ? hole.partner : o[1]);
    const s  = (stake * ch.n).toFixed(2);
    const r  = hole.result;

    const t1Names = `${players[fi]} + ${players[pi]}`;
    const t2Names = teamBNames(o, fi, pi);
    let teams;
    if (tp === 'hog') {
      teams = `🐷 ${players[fi]} vs all`;
    } else if (r === 'win') {
      teams = `🏆 ${t1Names}`;
    } else if (r === 'lose') {
      teams = `🏆 ${t2Names}`;
    } else {
      teams = `${t1Names} vs ${t2Names}`;
    }

    const badge = r === 'win' ? 'win' : r === 'lose' ? 'lose' : r === 'tie' ? 'tie' : 'pend';
    const label = r === 'win' ? 'Win' : r === 'lose' ? 'Lose' : r === 'tie' ? '🔄 Carry' : '—';

    let moneyStr = '—';
    if (r === 'win')  moneyStr = tp === 'hog' ? `+$${(stake*ch.n*3).toFixed(2)}` : `+$${s}`;
    if (r === 'lose') moneyStr = tp === 'hog' ? `−$${(stake*ch.n*3).toFixed(2)}` : `−$${s}`;
    if (r === 'tie')  moneyStr = '→ next';

    hr += `<div class="hr-row">
      <span class="hr-num">H${h+1}${ch.n > 1 ? ' ×'+ch.n : ''}</span>
      <span class="hr-teams">${teams}</span>
      <span class="hr-badge ${badge}">${label}</span>
      <span class="hr-money ${r==='win'?'pos':r==='lose'?'neg':''}">${moneyStr}</span>
    </div>`;
  }

  document.getElementById('hole-results').innerHTML = hr ||
    '<div class="hr-row"><span style="color:var(--tx2);font-size:14px">No holes entered yet</span></div>';
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
  const scoreDiffs = (t.rating != null)
    ? players.map((_, p) => {
        const gross = ah.reduce((sum, h) => sum + (scores[h][p] || 0), 0);
        // For 9-hole rounds adjust rating and slope to 9-hole equivalents
        const adjRating = holeCount === 9 ? t.rating / 2 : t.rating;
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
    players:    [...players],
    stake,
    scores:     scores.map(h => [...h]),
    holes:      holes.map(h => ({...h})),
    money:      [...money],
    scoreDiffs
  };
  const hist = JSON.parse(localStorage.getItem('hog_rounds') || '[]');
  const idx  = hist.findIndex(r => r.id === id);
  if (idx >= 0) hist[idx] = round; else hist.unshift(round);
  localStorage.setItem('hog_rounds', JSON.stringify(hist.slice(0, 100)));
}

function deleteRound(id, e) {
  e.stopPropagation();
  if (!confirm('Delete this round? This cannot be undone.')) return;
  const hist = JSON.parse(localStorage.getItem('hog_rounds') || '[]');
  localStorage.setItem('hog_rounds', JSON.stringify(hist.filter(r => r.id !== id)));
  showHistory();
}

function showHistory() {
  const hist = JSON.parse(localStorage.getItem('hog_rounds') || '[]');
  const el   = document.getElementById('history-list');
  if (!hist.length) {
    el.innerHTML = `<div class="history-empty">No rounds saved yet.<br>Finish a hole and check Totals to auto-save.</div>`;
  } else {
    el.innerHTML = hist.map(r => {
      const d    = new Date(r.date);
      const date = d.toLocaleDateString('en-US', {month:'short', day:'numeric', year:'numeric'});
      const time = d.toLocaleTimeString('en-US', {hour:'numeric', minute:'2-digit'});
      const pills = r.players.map((name, i) => {
        const m   = r.money[i];
        const cls = m > 0 ? 'pos' : m < 0 ? 'neg' : 'neu';
        const amt = (m >= 0 ? '+' : '−') + '$' + Math.abs(m).toFixed(2);
        return `<span class="history-money-pill ${cls}">${name} ${amt}</span>`;
      }).join('');
      return `<div class="history-card" onclick="viewRound(${r.id})">
        <div class="history-card-top">
          <div class="history-card-course">${r.courseSub}</div>
          <div class="history-card-date">${date} · ${time}</div>
        </div>
        <div class="history-card-tee">${r.tee} tees · $${r.stake.toFixed(2)}/hole</div>
        <div class="history-card-money">${pills}</div>
        <div class="history-card-actions">
          <button class="delete-btn" onclick="deleteRound(${r.id}, event)">Delete</button>
        </div>
      </div>`;
    }).join('');
  }
  show('sc-history');
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
  r.players.forEach((name, i) => {
    const m   = money[i];
    const cls = m > 0 ? 'pos' : m < 0 ? 'neg' : 'neu';
    const disp = (m >= 0 ? '+' : '−') + '$' + Math.abs(m).toFixed(2);
    html += `<div class="money-card">
      <div class="money-name">${name}</div>
      <div class="money-amt ${cls}">${disp}</div>
    </div>`;
  });
  html += '</div>';

  // Scorecard
  const pout = par.slice(0,9).reduce((a,b)=>a+b,0);
  const pin  = par.slice(9).reduce((a,b)=>a+b,0);
  let thead  = '<thead><tr><th class="stk">Player</th>';
  for (let h=0;h<9;h++)  thead += `<th>${h+1}</th>`;
  thead += `<th class="sep">Out</th>`;
  for (let h=9;h<18;h++) thead += `<th>${h+1}</th>`;
  thead += `<th class="sep">In</th><th class="sep">Tot</th></tr></thead>`;

  let tbody = `<tbody><tr class="par-row"><td class="stk">Par</td>`;
  par.slice(0,9).forEach(p => tbody += `<td>${p}</td>`);
  tbody += `<td class="sep">${pout}</td>`;
  par.slice(9).forEach(p => tbody += `<td>${p}</td>`);
  tbody += `<td class="sep">${pin}</td><td class="sep">${pout+pin}</td></tr>`;

  r.players.forEach((name, p) => {
    const sc  = r.scores.map(h => h[p]);
    const out = sc.slice(0,9).reduce((a,v)=>a+(v??0),0);
    const inp = sc.slice(9).reduce((a,v)=>a+(v??0),0);
    const tot = out + inp;
    const entered = sc.filter(v => v !== null);
    const entPar  = entered.length ? par.filter((_,h) => sc[h]!==null).reduce((a,b)=>a+b,0) : 0;
    const diff    = entered.length ? tot - entPar : 0;
    const diffStr = entered.length===0 ? '—' : diff===0 ? 'E' : (diff>0?'+':'')+diff;
    const diffCol = diff<0?'var(--green)':diff>0?'var(--red)':'var(--tx2)';

    tbody += `<tr><td class="stk">${name}</td>`;
    for (let h=0;h<9;h++)  tbody += sc[h]!==null?`<td>${fmtCell(sc[h],par[h])}</td>`:`<td style="color:var(--tx3)">—</td>`;
    tbody += `<td class="sep">${sc.slice(0,9).some(v=>v!==null)?out:'—'}</td>`;
    for (let h=9;h<18;h++) tbody += sc[h]!==null?`<td>${fmtCell(sc[h],par[h])}</td>`:`<td style="color:var(--tx3)">—</td>`;
    tbody += `<td class="sep">${sc.slice(9).some(v=>v!==null)?inp:'—'}</td>
      <td class="sep" style="font-weight:700">${entered.length?tot:'—'}<br>
      <span style="font-size:10px;color:${diffCol}">${diffStr}</span></td></tr>`;
  });
  tbody += '</tbody>';

  html += `<div class="totals-section-title">Scorecard</div>
    <div style="margin:12px 16px 0"><div class="sc-wrap"><table class="sct">${thead+tbody}</table></div></div>`;

  // Hole results
  html += `<div class="totals-section-title">Hole Results</div><div class="hole-results">`;
  let anyResult = false;
  const cs = (() => {
    // rebuild chains from saved data
    const tempHoles   = r.holes;
    const tempPlayers = r.players;
    function ordR(bh) { return tempPlayers.map((_,i)=>(i+bh)%tempPlayers.length); }
    const chains = Array.from({length:18},()=>({n:1,carry:false,f:null,p:null,t:null,betHole:0}));
    let cv=null, betHole=0;
    for (let h=0;h<18;h++) {
      if (cv) { chains[h].n=cv.n; chains[h].carry=true; chains[h].f=cv.f; chains[h].p=cv.p; chains[h].t=cv.t; chains[h].betHole=cv.betHole; }
      else { chains[h].betHole=betHole; }
      const hole=tempHoles[h], ch=chains[h];
      const o=ordR(ch.betHole);
      const fi=ch.carry?ch.f:o[0];
      const pi=ch.carry?ch.p:(hole.partner!==null?hole.partner:o[1]);
      const tp=ch.carry?ch.t:hole.type;
      if (hole.result==='tie') { cv={n:ch.n+1,f:fi,p:pi,t:tp,betHole:ch.betHole}; }
      else { cv=null; betHole++; }
    }
    return chains;
  })();

  for (let h=0;h<18;h++) {
    const hole=r.holes[h], ch=cs[h];
    const tp=ch.carry?ch.t:hole.type;
    if (!tp) continue;
    anyResult = true;
    function ordR(bh){return r.players.map((_,i)=>(i+bh)%r.players.length);}
    const o=ordR(ch.betHole);
    const fi=ch.carry?ch.f:o[0];
    const pi=ch.carry?ch.p:(hole.partner!==null?hole.partner:o[1]);
    const s=(r.stake*ch.n).toFixed(2);
    const re=hole.result;
    const teams=tp==='hog'
      ?`🐷 ${r.players[fi]} vs all`
      :`${r.players[fi]} + ${r.players[pi]} vs ${o.filter(i=>i!==fi&&i!==pi).map(i=>r.players[i]).join(' + ')}`;
    const badge=re==='win'?'win':re==='lose'?'lose':re==='tie'?'tie':'pend';
    const label=re==='win'?'Win':re==='lose'?'Lose':re==='tie'?'Tied':'—';
    let moneyStr='—';
    if(re==='win')  moneyStr=tp==='hog'?`+$${(r.stake*ch.n*3).toFixed(2)}`:`+$${s}`;
    if(re==='lose') moneyStr=tp==='hog'?`−$${(r.stake*ch.n*3).toFixed(2)}`:`−$${s}`;
    if(re==='tie')  moneyStr='→ next';
    html += `<div class="hr-row">
      <span class="hr-num">H${h+1}${ch.n>1?' ×'+ch.n:''}</span>
      <span class="hr-teams">${teams}</span>
      <span class="hr-badge ${badge}">${label}</span>
      <span class="hr-money ${re==='win'?'pos':re==='lose'?'neg':''}">${moneyStr}</span>
    </div>`;
  }
  if (!anyResult) html += `<div class="hr-row"><span style="color:var(--tx2);font-size:14px">No holes recorded</span></div>`;
  html += '</div>';

  document.getElementById('history-detail-body').innerHTML = html;
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
    r.players.forEach((name, i) => {
      if (r.scoreDiffs[i] == null) return;
      if (!playerData[name]) playerData[name] = [];
      playerData[name].push({ diff: r.scoreDiffs[i], date: r.date, course: r.courseSub, tee: r.tee });
    });
  });

  const el = document.getElementById('handicap-body');
  const names = Object.keys(playerData);

  if (!names.length) {
    el.innerHTML = `<div class="history-empty">No rounds with handicap data yet.<br>Finish a round to start building your index.</div>`;
    show('sc-handicap');
    return;
  }

  el.innerHTML = names.map(name => {
    const rounds = playerData[name]; // newest first from hist order
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
        <div class="hdcp-name">${name}</div>
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
    r.players.forEach((name, i) => {
      if (!stats[name]) stats[name] = { money: 0, rounds: 0, wins: 0, losses: 0 };
      stats[name].money  += r.money[i];
      stats[name].rounds += 1;
      // count hole wins from holes array
      if (r.holes) {
        r.holes.forEach(h => {
          if (h.result === 'win')  stats[name].wins   += 1;
          if (h.result === 'lose') stats[name].losses += 1;
        });
      }
    });
  });

  const sorted = Object.entries(stats).sort((a, b) => b[1].money - a[1].money);

  const medals = ['🥇', '🥈', '🥉'];

  const rows = sorted.map(([name, s], idx) => {
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
      const playerList = s.players.join(', ');
      primaryEl.innerHTML = `<button class="home-primary-btn home-primary-btn--continue" onclick="continueRound()">
        <div class="home-primary-icon">⛳</div>
        <div class="home-primary-text">
          <div class="home-primary-title">Continue Round</div>
          <div class="home-primary-sub">${courseSub} · ${tee} tees · Through hole ${holesIn}</div>
          <div class="home-primary-sub">${playerList}</div>
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
  const pills = r.players.map((name, i) => {
    const m   = r.money[i];
    const cls = m > 0 ? 'pos' : m < 0 ? 'neg' : 'neu';
    const amt = (m >= 0 ? '+' : '−') + '$' + Math.abs(m).toFixed(2);
    return `<span class="history-money-pill ${cls}">${name} ${amt}</span>`;
  }).join('');
  recentEl.innerHTML = `<div class="home-recent-card" onclick="viewRound(${r.id}); show('sc-history-detail')">
    <div class="home-recent-hdr">
      <span class="home-recent-label">Recent Round</span>
      <span class="home-recent-chevron">›</span>
    </div>
    <div class="home-recent-course">${r.courseSub || r.course}</div>
    <div class="home-recent-meta">${date} · ${r.tee} tees · $${r.stake}/hole</div>
    <div class="home-recent-pills">${pills}</div>
  </div>`;
}

(function init() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
  }
  renderCourses();
  renderHomeRecent();
})();
