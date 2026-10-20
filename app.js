const API_URL = 'https://kontests.net/api/v1/all';
const STORAGE = { reminders: 'remainder-reminders-v1', lead: 'remainder-lead-v1', notification: 'remainder-notifications-v1', cache: 'remainder-cache-v3' };
const PLATFORM_INFO = {
  codeforces: { name: 'Codeforces', short: 'CF', color: '#e68a62' },
  codechef: { name: 'CodeChef', short: 'CC', color: '#d4ad64' },
  leetcode: { name: 'LeetCode', short: 'LC', color: '#e6ae59' },
  atcoder: { name: 'AtCoder', short: 'At', color: '#8e9ce1' },
  hackerearth: { name: 'HackerEarth', short: 'HE', color: '#68c7a7' },
  hackerrank: { name: 'HackerRank', short: 'HR', color: '#81c878' },
  topcoder: { name: 'TopCoder', short: 'TC', color: '#9ca9bf' },
  other: { name: 'Other', short: '••', color: '#a7ad9b' }
};
const sampleContests = [
  { name: 'Codeforces Round (Div. 2)', url: 'https://codeforces.com/contests', platform: 'Codeforces', start_time: futureISO(3, 4), end_time: futureISO(3, 6), duration: '7200' },
  { name: 'Starters 261', url: 'https://www.codechef.com/contests', platform: 'CodeChef', start_time: futureISO(1, 12), end_time: futureISO(1, 14), duration: '7200' },
  { name: 'Weekly Contest 472', url: 'https://leetcode.com/contest/', platform: 'LeetCode', start_time: futureISO(4, 2), end_time: futureISO(4, 3.5), duration: '5400' },
  { name: 'AtCoder Beginner Contest 427', url: 'https://atcoder.jp/contests/', platform: 'AtCoder', start_time: futureISO(5, 3), end_time: futureISO(5, 5), duration: '7200' },
  { name: 'Biweekly Contest 167', url: 'https://leetcode.com/contest/', platform: 'LeetCode', start_time: futureISO(7, 3), end_time: futureISO(7, 4.5), duration: '5400' },
  { name: 'Codeforces Round (Div. 3)', url: 'https://codeforces.com/contests', platform: 'Codeforces', start_time: futureISO(10, 4), end_time: futureISO(10, 6.5), duration: '9000' }
];
function futureISO(dayOffset, hourOffset) { const d = new Date(); d.setDate(d.getDate() + dayOffset); d.setHours(d.getHours() + hourOffset, 0, 0, 0); return d.toISOString(); }
let contests = [];
let sourceIsLive = false;
let activeView = 'all';
let activeFilter = 'all';
let activePlatform = 'all';
let showAll = false;
let gridMode = false;
let serviceWorkerRegistration = null;
let installPrompt = null;
let reminders = readJson(STORAGE.reminders, {});
let notified = new Set();
let toastTimer;
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const list = $('#contest-list');

function readJson(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
function persistReminders() { localStorage.setItem(STORAGE.reminders, JSON.stringify(reminders)); }
function platformInfo(platform) {
  const key = String(platform || 'Other').toLowerCase().replace(/[^a-z]/g, '');
  return PLATFORM_INFO[key] || { name: platform || 'Other', short: String(platform || '•').slice(0, 2).toUpperCase(), color: '#a7ad9b' };
}
function normalizeContest(c, i) {
  const start = new Date(c.start_time || c.startTime || c.start);
  const durationSeconds = Number(c.duration || c.duration_seconds || c.durationSeconds || 0);
  let end = new Date(c.end_time || c.endTime || c.end);
  if (!Number.isFinite(end.getTime()) && Number.isFinite(start.getTime())) end = new Date(start.getTime() + durationSeconds * 1000);
  const p = platformInfo(c.site || c.platform || c.host || 'Other');
  return { id: `${p.name}:${c.name}:${start.toISOString()}:${i}`, name: c.name || 'Untitled contest', url: c.url || c.href || '#', platform: p.name, start, end, duration: durationSeconds || Math.max(0, (end - start) / 1000) };
}
async function fetchJsonSafe(url, timeoutMs = 8000) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, { signal: controller.signal, cache: 'no-store' });
    clearTimeout(timeout);
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null;
  }
}

