const express = require('express');
const cors = require('cors');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const BASE = 'https://www.xscores.com';

const http = axios.create({
  timeout: 20000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36',
    'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
  }
});

function normalizeSpace(str = '') {
  return String(str).replace(/\s+/g, ' ').replace(/\u00a0/g, ' ').trim();
}

function normKey(str = '') {
  return normalizeSpace(str)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '')
    .toLowerCase();
}

function decodePart(str = '') {
  return decodeURIComponent(str)
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b([a-zà-ÿ])/gi, (m) => m.toUpperCase())
    .replace(/\bU(\d{2})\b/gi, 'U$1');
}

function absUrl(href = '') {
  if (!href) return '';
  if (/^https?:\/\//i.test(href)) return href;
  return `${BASE}${href.startsWith('/') ? '' : '/'}${href}`;
}

function parseTeamsFromHref(href = '') {
  const clean = href.split('?')[0];
  const match = clean.match(/\/basketball\/match\/([^/]+)\/([0-9]{2}-[0-9]{2}-[0-9]{4})\/(\d+)/i);
  if (!match) return null;
  const slug = match[1];
  const dateSlug = match[2];
  const id = match[3];
  const [homeSlug, awaySlug] = slug.split(/-vs-/i);
  if (!homeSlug || !awaySlug) return null;
  return {
    id,
    href: absUrl(clean),
    dateSlug,
    home: decodePart(homeSlug),
    away: decodePart(awaySlug)
  };
}

function parseDateString(str = '') {
  const value = normalizeSpace(str);
  let m = value.match(/(\d{2})[.\/-](\d{2})[.\/-](\d{2,4})/);
  if (!m) return { raw: value || '-', stamp: 0 };
  let year = Number(m[3]);
  if (year < 100) year += 2000;
  const iso = `${year}-${m[2]}-${m[1]}`;
  return { raw: `${m[1]}.${m[2]}.${String(year).slice(-2)}`, stamp: Date.parse(iso) || 0 };
}

function extractTime(text = '') {
  const m = normalizeSpace(text).match(/\b(\d{1,2}:\d{2})\b/);
  return m ? m[1] : '';
}

function extractDate(text = '', fallback = '') {
  const n = normalizeSpace(text);
  const m = n.match(/(\d{2}[.\/-]\d{2}[.\/-]\d{2,4})/);
  if (m) return m[1];
  if (fallback) {
    const p = parseDateString(fallback);
    return p.raw;
  }
  return '-';
}

function extractLastTwoScores(text = '') {
  const numbers = (normalizeSpace(text).match(/\b\d{1,3}\b/g) || [])
    .map(Number)
    .filter((n) => n >= 40 && n <= 180);
  if (numbers.length >= 2) {
    return [numbers[numbers.length - 2], numbers[numbers.length - 1]];
  }
  return null;
}

function isUsefulContext(text = '') {
  const t = normalizeSpace(text);
  if (!t) return false;
  if (t.length < 5 || t.length > 130) return false;
  if (/Search|Advertisement|Cookie|Settings|Sort matches|Privacy|Contact/i.test(t)) return false;
  if (/^\d{1,2}:\d{2}$/.test(t)) return false;
  if (/^\d+$/.test(t)) return false;
  return true;
}

function closestRowText($, el) {
  let current = $(el);
  for (let i = 0; i < 7 && current && current.length; i++) {
    const text = normalizeSpace(current.text());
    if (text && text.length >= 8 && text.length <= 350) return text;
    current = current.parent();
  }
  return normalizeSpace($(el).text());
}

function collectContextTexts($, el) {
  const out = [];
  const pushText = (txt) => {
    const t = normalizeSpace(txt);
    if (isUsefulContext(t) && !out.includes(t)) out.push(t);
  };

  let node = $(el);
  for (let depth = 0; depth < 5 && node && node.length; depth++) {
    let prev = node.prev();
    let count = 0;
    while (prev && prev.length && count < 6) {
      pushText(prev.text());
      prev = prev.prev();
      count++;
    }
    node = node.parent();
  }
  return out;
}

function guessLeagueFromContext(contexts = []) {
  for (const c of contexts) {
    if (/^[A-ZÀ-ÿ].{3,}$/.test(c) && (c.includes(':') || c.includes('·') || /playoffs|mata|cup|league|liga|superliga|championship|u18|women/i.test(c))) {
      return c;
    }
  }
  return 'Basquete';
}

function splitCountryLeague(label = '') {
  const text = normalizeSpace(label);
  if (!text) return { country: 'Basquete', league: 'Basquete' };
  const clean = text.replace(/^[^A-Za-zÀ-ÿ0-9]+/, '');
  if (clean.includes(':')) {
    const [country, rest] = clean.split(':');
    return { country: normalizeSpace(country), league: normalizeSpace(rest) || normalizeSpace(clean) };
  }
  if (clean.includes('·')) {
    const parts = clean.split('·').map((s) => normalizeSpace(s)).filter(Boolean);
    return { country: parts[parts.length - 1] || 'Basquete', league: parts[0] || clean };
  }
  return { country: 'Basquete', league: clean };
}

function extractStatus(text = '') {
  const t = normalizeSpace(text).toUpperCase();
  if (/\bLIVE\b|\b1Q\b|\b2Q\b|\b3Q\b|\b4Q\b|\bOT\b|\bBRK\b/.test(t)) return 'Ao vivo';
  if (/\bFIN\b|\bFTR\b|\bENCERRADO\b/.test(t)) return 'Encerrado';
  return 'Agendado';
}

function safeSlice(arr, limit = 10) {
  return Array.isArray(arr) ? arr.slice(0, limit) : [];
}

async function fetchHtml(url) {
  const { data } = await http.get(url);
  return data;
}

function parseQuarterTableFromText(text = '') {
  const clean = normalizeSpace(text);
  const out = { home: [], away: [], totalHome: null, totalAway: null };

  const qPattern = /(?:Q1|1Q|1)\s+(\d{1,3})\s+(\d{1,3}).*?(?:Q2|2Q|2)\s+(\d{1,3})\s+(\d{1,3}).*?(?:Q3|3Q|3)\s+(\d{1,3})\s+(\d{1,3}).*?(?:Q4|4Q|4)\s+(\d{1,3})\s+(\d{1,3}).*?(?:T|TOTAL)\s+(\d{1,3})\s+(\d{1,3})/i;
  const m = clean.match(qPattern);
  if (m) {
    out.home = [Number(m[1]), Number(m[3]), Number(m[5]), Number(m[7])];
    out.away = [Number(m[2]), Number(m[4]), Number(m[6]), Number(m[8])];
    out.totalHome = Number(m[9]);
    out.totalAway = Number(m[10]);
    return out;
  }
  return out;
}

function normalizeGameRow(row, teamName) {
  const teamKey = normKey(teamName);
  const homeKey = normKey(row.home);
  const awayKey = normKey(row.away);
  const isHomeTeam = teamKey === homeKey;
  const isAwayTeam = teamKey === awayKey;
  const pointsFor = isHomeTeam ? row.homeScore : row.awayScore;
  const pointsAgainst = isHomeTeam ? row.awayScore : row.homeScore;
  const opponent = isHomeTeam ? row.away : row.home;
  const venue = isHomeTeam ? 'Casa' : 'Fora';
  const result = pointsFor > pointsAgainst ? 'V' : pointsFor < pointsAgainst ? 'D' : 'E';
  return {
    ...row,
    pointsFor,
    pointsAgainst,
    opponent,
    venue,
    result,
    teamName
  };
}

async function scrapeTeamResults(teamUrl, teamName) {
  const resultsUrl = teamUrl.replace(/\/+$/, '') + (teamUrl.endsWith('/results') ? '' : '/results');
  const html = await fetchHtml(resultsUrl);
  const $ = cheerio.load(html);
  const unique = new Map();

  $('a[href*="/basketball/match/"]').each((_, a) => {
    const href = absUrl($(a).attr('href'));
    const parsed = parseTeamsFromHref(href);
    if (!parsed || unique.has(parsed.id)) return;
    const rowText = closestRowText($, a);
    const scores = extractLastTwoScores(rowText);
    if (!scores) return;
    const base = {
      id: parsed.id,
      href,
      date: extractDate(rowText, parsed.dateSlug),
      dateStamp: parseDateString(extractDate(rowText, parsed.dateSlug)).stamp,
      leagueCode: (normalizeSpace(rowText).match(/\b[A-Z]{2,4}\b/) || [,'PRO'])[1],
      home: parsed.home,
      away: parsed.away,
      homeScore: scores[0],
      awayScore: scores[1],
      raw: rowText
    };
    const n = normalizeGameRow(base, teamName);
    if (normKey(n.teamName) !== normKey(n.home) && normKey(n.teamName) !== normKey(n.away)) return;
    unique.set(parsed.id, n);
  });

  const rows = [...unique.values()].sort((a, b) => b.dateStamp - a.dateStamp);
  return safeSlice(rows, 12);
}

function buildH2H(homeResults, awayResults, homeName, awayName) {
  const homeKey = normKey(homeName);
  const awayKey = normKey(awayName);
  const bag = new Map();
  [...homeResults, ...awayResults].forEach((row) => {
    const hk = normKey(row.home);
    const ak = normKey(row.away);
    const isPair = (hk === homeKey && ak === awayKey) || (hk === awayKey && ak === homeKey);
    if (isPair && !bag.has(row.id)) bag.set(row.id, row);
  });
  return [...bag.values()].sort((a, b) => b.dateStamp - a.dateStamp).slice(0, 10);
}

function sum(arr, pick) {
  return arr.reduce((acc, item) => acc + (pick(item) || 0), 0);
}

function calcSummary(homeRows, awayRows, live) {
  const homeGames = homeRows.length;
  const awayGames = awayRows.length;
  const homePtsFavor = sum(homeRows, (r) => r.pointsFor);
  const homePtsContra = sum(homeRows, (r) => r.pointsAgainst);
  const awayPtsFavor = sum(awayRows, (r) => r.pointsFor);
  const awayPtsContra = sum(awayRows, (r) => r.pointsAgainst);
  const avgHome = homeGames ? +(homePtsFavor / homeGames).toFixed(1) : 0;
  const avgAway = awayGames ? +(awayPtsFavor / awayGames).toFixed(1) : 0;
  const line = +(avgHome + avgAway).toFixed(1);

  const qHome = live?.quarters?.home?.length ? live.quarters.home : [null, null, null, null];
  const qAway = live?.quarters?.away?.length ? live.quarters.away : [null, null, null, null];
  const totalHome = live?.homeScore ?? null;
  const totalAway = live?.awayScore ?? null;
  const pointsTotal = totalHome != null && totalAway != null ? totalHome + totalAway : null;
  const pts1 = [qHome[0], qHome[1], qAway[0], qAway[1]].every((v) => Number.isFinite(v)) ? qHome[0] + qHome[1] + qAway[0] + qAway[1] : null;
  const pts2 = [qHome[2], qHome[3], qAway[2], qAway[3]].every((v) => Number.isFinite(v)) ? qHome[2] + qHome[3] + qAway[2] + qAway[3] : null;
  const diffBet = pointsTotal != null ? +(pointsTotal - line).toFixed(1) : null;
  const perQuarter = +(line / 4).toFixed(1);

  return {
    homeGames,
    awayGames,
    homePtsFavor,
    homePtsContra,
    awayPtsFavor,
    awayPtsContra,
    avgHome,
    avgAway,
    line,
    perQuarter,
    current: {
      qHome,
      qAway,
      totalHome,
      totalAway,
      pointsTotal,
      pts1,
      pts2,
      diffBet,
      prediction: line,
      suggestion: diffBet == null ? (line >= 160 ? 'OVER' : 'UNDER') : (diffBet >= 0 ? 'OVER' : 'UNDER')
    }
  };
}

async function scrapeTodayGames() {
  const html = await fetchHtml(`${BASE}/basketball`);
  const $ = cheerio.load(html);
  const games = [];
  const seen = new Set();

  $('a[href*="/basketball/match/"]').each((_, a) => {
    const href = absUrl($(a).attr('href'));
    const parsed = parseTeamsFromHref(href);
    if (!parsed || seen.has(parsed.id)) return;

    const rowText = closestRowText($, a);
    const contexts = collectContextTexts($, a);
    const leagueContext = guessLeagueFromContext(contexts);
    const meta = splitCountryLeague(leagueContext);
    const time = extractTime(rowText) || extractTime(contexts.join(' ')) || '--:--';
    const status = extractStatus(rowText);

    // evita links de páginas antigas e duplicidades óbvias
    if (!parsed.home || !parsed.away) return;
    seen.add(parsed.id);
    games.push({
      id: parsed.id,
      href,
      home: parsed.home,
      away: parsed.away,
      time,
      status,
      country: meta.country,
      league: meta.league,
      leagueLabel: `${meta.country}: ${meta.league}`,
      dateSlug: parsed.dateSlug
    });
  });

  const filtered = games
    .filter((g) => g.home && g.away)
    .sort((a, b) => a.time.localeCompare(b.time));

  const groupedMap = new Map();
  filtered.forEach((game) => {
    const key = game.leagueLabel || 'Outras Ligas';
    if (!groupedMap.has(key)) groupedMap.set(key, { title: key, games: [] });
    groupedMap.get(key).games.push(game);
  });

  return { groups: [...groupedMap.values()], games: filtered };
}

async function scrapeMatch(url) {
  const matchUrl = absUrl(url);
  const html = await fetchHtml(matchUrl);
  const $ = cheerio.load(html);
  const pageText = normalizeSpace($('body').text());
  const parsed = parseTeamsFromHref(matchUrl) || {};

  const title = normalizeSpace($('title').text());
  const heading = normalizeSpace($('h1').first().text()) || title;

  let home = parsed.home || '';
  let away = parsed.away || '';
  const titleMatch = heading.match(/(.+?)\s+vs\s+(.+?)\s+(\d{2}-\d{2}-\d{4})/i) || title.match(/(.+?)\s+vs\s+(.+?)\s+(\d{2}-\d{2}-\d{4})/i);
  if (titleMatch) {
    home = normalizeSpace(titleMatch[1]);
    away = normalizeSpace(titleMatch[2]);
  }

  const teamLinks = [];
  $('a[href*="/basketball/team/"]').each((_, a) => {
    const href = absUrl($(a).attr('href'));
    const text = normalizeSpace($(a).text());
    if (href && text && !teamLinks.find((x) => x.href === href)) {
      teamLinks.push({ href, name: text });
    }
  });

  const homeTeam = teamLinks.find((t) => normKey(t.name) === normKey(home)) || teamLinks[0] || { href: '', name: home };
  const awayTeam = teamLinks.find((t) => normKey(t.name) === normKey(away) && t.href !== homeTeam.href) || teamLinks[1] || { href: '', name: away };

  const dateText = (() => {
    const m = pageText.match(/(\d{2}-\d{2}-\d{4})\s*\/\s*(\d{1,2}:\d{2})/);
    return m ? `${m[1].replace(/-/g, '.')} ${m[2]}` : (parsed.dateSlug ? parsed.dateSlug.replace(/-/g, '.') : '-');
  })();

  const competitionMatch = pageText.match(/on\s+\d{2}-\d{2}-\d{4}\s+in\s+(.+?)\s*\(/i);
  const competition = competitionMatch ? normalizeSpace(competitionMatch[1]) : 'Basquete';

  let live = null;
  const possibleScores = extractLastTwoScores(heading) || extractLastTwoScores(title) || extractLastTwoScores(pageText.slice(0, 400));
  const quarters = parseQuarterTableFromText(pageText);
  if (possibleScores) {
    live = {
      homeScore: possibleScores[0],
      awayScore: possibleScores[1],
      quarters
    };
  } else if (quarters.totalHome != null && quarters.totalAway != null) {
    live = {
      homeScore: quarters.totalHome,
      awayScore: quarters.totalAway,
      quarters
    };
  }

  const [homeResults, awayResults] = await Promise.all([
    homeTeam.href ? scrapeTeamResults(homeTeam.href, homeTeam.name || home) : Promise.resolve([]),
    awayTeam.href ? scrapeTeamResults(awayTeam.href, awayTeam.name || away) : Promise.resolve([])
  ]);

  const h2h = buildH2H(homeResults, awayResults, homeTeam.name || home, awayTeam.name || away);
  const summary = calcSummary(homeResults.slice(0, 10), awayResults.slice(0, 10), live);

  return {
    source: 'XScores',
    sourceUrl: matchUrl,
    home: homeTeam.name || home,
    away: awayTeam.name || away,
    homeTeamUrl: homeTeam.href,
    awayTeamUrl: awayTeam.href,
    date: dateText,
    competition,
    country: splitCountryLeague(competition).country,
    homeResults: safeSlice(homeResults, 10),
    awayResults: safeSlice(awayResults, 10),
    h2h,
    live,
    summary
  };
}

app.get('/api/today', async (_req, res) => {
  try {
    const data = await scrapeTodayGames();
    res.json({ ok: true, ...data });
  } catch (error) {
    console.error(error);
    res.status(500).json({ ok: false, error: 'Não foi possível carregar os jogos do XScores agora.' });
  }
});

app.get('/api/match', async (req, res) => {
  try {
    const url = req.query.url;
    if (!url) return res.status(400).json({ ok: false, error: 'Informe a URL do jogo.' });
    const data = await scrapeMatch(url);
    res.json({ ok: true, ...data });
  } catch (error) {
    console.error(error);
    res.status(500).json({ ok: false, error: 'Não foi possível abrir o jogo selecionado agora.' });
  }
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
