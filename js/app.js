let DB, TBE, ERAS, SLOTS, ALL_T, HIST;

async function loadData() {
  const res = await fetch('/data/players.json');
  const data = await res.json();
  DB = data.db;
  TBE = data.tbe;
  ERAS = data.eras;
  SLOTS = data.slots;
  ALL_T = data.allTeams;
  HIST = data.hist;
}

let gMode = 'classic', roster = { PG: null, SG: null, SF: null, PF: null, C: null };
let takenC = new Set(), roundN = 1, rrT = false, rrE = false;
let cTeam = '', cEra = '', cKey = '', cPlayers = [], fPlayers = [];
let posF = 'ALL', selP = null, mvMode = false, mvFrom = null, spinning = false;

function pickMode(m) {
  gMode = m;
  document.querySelectorAll('.mode-card').forEach(c => c.classList.remove('sel'));
  document.querySelector('[data-mode="' + m + '"]').classList.add('sel');
}

function startGame() {
  roster = { PG: null, SG: null, SF: null, PF: null, C: null };
  takenC = new Set(); roundN = 1; rrT = false; rrE = false;
  cTeam = ''; cEra = ''; cKey = ''; selP = null; mvMode = false; mvFrom = null; spinning = false;
  document.getElementById('mode-tag').textContent = gMode === 'classic' ? 'Classic' : gMode === 'challenge' ? 'Challenge' : 'Dynasty';
  showScreen('game-screen');
  document.getElementById('list-zone').style.display = 'none';
  document.getElementById('reroll-row').style.display = 'none';
  document.getElementById('btn-spin').disabled = false;
  document.getElementById('sc-team').textContent = '--';
  document.getElementById('sc-era').textContent = '--';
  SLOTS.forEach(s => resetNode(s));
  syncTs();
  clearBanner();
}

function doSpin() {
  if (spinning) return;
  spinning = true;
  document.getElementById('btn-spin').disabled = true;
  const r = rRoll();
  cTeam = r.t; cEra = r.e;
  animBoth(750, () => {
    setCards(cTeam, cEra);
    spinning = false;
    document.getElementById('reroll-row').style.display = 'flex';
    syncRR();
    loadPool();
    document.getElementById('list-zone').style.display = 'flex';
    document.getElementById('list-zone').style.flexDirection = 'column';
  });
}

function doReroll(type) {
  if (spinning) return;
  if (type === 'team' && rrT) return;
  if (type === 'era' && rrE) return;
  if (type === 'team') rrT = true; else rrE = true;
  syncRR();
  spinning = true;
  if (type === 'team') {
    const pool = TBE[cEra];
    const nt = pool[Math.floor(Math.random() * pool.length)];
    animOne('sc-team', 600, true, () => { cTeam = nt; setCards(cTeam, cEra); spinning = false; loadPool(); });
  } else {
    const others = ERAS.filter(e => e !== cEra);
    const ne = others[Math.floor(Math.random() * others.length)];
    animOne('sc-era', 600, false, () => { cEra = ne; setCards(cTeam, cEra); spinning = false; loadPool(); });
  }
}

function rRoll() {
  const e = ERAS[Math.floor(Math.random() * ERAS.length)];
  const p = TBE[e];
  return { t: p[Math.floor(Math.random() * p.length)], e };
}

function animBoth(dur, cb) {
  let t = 0;
  const iv = setInterval(() => {
    const te = document.getElementById('sc-team'), ee = document.getElementById('sc-era');
    te.textContent = ALL_T[Math.floor(Math.random() * ALL_T.length)];
    te.classList.add('spinning');
    ee.textContent = ERAS[Math.floor(Math.random() * ERAS.length)];
    ee.classList.add('spinning');
    t += 80;
    if (t >= dur) { clearInterval(iv); te.classList.remove('spinning'); ee.classList.remove('spinning'); cb(); }
  }, 80);
}

