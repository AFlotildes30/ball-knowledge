let DB, TBE, ERAS, SLOTS, ALL_T, HIST, PLAYER_IDS = {};

async function loadData() {
  const [dataRes, idsRes] = await Promise.all([
    fetch('/data/players.json'),
    fetch('/data/player_ids.json')
  ]);
  const data = await dataRes.json();
  PLAYER_IDS = await idsRes.json();
  DB = data.db; TBE = data.tbe; ERAS = data.eras;
  SLOTS = data.slots; ALL_T = data.allTeams; HIST = data.hist;
}

function headshotUrl(canon) {
  const id = PLAYER_IDS[canon];
  return id ? 'https://cdn.nba.com/headshots/nba/latest/1040x760/' + id + '.png' : null;
}

let gMode = 'classic', roster = { PG: null, SG: null, SF: null, PF: null, C: null };
let takenC = new Set(), roundN = 1, rrT = false, rrE = false;
let cTeam = '', cEra = '', cKey = '', cPlayers = [], fPlayers = [];
let posF = 'ALL', selP = null, mvMode = false, mvFrom = null, spinning = false;

// Head-to-head state
let h2hChallenge = null;    // decoded payload from ?challenge= URL
let h2hLockedEVs = new Set(); // era_variants taken by P1
let h2hP2Roster = null;     // P2's completed roster (before series)
let h2hSeriesResult = null; // result from simH2HSeries

// Share state — populated by buildScore() and showDGrade()
let shareState = { grade: '', wins: 0, playerNames: [], challengeUrl: '', champs: 0, avgW: 0, dEraLabel: '' };
// H2H results share state — populated by openShareResultsModal()
let h2hShareData = { url: '', msg: '' };

function pickMode(m) {
  gMode = m;
  document.querySelectorAll('.mode-card').forEach(c => c.classList.remove('sel'));
  document.querySelector('[data-mode="' + m + '"]').classList.add('sel');
}

function startGame() {
  // Clear H2H challenge state on fresh game start
  h2hChallenge = null; h2hLockedEVs = new Set(); h2hP2Roster = null; h2hSeriesResult = null;
  roster = { PG: null, SG: null, SF: null, PF: null, C: null };
  takenC = new Set(); roundN = 1; rrT = false; rrE = false;
  cTeam = ''; cEra = ''; cKey = ''; selP = null; mvMode = false; mvFrom = null; spinning = false;
  const modeLabels = { classic: 'Classic', challenge: 'Challenge', dynasty: 'Dynasty' };
  document.getElementById('mode-tag').textContent = modeLabels[gMode] || 'Classic';
  showScreen('game-screen');
  document.getElementById('list-zone').style.display = 'none';
  document.getElementById('reroll-row').style.display = 'none';
  document.getElementById('btn-spin').disabled = false;
  document.getElementById('sc-team').textContent = '--';
  document.getElementById('sc-era').textContent = '--';
  setSpinZoneCompact(false);
  SLOTS.forEach(s => resetNode(s));
  syncTs();
  clearBanner();
  const dp = document.getElementById('d-players');
  if (dp) dp.style.display = 'none';
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
    setSpinZoneCompact(true);
  });
}

