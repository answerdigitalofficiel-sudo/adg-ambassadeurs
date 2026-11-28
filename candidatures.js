/* Candidatures : lien commun pour postuler (page candidat ?postuler=JETON) + onglet admin « 📨 Candidatures »
   Base : migration 018 (rc_calls, rc_applications, bucket rc-cv) */
(function () {
  const QA = new URLSearchParams(location.search).get('postuler') || '';
  const E = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const T = m => { if (typeof toast === 'function') toast(m); else alert(m); };
  const $q = s => document.querySelector(s);
  const fmt = iso => new Date(iso).toLocaleString('fr-FR', { dateStyle: 'full', timeStyle: 'short' });
  const left = ms => {
    const s = Math.max(0, Math.floor(ms / 1000)), d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return (d ? d + ' j ' : '') + (d || h ? h + ' h ' : '') + m + ' min' + (d ? '' : ' ' + x + ' s');
  };
  const waLink = (ph, txt) => 'https://wa.me/' + String(ph || '').replace(/[^0-9]/g, '') + (txt ? '?text=' + encodeURIComponent(txt) : '');

  /* ====================== PAGE CANDIDAT ====================== */
  const CSS = '<style>.rc{max-width:560px;margin:0 auto;padding:16px 14px 40px}.rc .logo{text-align:center;margin:8px 0 12px}.rcb{background:var(--card);border:1px solid var(--bd);border-radius:12px;padding:10px 12px;margin:10px 0;font-size:14px}.rc label{display:block;margin:12px 0 4px;font-weight:600;font-size:14px}.rc label small{font-weight:400;opacity:.7}.rc input{width:100%;box-sizing:border-box}</style>';
  const wrap = body => CSS + `<div class='rc'><div class='logo'>${typeof LOGO === 'function' ? LOGO(56) : ''}</div>${body}</div>`;
  let info = null, off = 0, view = '', busy = false;
  const nowMs = () => Date.now() + off;
  const isOpen = () => !!info && info.open && new Date(info.closes_at).getTime() > nowMs();
  const setInfo = d => { info = d; off = new Date(d.now).getTime() - Date.now(); };

  async function run() {
    const r = await sb.rpc('rc_info', { p_token: QA });
    if (r.error || !r.data) return invalid();
    setInfo(r.data);
    if (isOpen()) form(); else closed();
    setInterval(tick, 1000);
    setInterval(refresh, 30000);
  }

  async function refresh() {
    if (view === 'done') return;
    const r = await sb.rpc('rc_info', { p_token: QA });
    if (r.error || !r.data) return;
    setInfo(r.data);
    if (view === 'form' && !isOpen()) return closed();
    if (view === 'closed' && isOpen()) return form();
    const d = $q('#rcd'); if (d) d.textContent = fmt(info.closes_at);
  }

  function tick() {
    if (!info || view !== 'form') return;
    const rem = new Date(info.closes_at).getTime() - nowMs();
    if (rem <= 0) return closed();
    const el = $q('#rcl'); if (el) el.textContent = 'Temps restant : ' + left(rem);
  }

  function invalid() { view = 'closed'; $q('#app').innerHTML = wrap(`<div class='card'><h2>Lien non valide</h2><p>Ce lien de candidature n'est pas valide. Demandez-le de nouveau à l'équipe Answer Digital.</p></div>`); }

  function closed() {
    view = 'closed';
    $q('#app').innerHTML = wrap(`<div class='card'><h2>${E(info.title)}</h2><p><b>Les candidatures sont closes.</b></p><p class='mu'>La date limite était fixée au ${E(fmt(info.closes_at))}. Si le délai est prolongé, cette page se rouvrira.</p></div>`);
  }

  function form() {
    view = 'form';
    $q('#app').innerHTML = wrap(`<div class='card'><h2>${E(info.title)}</h2><div class='rcb'>⏳ Candidatures ouvertes jusqu'au <b id='rcd'>${E(fmt(info.closes_at))}</b><br><small id='rcl'></small></div>` +
      `<form onsubmit='ADG_RC.submit(event)' novalidate>` +
      `<label>Nom *</label><input id='cn' autocomplete='family-name'>` +
      `<label>Post-nom <small>(facultatif)</small></label><input id='cm'>` +
      `<label>Prénom *</label><input id='cp' autocomplete='given-name'>` +
      `<label>Adresse *</label><input id='ca' autocomplete='street-address' placeholder='Commune, quartier, avenue, n°'>` +
      `<label>Date de naissance *</label><input id='cb' type='date'>` +
      `<label>Numéro WhatsApp *</label><input id='cw' type='tel' inputmode='tel' placeholder='Ex. 0812345678' autocomplete='tel'>` +
      `<label>Adresse e-mail <small>(facultative, mais recommandée)</small></label><input id='ce' type='email' autocomplete='email'>` +
      `<label>CV <small>(facultatif · PDF, Word ou image · 5 Mo max)</small></label><input id='cv' type='file' accept='.pdf,.doc,.docx,.jpg,.jpeg,.png'>` +
      `<p id='cer' class='err'></p><button class='p' id='csb'>Envoyer ma candidature</button></form></div>`);
    tick();
  }

  function errMsg(m) {
    return /NOM_INVALIDE/.test(m) ? 'Entrez votre nom.' : /PRENOM_INVALIDE/.test(m) ? 'Entrez votre prénom.' : /ADRESSE_INVALIDE/.test(m) ? 'Entrez votre adresse complète.' : /DATE_INVALIDE/.test(m) ? 'Entrez une date de naissance valide.' : /TELEPHONE_INVALIDE/.test(m) ? 'Entrez un numéro WhatsApp valide (ex. 0812345678).' : /EMAIL_INVALIDE/.test(m) ? "Cette adresse e-mail n'est pas valide." : /DEJA_CANDIDAT/.test(m) ? 'Une candidature a déjà été envoyée avec ce numéro WhatsApp ou cet e-mail.' : 'Erreur : ' + m;
  }

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    const v = id => ($q('#' + id).value || '').trim();
    const ph = v('cw').replace(/[^0-9+]/g, ''), em = v('ce'), bd = v('cb'), f = $q('#cv').files[0];
    const err = v('cn').length < 2 ? 'Entrez votre nom.' : v('cp').length < 2 ? 'Entrez votre prénom.' : v('ca').length < 5 ? 'Entrez votre adresse complète.' : !bd ? 'Entrez votre date de naissance.' : !/^([+][0-9]{8,15}|00[0-9]{8,15}|243[0-9]{9}|0[0-9]{9}|[0-9]{9})$/.test(ph) ? 'Entrez un numéro WhatsApp valide (ex. 0812345678).' : (em && !/^[^@ ]+@[^@ ]+[.][^@ ]+$/.test(em)) ? "Cette adresse e-mail n'est pas valide." : (f && f.size > 5242880) ? 'Le CV dépasse 5 Mo.' : '';
    if (err) { $q('#cer').textContent = err; return; }
    busy = true; const b = $q('#csb'); b.disabled = true; b.textContent = 'Envoi en cours…'; $q('#cer').textContent = '';
    const r = await sb.rpc('rc_apply', { p_token: QA, p_last: v('cn'), p_middle: v('cm'), p_first: v('cp'), p_address: v('ca'), p_birth: bd, p_phone: v('cw'), p_email: em });
    if (r.error) {
      busy = false;
      const m = r.error.message || '';
      if (/CLOS/.test(m)) { info.open = false; return closed(); }
      if (/LIEN_INVALIDE/.test(m)) return invalid();
      b.disabled = false; b.textContent = 'Envoyer ma candidature'; $q('#cer').textContent = errMsg(m);
      return;
    }
    let cvOk = null;
    if (f) {
      try {
        const ext = (f.name.split('.').pop() || 'pdf').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'pdf';
        const path = r.data + '/cv-' + Date.now() + '.' + ext;
        const up = await sb.storage.from('rc-cv').upload(path, f, { contentType: f.type || undefined });
        if (up.error) cvOk = false;
        else { const at = await sb.rpc('rc_attach_cv', { p_id: r.data, p_path: path }); cvOk = !at.error && !!at.data; }
      } catch (x) { cvOk = false; }
    }
    busy = false;
    done(v('cp'), cvOk);
  }

  function done(first, cvOk) {
    view = 'done';
    $q('#app').innerHTML = wrap(`<div class='card' style='text-align:center'><h2>✅ Merci ${E(first)} !</h2><p>Votre candidature a bien été reçue. Nous vous contacterons par WhatsApp (et par e-mail si vous en avez indiqué un).</p>` +
      (cvOk === false ? `<p class='mu'>Votre CV n'a pas pu être envoyé : vous pourrez le transmettre lorsque nous vous contacterons.</p>` : '') +
      `<p class='mu'><small>Vous pouvez fermer cette page.</small></p></div>`);
  }

  /* ====================== ONGLET ADMIN ====================== */
  const sc = { calls: [], apps: [], sel: null, loaded: false, err: '', filter: 'all', q: '' };
  const ST = { new: ['Nouvelle', '#2563eb'], contacted: ['Contactée', '#d97706'], shortlisted: ['Présélectionnée', '#16a34a'], rejected: ['Refusée', '#6b7280'] };
  const tag = (txt, c) => `<span style='background:${c};color:#fff;padding:2px 8px;border-radius:99px;font-size:12px'>${txt}</span>`;
  const cur = () => sc.calls.find(x => x.id === sc.sel) || sc.calls[0];
  const linkOf = c => location.origin + location.pathname.replace('index.html', '') + '?postuler=' + c.token;
  const toLocal = x => { const d = new Date(x); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
  const fullName = a => [a.first_name, (a.last_name || '').toUpperCase(), (a.middle_name || '').toUpperCase()].filter(Boolean).join(' ');
  const age = d => { const b = new Date(d), n = new Date(); let a = n.getFullYear() - b.getFullYear(); if (n < new Date(n.getFullYear(), b.getMonth(), b.getDate())) a--; return a; };

  async function load() {
    const [c, a] = await Promise.all([
      sb.from('rc_calls').select('*').order('created_at', { ascending: false }),
      sb.from('rc_applications').select('*').order('created_at', { ascending: false })
    ]);
    const er = c.error || a.error;
    sc.err = er ? (/relation|does not exist|schema cache/i.test(er.message) ? 'SQL' : er.message) : '';
    sc.calls = c.data || []; sc.apps = a.data || []; sc.loaded = true;
  }

  function listHtml() {
    const c = cur(); if (!c) return '';
    const q = sc.q.trim().toLowerCase();
    const rows = sc.apps.filter(a => a.call_id === c.id && (sc.filter === 'all' || a.status === sc.filter) && (!q || (fullName(a) + ' ' + a.phone + ' ' + a.email + ' ' + a.address).toLowerCase().includes(q)));
    return rows.map(a => {
      const s = ST[a.status] || ST.new;
      const mail = a.email ? ` · <a href='mailto:${E(a.email)}' onclick='event.stopPropagation()'>✉ ${E(a.email)}</a>` : '';
      return `<div class='row' style='align-items:flex-start;cursor:pointer' data-id='${a.id}' onclick='ADG_RC.open(this.dataset.id)'><div style='flex:1'><b>${E(fullName(a))}</b><br><small><a href='${waLink(a.phone)}' target='_blank' rel='noopener' onclick='event.stopPropagation()'>💬 ${E(a.phone)}</a>${mail}</small><br><small class='mu'>${age(a.birth_date)} ans · ${E(a.address)}</small></div><div style='text-align:right'>${tag(s[0], s[1])}<br><small class='mu'>${new Date(a.created_at).toLocaleDateString('fr-FR')}${a.cv_path ? ' · 📄 CV' : ''}</small></div></div>`;
    }).join('') || `<p class='mu'>Aucune candidature.</p>`;
  }

  function render() {
    if (sc.err === 'SQL') return `<div class='card'><h2>📨 Candidatures</h2><p>La base n'est pas prête : la migration des candidatures n'a pas été appliquée.</p></div>`;
    if (sc.err) return `<div class='card'><p class='err'>${E(sc.err)}</p></div>`;
    const c = cur();
    let h = '';
    if (sc.calls.length > 1) h += `<div class='acts' style='flex-wrap:wrap;margin-bottom:10px'>${sc.calls.slice(0, 8).map(x => `<button class='${c && x.id === c.id ? 'p' : 's'}' data-id='${x.id}' onclick='ADG_RC.pick(this.dataset.id)'>${E(x.title.slice(0, 28))}</button>`).join('')}</div>`;
    h += `<div class='card'><details ${c ? '' : 'open'}><summary><b>➕ Nouvelle offre / nouveau lien de candidature</b></summary><form onsubmit='ADG_RC.newCall(event)'><input id='rcnt' placeholder='Intitulé de l offre (ex. Ambassadeurs — Kinshasa)'><span class='lb'>Date et heure limite</span><input id='rcnd' type='datetime-local' value='${toLocal(Date.now() + 7 * 86400000)}'><button class='p'>Créer le lien</button></form></details></div>`;
    if (!c) return h;
    sc.sel = c.id;
    const rem = new Date(c.closes_at).getTime() - Date.now();
    const open = c.active && rem > 0;
    const stt = open ? tag('Ouvert', '#16a34a') : tag(c.active ? 'Expiré' : 'Désactivé', '#dc2626');
    h += `<div class='card'><h2>${E(c.title)} ${stt}</h2><p class='mu'><small>${open ? 'Il reste ' + left(rem) + ' · fin le ' + E(fmt(c.closes_at)) : 'Fermé depuis le ' + E(fmt(c.closes_at))}</small></p>` +
      `<input readonly value='${E(linkOf(c))}' onclick='this.select()'><div class='acts'><button class='p' onclick='ADG_RC.copy()'>Copier le lien</button></div>` +
      `<span class='lb'>Date limite (modifiable à tout moment, même si le lien circule déjà)</span><input id='rcdl' type='datetime-local' value='${toLocal(c.closes_at)}'>` +
      `<div class='acts' style='flex-wrap:wrap'><button class='p' onclick='ADG_RC.saveDeadline()'>Enregistrer le délai</button><button class='s' onclick='ADG_RC.addDays(1)'>+1 jour</button><button class='s' onclick='ADG_RC.addDays(7)'>+7 jours</button><button class='ko' onclick='ADG_RC.closeNow()'>⛔ Fermer maintenant</button></div>` +
      `<button class='s' style='width:100%;margin-top:8px' onclick='ADG_RC.delCall()'>🗑 Supprimer cette offre et toutes ses candidatures</button></div>`;
    const mine = sc.apps.filter(a => a.call_id === c.id);
    const chips = [['all', 'Toutes'], ['new', 'Nouvelles'], ['contacted', 'Contactées'], ['shortlisted', 'Présélectionnées'], ['rejected', 'Refusées']]
      .map(([k, l]) => `<button class='${sc.filter === k ? 'p' : 's'}' data-f='${k}' onclick='ADG_RC.setFilter(this.dataset.f)'>${l} (${k === 'all' ? mine.length : mine.filter(a => a.status === k).length})</button>`).join('');
    h += `<div class='card'><h2>Candidatures (${mine.length})</h2><div class='acts' style='flex-wrap:wrap'>${chips}</div><input placeholder='Rechercher (nom, téléphone, e-mail, adresse)' value='${E(sc.q)}' oninput='ADG_RC.setQ(this.value)'><div id='rclist'>${listHtml()}</div></div>`;
    return h;
  }

  const paint = () => { const b = $q('#rcbox'); if (b) b.innerHTML = render(); };
  const reload = async () => { await load(); paint(); };
  const pick = id => { sc.sel = id; sc.filter = 'all'; sc.q = ''; paint(); };
  const setFilter = f => { sc.filter = f; paint(); };
  const setQ = v => { sc.q = v; const l = $q('#rclist'); if (l) l.innerHTML = listHtml(); };

  async function copyText(txt) { try { await navigator.clipboard.writeText(txt); return true; } catch (e) { prompt('Copiez le lien :', txt); return false; } }
  async function copy() { const c = cur(); if (c && await copyText(linkOf(c))) T('Lien copié'); }

  async function newCall(e) {
    e.preventDefault();
    const title = ($q('#rcnt').value || '').trim(), d = new Date($q('#rcnd').value);
    if (title.length < 3) return alert('Donnez un intitulé à l\'offre.');
    if (isNaN(d) || d <= new Date()) return alert('Choisissez une date limite dans le futur.');
    const r = await sb.from('rc_calls').insert({ title, closes_at: d.toISOString() }).select().single();
    if (r.error) return alert(r.error.message);
    sc.sel = r.data.id;
    const ok = await copyText(linkOf(r.data));
    if (ok) T('Lien créé et copié');
    await reload();
  }

  async function setDeadline(iso) {
    const c = cur();
    const r = await sb.from('rc_calls').update({ closes_at: iso, active: true }).eq('id', c.id);
    if (r.error) return alert(r.error.message);
    T('Délai mis à jour : ' + fmt(iso)); await reload();
  }
  function saveDeadline() { const d = new Date($q('#rcdl').value); if (isNaN(d)) return alert('Date invalide.'); return setDeadline(d.toISOString()); }
  function addDays(n) { const c = cur(); const base = Math.max(Date.now(), new Date(c.closes_at).getTime()); return setDeadline(new Date(base + n * 86400000).toISOString()); }
  function closeNow() { if (!confirm('Fermer ce lien maintenant ? Plus personne ne pourra postuler, même avec le lien déjà envoyé.')) return; return setDeadline(new Date().toISOString()); }

  async function delCall() {
    const c = cur();
    const mine = sc.apps.filter(a => a.call_id === c.id);
    if (!confirm('Supprimer définitivement l\'offre « ' + c.title + ' » et ses ' + mine.length + ' candidature(s) (coordonnées et CV) ? Cette action est irréversible.')) return;
    const paths = mine.map(a => a.cv_path).filter(Boolean);
    if (paths.length) await sb.storage.from('rc-cv').remove(paths);
    const r = await sb.from('rc_calls').delete().eq('id', c.id);
    if (r.error) return alert(r.error.message);
    sc.sel = null; T('Offre supprimée'); await reload();
  }

  function msgText(a, c) { return `Bonjour ${a.first_name}, merci pour votre candidature à Answer Digital (${c ? c.title : 'recrutement'}). Nous avons bien reçu votre dossier et nous reviendrons vers vous très prochainement. — L'équipe Answer Digital`; }
  function mailHref(a, c) { return 'mailto:' + encodeURIComponent(a.email) + '?subject=' + encodeURIComponent('Answer Digital — Votre candidature') + '&body=' + encodeURIComponent(msgText(a, c)); }

  function open(id) {
    const a = sc.apps.find(x => x.id === id); if (!a) return;
    const c = sc.calls.find(x => x.id === a.call_id);
    const sts = Object.keys(ST).map(k => `<button class='${a.status === k ? 'p' : 's'}' data-id='${a.id}' data-s='${k}' onclick='ADG_RC.setStatus(this)'>${ST[k][0]}</button>`).join('');
    const html = `<h2>${E(fullName(a))}</h2><p class='mu'><small>${tag(ST[a.status][0], ST[a.status][1])} · reçue le ${E(fmt(a.created_at))}</small></p>` +
      `<a class='p' href='${waLink(a.phone, msgText(a, c))}' target='_blank' rel='noopener' style='display:block;text-align:center;padding:12px;border-radius:12px;text-decoration:none;margin:6px 0'>💬 Écrire sur WhatsApp (${E(a.phone)})</a>` +
      (a.email ? `<a class='s' href='${mailHref(a, c)}' style='display:block;text-align:center;padding:12px;border-radius:12px;text-decoration:none;margin:6px 0'>✉ Écrire un e-mail (${E(a.email)})</a>` : `<p class='mu'><small>Pas d'adresse e-mail : contact par WhatsApp uniquement.</small></p>`) +
      (a.cv_path ? `<button class='s' style='width:100%;margin:6px 0' data-id='${a.id}' onclick='ADG_RC.viewCv(this.dataset.id)'>📄 Voir le CV</button>` : `<p class='mu'><small>Aucun CV envoyé.</small></p>`) +
      `<div class='row'><div><small class='mu'>Nom</small><br>${E(a.last_name)}</div><div><small class='mu'>Post-nom</small><br>${E(a.middle_name || '—')}</div><div><small class='mu'>Prénom</small><br>${E(a.first_name)}</div></div>` +
      `<div class='row'><div><small class='mu'>Date de naissance</small><br>${E(new Date(a.birth_date).toLocaleDateString('fr-FR'))} (${age(a.birth_date)} ans)</div></div>` +
      `<div class='row'><div><small class='mu'>Adresse</small><br>${E(a.address)}</div></div>` +
      `<span class='lb'>Statut</span><div class='acts' style='flex-wrap:wrap'>${sts}</div>` +
      `<span class='lb'>Note interne</span><textarea id='rcnote' placeholder='Ex. appelée le 3 déc., entretien prévu…'>${E(a.note)}</textarea><button class='s' data-id='${a.id}' onclick='ADG_RC.saveNote(this.dataset.id)'>Enregistrer la note</button>` +
      `<button class='ko' style='width:100%;margin-top:10px' data-id='${a.id}' onclick='ADG_RC.delApp(this.dataset.id)'>🗑 Supprimer cette candidature (coordonnées et CV)</button><button class='s' style='width:100%;margin-top:8px' onclick='closeModal()'>Fermer</button>`;
    if (typeof openModal === 'function') openModal(html); else alert('Fenêtre indisponible');
  }

  async function setStatus(b) {
    const r = await sb.from('rc_applications').update({ status: b.dataset.s }).eq('id', b.dataset.id);
    if (r.error) return alert(r.error.message);
    await load(); paint(); open(b.dataset.id);
  }
  async function saveNote(id) {
    const r = await sb.from('rc_applications').update({ note: ($q('#rcnote').value || '').slice(0, 2000) }).eq('id', id);
    if (r.error) return alert(r.error.message);
    T('Note enregistrée'); await load(); paint();
  }
  async function viewCv(id) {
    const a = sc.apps.find(x => x.id === id); if (!a || !a.cv_path) return;
    const w = window.open('', '_blank');
    const r = await sb.storage.from('rc-cv').createSignedUrl(a.cv_path, 600);
    if (r.error || !r.data) { if (w) w.close(); return alert('CV introuvable : ' + (r.error ? r.error.message : '')); }
    if (w) w.location.href = r.data.signedUrl; else location.href = r.data.signedUrl;
  }
  async function delApp(id) {
    const a = sc.apps.find(x => x.id === id); if (!a) return;
    if (!confirm('Supprimer définitivement la candidature de ' + fullName(a) + ' (coordonnées et CV) ? Cette action est irréversible.')) return;
    if (a.cv_path) await sb.storage.from('rc-cv').remove([a.cv_path]);
    const r = await sb.from('rc_applications').delete().eq('id', id);
    if (r.error) return alert(r.error.message);
    if (typeof closeModal === 'function') closeModal();
    T('Candidature supprimée'); await load(); paint();
  }

  /* Rafraîchissement automatique de l'onglet (nouvelles candidatures) */
  setInterval(() => {
    try {
      if (typeof tab !== 'undefined' && tab === 'cand' && !document.querySelector('.modal') && !/INPUT|TEXTAREA|SELECT/.test((document.activeElement || {}).tagName || '')) reload();
    } catch (e) { /* ignore */ }
  }, 20000);

  window.ADG_RC = {
    isApply: () => !!QA,
    run, submit,
    adminHtml: () => '<div id="rcbox">' + (sc.loaded ? render() : '<p class="mu">Chargement…</p>') + '</div>',
    adminMount: () => { load().then(paint); },
    pick, setFilter, setQ, copy, newCall, saveDeadline, addDays, closeNow, delCall, open, setStatus, saveNote, viewCv, delApp
  };
})();