function animOne(id, dur, isT, cb) {
  const el = document.getElementById(id);
  let t = 0;
  const iv = setInterval(() => {
    el.textContent = isT ? ALL_T[Math.floor(Math.random() * ALL_T.length)] : ERAS[Math.floor(Math.random() * ERAS.length)];
    el.classList.add('spinning');
    t += 80;
    if (t >= dur) { clearInterval(iv); el.classList.remove('spinning'); cb(); }
  }, 80);
}

function setCards(t, e) {
  document.getElementById('sc-team').textContent = t;
  document.getElementById('sc-era').textContent = e;
}

function syncRR() {
  document.getElementById('rr-team').disabled = rrT;
  document.getElementById('dot-t').classList.toggle('spent', rrT);
  document.getElementById('rr-era').disabled = rrE;
  document.getElementById('dot-e').classList.toggle('spent', rrE);
}

function loadPool(retries = 0) {
  cKey = cTeam + '-' + cEra;
  const all = DB[cKey] || [];
  if (!all.length && retries < 10) {
    const r = rRoll();
    cTeam = r.t; cEra = r.e;
    setCards(cTeam, cEra);
    return loadPool(retries + 1);
  }
  const seen = new Set();
  cPlayers = all.filter(p => {
    if (takenC.has(p.canon) || seen.has(p.canon)) return false;
    seen.add(p.canon);
    return true;
  });
  document.getElementById('list-meta').textContent = cPlayers.length + ' players available';
  posF = 'ALL';
  document.querySelectorAll('.pf-btn').forEach((b, i) => b.classList.toggle('active', i === 0));
  document.getElementById('search-in').value = '';
  selP = null;
  clearBanner();
  applyF();
  SLOTS.forEach(s => updateNode(s));
}