function doReroll(type) {
  if (spinning) return;
  if (type === 'team' && rrT) return;
  if (type === 'era' && rrE) return;
  if (type === 'team') rrT = true; else rrE = true;
  syncRR();
  spinning = true;
  setSpinZoneCompact(false);
  if (type === 'team') {
    const pool = TBE[cEra].filter(t => t !== cTeam);
    const nt = pool[Math.floor(Math.random() * pool.length)];
    const frozenEra = cEra;
    animTeam(nt, () => {
      cTeam = nt;
      console.log('[re-roll] team →', cTeam, '| era frozen at', frozenEra);
      spinning = false;
      loadPool(0, 'era');
      setSpinZoneCompact(true);
    });
  } else {
    const origEra = cEra;
    const frozenTeam = cTeam;
    // Only pick eras that have data for the locked team — prevents loadPool's
    // empty-combo fallback from cycling back to origEra.
    const withData = ERAS.filter(e => e !== origEra && (DB[frozenTeam + '-' + e] || []).length > 0);
    const pool = withData.length ? withData : ERAS.filter(e => e !== origEra);
    const ne = pool[Math.floor(Math.random() * pool.length)];
    animEra(ne, () => {
      cEra = ne;
      console.log('[re-roll] era →', cEra, '| team frozen at', frozenTeam);
      spinning = false;
      loadPool(0, 'team');
      setSpinZoneCompact(true);
    });
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

function animTeam(finalVal, cb) {
  const el = document.getElementById('sc-team');
  let t = 0;
  const iv = setInterval(() => {
    el.textContent = ALL_T[Math.floor(Math.random() * ALL_T.length)];
    el.classList.add('spinning');
    t += 80;
    if (t >= 600) {
      clearInterval(iv);
      el.classList.remove('spinning');
      el.textContent = finalVal;
      cb();
    }
  }, 80);
}

function animEra(finalVal, cb) {
  const el = document.getElementById('sc-era');
  let t = 0;
  const iv = setInterval(() => {
    el.textContent = ERAS[Math.floor(Math.random() * ERAS.length)];
    el.classList.add('spinning');
    t += 80;
    if (t >= 600) {
      clearInterval(iv);
      el.classList.remove('spinning');
      el.textContent = finalVal;
      cb();
    }
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

function loadPool(retries = 0, lock = '') {
  cKey = cTeam + '-' + cEra;
  const all = DB[cKey] || [];
  if (!all.length && retries < 10) {
    if (lock === 'team') {
      // Era re-roll: keep cTeam fixed, only cycle the era
      const others = ERAS.filter(e => e !== cEra);
      cEra = others[Math.floor(Math.random() * others.length)];
      document.getElementById('sc-era').textContent = cEra;
    } else if (lock === 'era') {
      // Team re-roll: keep cEra fixed, only cycle the team
      const pool = TBE[cEra];
      cTeam = pool[Math.floor(Math.random() * pool.length)];
      document.getElementById('sc-team').textContent = cTeam;
    } else {
      const r = rRoll();
      cTeam = r.t; cEra = r.e;
      document.getElementById('sc-team').textContent = cTeam;
      document.getElementById('sc-era').textContent = cEra;
    }
    return loadPool(retries + 1, lock);
  }
  const seen = new Set();
  cPlayers = all.filter(p => {
    const ev = p.era_variant || (p.canon + '-' + p.rE);
    if (takenC.has(ev) || seen.has(ev)) return false;
    seen.add(ev);
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
    // H2H: check if this player's era_variant is locked by P1
    const pEV = p.era_variant || (p.canon + '-' + (p.rE || cEra));
    const isLocked = h2hChallenge && h2hLockedEVs.has(pEV);
    if (isLocked) {
      d.className = 'p-card p-card-locked';
      const url = headshotUrl(p.canon);
      const avHtml = url
        ? '<div class="p-av has-hs">' + p.init + '<img class="p-hs" src="' + url + '" alt="" onerror="this.parentNode.classList.remove(\'has-hs\');this.remove()"></div>'
        : '<div class="p-av">' + p.init + '</div>';
      d.innerHTML = avHtml + '<div class="p-info"><div class="p-name">' + p.name + '</div><div class="p-pos">' + p.pos.join(' - ') + '</div></div><div class="p-taken">Taken</div>';
      sc.appendChild(d);
      return;
    }
    d.className = 'p-card' + (isSel ? ' selected' : '');
    const untracked = p.note && p.note.includes('untracked');
    const stats = ch ? '' : '<div class="p-stats"><div class="p-stat"><div class="p-stat-val">' + p.ppg.toFixed(1) + '</div><div class="p-stat-lbl">PPG</div></div><div class="p-stat"><div class="p-stat-val">' + p.apg.toFixed(1) + '</div><div class="p-stat-lbl">APG</div></div><div class="p-stat"><div class="p-stat-val">' + p.rpg.toFixed(1) + '</div><div class="p-stat-lbl">RPG</div></div><div class="p-stat"><div class="p-stat-val">' + (p.spg||0).toFixed(1) + '</div><div class="p-stat-lbl">SPG</div></div><div class="p-stat"><div class="p-stat-val">' + (p.bpg||0).toFixed(1) + '</div><div class="p-stat-lbl">BPG</div></div></div>';
    const meta = ch ? '' : '<div class="p-meta">Best: ' + p.best + (untracked ? ' - Pre-stat era' : '') + '</div>';
    const url = headshotUrl(p.canon);
    const avHtml = url
      ? '<div class="p-av has-hs">' + p.init + '<img class="p-hs" src="' + url + '" alt="" onerror="this.parentNode.classList.remove(\'has-hs\');this.remove()"></div>'
      : '<div class="p-av">' + p.init + '</div>';
    d.innerHTML = avHtml + '<div class="p-info"><div class="p-name">' + p.name + '</div><div class="p-pos">' + p.pos.join(' - ') + '</div>' + meta + '</div>' + stats;
    d.onclick = (ev) => { ev.stopPropagation(); selPlayer(p); };
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
  const url = headshotUrl(p.canon);
  if (url) {
    bub.innerHTML = '<span class="bub-fb">' + p.init + '</span><div class="bub-hs-wrap"><img class="bub-hs" src="' + url + '" alt="" onerror="this.parentNode.remove()"></div>';
  } else {
    bub.innerHTML = '<div style="font-size:18px;font-weight:800;color:var(--ink);">' + p.init + '</div>';
  }
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
    takenC.add(selP.era_variant || (selP.canon + '-' + cEra));
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
      setSpinZoneCompact(false);
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

function setSpinZoneCompact(compact) {
  const sz = document.getElementById('spin-zone');
  if (!sz) return;
  if (compact) {
    const pill = document.getElementById('compact-pill');
    if (pill) pill.textContent = cTeam + ' · ' + cEra;
    sz.classList.add('has-result');
  } else {
    sz.classList.remove('has-result');
  }
}

function syncMobilePosBar() {
  SLOTS.forEach(pos => {
    const bubble = document.getElementById('mpb-' + pos);
    if (!bubble) return;
    const slot = bubble.parentElement;
    const p = roster[pos];
    if (p) {
      bubble.textContent = p.init;
      slot.classList.add('filled');
    } else {
      bubble.textContent = pos;
      slot.classList.remove('filled');
    }
  });
}

function syncTs() {
  const ps = Object.values(roster).filter(Boolean);
  const count = ps.length;
  const countEl = document.getElementById('ts-count');
  if (countEl) countEl.textContent = '(' + count + '/5 players)';
  syncMobilePosBar();
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
  // H2H challenge response: go to pre-series screen instead of scorecard
  if (h2hChallenge) {
    h2hP2Roster = Object.assign({}, roster);
    showPreseries();
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
    const url = headshotUrl(p.canon);
    const hsHtml = url
      ? '<div class="sr-hs-wrap"><span class="sr-hs-fb">' + p.init + '</span><img class="sr-hs" src="' + url + '" alt="" onerror="this.remove()"></div>'
      : '<div class="sr-hs-wrap"><span class="sr-hs-fb">' + p.init + '</span></div>';
    return '<div class="sr-chip">' + hsHtml + '<div class="sr-pos">' + pos + '</div><div class="sr-name">' + p.name.split(' ').pop() + '</div><div class="sr-era">' + p.rT + ' ' + p.rE + '</div></div>';
  }).join('');
  document.getElementById('score-stats').innerHTML = '<div style="grid-column:1/-1;font-size:10px;font-weight:700;color:var(--ink3);letter-spacing:.06em;text-transform:uppercase;margin-bottom:4px;">Starting 5 Totals</div>'
    + [['PPG', tPpg], ['RPG', tRpg], ['APG', tApg], ['SPG', tSpg], ['BPG', tBpg]].map(kv =>
      '<div class="ss-box"><div class="ss-val">' + kv[1].toFixed(1) + '</div><div class="ss-lbl">' + kv[0] + '</div></div>'
    ).join('');
  document.getElementById('score-analysis').innerHTML = buildAnalysis(ps, tPpg, tRpg, tApg, tSpg, tBpg, avg);
  buildProjections();
  // Populate share state for score-screen share buttons
  shareState.grade = g;
  shareState.wins = wins;
  shareState.playerNames = SLOTS.map(pos => roster[pos] ? roster[pos].name : '').filter(Boolean);
  shareState.challengeUrl = buildChallengeUrl();
  // Show challenge button for classic / challenge / h2h modes
  const chalBtn = document.getElementById('btn-challenge-friend');
  if (chalBtn) chalBtn.style.display = gMode !== 'dynasty' ? 'flex' : 'none';
}

let dEra = '';

function dynastySpin() {
  document.getElementById('btn-dspin').disabled = true;
  const ERA_W = {'1960s':8,'1970s':10,'1980s':16,'1990s':22,'2000s':22,'2010s':16,'2020s':6};
  const era = ERAS[weightedIdx(ERAS.map(e => ERA_W[e] || 1))];
  dEra = era;
  const reel = document.getElementById('d-reel');
  let t = 0;
  const iv = setInterval(() => {
    reel.textContent = ERAS[Math.floor(Math.random() * ERAS.length)];
    t += 80;
    if (t >= 1000) { clearInterval(iv); reel.textContent = era; setTimeout(() => simDynasty(era), 400); }
  }, 80);
}

function weightedIdx(weights) {
  let r = Math.random() * weights.reduce((a,b)=>a+b,0);
  for (let i=0;i<weights.length;i++){r-=weights[i];if(r<=0)return i;}
  return weights.length-1;
}

function seriesScore(weWin) {
  const lw = [0,1,2,3][weightedIdx([3,10,16,20])];
  return (weWin ? 'Won' : 'Lost') + ' 4–' + lw;
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
    let res = 'Missed Playoffs', cls = 'early', series = '';
    if (wins >= 48) {
      const o1 = opps[Math.floor(Math.random() * opps.length)];
      const w1 = sg(ts, o1.r); const sc1 = seriesScore(w1);
      if (w1) {
        const o2 = opps[Math.floor(Math.random() * opps.length)];
        const w2 = sg(ts, o2.r); const sc2 = seriesScore(w2);
        if (w2) {
          const o3 = opps[Math.floor(Math.random() * opps.length)];
          const w3 = sg(ts, o3.r); const sc3 = seriesScore(w3);
          if (w3) {
            const o4 = opps[Math.floor(Math.random() * opps.length)];
            const w4 = sg(ts, o4.r); const sc4 = seriesScore(w4);
            if (w4) { res = '🏆 Champions'; cls = 'champ'; champs++; }
            else { res = 'Finals Loss'; cls = 'conf'; }
            series = '1st Round: ' + sc1 + ' · Semis: ' + sc2 + ' · Conf Finals: ' + sc3 + ' · Finals: ' + sc4;
          } else {
            res = 'Conference Finals'; cls = 'conf';
            series = '1st Round: ' + sc1 + ' · Semis: ' + sc2 + ' · Conf Finals: ' + sc3;
          }
        } else {
          res = 'Second Round Exit'; cls = 'early';
          series = '1st Round: ' + sc1 + ' · Semis: ' + sc2;
        }
      } else {
        res = 'First Round Exit'; cls = 'early';
        series = '1st Round: ' + sc1;
      }
    } else if (wins >= 38) {
      res = 'First Round Exit'; cls = 'early';
      series = '1st Round: ' + seriesScore(false);
    }
    results.push({ yr, wins, res, cls, series });
  }
  results.forEach((r, i) => {
    setTimeout(() => {
      const row = document.createElement('div');
      row.className = 's-row';
      const losses = 82 - r.wins;
      const rHtml = r.series
        ? '<div class="s-r ' + r.cls + '"><div class="s-r-main">' + r.res + '</div><div class="s-series">' + r.series + '</div></div>'
        : '<div class="s-r ' + r.cls + '">' + r.res + '</div>';
      row.innerHTML = '<div class="s-yr">' + r.yr + '-' + (r.yr + 1).toString().slice(2) + '</div><div class="s-w">' + r.wins + '-' + losses + '</div>' + rHtml;
      tl.appendChild(row);
      if (i === 9) setTimeout(() => showDGrade(champs, totalW / 10), 600);
    }, i * 260);
  });
}

function sg(my, opp) {
  return Math.random() < 1 / (1 + Math.pow(10, (opp - my) / 15));
}

function showDGrade(champs, avgW) {
  buildDynastyPlayers(dEra);
  // Populate share state for dynasty share buttons
  shareState.champs = champs;
  shareState.avgW = avgW;
  shareState.dEraLabel = dEra;
  shareState.playerNames = SLOTS.map(pos => roster[pos] ? roster[pos].name : '').filter(Boolean);
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

function buildAnalysis(ps, tPpg, tRpg, tApg, tSpg, tBpg, avg) {
  const tDef = tSpg + tBpg;
  const cScore = roster['C'] ? roster['C'].score : 0;
  const pfScore = roster['PF'] ? roster['PF'].score : 0;
  const topScorer = ps.reduce((a, b) => a.ppg > b.ppg ? a : b);
  const topFloor = ps.reduce((a, b) => a.apg > b.apg ? a : b);
  const topDef = ps.reduce((a, b) => (a.spg + a.bpg) > (b.spg + b.bpg) ? a : b);
  const topBig = cScore >= pfScore ? roster['C'] : roster['PF'];
  const tail = avg >= 88
    ? 'championship-caliber across any era.'
    : avg >= 73
    ? 'a legitimate playoff team — one cornerstone away from real contention.'
    : 'a squad that can hang with anyone on a good night, but needs more firepower to go deep.';

  if (tPpg > 110) {
    return 'Buckle up — this is a team built to light up the scoreboard. <strong>' + topScorer.name.split(' ').pop() + '</strong> leads the charge at ' + topScorer.ppg.toFixed(1) + ' PPG, and the starting five pour in a combined <strong>' + tPpg.toFixed(1) + ' PPG</strong> that would rank among the highest-output lineups of any era. Opponents can\'t sag off a single player in this rotation — everyone is a threat. ' + (avg >= 88 ? 'The firepower is undeniable. This roster wins shootouts and grinds opponents into submission on the scoreboard.' : avg >= 73 ? 'The offense is elite, but establishing a defensive identity would push this from a great team to an untouchable one.' : 'They can score with anyone. Defensive consistency will determine how far they actually go.');
  }
  if (tDef > 15) {
    return 'Defense doesn\'t show up in highlight reels until someone\'s shot gets rejected into the third row. This roster, anchored by <strong>' + topDef.name.split(' ').pop() + '</strong>, combines for <strong>' + tDef.toFixed(1) + ' steals and blocks per game</strong> — the kind of collective pressure that forces opponents to completely alter their schemes. Scoring in the half court against this group is a grind. ' + (avg >= 88 ? 'Add the offensive firepower to match and you have the formula every championship team is built on.' : avg >= 73 ? 'If the offense stays consistent, this defense alone makes them dangerous in a seven-game series.' : 'The defensive ceiling is real. Give them a legitimate bucket-getter and the pieces are already in place.');
  }
  if (tApg > 25) {
    return 'Ball movement is the identity here. <strong>' + topFloor.name.split(' ').pop() + '</strong> orchestrates the offense and the group generates a combined <strong>' + tApg.toFixed(1) + ' assists per game</strong> — the ball never sticks, everyone gets their shot in rhythm. Teams that share the rock at this rate are historically difficult to gameplan against because there\'s no single player to key on. ' + (avg >= 88 ? 'With this level of unselfishness and the talent to execute, opponents are in for a long series.' : avg >= 73 ? 'The system creates open looks for everyone. Get them a few more elite finishers and this becomes truly dangerous.' : 'The playmaking keeps them in every game. The ceiling rises dramatically if the finishing catches up to the passing.');
  }
  if (cScore > 85 && pfScore > 85) {
    return 'The paint belongs to this squad. <strong>' + topBig.name.split(' ').pop() + '</strong> and the frontcourt make life miserable inside — <strong>' + tRpg.toFixed(1) + ' boards per game</strong>, rim protection that shrinks the lane, and the kind of interior depth that doesn\'t fatigue in the fourth quarter. Teams without size get eaten alive at both ends. ' + (avg >= 88 ? 'Championship-caliber bigs on both ends of the floor — this team was made to win a seven-game series.' : avg >= 73 ? 'The frontcourt is elite. Get them a perimeter shooter who demands attention and this is a Finals-caliber lineup.' : 'They dominate the paint but the pace of the modern game may expose them on the perimeter. The talent is there, the fit is everything.');
  }
  return 'No glaring weaknesses. No obvious one-note identity. This is a roster built on balance — <strong>' + tPpg.toFixed(1) + ' PPG</strong>, <strong>' + tRpg.toFixed(1) + ' RPG</strong>, and <strong>' + tApg.toFixed(1) + ' APG</strong> spread evenly across all five positions. <strong>' + topScorer.name.split(' ').pop() + '</strong> leads the scoring but the others carry their weight rather than just filling out a stat line. Balanced teams are underrated — they adjust, they don\'t rely on one action, and they hold up late in series. ' + (avg >= 88 ? 'When a complete team is also this talented, that\'s the formula every dynasty was built on.' : avg >= 73 ? 'Versatile, hard to exploit, and dangerous in a series. One true star away from the next level.' : 'A team you never take lightly — but one that needs a genuine closer to reach their ceiling.');
}

const PRE74_KNOWN = {
  'Wilt Chamberlain':    { spg: 0.8, bpg: 4.5 },
  'Elvin Hayes':         { spg: 0.9, bpg: 2.8 },
  'Bill Russell':        { spg: 1.5, bpg: 7.0 },
  'Oscar Robertson':     { spg: 2.2, bpg: 0.2 },
  'Jerry West':          { spg: 2.5, bpg: 0.3 },
  'Kareem Abdul-Jabbar': { spg: 0.9, bpg: 4.5 },
  'Elgin Baylor':        { spg: 1.4, bpg: 0.8 },
  'Walt Frazier':        { spg: 2.8, bpg: 0.3 },
  'John Havlicek':       { spg: 1.6, bpg: 0.5 },
  'Dave DeBusschere':    { spg: 1.2, bpg: 0.6 },
};
const PRE74_POS = { PG:{spg:1.8,bpg:0.2}, SG:{spg:1.5,bpg:0.2}, SF:{spg:1.4,bpg:0.6}, PF:{spg:1.0,bpg:1.4}, C:{spg:0.8,bpg:2.8} };

function getDefStats(p) {
  const isPreTracking = p.spg === 0 && p.bpg === 0 &&
    (parseInt(p.best) < 1974 || p.rE === '1960s' || p.rE === '1970s');
  if (!isPreTracking) return { spg: p.spg, bpg: p.bpg, est: false };
  const known = PRE74_KNOWN[p.canon] || PRE74_KNOWN[p.name];
  if (known) return { spg: known.spg, bpg: known.bpg, est: true };
  const base = PRE74_POS[(p.pos && p.pos[0]) || 'SF'] || PRE74_POS.SF;
  const mod = 0.8 + (p.score / 99) * 0.4;
  return { spg: base.spg * mod, bpg: base.bpg * mod, est: true };
}

function buildProjections() {
  let hasEst = false;
  const rows = SLOTS.map(pos => {
    const p = roster[pos];
    if (!p) return '';
    const perf = 0.88 + (p.score / 99) * 0.22;
    const pPpg = (p.ppg * perf).toFixed(1);
    const pRpg = (p.rpg * perf).toFixed(1);
    const pApg = (p.apg * perf).toFixed(1);
    const def = getDefStats(p);
    if (def.est) hasEst = true;
    const pSpg = Math.max(0.1, def.spg * perf).toFixed(1);
    const pBpg = Math.max(0.1, def.bpg * perf).toFixed(1);
    const spgStr = def.est ? '<span class="est-pfx">~</span>' + pSpg : pSpg;
    const bpgStr = def.est ? '<span class="est-pfx">~</span>' + pBpg : pBpg;
    const url = headshotUrl(p.canon);
    const avHtml = url
      ? '<div class="proj-av has-hs">' + p.init + '<img class="p-hs" src="' + url + '" alt="" onerror="this.parentNode.classList.remove(\'has-hs\');this.remove()"></div>'
      : '<div class="proj-av">' + p.init + '</div>';
    const s = (v, l) => '<div class="proj-s"><div class="proj-v">' + v + '</div><div class="proj-l">' + l + '</div></div>';
    return '<div class="proj-row">' + avHtml + '<div class="proj-info"><div class="proj-name">' + p.name + '</div><div class="proj-sub">' + pos + ' &middot; ' + p.rT + ' ' + p.rE + '</div></div><div class="proj-stats">' + s(pPpg,'PPG') + s(pRpg,'RPG') + s(pApg,'APG') + s(spgStr,'SPG') + s(bpgStr,'BPG') + '</div></div>';
  }).join('');
  const fn = hasEst ? '<div class="proj-footnote">Pre-1974 defensive stats marked with ~ are historically-informed projections. SPG and BPG were not officially recorded before the 1973&#8209;74 season.</div>' : '';
  const el = document.getElementById('score-projections');
  if (el) el.innerHTML = '<div class="proj-hd">Projected Season Stats</div>' + rows + fn;
}

function buildDynastyPlayers(era) {
  const ps = Object.values(roster).filter(Boolean);
  if (!ps.length) return;
  const mvp = ps.reduce((a, b) => a.score > b.score ? a : b);
  const startY = parseInt(era);
  let hasEst = false;
  const rows = SLOTS.map(pos => {
    const p = roster[pos];
    if (!p) return '';
    const peakOff = Math.floor(Math.random() * 3);
    const primePerf = 0.88 + (p.score / 99) * 0.22;
    const declineRate = p.score > 85 ? 0.018 : 0.028;
    const def = getDefStats(p);
    if (def.est) hasEst = true;
    let sumPpg = 0, sumRpg = 0, sumApg = 0, sumSpg = 0, sumBpg = 0;
    for (let i = 0; i < 10; i++) {
      const dec = Math.max(0, (i - peakOff) * declineRate);
      const perf = Math.max(0.5, primePerf - dec);
      sumPpg += p.ppg * perf; sumRpg += p.rpg * perf; sumApg += p.apg * perf;
      sumSpg += def.spg * perf; sumBpg += def.bpg * perf;
    }
    const bestY = startY + peakOff;
    const isMvp = p.canon === mvp.canon;
    const url = headshotUrl(p.canon);
    const avHtml = url
      ? '<div class="dp-av has-hs">' + p.init + '<img class="p-hs" src="' + url + '" alt="" onerror="this.parentNode.classList.remove(\'has-hs\');this.remove()"></div>'
      : '<div class="dp-av">' + p.init + '</div>';
    const spgAvg = Math.max(0.1, sumSpg/10).toFixed(1);
    const bpgAvg = Math.max(0.1, sumBpg/10).toFixed(1);
    const spgStr = def.est ? '<span class="est-pfx">~</span>' + spgAvg : (sumSpg/10).toFixed(1);
    const bpgStr = def.est ? '<span class="est-pfx">~</span>' + bpgAvg : (sumBpg/10).toFixed(1);
    return '<div class="dp-row">' + avHtml + '<div class="dp-info"><div class="dp-name">' + p.name.split(' ').pop() + (isMvp ? ' <span class="dp-mvp-badge">MVP</span>' : '') + '</div><div class="dp-sub">' + pos + ' &middot; ' + p.rT + ' ' + p.rE + '</div></div><div class="dp-peak">Peak<br>' + bestY + '&ndash;' + (bestY + 1).toString().slice(2) + '</div><div class="dp-stats"><div class="dp-s"><div class="dp-v">' + (sumPpg/10).toFixed(1) + '</div><div class="dp-l">PPG</div></div><div class="dp-s"><div class="dp-v">' + (sumRpg/10).toFixed(1) + '</div><div class="dp-l">RPG</div></div><div class="dp-s"><div class="dp-v">' + (sumApg/10).toFixed(1) + '</div><div class="dp-l">APG</div></div><div class="dp-s"><div class="dp-v">' + spgStr + '</div><div class="dp-l">SPG</div></div><div class="dp-s"><div class="dp-v">' + bpgStr + '</div><div class="dp-l">BPG</div></div></div></div>';
  }).join('');
  const fn = hasEst ? '<div class="dp-footnote">Pre-1974 defensive stats marked with ~ are historically-informed projections. SPG and BPG were not officially recorded before the 1973&#8209;74 season.</div>' : '';
  const el = document.getElementById('d-players');
  if (el) { el.innerHTML = '<div class="dp-hd">Player Decade Averages</div>' + rows + fn; el.style.display = 'block'; }
}

function logoClick() {
  const hasGame = Object.values(roster).some(Boolean) || !!selP || !!cTeam;
  if (hasGame) {
    document.getElementById('confirm-modal').style.display = 'flex';
  } else {
    goHome();
  }
}

function goHome() {
  h2hChallenge = null; h2hLockedEVs = new Set(); h2hP2Roster = null; h2hSeriesResult = null;
  showScreen('home-screen');
}

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
  const atHome = id === 'home-screen';
  document.documentElement.classList.toggle('at-home', atHome);
  if (atHome) window.scrollTo(0, 0);
}

document.addEventListener('DOMContentLoaded', () => {
  loadData().then(() => {
    // Handle challenge/results URL params after data loads
    const params = new URLSearchParams(window.location.search);
    const challengeB64 = params.get('challenge');
    const resultsB64 = params.get('results');
    if (challengeB64) {
      handleChallengeUrl(challengeB64);
    } else if (resultsB64) {
      handleResultsUrl(resultsB64);
    }
  }).catch(err => {
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
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      closeHTP();
      document.getElementById('confirm-modal').style.display = 'none';
      document.getElementById('challenge-modal').style.display = 'none';
    }
  });
});

// ═══════════════════════════════════════════════════════
//  HEAD TO HEAD — encoding / decoding
// ═══════════════════════════════════════════════════════

function encodePayload(obj) {
  const json = JSON.stringify(obj);
  const bytes = new TextEncoder().encode(json);
  let binary = '';
  bytes.forEach(b => { binary += String.fromCharCode(b); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function decodePayload(b64) {
  try {
    const pad = b64.length % 4;
    const padded = pad ? b64 + '===='.slice(pad) : b64;
    const normal = padded.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(normal);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (e) {
    console.error('Failed to decode payload:', e);
    return null;
  }
}

// Build a compact roster payload from the current roster object
function buildRosterPayload(rosterObj) {
  return SLOTS.map(pos => {
    const p = rosterObj[pos];
    if (!p) return null;
    return {
      pos,
      canon: p.canon,
      name:  p.name,
      init:  p.init || '??',
      rT:    p.rT,
      rE:    p.rE,
      score: p.score,
      ev:    p.era_variant || (p.canon + '-' + p.rE),
    };
  }).filter(Boolean);
}

// Look up full player object from DB given a payload entry
function lookupPlayer(entry) {
  const key = entry.rT + '-' + entry.rE;
  const players = DB[key] || [];
  const found = players.find(p => p.canon === entry.canon);
  if (found) return Object.assign({}, found, { rT: entry.rT, rE: entry.rE });
  // Fallback: minimal object from payload
  return {
    canon: entry.canon, name: entry.name, init: entry.init || entry.canon.split(' ').map(w => w[0]).join('').slice(0,2),
    rT: entry.rT, rE: entry.rE, score: entry.score || 70,
    pos: ['PG'], ppg: 0, rpg: 0, apg: 0, spg: 0, bpg: 0,
    era_variant: entry.ev || (entry.canon + '-' + entry.rE),
  };
}

// ═══════════════════════════════════════════════════════
//  SOCIAL SHARING
// ═══════════════════════════════════════════════════════

function buildChallengeUrl() {
  const payload = { v: 1, p1: buildRosterPayload(roster) };
  return window.location.origin + '/?challenge=' + encodePayload(payload);
}

function abbrevEra(era) {
  return ({ '1960s':'60s','1970s':'70s','1980s':'80s','1990s':'90s','2000s':'00s','2010s':'10s','2020s':'20s' })[era] || era;
}

function buildScoreShareText(forTwitter) {
  const { grade, wins, playerNames, challengeUrl } = shareState;
  const lastNames = playerNames.map(n => n.split(' ').pop()).join(' · ');
  if (forTwitter) {
    const body = '🏀 Ball Knowledge · ' + grade + ' · ' + wins + 'W · ' + lastNames + ' · Can you beat it?';
    // Twitter counts URLs as ~23 chars via t.co shortening
    if (body.length + 24 <= 280) return body + ' ' + challengeUrl;
    return '🏀 Ball Knowledge · ' + grade + ' · ' + wins + ' Projected Wins · ' + challengeUrl;
  }
  return '🏀 Ball Knowledge · ' + grade + ' · ' + wins + ' Projected Wins\n' + lastNames + '\nThink you can beat it?\n' + challengeUrl;
}

function buildDynastyShareText(forTwitter) {
  const { champs, avgW, dEraLabel, playerNames } = shareState;
  const era = abbrevEra(dEraLabel);
  const lastNames = playerNames.map(n => n.split(' ').pop()).join(' · ');
  const url = window.location.origin;
  let header;
  if (champs >= 5)      header = '🏆🏆 DYNASTY · ' + champs + ' Championships in the ' + era;
  else if (champs >= 3) header = '🏆 Dynasty · ' + champs + ' Championships in the ' + era;
  else if (champs >= 1) header = 'Ball Knowledge Dynasty · ' + champs + ' Championship' + (champs > 1 ? 's' : '') + ' in the ' + era;
  else                  header = 'Ball Knowledge Contender · 0 Championships but ' + avgW.toFixed(1) + ' avg wins in the ' + era;
  const suffix = 'See the full dynasty: ' + url;
  if (forTwitter) {
    const full = header + ' · ' + lastNames + '\n' + suffix;
    if (full.length <= 280) return full;
    const mid = header + '\n' + suffix;
    if (mid.length <= 280) return mid;
    return header + '\n' + url;
  }
  return header + '\n' + lastNames + '\n' + suffix;
}

function doScShare() {
  const text = buildScoreShareText(false);
  if (navigator.share) {
    navigator.share({ text }).catch(() => {});
  } else {
    navigator.clipboard.writeText(text).then(() => showShareToast('btn-sc-share'));
  }
}

function doDyShare() {
  const text = buildDynastyShareText(false);
  if (navigator.share) {
    navigator.share({ text }).catch(() => {});
  } else {
    navigator.clipboard.writeText(text).then(() => showShareToast('btn-dy-share'));
  }
}

function showShareToast(btnId) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  const orig = btn.innerHTML;
  btn.textContent = '✓ Copied!';
  setTimeout(() => { btn.innerHTML = orig; }, 2000);
}

function openPlatformShare(platform, screen) {
  const isDynasty = screen === 'dynasty';
  const text = isDynasty ? buildDynastyShareText(platform === 'twitter') : buildScoreShareText(platform === 'twitter');
  const url = isDynasty ? window.location.origin : shareState.challengeUrl;
  const enc = encodeURIComponent(text);
  const encUrl = encodeURIComponent(url);
  let shareUrl;
  if (platform === 'twitter')   shareUrl = 'https://twitter.com/intent/tweet?text=' + enc;
  else if (platform === 'whatsapp') shareUrl = 'https://wa.me/?text=' + enc;
  else if (platform === 'reddit')   shareUrl = 'https://reddit.com/submit?url=' + encUrl + '&title=' + enc;
  else if (platform === 'sms')      shareUrl = 'sms:?&body=' + enc;
  if (platform === 'sms') window.location.href = shareUrl;
  else window.open(shareUrl, '_blank');
}

// ═══════════════════════════════════════════════════════
//  CHALLENGE LINK GENERATION
// ═══════════════════════════════════════════════════════

function openChallengeModal() {
  const payload = { v: 1, p1: buildRosterPayload(roster) };
  const b64 = encodePayload(payload);
  const base = window.location.origin;
  const challengeUrl = base + '/?challenge=' + b64;
  const resultsUrl   = base + '/?results='   + b64;
  document.getElementById('chal-link').value = challengeUrl;
  document.getElementById('res-link').value  = resultsUrl;
  document.getElementById('challenge-modal').style.display = 'flex';
}

function copyChalLink() {
  navigator.clipboard.writeText(document.getElementById('chal-link').value);
  const btn = document.getElementById('btn-copy-chal');
  btn.textContent = 'Copied!';
  setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
}

function copyResLink() {
  navigator.clipboard.writeText(document.getElementById('res-link').value);
  const btn = document.getElementById('btn-copy-res');
  btn.textContent = 'Copied!';
  setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
}

function shareChallenge() {
  const url = document.getElementById('chal-link').value;
  if (navigator.share) {
    navigator.share({ text: 'I built a Ball Knowledge roster — think you can beat it?', url });
  } else {
    navigator.clipboard.writeText(url);
    const btn = document.getElementById('btn-share-chal');
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = 'Share'; }, 2000);
  }
}

// ═══════════════════════════════════════════════════════
//  CHALLENGE ACCEPTANCE FLOW
// ═══════════════════════════════════════════════════════

function handleChallengeUrl(b64) {
  const data = decodePayload(b64);
  if (!data || !data.p1 || !data.p1.length) return;
  h2hChallenge = data;
  h2hLockedEVs = new Set(data.p1.map(p => p.ev || (p.canon + '-' + p.rE)));
  renderChallengeScreen(data);
  showScreen('challenge-screen');
}

function handleResultsUrl(b64) {
  const data = decodePayload(b64);
  if (!data) return;
  if (!data.p2) {
    // P1 opened their own results link before opponent played
    showScreen('results-waiting-screen');
    return;
  }
  // Full results data from P2's share
  h2hChallenge = data;
  h2hSeriesResult = data.series;
  renderH2HResults(data.p1, data.p2, data.series);
  showScreen('h2h-results-screen');
}

function renderChallengeScreen(data) {
  const chipsHtml = data.p1.map(entry => {
    const p = lookupPlayer(entry);
    const url = headshotUrl(p.canon);
    const hsHtml = url
      ? '<div class="sr-hs-wrap"><span class="sr-hs-fb">' + (p.init||'??') + '</span><img class="sr-hs" src="' + url + '" alt="" onerror="this.remove()"></div>'
      : '<div class="sr-hs-wrap"><span class="sr-hs-fb">' + (p.init||'??') + '</span></div>';
    return '<div class="sr-chip">' + hsHtml + '<div class="sr-pos">' + entry.pos + '</div><div class="sr-name">' + p.name.split(' ').pop() + '</div><div class="sr-era">' + entry.rT + ' ' + entry.rE + '</div></div>';
  }).join('');
  document.getElementById('ch-p1-chips').innerHTML = chipsHtml;

  const ps = data.p1.map(e => lookupPlayer(e));
  const totalsHtml = '<div style="grid-column:1/-1;font-size:10px;font-weight:700;color:var(--ink3);letter-spacing:.06em;text-transform:uppercase;margin-bottom:4px;">Starting 5 Totals</div>'
    + [['PPG', ps.reduce((s,p)=>s+(p.ppg||0),0)],['RPG', ps.reduce((s,p)=>s+(p.rpg||0),0)],['APG', ps.reduce((s,p)=>s+(p.apg||0),0)],['SPG', ps.reduce((s,p)=>s+(p.spg||0),0)],['BPG', ps.reduce((s,p)=>s+(p.bpg||0),0)]].map(([lbl,val]) =>
      '<div class="ss-box"><div class="ss-val">' + val.toFixed(1) + '</div><div class="ss-lbl">' + lbl + '</div></div>'
    ).join('');
  document.getElementById('ch-p1-stats').innerHTML = totalsHtml;
}

function acceptChallenge() {
  // Start game in h2h mode, preserving h2hChallenge and h2hLockedEVs
  gMode = 'h2h';
  roster = { PG: null, SG: null, SF: null, PF: null, C: null };
  takenC = new Set(); roundN = 1; rrT = false; rrE = false;
  cTeam = ''; cEra = ''; cKey = ''; selP = null; mvMode = false; mvFrom = null; spinning = false;
  document.getElementById('mode-tag').textContent = 'Head to Head';
  showScreen('game-screen');
  document.getElementById('list-zone').style.display = 'none';
  document.getElementById('reroll-row').style.display = 'none';
  document.getElementById('btn-spin').disabled = false;
  document.getElementById('sc-team').textContent = '--';
  document.getElementById('sc-era').textContent = '--';
  setSpinZoneCompact(false);
  SLOTS.forEach(s => resetNode(s));
  syncTs(); clearBanner();
}

// ═══════════════════════════════════════════════════════
//  PRE-SERIES SCREEN
// ═══════════════════════════════════════════════════════

function renderPSChips(containerId, entries) {
  const html = entries.map(entry => {
    const p = lookupPlayer(entry);
    return '<div class="ps-chip">' +
      '<span class="ps-chip-pos">' + entry.pos + '</span>' +
      '<div style="flex:1;min-width:0;"><div class="ps-chip-name">' + p.name.split(' ').pop() + '</div>' +
      '<div class="ps-chip-era">' + entry.rT + ' ' + entry.rE + '</div></div>' +
      '</div>';
  }).join('');
  document.getElementById(containerId).innerHTML = html;
}

function showPreseries() {
  const p1Entries = h2hChallenge.p1;
  const p2Entries = buildRosterPayload(h2hP2Roster);

  renderPSChips('ps-p1-chips', p1Entries);
  renderPSChips('ps-p2-chips', p2Entries);

  const p1Avg = (p1Entries.reduce((s,e) => s + (lookupPlayer(e).score || e.score || 75), 0) / p1Entries.length).toFixed(1);
  const p2Avg = (Object.values(h2hP2Roster).filter(Boolean).reduce((s,p) => s + p.score, 0) / 5).toFixed(1);
  document.getElementById('ps-p1-rating').textContent = 'Avg Rating: ' + p1Avg;
  document.getElementById('ps-p2-rating').textContent = 'Avg Rating: ' + p2Avg;

  showScreen('preseries-screen');
}

// ═══════════════════════════════════════════════════════
//  SERIES SIMULATION
// ═══════════════════════════════════════════════════════

function calcModifiers(r1, r2) {
  const mods = { p1: 0, p2: 0, details: [] };

  // Interior dominance: C+PF avg 10+ higher
  const p1Int = ((r1.C ? r1.C.score : 0) + (r1.PF ? r1.PF.score : 0)) / 2;
  const p2Int = ((r2.C ? r2.C.score : 0) + (r2.PF ? r2.PF.score : 0)) / 2;
  if (p1Int - p2Int >= 10) { mods.p1 += 4; mods.details.push({ name: 'Interior Dominance', p1: true }); }
  else if (p2Int - p1Int >= 10) { mods.p2 += 4; mods.details.push({ name: 'Interior Dominance', p1: false }); }

  // Perimeter advantage: PG+SG avg 10+ higher
  const p1Per = ((r1.PG ? r1.PG.score : 0) + (r1.SG ? r1.SG.score : 0)) / 2;
  const p2Per = ((r2.PG ? r2.PG.score : 0) + (r2.SG ? r2.SG.score : 0)) / 2;
  if (p1Per - p2Per >= 10) { mods.p1 += 3; mods.details.push({ name: 'Perimeter Advantage', p1: true }); }
  else if (p2Per - p1Per >= 10) { mods.p2 += 3; mods.details.push({ name: 'Perimeter Advantage', p1: false }); }

  // Defensive edge: combined SPG+BPG 20% higher
  const p1Def = Object.values(r1).reduce((s, p) => s + (p ? (p.spg||0) + (p.bpg||0) : 0), 0);
  const p2Def = Object.values(r2).reduce((s, p) => s + (p ? (p.spg||0) + (p.bpg||0) : 0), 0);
  if (p2Def > 0 && p1Def > p2Def * 1.2) { mods.p1 += 3; mods.details.push({ name: 'Defensive Edge', p1: true }); }
  else if (p1Def > 0 && p2Def > p1Def * 1.2) { mods.p2 += 3; mods.details.push({ name: 'Defensive Edge', p1: false }); }

  // Versatility bonus: 3+ multi-pos players
  const p1Vers = Object.values(r1).filter(p => p && p.pos && p.pos.length >= 2).length;
  const p2Vers = Object.values(r2).filter(p => p && p.pos && p.pos.length >= 2).length;
  if (p1Vers >= 3) { mods.p1 += 2; mods.details.push({ name: 'Versatility Bonus', p1: true }); }
  if (p2Vers >= 3) { mods.p2 += 2; mods.details.push({ name: 'Versatility Bonus', p1: false }); }

  // Playmaking edge: total APG 5+ higher
  const p1Apg = Object.values(r1).reduce((s, p) => s + (p ? (p.apg||0) : 0), 0);
  const p2Apg = Object.values(r2).reduce((s, p) => s + (p ? (p.apg||0) : 0), 0);
  if (p1Apg - p2Apg >= 5) { mods.p1 += 2; mods.details.push({ name: 'Playmaking Edge', p1: true }); }
  else if (p2Apg - p1Apg >= 5) { mods.p2 += 2; mods.details.push({ name: 'Playmaking Edge', p1: false }); }

  return mods;
}

function simH2HSeries(p1Entries, p2Entries) {
  // Build position-keyed roster objects
  const r1 = {}, r2 = {};
  p1Entries.forEach(e => { r1[e.pos] = lookupPlayer(e); });
  p2Entries.forEach(e => { r2[e.pos] = lookupPlayer(e); });

  const ps1 = Object.values(r1).filter(Boolean);
  const ps2 = Object.values(r2).filter(Boolean);
  const avg1 = ps1.reduce((s,p) => s + p.score, 0) / ps1.length;
  const avg2 = ps2.reduce((s,p) => s + p.score, 0) / ps2.length;

  const mods = calcModifiers(r1, r2);
  const baseProb = 1 / (1 + Math.pow(10, (avg2 - avg1) / 15));
  const adjProb  = Math.min(0.85, Math.max(0.15, baseProb + (mods.p1 - mods.p2) / 100));

  let p1W = 0, p2W = 0;
  const games = [];
  while (p1W < 4 && p2W < 4) {
    const p1Won = Math.random() < adjProb;
    if (p1Won) p1W++; else p2W++;
    games.push({ game: games.length + 1, p1Won, p1W, p2W });
  }

  // MVP: highest-rated player on winning team
  const winPosRoster = p1W > p2W ? r1 : r2;
  const winPlayers   = Object.entries(winPosRoster).filter(([,p]) => p);
  const [mvpPos, mvpP] = winPlayers.reduce(([ap,a],[bp,b]) => a.score >= b.score ? [ap,a] : [bp,b]);
  const mvp = Object.assign({}, mvpP, { pos_assigned: mvpPos });

  return { games, p1W, p2W, mods, mvp, p1Won: p1W > p2W, adjProb };
}

function runH2HSeries() {
  const p1Entries = h2hChallenge.p1;
  const p2Entries = buildRosterPayload(h2hP2Roster);
  h2hSeriesResult = simH2HSeries(p1Entries, p2Entries);
  renderH2HResults(p1Entries, p2Entries, h2hSeriesResult);
  showScreen('h2h-results-screen');
  fetchNarrative(p1Entries, p2Entries, h2hSeriesResult);
}

// ═══════════════════════════════════════════════════════
//  RESULTS DISPLAY
// ═══════════════════════════════════════════════════════

function renderH2HResults(p1Entries, p2Entries, series) {
  // Winner banner
  const p2Won = !series.p1Won;
  const winLabel  = p2Won ? 'You Win! &#127881;' : 'Challenger Wins!';
  const scoreStr  = series.p1Won ? series.p1W + '–' + series.p2W : series.p2W + '–' + series.p1W;
  const winnerName = series.p1Won ? 'Challenger' : 'You';
  const banner = document.getElementById('h2h-winner-banner');
  banner.className = 'h2h-winner-banner' + (p2Won ? ' banner-you' : '');
  banner.innerHTML = '<div class="h2h-winner-title">' + winLabel + '</div><div class="h2h-winner-score">' + winnerName + ' win the series ' + scoreStr + '</div>';

  // Game-by-game timeline
  const tlEl = document.getElementById('h2h-series-timeline');
  tlEl.innerHTML = series.games.map(g => {
    const gWinner = g.p1Won ? 'Challenger' : 'You';
    const cls = g.p1Won ? 'early' : 'champ';
    return '<div class="s-row" style="opacity:1">' +
      '<div class="s-yr">Game ' + g.game + '</div>' +
      '<div class="s-w">' + g.p1W + '–' + g.p2W + '</div>' +
      '<div class="s-r ' + cls + '">' + gWinner + ' win</div></div>';
  }).join('');

  // MVP card
  const mvp = series.mvp;
  const mvpUrl = headshotUrl(mvp.canon);
  const mvpAvHtml = mvpUrl
    ? '<div class="dp-av has-hs" style="width:48px;height:48px;flex-shrink:0;border-radius:10px;">' + (mvp.init||'??') + '<img class="p-hs" src="' + mvpUrl + '" alt="" onerror="this.parentNode.classList.remove(\'has-hs\');this.remove()"></div>'
    : '<div class="dp-av" style="width:48px;height:48px;flex-shrink:0;border-radius:10px;">' + (mvp.init||'??') + '</div>';
  document.getElementById('h2h-mvp-card').innerHTML =
    '<div class="h2h-card-hd">Series MVP</div>' +
    '<div class="h2h-mvp-row">' + mvpAvHtml +
    '<div class="dp-info"><div class="dp-name">' + mvp.name + ' <span class="dp-mvp-badge">MVP</span></div>' +
    '<div class="dp-sub">' + (mvp.pos_assigned||'') + ' &middot; ' + mvp.rT + ' ' + mvp.rE + ' &middot; ' + mvp.score + ' Rating</div></div></div>';

  // Matchup modifiers
  const modsHtml = series.mods.details.length
    ? '<div class="h2h-mods-list">' + series.mods.details.map(m =>
        '<div class="mod-badge ' + (m.p1 ? 'mod-p1' : 'mod-p2') + '">' +
        '<span>' + m.name + '</span><span>&#8594; ' + (m.p1 ? 'Challenger' : 'You') + '</span></div>'
      ).join('') + '</div>'
    : '<div class="mod-none">Evenly matched — no significant matchup advantages</div>';
  document.getElementById('h2h-mods-card').innerHTML = '<div class="h2h-card-hd">Matchup Factors</div>' + modsHtml;

  // Roster comparison
  const p1RowsHtml = p1Entries.map(e => {
    const p = lookupPlayer(e);
    return '<div class="h2h-roster-row"><span class="h2h-roster-pos">' + e.pos + '</span><span class="h2h-roster-name">' + p.name.split(' ').pop() + '</span><span class="h2h-roster-score">' + (p.score||e.score) + '</span></div>';
  }).join('');
  const p2RowsHtml = p2Entries.map(e => {
    const p = lookupPlayer(e);
    return '<div class="h2h-roster-row"><span class="h2h-roster-pos">' + e.pos + '</span><span class="h2h-roster-name">' + p.name.split(' ').pop() + '</span><span class="h2h-roster-score">' + (p.score||e.score) + '</span></div>';
  }).join('');
  document.getElementById('h2h-rosters-card').innerHTML =
    '<div class="h2h-card-hd">Roster Comparison</div>' +
    '<div class="h2h-roster-grid">' +
    '<div class="h2h-roster-col"><div class="h2h-col-label">Challenger</div>' + p1RowsHtml + '</div>' +
    '<div class="h2h-roster-col"><div class="h2h-col-label">You</div>' + p2RowsHtml + '</div>' +
    '</div>';

  const narEl = document.getElementById('h2h-narrative');
  narEl.style.display = 'none';
}

// ═══════════════════════════════════════════════════════
//  AI NARRATIVE
// ═══════════════════════════════════════════════════════

async function fetchNarrative(p1Entries, p2Entries, series) {
  const narEl = document.getElementById('h2h-narrative');
  try {
    const r = await fetch('/api/narrate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        p1: p1Entries.map(e => { const p = lookupPlayer(e); return { name: p.name, rT: e.rT, rE: e.rE, pos: e.pos, score: p.score||e.score }; }),
        p2: p2Entries.map(e => { const p = lookupPlayer(e); return { name: p.name, rT: e.rT, rE: e.rE, pos: e.pos, score: p.score||e.score }; }),
        series: {
          p1Won: series.p1Won, p1W: series.p1W, p2W: series.p2W,
          games: series.games,
          mvp: { name: series.mvp.name, rT: series.mvp.rT, rE: series.mvp.rE },
          modDetails: series.mods.details,
        },
      }),
    });
    if (r.ok) {
      const data = await r.json();
      if (data.narrative) {
        narEl.innerHTML = data.narrative;
        narEl.style.display = 'block';
        return;
      }
    }
  } catch (_) {}
  // Fall back to client-side narrative
  const p1Full = p1Entries.map(e => lookupPlayer(e));
  const p2Full = p2Entries.map(e => lookupPlayer(e));
  const txt = buildLocalNarrative(p1Full, p2Full, series);
  if (txt) { narEl.innerHTML = txt; narEl.style.display = 'block'; }
}

function buildLocalNarrative(p1, p2, series) {
  const p2Won = !series.p1Won;
  const winner = p2Won ? 'You' : 'the Challenger';
  const wRoster = p2Won ? p2 : p1;
  const lRoster = p2Won ? p1 : p2;
  const scoreStr = p2Won ? series.p2W + '–' + series.p1W : series.p1W + '–' + series.p2W;
  const mvp = series.mvp;
  const nGames = series.games.length;
  const drama = nGames === 7 ? ' It went the full seven — every game decided by a possession.' : nGames <= 4 ? ' The sweep left no doubt.' : '';
  const dominantMod = series.mods.details.find(m => p2Won ? !m.p1 : m.p1);
  const modLine = dominantMod ? ' The <strong>' + dominantMod.name.toLowerCase() + '</strong> proved to be the decisive edge.' : '';
  const topStar = wRoster.reduce((a,b) => (a.score||0) >= (b.score||0) ? a : b);
  return 'In a ' + (nGames <= 5 ? 'commanding' : 'hard-fought') + ' ' + nGames + '-game series, <strong>' + winner + '</strong> took the series ' + scoreStr + '.' + drama + modLine +
    ' <strong>' + mvp.name + '</strong> was the standout, anchoring the winning squad at a ' + (mvp.score||'elite') + ' composite rating.' +
    (topStar.canon !== mvp.canon ? ' <strong>' + topStar.name.split(' ').pop() + '</strong> was equally crucial, giving the winners an insurmountable depth advantage.' : '');
}

// ═══════════════════════════════════════════════════════
//  SHARE RESULTS
// ═══════════════════════════════════════════════════════

function openShareResultsModal() {
  console.log('[H2H Share] button clicked — state:', {
    h2hChallenge: !!h2hChallenge,
    h2hSeriesResult: !!h2hSeriesResult,
    h2hP2Roster: !!h2hP2Roster,
  });

  if (!h2hChallenge || !h2hSeriesResult) {
    console.error('[H2H Share] missing required state', { h2hChallenge, h2hSeriesResult });
    const btn = document.getElementById('btn-h2h-share');
    if (btn) { btn.textContent = '⚠ State missing — reload?'; btn.style.background = '#c00'; }
    return;
  }

  try {
    // P2 played locally → use h2hP2Roster.
    // P1 viewing a ?results= URL → h2hChallenge.p2 already has P2's entries from the decoded payload.
    const p2Entries = h2hP2Roster
      ? buildRosterPayload(h2hP2Roster)
      : (h2hChallenge.p2 || []);

    console.log('[H2H Share] p2Entries count:', p2Entries.length);

    const series = h2hSeriesResult;
    const payload = { v: 1, p1: h2hChallenge.p1, p2: p2Entries, series };
    const b64 = encodePayload(payload);
    const url = window.location.origin + '/?results=' + b64;

    console.log('[H2H Share] results URL length:', url.length);

    const p2Won = !series.p1Won;
    const scoreStr = p2Won ? series.p2W + '-' + series.p1W : series.p1W + '-' + series.p2W;
    const msg = p2Won
      ? 'I just beat your Ball Knowledge squad ' + scoreStr + '. See the full breakdown: ' + url
      : 'Your Ball Knowledge squad got me ' + scoreStr + '. See the full series: ' + url;

    h2hShareData = { url, msg };
    document.getElementById('h2h-res-link').value = url;
    console.log('[H2H Share] showing modal');
    document.getElementById('share-results-modal').style.display = 'flex';
  } catch (e) {
    console.error('[H2H Share] uncaught error:', e);
  }
}

function copyH2HResLink() {
  navigator.clipboard.writeText(h2hShareData.url);
  const btn = document.getElementById('btn-copy-h2h-res');
  btn.textContent = 'Copied!';
  setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
}

function shareH2HViaBtn() {
  if (navigator.share) {
    navigator.share({ text: h2hShareData.msg }).catch(() => {});
  } else {
    navigator.clipboard.writeText(h2hShareData.msg);
    const btn = document.getElementById('btn-share-h2h-res');
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = 'Share'; }, 2000);
  }
}

function openH2HPlatformShare(platform) {
  const { msg, url } = h2hShareData;
  const enc = encodeURIComponent(msg);
  const encUrl = encodeURIComponent(url);
  let shareUrl;
  if (platform === 'twitter')       shareUrl = 'https://twitter.com/intent/tweet?text=' + enc;
  else if (platform === 'whatsapp') shareUrl = 'https://wa.me/?text=' + enc;
  else if (platform === 'reddit')   shareUrl = 'https://reddit.com/submit?url=' + encUrl + '&title=' + enc;
  else if (platform === 'sms')      shareUrl = 'sms:?&body=' + enc;
  if (platform === 'sms') window.location.href = shareUrl;
  else window.open(shareUrl, '_blank');
}
