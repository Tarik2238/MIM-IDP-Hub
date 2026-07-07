// injury-feed.js — geteiltes Modul für den IDP-Injury-Tracker (genutzt von index.html
// und injury-news.html). Baut einen chronologischen News-Feed aus ESPNs
// Team-Injuries-Endpunkten (sports.core.api.espn.com, nicht das blockierte
// site.api.espn.com), begrenzt auf DL/LB/DB (dieselbe IDP-Klassifikation wie überall
// sonst im Hub) und zugeordnet über Sleepers eigenes espn_id-Feld — kein separater
// nflverse-Crosswalk nötig.

const ESPN_TEAM_ID = {ATL:1,BUF:2,CHI:3,CIN:4,CLE:5,DAL:6,DEN:7,DET:8,GB:9,TEN:10,IND:11,KC:12,LV:13,LAR:14,MIA:15,MIN:16,NE:17,NO:18,NYG:19,NYJ:20,PHI:21,ARI:22,PIT:23,LAC:24,SF:25,SEA:26,TB:27,WAS:28,CAR:29,JAX:30,BAL:33,HOU:34};

const SLEEPER_ALL = 'https://api.sleeper.app/v1/players/nfl';
const SLEEPER_CACHE_KEY = 'mim_sleeper_players_v3', SLEEPER_CACHE_TS = 'mim_sleeper_ts_v3', SLEEPER_CACHE_TTL = 23*60*60*1000;
const FEED_CACHE_KEY = 'mim_injury_feed_v1', FEED_CACHE_TS = 'mim_injury_feed_ts_v1', FEED_CACHE_TTL = 6*60*60*1000;

function store(){ try{ localStorage.setItem('_t','1'); localStorage.removeItem('_t'); return localStorage; }catch{ return sessionStorage; } }

const DL_SET = new Set(['DE','DT','NT','EDGE','IDL','DL']);
const LB_SET = new Set(['LB','ILB','MLB','OLB']);
const DB_SET = new Set(['CB','FS','SS','S','DB','SAF']);
function classifyTag(tag){
  const t = (tag||'').toUpperCase();
  if(DL_SET.has(t)) return 'DL';
  if(LB_SET.has(t)) return 'LB';
  if(DB_SET.has(t)) return 'DB';
  return null;
}
function classifyPlayer(x){
  const groups = new Set();
  const tags = (x.fantasy_positions && x.fantasy_positions.length) ? x.fantasy_positions : [x.position];
  tags.forEach(t => { const c = classifyTag(t); if(c) groups.add(c); });
  if(groups.size === 0){ const c2 = classifyTag(x.depth_chart_position); if(c2) groups.add(c2); }
  return [...groups];
}

// Baut eine Map espn_id -> Spieler-Objekt, NUR für IDP-Positionen (DL/LB/DB) und nur
// wo Sleeper überhaupt eine espn_id führt (ohne die können wir eh nicht zuordnen).
// Nutzt denselben Sleeper-Cache-Key wie die anderen Seiten — kein doppelter Download,
// wenn der schon frisch im localStorage liegt.
async function loadIdpEspnIndex(){
  let data;
  try{
    const s = store();
    const ts = s.getItem(SLEEPER_CACHE_TS);
    if(ts && Date.now()-parseInt(ts) < SLEEPER_CACHE_TTL){
      const cached = s.getItem(SLEEPER_CACHE_KEY);
      if(cached){ data = JSON.parse(cached); }
    }
  }catch{}

  let rawPlayers;
  if(data){
    // Gecachte Liste ist schon auf unser eigenes, schlankes Format vorverarbeitet
    // (siehe index.html/players.html) — hat also schon positions/espn_id direkt.
    rawPlayers = data;
  } else {
    const r = await fetch(SLEEPER_ALL);
    const raw = await r.json();
    rawPlayers = Object.entries(raw).map(([id,x]) => {
      const groups = classifyPlayer(x);
      if(!groups.length) return null;
      return {
        sleeper_id: id, espn_id: x.espn_id || '',
        full_name: x.full_name || `${x.first_name||''} ${x.last_name||''}`.trim(),
        position: groups[0], positions: groups, team: x.team || ''
      };
    }).filter(Boolean);
    try{ const s = store(); s.setItem(SLEEPER_CACHE_KEY, JSON.stringify(rawPlayers)); s.setItem(SLEEPER_CACHE_TS, Date.now().toString()); }catch{}
  }

  const idx = new Map();
  rawPlayers.forEach(p => {
    if(!p.espn_id) return;
    // Bereits vorverarbeitete gecachte Objekte haben "positions" auch schon gesetzt
    // (aus classifyPlayer) — falls das Format abweicht, defensiv nochmal prüfen.
    const positions = p.positions || (p.position ? [p.position] : []);
    if(!positions.some(pos => ['DL','LB','DB'].includes(pos))) return;
    idx.set(String(p.espn_id), p);
  });
  return idx;
}

async function fetchTeamInjuryRefs(teamId){
  try{
    const data = await fetch(`https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/teams/${teamId}/injuries?limit=100`).then(r => r.json());
    return data.items || [];
  }catch(e){
    console.warn('[InjuryFeed] Team-Injuries konnten nicht geladen werden für Team', teamId, e);
    return [];
  }
}

function extractIds(ref){
  const m = (ref||'').match(/\/athletes\/(\d+)\/injuries\/(-?\d+)/);
  return m ? { espnId: m[1], injuryId: m[2] } : null;
}

// Baut den vollständigen, chronologisch sortierten IDP-Injury-Feed über alle 32 Teams.
// Ergebnis wird 6h gecacht (Injury-News ändert sich nicht minütlich, aber öfter als
// z.B. Rosters) — beide Seiten (Startseite + Volltext-Seite) teilen sich diesen Cache.
export async function loadInjuryFeed(forceRefresh){
  if(!forceRefresh){
    try{
      const ts = localStorage.getItem(FEED_CACHE_TS);
      if(ts && Date.now()-parseInt(ts) < FEED_CACHE_TTL){
        const cached = localStorage.getItem(FEED_CACHE_KEY);
        if(cached) return JSON.parse(cached);
      }
    }catch{}
  }

  const idpIndex = await loadIdpEspnIndex();

  const teamRefLists = await Promise.all(
    Object.entries(ESPN_TEAM_ID).map(async ([abbr, id]) => ({ abbr, refs: await fetchTeamInjuryRefs(id) }))
  );

  const matches = [];
  teamRefLists.forEach(({ abbr, refs }) => {
    refs.forEach(it => {
      const ids = extractIds(it.$ref);
      if(!ids) return;
      const player = idpIndex.get(ids.espnId);
      if(player) matches.push({ ref: it.$ref, teamAbbr: abbr, player });
    });
  });

  const details = await Promise.all(matches.map(async m => {
    try{
      const d = await fetch(m.ref.replace('http://','https://')).then(r => r.json());
      if(!d.date) return null;
      return {
        sleeperId: m.player.sleeper_id,
        name: m.player.full_name,
        position: m.player.position,
        team: m.teamAbbr,
        date: d.date,
        status: d.status || '',
        shortComment: d.shortComment || '',
        longComment: d.longComment || '',
        type: (d.details && d.details.type) || '',
        returnDate: (d.details && d.details.returnDate) || ''
      };
    }catch(e){ return null; }
  }));

  const feed = details.filter(Boolean).sort((a,b) => new Date(b.date) - new Date(a.date));

  try{ localStorage.setItem(FEED_CACHE_KEY, JSON.stringify(feed)); localStorage.setItem(FEED_CACHE_TS, Date.now().toString()); }catch{}
  return feed;
}