function fPos(p, btn) {
  posF = p;
  document.querySelectorAll('.pf-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  applyF();
}

function applyF() {
  const s = document.getElementById('search-in').value.toLowerCase();
  fPlayers = cPlayers.filter(p => {
    const pm = posF === 'ALL'
      || (posF === 'G' && (p.pos.includes('PG') || p.pos.includes('SG')))
      || (posF === 'F' && (p.pos.includes('SF') || p.pos.includes('PF')))
      || (posF === 'C' && p.pos.includes('C'));
    return pm && p.name.toLowerCase().includes(s);
  });
  if (gMode === 'challenge') {
    fPlayers.sort((a, b) => a.name.split(' ').pop().localeCompare(b.name.split(' ').pop()));
  } else {
    fPlayers.sort((a, b) => b.ppg - a.ppg);
  }
  renderList();
}

function renderList() {
  const sc = document.getElementById('player-scroll');
  const ch = gMode === 'challenge';
  sc.innerHTML = '';
  if (!fPlayers.length) {
    sc.innerHTML = '<div class="empty-list">' + (cPlayers.length === 0 ? 'No data for this combo -- try re-rolling' : 'No players match') + '</div>';
    return;
  }
  fPlayers.forEach(p => {
    const d = document.createElement('div');
    const isSel = selP && selP.canon === p.canon;
    d.className = 'p-card' + (isSel ? ' selected' : '');
    const untracked = p.note && p.note.includes('untracked');
    const stats = ch ? '' : '<div class="p-stats"><div class="p-stat"><div class="p-stat-val">' + p.ppg.toFixed(1) + '</div><div class="p-stat-lbl">PPG</div></div><div class="p-stat"><div class="p-stat-val">' + p.rpg.toFixed(1) + '</div><div class="p-stat-lbl">RPG</div></div><div class="p-stat"><div class="p-stat-val">' + p.apg.toFixed(1) + '</div><div class="p-stat-lbl">APG</div></div></div>';
    const meta = ch ? '' : '<div class="p-meta">Best: ' + p.best + (untracked ? ' - Pre-stat era' : '') + '</div>';
    d.innerHTML = '<div class="p-av">' + p.init + '</div><div class="p-info"><div class="p-name">' + p.name + '</div><div class="p-pos">' + p.pos.join(' - ') + '</div>' + meta + '</div>' + stats;
    d.onclick = () => selPlayer(p);
    sc.appendChild(d);
  });
}

function selPlayer(p) {
  if (mvMode) exitMV();
  selP = p;
  renderList();
  showBanner('Select a position for ' + p.name.split(' ').pop(), false);
  SLOTS.forEach(s => updateNode(s));
}

function updateNode(pos) {
  const node = document.getElementById('node-' + pos);
  const bub = document.getElementById('bub-' + pos);
  const p = roster[pos];
  if (mvMode) {
    if (pos === mvFrom) { node.className = 'pos-node filled move-source'; }
    else if (p) { node.className = 'pos-node filled ineligible'; }
    else {
      const e = roster[mvFrom] && roster[mvFrom].pos.includes(pos);
      node.className = 'pos-node' + (e ? ' move-eligible' : ' ineligible');
    }
    if (pos !== mvFrom) renderEmpty(bub, pos); else renderFilled(bub, roster[pos]);
    return;
  }
  if (p) { node.className = 'pos-node filled'; renderFilled(bub, p); }
  else if (selP) {
    const e = selP.pos.includes(pos);
    node.className = 'pos-node' + (e ? ' eligible' : ' ineligible');
    renderEmpty(bub, pos);
  } else { node.className = 'pos-node'; renderEmpty(bub, pos); }
}

function renderEmpty(bub, pos) {
  bub.removeAttribute('data-name');
  bub.innerHTML = pos;
  bub.style.fontSize = '17px';
  bub.style.fontWeight = '800';
}

function renderFilled(bub, p) {
  bub.setAttribute('data-name', p.name);
  bub.innerHTML = '<div style="font-size:18px;font-weight:800;color:var(--ink);">' + p.init + '</div>';
}

function nodeClick(pos) {
  if (mvMode) {
    if (pos === mvFrom) { exitMV(); return; }
    if (roster[pos]) return;
    if (!roster[mvFrom].pos.includes(pos)) return;
    roster[pos] = roster[mvFrom];
    roster[mvFrom] = null;
    exitMV();
    SLOTS.forEach(s => updateNode(s));
    syncTs();
    return;
  }
  if (selP) {
    if (roster[pos]) return;
    if (!selP.pos.includes(pos)) return;
    roster[pos] = Object.assign({}, selP, { rT: cTeam, rE: cEra });
    takenC.add(selP.canon);
    selP = null;
    clearBanner();
    SLOTS.forEach(s => updateNode(s));
    syncTs();
    renderList();
    const filled = Object.values(roster).filter(Boolean).length;
    if (filled === 5) { setTimeout(() => showResult(), 500); return; }
    roundN++;
    setTimeout(() => {
      document.getElementById('list-zone').style.display = 'none';
      document.getElementById('reroll-row').style.display = 'none';
      document.getElementById('btn-spin').disabled = false;
      setCards('--', '--');
    }, 350);
    return;
  }
  if (roster[pos]) enterMV(pos);
}

function enterMV(pos) {
  mvMode = true; mvFrom = pos; selP = null;
  renderList();
  showBanner('Move ' + roster[pos].name.split(' ').pop() + ' -- tap an open eligible slot', true);
  SLOTS.forEach(s => updateNode(s));
}

function exitMV() {
  mvMode = false; mvFrom = null;
  clearBanner();
  SLOTS.forEach(s => updateNode(s));
}

function showBanner(txt, isMove) {
  const b = document.getElementById('assign-banner');
  b.textContent = txt;
  b.className = 'assign-banner show' + (isMove ? ' move' : '');
}

function clearBanner() {
  document.getElementById('assign-banner').className = 'assign-banner';
}

function syncTs() {
  const ps = Object.values(roster).filter(Boolean);
  const count = ps.length;
  const countEl = document.getElementById('ts-count');
  if (countEl) countEl.textContent = '(' + count + '/5 players)';
  ['ppg', 'apg', 'rpg', 'spg', 'bpg'].forEach(k => {
    const v = ps.length ? ps.reduce((s, p) => s + (p[k] || 0), 0) / ps.length : 0;
    const el = document.getElementById('ts-' + k);
    el.textContent = v.toFixed(1);
    el.className = 'ts-val' + (k === 'ppg' ? (v > 20 ? ' hi' : v < 12 ? ' lo' : '') : k === 'rpg' ? (v > 8 ? ' hi' : v < 4 ? ' lo' : '') : k === 'apg' ? (v > 5 ? ' hi' : v < 2.5 ? ' lo' : '') : '');
  });
}

function resetNode(pos) {
  const n = document.getElementById('node-' + pos);
  const b = document.getElementById('bub-' + pos);
  n.className = 'pos-node';
  b.innerHTML = pos;
  b.style.fontSize = '17px';
  b.style.fontWeight = '800';
}

function showResult() {
  if (gMode === 'dynasty') {
    showScreen('dynasty-screen');
    document.getElementById('d-spin-box').style.display = 'block';
    document.getElementById('d-timeline').style.display = 'none';
    document.getElementById('d-summary').style.display = 'none';
    document.getElementById('btn-dspin').disabled = false;
    document.getElementById('d-reel').textContent = '--';
    document.getElementById('d-title').textContent = 'Spin for your dynasty era';
    document.getElementById('d-sub').textContent = 'Your squad will be placed in a decade and simulate every season.';
    return;
  }
  buildScore();
  showScreen('score-screen');
}

function buildScore() {
  const ps = Object.values(roster).filter(Boolean);
  const avg = ps.reduce((s, p) => s + p.score, 0) / 5;
  const ppgAvg = ps.reduce((s, p) => s + p.ppg, 0) / 5;
  const rpgAvg = ps.reduce((s, p) => s + p.rpg, 0) / 5;
  const apgAvg = ps.reduce((s, p) => s + p.apg, 0) / 5;
  const spgAvg = ps.reduce((s, p) => s + p.spg, 0) / 5;
  const bpgAvg = ps.reduce((s, p) => s + p.bpg, 0) / 5;
  const tPpg = ps.reduce((s, p) => s + p.ppg, 0);
  const tRpg = ps.reduce((s, p) => s + p.rpg, 0);
  const tApg = ps.reduce((s, p) => s + p.apg, 0);
  const tSpg = ps.reduce((s, p) => s + p.spg, 0);
  const tBpg = ps.reduce((s, p) => s + p.bpg, 0);
  const wins = Math.round(20 + (avg / 100) * 62);
  const losses = 82 - wins;
  const record = wins + '-' + losses;
  let g, cls;
  if (avg >= 93) { g = 'A+'; cls = 'ga'; }
  else if (avg >= 88) { g = 'A'; cls = 'ga'; }
  else if (avg >= 83) { g = 'A-'; cls = 'ga'; }
  else if (avg >= 78) { g = 'B+'; cls = 'gb'; }
  else if (avg >= 73) { g = 'B'; cls = 'gb'; }
  else if (avg >= 68) { g = 'B-'; cls = 'gb'; }
  else if (avg >= 62) { g = 'C+'; cls = 'gc'; }
  else if (avg >= 55) { g = 'C'; cls = 'gc'; }
  else { g = 'F'; cls = 'gf'; }
  const gl = document.getElementById('score-grade');
  gl.textContent = g;
  gl.className = 'score-grade ' + cls;
  document.getElementById('score-wins').innerHTML = wins + ' Projected Wins <span style="color:var(--ink3);font-weight:500;font-size:16px;">(' + record + ')</span>';
  document.getElementById('score-roster').innerHTML = SLOTS.map(pos => {
    const p = roster[pos];
    if (!p) return '';
    return '<div class="sr-chip"><div class="sr-pos">' + pos + '</div><div class="sr-name">' + p.name.split(' ').pop() + '</div><div class="sr-era">' + p.rT + ' ' + p.rE + '</div></div>';
  }).join('');
  document.getElementById('score-stats').innerHTML = '<div style="grid-column:1/-1;font-size:10px;font-weight:700;color:var(--ink3);letter-spacing:.06em;text-transform:uppercase;margin-bottom:4px;">Starting 5 Totals</div>'
    + [['PPG', tPpg], ['RPG', tRpg], ['APG', tApg], ['SPG', tSpg], ['BPG', tBpg]].map(kv =>
      '<div class="ss-box"><div class="ss-val">' + kv[1].toFixed(1) + '</div><div class="ss-lbl">' + kv[0] + '</div></div>'
    ).join('');
  const sc = ppgAvg > 22 ? 'elite scoring' : ppgAvg > 16 ? 'solid scoring' : 'limited scoring';
  const rb = rpgAvg > 8 ? 'dominant rebounding' : rpgAvg > 5 ? 'solid rebounding' : 'light rebounding';
  const pl = apgAvg > 5 ? 'elite playmaking' : apgAvg > 3 ? 'decent playmaking' : 'minimal playmaking';
  const df = (spgAvg + bpgAvg) > 3 ? 'strong defensive presence' : 'modest defensive output';
  document.getElementById('score-analysis').innerHTML = 'This roster delivers <strong>' + sc + '</strong>, <strong>' + rb + '</strong>, and <strong>' + pl + '</strong> with <strong>' + df + '</strong>. The starting five combine for ' + tPpg.toFixed(1) + ' PPG and ' + tRpg.toFixed(1) + ' RPG, ' + (avg > 88 ? 'making this a legitimate championship-caliber squad in any era.' : avg > 73 ? 'a solid playoff team -- one star away from true contention.' : 'but would need more firepower to compete at the highest level.');
}

let dEra = '';

function dynastySpin() {
  document.getElementById('btn-dspin').disabled = true;
  const era = ERAS[Math.floor(Math.random() * ERAS.length)];
  dEra = era;
  const reel = document.getElementById('d-reel');
  let t = 0;
  const iv = setInterval(() => {
    reel.textContent = ERAS[Math.floor(Math.random() * ERAS.length)];
    t += 80;
    if (t >= 1000) { clearInterval(iv); reel.textContent = era; setTimeout(() => simDynasty(era), 400); }
  }, 80);
}

function simDynasty(era) {
  document.getElementById('d-spin-box').style.display = 'none';
  document.getElementById('d-title').textContent = 'Dynasty: ' + era;
  document.getElementById('d-sub').textContent = 'Simulating 10 seasons on the hardwood...';
  const tl = document.getElementById('d-timeline');
  const ps = Object.values(roster).filter(Boolean);
  tl.innerHTML = '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px;">'
    + SLOTS.map(pos => {
      const p = roster[pos];
      if (!p) return '';
      return '<div style="background:#fff;border:1.5px solid var(--border);border-radius:10px;padding:8px 12px;text-align:center;min-width:88px;"><div style="font-size:9px;font-weight:700;color:var(--orange);letter-spacing:.06em;text-transform:uppercase;margin-bottom:4px;">' + pos + '</div><div style="font-size:12px;font-weight:700;color:var(--ink);">' + p.name.split(' ').pop() + '</div><div style="font-size:10px;color:var(--ink3);margin-top:2px;">' + p.rT + ' ' + p.rE + '</div></div>';
    }).join('') + '</div>';
  tl.style.display = 'flex';
  tl.style.flexDirection = 'column';
  const ts = ps.reduce((s, p) => s + p.score, 0) / 5;
  const startY = parseInt(era);
  const opps = HIST[era] || [];
  let champs = 0, totalW = 0;
  const results = [];
  for (let i = 0; i < 10; i++) {
    const yr = startY + i;
    const noise = (Math.random() - .5) * 14;
    const wins = Math.max(14, Math.min(82, Math.round(18 + (ts / 100) * 60 + noise)));
    totalW += wins;
    let res = 'Missed Playoffs', cls = 'early';
    if (wins >= 48) {
      const o1 = opps[Math.floor(Math.random() * opps.length)];
      if (sg(ts, o1.r)) {
        const o2 = opps[Math.floor(Math.random() * opps.length)];
        if (sg(ts, o2.r)) {
          const o3 = opps[Math.floor(Math.random() * opps.length)];
          if (sg(ts, o3.r)) {
            const o4 = opps[Math.floor(Math.random() * opps.length)];
            if (sg(ts, o4.r)) { res = 'Trophy Champion'; cls = 'champ'; champs++; }
            else { res = 'Finals Loss'; cls = 'conf'; }
          } else { res = 'Conference Finals'; cls = 'conf'; }
        } else { res = 'Second Round Exit'; cls = 'early'; }
      } else { res = 'First Round Exit'; cls = 'early'; }
    } else if (wins >= 38) { res = 'First Round Exit'; cls = 'early'; }
    results.push({ yr, wins, res, cls });
  }
  results.forEach((r, i) => {
    setTimeout(() => {
      const row = document.createElement('div');
      row.className = 's-row';
      const losses = 82 - r.wins;
      row.innerHTML = '<div class="s-yr">' + r.yr + '-' + (r.yr + 1).toString().slice(2) + '</div><div class="s-w">' + r.wins + '-' + losses + '</div><div class="s-r ' + r.cls + '">' + r.res + '</div>';
      tl.appendChild(row);
      if (i === 9) setTimeout(() => showDGrade(champs, totalW / 10), 600);
    }, i * 260);
  });
}

function sg(my, opp) {
  return Math.random() < 1 / (1 + Math.pow(10, (opp - my) / 15));
}

function showDGrade(champs, avgW) {
  const sum = document.getElementById('d-summary');
  sum.style.display = 'block';
  let g, cls;
  if (champs >= 7) { g = 'A+'; cls = 'ga'; }
  else if (champs >= 5) { g = 'A'; cls = 'ga'; }
  else if (champs >= 4) { g = 'A-'; cls = 'ga'; }
  else if (champs >= 3) { g = 'B+'; cls = 'gb'; }
  else if (champs >= 2) { g = 'B'; cls = 'gb'; }
  else if (champs === 1) { g = 'B-'; cls = 'gb'; }
  else if (avgW >= 50) { g = 'C+'; cls = 'gc'; }
  else if (avgW >= 42) { g = 'C'; cls = 'gc'; }
  else { g = 'F'; cls = 'gf'; }
  const dg = document.getElementById('ds-grade');
  dg.textContent = g;
  dg.className = 'ds-grade ' + cls;
  document.getElementById('ds-sub2').textContent = champs + ' Championship' + (champs !== 1 ? 's' : '') + ' in 10 Seasons';
  document.getElementById('ds-txt').textContent = 'Averaging ' + avgW.toFixed(1) + ' wins/season across the ' + dEra + '. ' + (champs >= 5 ? 'An all-time dynasty - this team owned their era.' : champs >= 3 ? 'A legitimate dynasty with multiple deep runs.' : champs >= 1 ? 'Champions, but inconsistency prevented true greatness.' : avgW >= 50 ? 'A perennial contender that could never close the deal.' : 'This squad struggled to find their footing in a tough decade.');
}

function goHome() { showScreen('home-screen'); }

let htpStep = 1;
function openHTP() {
  htpStep = 1;
  document.getElementById('htp-modal').style.display = 'flex';
  htpRender();
}
function closeHTP() { document.getElementById('htp-modal').style.display = 'none'; }
function htpNext() { if (htpStep < 4) { htpStep++; htpRender(); } else closeHTP(); }
function htpPrev() { if (htpStep > 1) { htpStep--; htpRender(); } }
function htpRender() {
  for (let i = 1; i <= 4; i++) document.getElementById('htp-s' + i).classList.toggle('active', i === htpStep);
  document.querySelectorAll('.htp-dot').forEach((d, i) => d.classList.toggle('active', i + 1 === htpStep));
  document.getElementById('htp-prev').style.visibility = htpStep === 1 ? 'hidden' : 'visible';
  document.getElementById('htp-next').textContent = htpStep === 4 ? 'Got it!' : 'Next →';
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

document.addEventListener('DOMContentLoaded', () => {
  loadData().catch(err => {
    console.error('Failed to load player data:', err);
    document.body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;color:#888;font-size:14px;">Serve this app over HTTP to load player data.<br>Run: <code>python3 -m http.server 8080</code></div>';
  });
  document.addEventListener('click', (e) => {
    if (!selP) return;
    if (e.target.closest('#list-zone')) return;
    selP = null;
    clearBanner();
    renderList();
    SLOTS.forEach(s => updateNode(s));
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeHTP(); });
});
