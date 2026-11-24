/* ADG Ambassadeurs — messagerie flottante (texte, image, audio).
   Fichier indépendant : s'il échoue, le reste de l'application n'est pas affecté. Nécessite sql/011 et sql/012.
   Règles (appliquées côté serveur) : ambassadeur ↔ son équipe et son manager uniquement ; manager ↔ son équipe, les autres managers et l'administration ;
   l'administration → managers et ambassadeurs (les ambassadeurs ne peuvent pas lui répondre).
   Stockage : seuls les TEXTES sont enregistrés sur le serveur. Les photos et audios ne sont jamais stockés : ils sont relayés en direct
   (Supabase Realtime, canaux privés) puis gardés dans le téléphone (IndexedDB) de l'expéditeur et du destinataire.
   Aucun numéro de téléphone n'est exposé : on voit le nom enregistré et le poste. */
(function () {
  const S = { key: '', dir: [], by: {}, msgs: [], local: [], lun: {}, reads: {}, univs: {}, chan: null, chIn: null, chTeam: null, poll: null, open: false, view: 'list', cur: null, q: '', rec: null };
  const urls = {};
  let busy = false, dbp = null;
  const $q = s => document.querySelector(s);
  const E = s => (typeof esc === 'function' ? esc(s) : String(s == null ? '' : s));
  const ME = () => { try { return me; } catch (e) { return null; } };
  const SB = () => { try { return sb; } catch (e) { return null; } };
  const eligible = m => !!m && m.active !== false && (m.role === 'admin' || m.role === 'manager' || (m.role === 'ambassador' && m.stage === 'active' && !!m.university_id));
  const poste = p => p.role === 'admin' ? 'Administration' : p.role === 'manager' ? 'Manager' : p.is_chief ? 'Ambassadeur en chef' : 'Ambassadeur';
  const keyOf = m => m.key ? m.key : (m.univ_id ? 'g:' + m.univ_id : 'u:' + (m.sender_id === ME().id ? m.recipient_id : m.sender_id));
  const hm = d => new Date(d).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const dk = d => new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
  const inits = n => String(n || '?').trim().split(' ').filter(Boolean).slice(0, 2).map(w => w.charAt(0).toUpperCase()).join('');
  const uid = () => (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(36).slice(2);
  const note = e => { const t = typeof errMsg === 'function' ? errMsg(e) : ((e && e.message) || 'Erreur'); if (typeof toast === 'function') toast(t); else alert(t); };
  const say = t => { if (typeof toast === 'function') toast(t); };
  const adapt = r => ({ id: r.id, sender_id: r.sender_id, kind: r.kind, body: '', created_at: new Date(r.ts).toISOString(), key: r.key, local: true, dur: r.dur });
  const all = () => S.msgs.concat(S.local.map(adapt));
  const preview = m => { const u = ME(), pre = u && m.sender_id === u.id ? 'Vous : ' : ''; return m.kind === 'image' ? pre + '📷 Photo' : m.kind === 'audio' ? pre + '🎤 Message vocal' : pre + String(m.body).slice(0, 60); };
  const toDataUrl = b => new Promise((res, rej) => { const f = new FileReader(); f.onload = () => res(f.result); f.onerror = () => rej(f.error); f.readAsDataURL(b); });
  const fromDataUrl = (d, mime) => { const bin = atob(d.slice(d.indexOf(',') + 1)), a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return new Blob([a], { type: mime }); };
  const ICON = `<svg viewBox='0 0 24 24' width='28' height='28' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true'><path d='M21 11.5a8.5 8.5 0 0 1-12.6 7.4L3 20.5l1.7-5A8.5 8.5 0 1 1 21 11.5z'/><path d='M8.5 10.5h7M8.5 14h4'/></svg>`;
  const CSS = `#chFab{position:fixed;right:14px;bottom:66px;width:56px;height:56px;border-radius:50%;border:0;background:var(--ac);color:var(--nv);box-shadow:0 6px 18px rgba(0,0,0,.35);z-index:8;display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0}
#chBadge{position:absolute;top:-4px;right:-4px;min-width:20px;height:20px;border-radius:10px;background:var(--ko);color:#fff;font-size:11px;font-weight:700;display:none;align-items:center;justify-content:center;padding:0 5px;border:2px solid var(--bg)}
.chp{position:fixed;top:0;right:0;bottom:0;left:0;z-index:40;background:var(--bg);color:var(--tx);display:none;flex-direction:column}
.chp.on{display:flex}
@media(min-width:700px){.chp{top:auto;left:auto;right:14px;bottom:14px;width:400px;height:min(660px,85vh);border-radius:16px;border:1px solid var(--bd);box-shadow:0 12px 34px rgba(0,0,0,.4);overflow:hidden}}
.chh{display:flex;align-items:center;gap:8px;padding:10px 12px;background:var(--nv);color:#fff;border-bottom:3px solid var(--ac)}
.cht{flex:1;min-width:0;display:flex;flex-direction:column}.cht b{font-size:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.cht small{color:var(--ac);font-size:11px}
.chi{background:rgba(255,255,255,.14);color:#fff;border:0;border-radius:8px;width:34px;height:34px;font-size:16px;padding:0}
.chbody{flex:1;overflow:auto;display:flex;flex-direction:column;min-height:0}
.chs{padding:10px 12px 4px}.chs input{margin:0}
.chsec{padding:10px 14px 4px;font-size:12px;color:var(--mu);text-transform:uppercase;letter-spacing:1px}
.chr{display:flex;align-items:center;gap:10px;width:100%;text-align:left;background:none;border:0;border-bottom:1px solid var(--bd);padding:10px 14px;color:var(--tx);font-size:15px}
.cha{flex:none;width:40px;height:40px;border-radius:50%;background:var(--nv);color:var(--ac);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px}
.chm{flex:1;min-width:0;display:flex;flex-direction:column}.chm b{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.chm small{color:var(--mu);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.chx{display:flex;flex-direction:column;align-items:flex-end;gap:4px;color:var(--mu)}
.chn{background:var(--ko);color:#fff;border-radius:10px;min-width:20px;padding:1px 6px;font-size:11px;text-align:center}
.chempty{color:var(--mu);text-align:center;padding:24px 14px}
.chmsgs{flex:1;overflow:auto;padding:10px 10px 6px}
.chday{text-align:center;color:var(--mu);font-size:11px;margin:10px 0 6px}
.chb2{display:flex;margin:4px 0}.chb2.me{justify-content:flex-end}
.chbub{max-width:82%;background:var(--card);border:1px solid var(--bd);border-radius:14px;padding:7px 10px;display:flex;flex-direction:column;gap:3px}
.chb2.me .chbub{background:var(--ac);color:var(--nv);border-color:var(--ac)}
.chwho{font-size:11px;font-weight:700;color:var(--lk)}
.chb2.me .chwho{color:var(--nv)}
.chtx{white-space:pre-wrap;word-break:break-word}
.chimg{max-width:100%;max-height:260px;border-radius:10px;cursor:pointer;background:var(--bd);min-height:60px}
.chbub audio{width:220px;max-width:100%}
.cht2{align-self:flex-end;font-size:10px;opacity:.7}
.chc{display:none;align-items:center;gap:6px;padding:8px 10px;border-top:1px solid var(--bd);background:var(--card)}
.chc input#chIn{flex:1;margin:0;min-width:0}
.chi2{flex:none;width:38px;height:38px;border-radius:50%;border:1px solid var(--bd);background:var(--bg);display:flex;align-items:center;justify-content:center;font-size:18px;cursor:pointer;padding:0}
.chbtn{flex:none;border:1px solid var(--bd);background:transparent;color:var(--tx);border-radius:10px;padding:9px 12px;font-size:15px}
.chbtn.chok{background:var(--ac);color:var(--nv);border:0;font-weight:700}
.chrec{flex:1;color:var(--ko)}
.chro{flex:1;color:var(--mu);font-size:13px;text-align:center}`;

  /* ---------- Stockage local des photos et audios (dans le téléphone) ---------- */
  function idb() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => { try { const rq = indexedDB.open('adg-chat-media', 1); rq.onupgradeneeded = () => { rq.result.createObjectStore('media', { keyPath: 'id' }); }; rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error); } catch (e) { rej(e); } });
    return dbp;
  }
  async function dbPut(rec) { try { const d = await idb(); await new Promise((res, rej) => { const t = d.transaction('media', 'readwrite'); t.objectStore('media').put(rec); t.oncomplete = res; t.onerror = () => rej(t.error); }); } catch (e) {} }
  async function dbLoad(owner) { try { const d = await idb(); return await new Promise((res, rej) => { const r = d.transaction('media').objectStore('media').getAll(); r.onsuccess = () => res((r.result || []).filter(x => x.owner === owner)); r.onerror = () => rej(r.error); }); } catch (e) { return []; } }
  function localUrl(id) { if (urls[id]) return urls[id]; const r = S.local.find(x => x.id === id); if (!r) return ''; urls[id] = URL.createObjectURL(r.blob); return urls[id]; }

  /* ---------- Interface ---------- */
  function mount() {
    if ($q('#chRoot')) return;
    if (!$q('#chCss')) { const st = document.createElement('style'); st.id = 'chCss'; st.textContent = CSS; document.head.appendChild(st); }
    const r = document.createElement('div'); r.id = 'chRoot';
    r.innerHTML = `<button id='chFab' type='button' data-act='open' aria-label='Messagerie' title='Messagerie'>${ICON}<span id='chBadge'></span></button><div class='chp' id='chPanel'><div class='chh'><button type='button' class='chi' id='chBack' data-act='back' aria-label='Retour'>←</button><div class='cht'><b id='chTitle'>Messages</b><small id='chSub'></small></div><button type='button' class='chi' data-act='close' aria-label='Fermer'>✕</button></div><div class='chbody' id='chBody'></div><div class='chc' id='chComposer'></div></div>`;
    document.body.appendChild(r);
    r.addEventListener('click', onClick); r.addEventListener('input', onInput); r.addEventListener('change', onChange); r.addEventListener('keydown', onKey);
  }
  function unmount() { stopRec(true); const r = $q('#chRoot'); if (r) r.remove(); }
  function onClick(e) {
    const t = e.target.closest('[data-act]'); if (!t) return;
    const a = t.getAttribute('data-act'), id = t.getAttribute('data-id');
    if (a === 'open') openPanel();
    else if (a === 'close') closePanel();
    else if (a === 'back') showList();
    else if (a === 'conv') openConv(t.getAttribute('data-type'), id);
    else if (a === 'send') sendText();
    else if (a === 'rec') startRec();
    else if (a === 'rec-cancel') stopRec(true);
    else if (a === 'rec-send') stopRec(false);
    else if (a === 'zoom') zoom(t);
  }
  function onInput(e) { if (e.target.id === 'chQ') { S.q = e.target.value; renderList(); } }
  function onChange(e) { if (e.target.id === 'chImg') { const f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) sendImage(f); } }
  function onKey(e) { if (e.target.id === 'chIn' && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendText(); } }

  /* ---------- Données ---------- */
  async function loadDir() { const r = await SB().rpc('chat_directory'); S.dir = r.data || []; S.by = {}; S.dir.forEach(p => { S.by[p.id] = p; }); }
  async function loadUnivs() { const r = await SB().from('universities').select('id,name'); S.univs = {}; (r.data || []).forEach(u => { S.univs[u.id] = u.name; }); }
  async function loadMsgs() { const r = await SB().from('chat_messages').select('*').order('created_at', { ascending: false }).limit(500); if (r.data) S.msgs = r.data.slice().reverse(); }
  async function loadReads() { const r = await SB().from('chat_reads').select('*'); S.reads = {}; (r.data || []).forEach(x => { S.reads[x.conv_key] = x.last_read_at; }); }
  const lastRead = k => S.reads[k] ? new Date(S.reads[k]).getTime() : 0;
  const unreadOf = k => S.msgs.filter(m => keyOf(m) === k && m.sender_id !== ME().id && new Date(m.created_at).getTime() > lastRead(k)).length + (S.lun[k] || 0);
  function badge() {
    const u = ME(); if (!u) return;
    let n = S.msgs.filter(x => x.sender_id !== u.id && new Date(x.created_at).getTime() > lastRead(keyOf(x))).length;
    Object.keys(S.lun).forEach(k => { n += S.lun[k]; });
    const b = $q('#chBadge');
    if (b) { b.textContent = n > 99 ? '99+' : String(n); b.style.display = n ? 'flex' : 'none'; }
  }
  async function markRead(k) { S.lun[k] = 0; badge(); const r = await SB().rpc('chat_mark_read', { p_key: k }); if (!r.error && r.data) { S.reads[k] = r.data; badge(); } }
  async function refresh() { const n = S.msgs.length; await Promise.all([loadMsgs(), loadDir()]); badge(); if (S.open && S.msgs.length !== n) render(); }
  function render() { if (S.view === 'thread') renderThread(); else renderList(); }

  /* ---------- Liste des conversations ---------- */
  function catOf(p) {
    const u = ME();
    if (p.role === 'admin') return [1, 'Administration'];
    if (p.role === 'manager') return u.role === 'admin' ? [2, 'Managers'] : (u.role === 'ambassador' ? [2, 'Mon manager'] : [4, 'Autres managers']);
    return [3, u.role === 'admin' ? 'Ambassadeurs' : 'Mon équipe'];
  }
  function convs() {
    const u = ME(), out = [];
    if (u.university_id && u.role !== 'admin') out.push({ type: 'g', id: u.university_id, key: 'g:' + u.university_id, name: '👥 Équipe ' + (S.univs[u.university_id] || ''), sub: 'Discussion de groupe', cat: [0, ''] });
    S.dir.forEach(p => { out.push({ type: 'u', id: p.id, key: 'u:' + p.id, name: p.full_name, sub: poste(p) + (p.role !== 'admin' && p.university_name ? ' · ' + p.university_name : ''), cat: catOf(p) }); });
    return out;
  }
  function showList() {
    stopRec(true); S.view = 'list'; S.cur = null;
    $q('#chBack').style.visibility = 'hidden'; $q('#chTitle').textContent = 'Messages'; $q('#chSub').textContent = '';
    $q('#chComposer').style.display = 'none';
    $q('#chBody').innerHTML = `<div class='chs'><input id='chQ' type='search' placeholder='Rechercher une personne…' value='${E(S.q)}'></div><div id='chList'></div>`;
    renderList();
  }
  function renderList() {
    const box = $q('#chList'); if (!box) return;
    const q = S.q.trim().toLowerCase(), msgs = all();
    const items = convs().filter(c => !q || c.name.toLowerCase().indexOf(q) >= 0);
    items.forEach(c => { const l = msgs.filter(m => keyOf(m) === c.key).sort((a, b) => new Date(a.created_at) - new Date(b.created_at)); c.last = l.length ? l[l.length - 1] : null; c.un = unreadOf(c.key); });
    items.sort((a, b) => a.cat[0] - b.cat[0] || (b.last ? new Date(b.last.created_at).getTime() : 0) - (a.last ? new Date(a.last.created_at).getTime() : 0) || a.name.localeCompare(b.name));
    let h = '', cur = -1;
    items.forEach(c => {
      if (c.cat[0] !== cur) { cur = c.cat[0]; if (c.cat[1]) h += `<div class='chsec'>${E(c.cat[1])}</div>`; }
      h += `<button type='button' class='chr' data-act='conv' data-type='${c.type}' data-id='${c.id}'><span class='cha'>${c.type === 'g' ? '👥' : E(inits(c.name))}</span><span class='chm'><b>${E(c.name)}</b><small>${E(c.sub)}</small>${c.last ? `<small>${E(preview(c.last))}</small>` : ''}</span><span class='chx'>${c.last ? `<small>${hm(c.last.created_at)}</small>` : ''}${c.un ? `<span class='chn'>${c.un}</span>` : ''}</span></button>`;
    });
    box.innerHTML = h || `<p class='chempty'>Personne à qui écrire pour le moment.</p>`;
  }

  /* ---------- Conversation ---------- */
  function openConv(type, id) {
    const key = (type === 'g' ? 'g:' : 'u:') + id, p = type === 'u' ? S.by[id] : null;
    S.cur = { type, id, key, canWrite: type === 'g' || !p || p.can_write !== false, name: type === 'g' ? 'Équipe ' + (S.univs[id] || '') : (p ? p.full_name : 'Contact'), sub: type === 'g' ? (S.dir.filter(x => x.same_team && x.role !== 'admin').length + 1) + ' membres' : (p ? poste(p) + (p.role !== 'admin' && p.university_name ? ' · ' + p.university_name : '') : '') };
    S.view = 'thread';
    $q('#chBack').style.visibility = 'visible'; $q('#chTitle').textContent = S.cur.name; $q('#chSub').textContent = S.cur.sub;
    $q('#chBody').innerHTML = `<div class='chmsgs' id='chMsgs'></div>`;
    renderComposer(); renderThread(true); markRead(key);
  }
  function bubble(x, grp) {
    const mine = x.sender_id === ME().id, who = S.by[x.sender_id];
    let c = '';
    if (x.kind === 'text') c = `<span class='chtx'>${E(x.body)}</span>`;
    else if (x.kind === 'image') c = `<img class='chimg' data-l='${E(x.id)}' data-act='zoom' alt='Photo'>`;
    else c = `<audio controls preload='metadata' data-l='${E(x.id)}'></audio>`;
    const head = grp && !mine ? `<span class='chwho'>${E(who ? who.full_name : 'Ancien membre')}${who ? ' · ' + E(poste(who)) : ''}</span>` : '';
    return `<div class='chb2 ${mine ? 'me' : ''}' data-mid='${x.id}'><div class='chbub'>${head}${c}<small class='cht2'>${hm(x.created_at)}</small></div></div>`;
  }
  function fillMedia(box) { box.querySelectorAll('[data-l]').forEach(el => { const u = localUrl(el.getAttribute('data-l')); if (u && el.getAttribute('src') !== u) el.setAttribute('src', u); }); }
  function renderThread(stick) {
    const box = $q('#chMsgs'); if (!box || !S.cur) return;
    const near = stick || box.scrollHeight - box.scrollTop - box.clientHeight < 80, grp = S.cur.type === 'g';
    let h = '', day = '';
    all().filter(x => keyOf(x) === S.cur.key).sort((a, b) => new Date(a.created_at) - new Date(b.created_at)).forEach(x => { const d = dk(x.created_at); if (d !== day) { day = d; h += `<div class='chday'>${d}</div>`; } h += bubble(x, grp); });
    box.setAttribute('data-day', day);
    box.innerHTML = h || `<p class='chempty'>Aucun message.${S.cur.canWrite ? ' Écrivez le premier !' : ''}</p>`;
    fillMedia(box); if (near) box.scrollTop = box.scrollHeight;
  }
  function appendMsg(x) {
    const box = $q('#chMsgs'); if (!box || !S.cur || keyOf(x) !== S.cur.key) return;
    if (box.querySelector(`[data-mid='${x.id}']`)) return;
    const emp = box.querySelector('.chempty'); if (emp) emp.remove();
    const near = box.scrollHeight - box.scrollTop - box.clientHeight < 120 || x.sender_id === ME().id, d = dk(x.created_at);
    let h = ''; if (box.getAttribute('data-day') !== d) { h += `<div class='chday'>${d}</div>`; box.setAttribute('data-day', d); }
    const w = document.createElement('div'); w.innerHTML = h + bubble(x, S.cur.type === 'g');
    while (w.firstChild) box.appendChild(w.firstChild);
    fillMedia(box); if (near) box.scrollTop = box.scrollHeight;
  }
  function renderComposer() {
    const c = $q('#chComposer'); c.style.display = 'flex';
    if (S.cur && !S.cur.canWrite) { c.innerHTML = `<span class='chro'>Message de l'administration : vous ne pouvez pas répondre ici.</span>`; return; }
    if (S.rec) { c.innerHTML = `<span class='chrec'>🔴 Enregistrement <b id='chT'>0:00</b></span><button type='button' class='chbtn' data-act='rec-cancel'>Annuler</button><button type='button' class='chbtn chok' data-act='rec-send'>Envoyer</button>`; return; }
    c.innerHTML = `<label class='chi2' for='chImg' title='Photo'>📷</label><input type='file' id='chImg' accept='image/*' style='display:none'><input id='chIn' placeholder='Écrire un message…' maxlength='2000' autocomplete='off'><button type='button' class='chi2' data-act='rec' title='Message vocal'>🎤</button><button type='button' class='chbtn chok' data-act='send'>➤</button>`;
  }

  /* ---------- Envoi : texte = serveur ; photo/audio = relais direct puis téléphone ---------- */
  async function sendText() {
    const inp = $q('#chIn'), c = S.cur; if (!inp || !c || busy) return;
    const t = inp.value.trim(); if (!t) return;
    busy = true; inp.value = '';
    try {
      const r = await SB().rpc('chat_send_text', { p_to: c.type === 'u' ? c.id : null, p_univ: c.type === 'g' ? c.id : null, p_body: t });
      if (r.error) throw r.error;
      const m = { id: r.data, sender_id: ME().id, recipient_id: c.type === 'u' ? c.id : null, univ_id: c.type === 'g' ? c.id : null, kind: 'text', body: t, created_at: new Date().toISOString() };
      if (!S.msgs.some(x => x.id === m.id)) { S.msgs.push(m); appendMsg(m); }
    } catch (e) { inp.value = t; note(e); }
    busy = false;
  }
  function subscribeCh(ch) {
    return new Promise((res, rej) => {
      let done = false;
      const tm = setTimeout(() => { if (!done) { done = true; rej(new Error(`Connexion impossible.`)); } }, 8000);
      ch.subscribe(st => {
        if (done) return;
        if (st === 'SUBSCRIBED') { done = true; clearTimeout(tm); res(ch); }
        else if (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT' || st === 'CLOSED') { done = true; clearTimeout(tm); rej(new Error(`Envoi non autorisé ou connexion impossible.`)); }
      });
    });
  }
  async function sendMedia(kind, blob, dur) {
    const c = S.cur, u = ME(); if (!c || !c.canWrite) return;
    const data = await toDataUrl(blob);
    if (data.length > 1200000) throw new Error(`Fichier trop lourd pour l'envoi.`);
    const payload = { id: uid(), kind, sender_id: u.id, name: u.full_name, role: u.role, ts: Date.now(), dur: dur || 0, mime: blob.type, data, univ: c.type === 'g' ? c.id : null };
    let ch = null, own = false;
    if (c.type === 'g' && S.chTeam) ch = S.chTeam;
    else { ch = SB().channel('inbox:' + c.id, { config: { private: true, broadcast: { ack: true } } }); own = true; await subscribeCh(ch).catch(e => { SB().removeChannel(ch); throw e; }); }
    let r; try { r = await ch.send({ type: 'broadcast', event: 'media', payload }); } finally { if (own) SB().removeChannel(ch); }
    if (r !== 'ok') throw new Error(`Envoi impossible. Réessayez.`);
    const rec = { id: payload.id, owner: u.id, key: c.key, sender_id: u.id, kind, dur: payload.dur, ts: payload.ts, mime: blob.type, blob };
    S.local.push(rec); dbPut(rec); appendMsg(adapt(rec));
    say(`Envoyé : le destinataire le reçoit s'il est connecté.`);
  }
  async function sendImage(f) {
    if (busy) return; busy = true;
    try { const blob = await shrink(f); await sendMedia('image', blob, 0); } catch (e) { note(e); }
    busy = false;
  }
  async function startRec() {
    if (S.rec || busy) return;
    if (!navigator.mediaDevices || !window.MediaRecorder) return note({ message: `L'enregistrement audio n'est pas pris en charge par ce navigateur.` });
    let stream; try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch (e) { return note({ message: `Micro indisponible ou refusé.` }); }
    const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
    const mime = types.find(t => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) || '';
    const opts = { audioBitsPerSecond: 24000 }; if (mime) opts.mimeType = mime;
    let mr; try { mr = new MediaRecorder(stream, opts); } catch (e) { mr = new MediaRecorder(stream); }
    const r = { mr, stream, chunks: [], t0: Date.now(), cancel: false, tm: null, done: false };
    mr.ondataavailable = ev => { if (ev.data && ev.data.size) r.chunks.push(ev.data); };
    mr.onstop = () => finishRec(r);
    S.rec = r; mr.start(); renderComposer();
    r.tm = setInterval(() => { const s = Math.floor((Date.now() - r.t0) / 1000), el = $q('#chT'); if (el) el.textContent = Math.floor(s / 60) + ':' + (s % 60 < 10 ? '0' : '') + (s % 60); if (s >= 60) stopRec(false); }, 500);
  }
  function stopRec(cancel) {
    const r = S.rec; if (!r) return;
    r.cancel = !!cancel; clearInterval(r.tm);
    try { if (r.mr.state !== 'inactive') r.mr.stop(); else finishRec(r); } catch (e) { finishRec(r); }
  }
  async function finishRec(r) {
    if (r.done) return; r.done = true;
    r.stream.getTracks().forEach(t => t.stop());
    if (S.rec === r) S.rec = null;
    if (S.view === 'thread' && $q('#chComposer')) renderComposer();
    if (r.cancel || !r.chunks.length) return;
    const type = (r.mr.mimeType || 'audio/webm').split(';')[0], dur = Math.round((Date.now() - r.t0) / 1000);
    if (dur < 1) return;
    busy = true;
    try { await sendMedia('audio', new Blob(r.chunks, { type }), dur); } catch (e) { note(e); }
    busy = false;
  }
  function zoom(el) {
    const u = el.getAttribute('src'); if (!u) return;
    const z = document.createElement('div'); z.className = 'modal'; z.style.zIndex = '60';
    z.innerHTML = `<div style='background:transparent;padding:0;max-width:96vw'><img src='${E(u)}' alt='Photo'></div>`;
    z.addEventListener('click', () => z.remove()); document.body.appendChild(z);
  }

  /* ---------- Réception en direct, ouverture, cycle de vie ---------- */
  function onNew(x) {
    const u = ME(); if (!u || S.msgs.some(y => y.id === x.id)) return;
    S.msgs.push(x);
    if (!S.by[x.sender_id] && x.sender_id !== u.id) loadDir();
    const k = keyOf(x), mine = x.sender_id === u.id;
    if (S.open && S.view === 'thread' && S.cur && S.cur.key === k) { appendMsg(x); if (!mine) markRead(k); return; }
    if (!mine) { const w = S.by[x.sender_id]; say(`💬 ${w ? w.full_name : 'Nouveau message'} : ${preview(x)}`); }
    badge(); if (S.open && S.view === 'list') renderList();
  }
  function onMedia(p) {
    const u = ME(); if (!u || !p || !p.id || !p.data || p.sender_id === u.id || String(p.data).length > 1600000) return;
    if (S.local.some(x => x.id === p.id)) return;
    if (p.univ && p.univ !== u.university_id) return;
    const kind = p.kind === 'audio' ? 'audio' : 'image', key = p.univ ? 'g:' + p.univ : 'u:' + p.sender_id;
    const mime = kind === 'audio' ? (String(p.mime).indexOf('audio/') === 0 ? p.mime : 'audio/webm') : 'image/jpeg';
    let rec; try { rec = { id: String(p.id), owner: u.id, key, sender_id: p.sender_id, kind, dur: Number(p.dur) || 0, ts: Number(p.ts) || Date.now(), mime, blob: fromDataUrl(p.data, mime) }; } catch (e) { return; }
    S.local.push(rec); dbPut(rec);
    if (!S.by[p.sender_id]) {
      if (p.role === 'admin') { const en = { id: p.sender_id, full_name: p.name || 'Administration', role: 'admin', is_chief: false, university_name: '', can_write: false }; S.by[en.id] = en; S.dir.push(en); }
      else loadDir();
    }
    if (S.open && S.view === 'thread' && S.cur && S.cur.key === key) { appendMsg(adapt(rec)); return; }
    S.lun[key] = (S.lun[key] || 0) + 1;
    const w = S.by[p.sender_id]; say(`💬 ${w ? w.full_name : 'Nouveau message'} : ${preview(adapt(rec))}`);
    badge(); if (S.open && S.view === 'list') renderList();
  }
  function openPanel() { S.open = true; $q('#chPanel').classList.add('on'); showList(); refresh(); }
  function closePanel() { S.open = false; stopRec(true); const p = $q('#chPanel'); if (p) p.classList.remove('on'); }
  function listen(topic, key) {
    const ch = SB().channel(topic, { config: { private: true, broadcast: { ack: true } } }).on('broadcast', { event: 'media' }, m => onMedia(m.payload));
    ch.subscribe();
    return ch;
  }
  async function init() {
    mount();
    const u = ME(); if (!u) return;
    await Promise.all([loadDir(), loadUnivs(), loadMsgs(), loadReads(), dbLoad(u.id).then(r => { S.local = r; })]);
    badge(); if (S.open) render();
    S.chan = SB().channel('chat-' + u.id).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, p => onNew(p.new)).subscribe();
    try { const ss = await SB().auth.getSession(); if (ss.data && ss.data.session && SB().realtime && SB().realtime.setAuth) SB().realtime.setAuth(ss.data.session.access_token); } catch (e) {}
    S.chIn = listen('inbox:' + u.id);
    if (u.university_id && u.role !== 'admin') S.chTeam = listen('team:' + u.university_id);
    S.poll = setInterval(refresh, 45000);
  }
  function teardown() {
    [S.chan, S.chIn, S.chTeam].forEach(c => { if (c) { try { SB().removeChannel(c); } catch (e) {} } });
    clearInterval(S.poll); unmount();
    Object.keys(urls).forEach(k => { try { URL.revokeObjectURL(urls[k]); } catch (e) {} delete urls[k]; });
    S.dir = []; S.by = {}; S.msgs = []; S.local = []; S.lun = {}; S.reads = {}; S.chan = null; S.chIn = null; S.chTeam = null; S.poll = null; S.open = false; S.view = 'list'; S.cur = null; S.q = ''; S.rec = null; busy = false;
  }
  function tick() {
    const u = ME(), k = eligible(u) ? [u.id, u.role, u.stage, u.university_id, u.active].join(':') : '';
    if (k === S.key) return;
    teardown(); S.key = k;
    if (k) init().catch(() => {});
  }
  setInterval(tick, 1500);
})();