async function loadContests() {
  setRefreshState(true);
  try {
    const [cfData, hiveData, competeData] = await Promise.all([
      fetchJsonSafe('https://codeforces.com/api/contest.list?gym=false'),
      fetchJsonSafe('https://contest-hive.vercel.app/api/all'),
      fetchJsonSafe('https://competeapi.vercel.app/contests/upcoming')
    ]);

    const liveContests = [];
    const seenKeys = new Set();

    function addContest(platform, name, url, start, end, duration) {
      if (!Number.isFinite(start.getTime()) || start.getTime() <= Date.now() - 3600000) return;
      const normName = String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const key = `${platform.toLowerCase()}:${normName.slice(0, 14)}:${Math.round(start.getTime() / 60000)}`;
      if (seenKeys.has(key)) return;
      seenKeys.add(key);

      const dur = duration || Math.max(0, Math.round((end.getTime() - start.getTime()) / 1000));
      liveContests.push({
        id: `${platform}:${name}:${start.toISOString()}`,
        name: name || 'Untitled contest',
        platform,
        url: url || '#',
        start,
        end: end || new Date(start.getTime() + dur * 1000),
        duration: dur
      });
    }

    // 1. Parse official Codeforces contests (high accuracy)
    if (cfData && cfData.status === 'OK' && Array.isArray(cfData.result)) {
      cfData.result.filter(c => c.phase === 'BEFORE' || c.phase === 'CODING').forEach(c => {
        const start = new Date(c.startTimeSeconds * 1000);
        const end = new Date((c.startTimeSeconds + c.durationSeconds) * 1000);
        addContest('Codeforces', c.name, `https://codeforces.com/contest/${c.id}`, start, end, c.durationSeconds);
      });
    }

    // 2. Parse Contest Hive (AtCoder, LeetCode, CodeChef, HackerRank, HackerEarth)
    if (hiveData && hiveData.ok && hiveData.data) {
      const platformMap = {
        atcoder: 'AtCoder',
        codechef: 'CodeChef',
        codeforces: 'Codeforces',
        leetcode: 'LeetCode',
        hackerrank: 'HackerRank',
        hackerearth: 'HackerEarth',
        toph: 'Other'
      };
      for (const [siteKey, items] of Object.entries(hiveData.data)) {
        const plat = platformMap[siteKey] || (siteKey.charAt(0).toUpperCase() + siteKey.slice(1));
        if (Array.isArray(items)) {
          items.forEach(c => {
            const start = new Date(c.startTime);
            const end = new Date(c.endTime);
            addContest(plat, c.title, c.url, start, end, c.duration || 7200);
          });
        }
      }
    }

    // 3. Parse CompeteAPI (secondary fallback for CodeChef / LeetCode)
    if (Array.isArray(competeData)) {
      competeData.forEach(c => {
        const plat = c.site === 'codechef' ? 'CodeChef' : c.site === 'leetcode' ? 'LeetCode' : (c.site || 'Other');
        const start = new Date(c.startTime);
        const duration = Math.round((c.duration || 7200000) / 1000);
        const end = new Date(c.endTime || (start.getTime() + duration * 1000));
        addContest(plat, c.title || c.name, c.url, start, end, duration);
      });
    }

    const now = Date.now();
    const valid = liveContests.filter(c => Number.isFinite(c.start.getTime()) && c.end.getTime() > now).sort((a,b) => a.start - b.start);

    if (valid.length > 0) {
      contests = valid;
      sourceIsLive = true;
      localStorage.setItem(STORAGE.cache, JSON.stringify(contests));
    } else {
      throw new Error('No live contests returned');
    }
  } catch (error) {
    console.warn('Live contest feeds unavailable; checking cached schedule.', error);
    const cached = readJson(STORAGE.cache, null);
    if (cached && Array.isArray(cached) && cached.length) {
      const now = Date.now();
      contests = cached.map(c => ({
        ...c,
        start: new Date(c.start),
        end: new Date(c.end)
      })).filter(c => Number.isFinite(c.start.getTime()) && c.end.getTime() > now - 86400000).sort((a,b) => a.start - b.start);
      sourceIsLive = false;
      $('#last-updated').textContent = `Cached schedule · ${new Date().toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})}`;
      $('#last-updated').title = 'Schedule restored from previous sync on this device.';
      render(); setRefreshState(false);
      return;
    }
    contests = sampleContests.map(normalizeContest);
    sourceIsLive = false;
  }
  $('#last-updated').textContent = sourceIsLive ? `Live schedule synced ${new Date().toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})}` : 'Preview schedule · live feed unavailable';
  $('#last-updated').title = sourceIsLive ? 'Live contests across Codeforces, AtCoder, LeetCode, CodeChef & HackerRank' : 'Preview events shown.';
  render(); setRefreshState(false);
}
function setRefreshState(active) { $('#refresh-btn').classList.toggle('spinning', active); }
function durationLabel(seconds) {
  const hrs = Math.floor(seconds / 3600), mins = Math.round((seconds % 3600) / 60), days = Math.floor(hrs / 24);
  if (days) return `${days} day${days > 1 ? 's' : ''}${hrs % 24 ? ` ${hrs % 24} hr` : ''}`;
  if (hrs && mins) return `${hrs} hr ${mins} min`;
  if (hrs) return `${hrs} hr`;
  return `${mins} min`;
}
function formatDate(date) { const now = new Date(); if (date.toDateString() === now.toDateString()) return `Today, ${date.toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})}`; const tomorrow = new Date(now); tomorrow.setDate(now.getDate()+1); if(date.toDateString()===tomorrow.toDateString())return `Tomorrow, ${date.toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})}`; return date.toLocaleDateString([], {weekday:'short',month:'short',day:'numeric'}) + `, ${date.toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})}`; }
function timeUntil(date) {
  const ms = date - Date.now(); if (ms <= 0) return 'Started';
  const d = Math.floor(ms / 86400000), h = Math.floor(ms % 86400000 / 3600000), m = Math.floor(ms % 3600000 / 60000);
  if (d) return `in ${d}d ${h}h`; if(h) return `in ${h}h ${m}m`; return `in ${Math.max(1,m)}m`;
}
function getStatus(c) { const now = Date.now(); if(c.start <= now && c.end > now) return 'live'; if(c.start > now) return 'upcoming'; return 'ended'; }
function renderPlatforms() {
  const counts = {};
  contests.filter(c => getStatus(c) !== 'ended').forEach(c => counts[c.platform] = (counts[c.platform] || 0) + 1);
  const entries = Object.entries(counts).sort(([a],[b])=>a.localeCompare(b));
  $('#platform-list').innerHTML = `<button class="platform-filter ${activePlatform==='all'?'selected':''}" data-platform="all"><span class="platform-dot" style="--brand-color:#c5f36a"></span>All platforms<span class="platform-num">${entries.reduce((n,[,v])=>n+v,0)}</span></button>` + entries.map(([p,n]) => { const meta=platformInfo(p);return `<button class="platform-filter ${activePlatform===p?'selected':''}" data-platform="${escapeHtml(p)}"><span class="platform-dot" style="--brand-color:${meta.color}"></span>${escapeHtml(p)}<span class="platform-num">${n}</span></button>`; }).join('');
  $$('.platform-filter').forEach(btn=>btn.addEventListener('click',()=>{activePlatform=btn.dataset.platform;render();}));
}
function visibleContests() {
  const now = new Date();
  const todayStart = new Date(now); todayStart.setHours(0,0,0,0);
  const tomorrow = new Date(todayStart); tomorrow.setDate(tomorrow.getDate()+1);
  const dayAfterTomorrow = new Date(todayStart); dayAfterTomorrow.setDate(dayAfterTomorrow.getDate()+2);
  const week = new Date(todayStart); week.setDate(week.getDate()+7);
  const query = $('#search-input').value.trim().toLowerCase();
  return contests.filter(c => {
    const status = getStatus(c);
    if(status === 'ended') return false;
    if(activeView === 'live' && status !== 'live') return false;
    if(activeView === 'saved' && !reminders[c.id]) return false;
    if(activePlatform !== 'all' && c.platform !== activePlatform) return false;
    if(activeFilter === 'today' && (c.start < todayStart || c.start >= tomorrow)) return false;
    if(activeFilter === 'tomorrow' && (c.start < tomorrow || c.start >= dayAfterTomorrow)) return false;
    if(activeFilter === 'week' && (c.start < todayStart || c.start >= week)) return false;
    if(query && !`${c.name} ${c.platform}`.toLowerCase().includes(query)) return false;
    return true;
  }).sort((a,b)=>$('#sort-select').value==='duration'?a.duration-b.duration:$('#sort-select').value==='platform'?a.platform.localeCompare(b.platform)||a.start-b.start:a.start-b.start);
}
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); }
function render() {
  const now=Date.now(), upcoming=contests.filter(c=>c.start.getTime()>now).sort((a,b)=>a.start-b.start), live=contests.filter(c=>getStatus(c)==='live');
  $('#stat-live').innerHTML=`${String(live.length).padStart(2,'0')}<span class="stat-unit"> contests</span>`;
  $('#stat-saved').innerHTML=`${String(Object.keys(reminders).length).padStart(2,'0')}<span class="stat-unit"> saved</span>`;
  $('#stat-next').textContent=upcoming.length?timeUntil(upcoming[0].start):'—';
  $('#stat-next-name').textContent=upcoming.length?`${upcoming[0].platform} · ${upcoming[0].name}`:'Looking for your next contest';
  $('#nav-count').textContent=String(contests.filter(c=>getStatus(c)!=='ended').length);
  $('#live-count').textContent=String(live.length);$('#saved-count').textContent=String(Object.keys(reminders).length);
  $('#filter-all-count').textContent=String(contests.filter(c=>getStatus(c)!=='ended').length);
  const visible=visibleContests();
  $('#contest-list').classList.toggle('grid-mode',gridMode);
  $('#contest-list').innerHTML=(showAll?visible:visible.slice(0,6)).map(renderCard).join('');
  $('#empty-state').classList.toggle('hidden',visible.length>0);
  $('#contest-list').classList.toggle('hidden',visible.length===0);
  $('#results-count').textContent=`SHOWING ${Math.min(visible.length,showAll?visible.length:6)} OF ${visible.length} CONTEST${visible.length===1?'':'S'}`;
  $('#show-more').classList.toggle('hidden',visible.length<=6);
  $('#show-more').innerHTML=showAll?'Show fewer contests <span>↑</span>':'Show all contests <span>↓</span>';
  renderPlatforms();
  $$('.remind-btn').forEach(btn=>btn.addEventListener('click',()=>toggleReminder(btn.dataset.id)));
}
function googleCalUrl(c) {
  const pad = n => String(n).padStart(2, '0');
  const toUtc = d => d.getUTCFullYear() + pad(d.getUTCMonth()+1) + pad(d.getUTCDate()) + 'T' + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + 'Z';
  const startStr = toUtc(c.start);
  const endStr = toUtc(c.end);
  const title = encodeURIComponent(`[${c.platform}] ${c.name}`);
  const details = encodeURIComponent(`Coding contest: ${c.name}\nPlatform: ${c.platform}\nContest link: ${c.url}`);
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${startStr}/${endStr}&details=${details}&location=${encodeURIComponent(c.platform)}`;
}
function renderCard(c) {
  const meta=platformInfo(c.platform), live=getStatus(c)==='live', saved=Boolean(reminders[c.id]);
  return `<article class="contest-card ${live?'is-live':''}"><div class="contest-main"><div class="platform-name"><span class="platform-icon" style="--brand-color:${meta.color}">${escapeHtml(meta.short)}</span>${escapeHtml(c.platform)}</div><div class="contest-name" title="${escapeHtml(c.name)}">${escapeHtml(c.name)}${live?'<span class="live-badge">LIVE NOW</span>':''}</div></div><div class="date-cell"><span class="cell-label">STARTS</span><span class="cell-value">${formatDate(c.start)}</span></div><div class="duration-cell"><span class="cell-label">DURATION</span><span class="cell-value">${durationLabel(c.duration)}</span></div><div class="starts-cell"><span class="cell-label">${live?'ENDS':'STARTS IN'}</span><span class="cell-value">${live?timeUntil(c.end):timeUntil(c.start)}</span></div><div class="card-actions"><button class="remind-btn ${saved?'saved':''}" data-id="${escapeHtml(c.id)}">${saved?'Saved':'Remind me'}</button><a class="external-link" href="${googleCalUrl(c)}" target="_blank" rel="noopener" title="Add to Google Calendar (Guaranteed lockscreen reminder)" aria-label="Add to Calendar">📅</a><a class="external-link" href="${safeUrl(c.url)}" target="_blank" rel="noopener" title="Open contest page" aria-label="Open ${escapeHtml(c.name)}">↗</a></div></article>`;
}
function safeUrl(url) { try { const u=new URL(url,location.href); return ['http:','https:'].includes(u.protocol)?u.href:'#'; } catch {return '#';} }
function toggleReminder(id) {
  if(reminders[id]) { delete reminders[id]; toast('Reminder removed from your list.'); }
  else { const contest=contests.find(c=>c.id===id); reminders[id]={lead:Number(localStorage.getItem(STORAGE.lead)||15), notified:false}; toast(`${contest?.platform||'Contest'} added to your reminders.`); }
  persistReminders(); render();
}
function toast(message) { const el=$('#toast');el.textContent=message;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),2500); }
function updateNotificationButton() {
  const enabled=localStorage.getItem(STORAGE.notification)==='yes';
  $('#notification-label').textContent=enabled?'Notifications on':'Enable notifications';
}
function isInstalled() { return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true; }
function showInstallButton() { $('#install-cta').classList.toggle('hidden', isInstalled()); }
async function installApp() {
  if (installPrompt) {
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    showInstallButton();
    return;
  }
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  $('#install-instructions').textContent = isIOS
    ? 'In Safari, tap Share, then choose “Add to Home Screen.” Open Remainder from your Home Screen to install it and enable notifications.'
    : 'Open your browser menu and choose “Install app” or “Add to Home screen.” Then open Remainder from your Home Screen.';
  $('#install-dialog').showModal();
}
async function enableNotifications() {
  if(!('Notification'in window)){toast('Notifications are not supported in this browser.');return;}
  const permission=await Notification.requestPermission();
  if(permission==='granted'){localStorage.setItem(STORAGE.notification,'yes');updateNotificationButton();notifyUser('You’re all set ✳',{body:'Remainder will remind you before contests while this app is open.',tag:'remainder-enabled'});toast('Notifications enabled for this device.');}
  else toast('Notifications are blocked. You can allow them in browser settings.');
}
function notifyUser(title, options) {
  if(serviceWorkerRegistration?.showNotification) serviceWorkerRegistration.showNotification(title, options).catch(()=>new Notification(title, options));
  else new Notification(title, options);
}
function checkReminders() {
  if(!('Notification'in window)||Notification.permission!=='granted')return;
  const now=Date.now();
  for(const c of contests){const reminder=reminders[c.id];if(!reminder)continue;const due=c.start.getTime()-Number(reminder.lead||15)*60000;if(due<=now&&c.start.getTime()>now&&reminder.notified!==true){notifyUser(`${c.name} starts soon`,{body:`${c.platform} · Starts ${formatDate(c.start)}`,icon:'./icon-192.png',tag:c.id});reminders[c.id]={...reminder,notified:true};persistReminders();}}
}
function tick() { render();checkReminders(); }

$$('.nav-item').forEach(item=>item.addEventListener('click',e=>{e.preventDefault();activeView=item.dataset.view;activeFilter='all';$$('.nav-item').forEach(x=>x.classList.toggle('active',x===item));$('#breadcrumb-title').textContent=item.textContent.trim().replace(/\s+\d+$/,'');$('#section-title').innerHTML=`${activeView==='live'?'Happening now':activeView==='saved'?'My reminders':'Upcoming contests'}<span class="title-period">.</span>`;render();}));
$$('.filter-tab').forEach(tab=>tab.addEventListener('click',()=>{$$('.filter-tab').forEach(x=>x.classList.toggle('selected',x===tab));activeFilter=tab.dataset.filter;showAll=false;render();}));
$('#search-input').addEventListener('input',()=>{showAll=false;render();});$('#sort-select').addEventListener('change',render);
$('#refresh-btn').addEventListener('click',loadContests);$('#notification-cta').addEventListener('click',enableNotifications);
$('#view-toggle').addEventListener('click',()=>{gridMode=!gridMode;$('#view-toggle').classList.toggle('grid-active',gridMode);render();});
$('#show-more').addEventListener('click',()=>{showAll=!showAll;render();});$('#clear-filters').addEventListener('click',()=>{activeFilter='all';activeView='all';activePlatform='all';$('#search-input').value='';$$('.filter-tab').forEach(x=>x.classList.toggle('selected',x.dataset.filter==='all'));$$('.nav-item').forEach(x=>x.classList.toggle('active',x.dataset.view==='all'));render();});
$('#settings-open').addEventListener('click',()=>$('#settings-dialog').showModal());$('#reminder-time').value=localStorage.getItem(STORAGE.lead)||'15';
$('#settings-dialog').addEventListener('close',()=>{localStorage.setItem(STORAGE.lead,$('#reminder-time').value);for(const id of Object.keys(reminders))reminders[id].lead=Number($('#reminder-time').value);persistReminders();});
$('#install-cta').addEventListener('click',installApp);
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event;showInstallButton();});
window.addEventListener('appinstalled',()=>{installPrompt=null;showInstallButton();toast('Remainder installed on this phone.');});
$('#mobile-menu').addEventListener('click',()=>$('.sidebar').classList.toggle('open'));document.addEventListener('click',e=>{if(window.innerWidth<=620&&!e.target.closest('.sidebar')&&!e.target.closest('#mobile-menu'))$('.sidebar').classList.remove('open');});
$('#timezone-label').textContent=Intl.DateTimeFormat().resolvedOptions().timeZone.replaceAll('_',' ').toUpperCase();updateNotificationButton();showInstallButton();
if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js').then(registration=>{serviceWorkerRegistration=registration;}).catch(err=>console.info('Service worker unavailable',err));
loadContests();setInterval(tick,15000);setInterval(loadContests,5*60*1000);
