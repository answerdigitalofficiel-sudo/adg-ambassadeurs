/* Recrutement : tests chronométrés (managers et ambassadeurs), liens à usage unique
   - Page candidat : ?test=JETON (lien valable une seule fois, sans compte)
   - Onglet admin « 🧪 Test » : liens, candidats, notation, décision en un clic, questions
   Base : sql/013 + migration 014 (Supabase) */
(function () {
  const Q = new URLSearchParams(location.search).get('test') || '';
  const KEY = 'adg_rt_' + Q;
  const E = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const T = m => { if (typeof toast === 'function') toast(m); else alert(m); };
  const $q = s => document.querySelector(s);
  const mmss = s => Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  let tick = null, cur = null, busy = false;

  /* ====================== PAGE CANDIDAT ====================== */
  const CSS = '<style>.rt{max-width:560px;margin:0 auto;padding:16px 14px 40px}.rt .logo{text-align:center;margin:8px 0 12px}.rtt{font-size:30px;font-weight:800;font-variant-numeric:tabular-nums}.rtbar{height:8px;border-radius:99px;background:var(--bd);overflow:hidden;margin:6px 0 14px}.rtbar>i{display:block;height:100%;background:var(--ac);transition:width .3s linear}.rtbar.lo>i{background:var(--ko)}.rto{display:block;width:100%;text-align:left;margin:8px 0;padding:13px;border:2px solid var(--bd);border-radius:12px;background:var(--card);color:var(--tx);font:inherit;cursor:pointer}.rto.on{border-color:var(--ac);box-shadow:0 0 0 2px var(--ac) inset}.rt textarea{width:100%;min-height:150px;box-sizing:border-box}.rtq{font-size:17px;line-height:1.45;margin:8px 0 12px}</style>';
  const wrap = body => CSS + `<div class='rt'><div class='logo'>${typeof LOGO === 'function' ? LOGO(56) : ''}</div>${body}</div>`;
  const invalid = () => { $q('#app').innerHTML = wrap(`<div class='card'><h2>Lien non valide</h2><p>Ce lien a déjà été utilisé ou n'est plus valide. Chaque lien ne peut servir qu'une seule fois : demandez-en un nouveau à l'équipe Answer Digital.</p></div>`); };

  async function run() {
    document.addEventListener('visibilitychange', () => { if (document.hidden && cur) sb.rpc('rt_flag', { p_secret: cur.sec }); });
    const sec = localStorage.getItem(KEY);
    if (sec) return next(sec);
    const info = await sb.rpc('rt_info', { p_token: Q });
    if (info.error || !info.data) return invalid();
    intro(info.data);
  }

  function intro(info) {
    $q('#app').innerHTML = wrap(`<div class='card'><h2>${E(info.title)}</h2><p><b>${info.count} questions</b> · environ ${Math.ceil(info.seconds / 60)} minutes au total.</p><ul style='padding-left:18px;line-height:1.6'><li>Ce lien est <b>à usage unique</b> : il devient invalide dès que vous commencez.</li><li>Chaque question a <b>son propre chrono</b> : le temps écoulé, la réponse n'est plus acceptée.</li><li>Pas de retour en arrière. Une seule tentative.</li><li>Ne quittez pas la page : chaque sortie est enregistrée.</li><li>Répondez seul(e), avec vos propres mots.</li></ul><form onsubmit='ADG_RT.start(event)'><input id='rn' placeholder='Nom complet' required minlength='3' autocomplete='name'><input id='rp' type='tel' placeholder='Téléphone (WhatsApp)' required autocomplete='tel'><input id='re' type='email' placeholder='Adresse e-mail' required autocomplete='email'><p id='rer' class='err'></p><button class='p'>Commencer le test</button></form></div>`);
  }

  async function start(e) {
    e.preventDefault();
    const b = e.target.querySelector('button.p'); b.disabled = true;
    const r = await sb.rpc('rt_begin', { p_token: Q, p_name: $q('#rn').value, p_phone: $q('#rp').value, p_email: $q('#re').value });
    if (r.error) {
      const m = r.error.message || '';
      if (/LIEN_INVALIDE/.test(m)) return invalid();
      b.disabled = false;
      $q('#rer').textContent = /DEJA_PASSE/.test(m) ? 'Un test a déjà été passé avec ce téléphone ou cet e-mail.' : /COORDONNEES/.test(m) ? 'Vérifiez votre nom, votre téléphone et votre e-mail.' : 'Erreur : ' + m;
      return;
    }
    localStorage.setItem(KEY, r.data);
    next(r.data);
  }

  async function next(sec) {
    clearInterval(tick);
    const r = await sb.rpc('rt_next', { p_secret: sec });
    if (r.error) { localStorage.removeItem(KEY); return invalid(); }
    if (r.data.done) return done();
    cur = Object.assign({ sec, sel: null }, r.data);
    show();
  }

  function show() {
    const q = cur; q.end = Date.now() + q.seconds * 1000;
    const body = q.kind === 'choice'
      ? q.options.map((o, i) => `<button type='button' class='rto' onclick='ADG_RT.pick(${i})'>${E(o)}</button>`).join('')
      : `<textarea id='rta' placeholder='Votre réponse…' onpaste='return false' ondrop='return false'></textarea>`;
    $q('#app').innerHTML = wrap(`<div class='card'><div style='display:flex;justify-content:space-between;align-items:center'><small>Question ${q.index} / ${q.total}</small><span class='rtt' id='rtt'>${mmss(q.seconds)}</span></div><div class='rtbar' id='rtb'><i id='rti' style='width:100%'></i></div><p class='rtq'>${E(q.prompt)}</p>${body}<button class='p' id='rtv' onclick='ADG_RT.submit(false)' style='margin-top:10px'>Valider et passer à la suite</button></div>`);
    tick = setInterval(() => {
      const left = Math.max(0, Math.ceil((q.end - Date.now()) / 1000));
      const t = $q('#rtt'), i = $q('#rti'), b = $q('#rtb');
      if (t) t.textContent = mmss(left);
      if (i) i.style.width = Math.max(0, Math.min(100, (q.end - Date.now()) / (q.total_seconds * 10))) + '%';
      if (b && left <= 10) b.classList.add('lo');
      if (left <= 0) { clearInterval(tick); submit(true); }
    }, 250);
  }

  function pick(i) {
    if (!cur) return;
    cur.sel = i;
    document.querySelectorAll('.rto').forEach((b, k) => b.classList.toggle('on', k === i));
  }

  async function submit(auto) {
    if (busy || !cur) return;
    busy = true; clearInterval(tick);
    const q = cur;
    const ans = q.kind === 'choice' ? (q.sel == null ? '' : String(q.sel)) : ($q('#rta') ? $q('#rta').value : '');
    const v = $q('#rtv'); if (v) v.disabled = true;
    try { await sb.rpc('rt_answer', { p_secret: q.sec, p_qid: q.qid, p_answer: ans }); } catch (e) { /* le serveur clôturera la question */ }
    busy = false; cur = null;
    next(q.sec);
  }

  function done() {
    clearInterval(tick); cur = null;
    $q('#app').innerHTML = wrap(`<div class='card' style='text-align:center'><h2>✅ Test terminé</h2><p>Merci ! Vos réponses ont été enregistrées. L'équipe Answer Digital vous contactera par e-mail ou sur WhatsApp.</p><p class='mu'><small>Vous pouvez fermer cette page.</small></p></div>`);
  }

  /* ====================== ONGLET ADMIN ====================== */
  const st = { tests: [], invs: [], qs: [], atts: [], ans: [], sel: null, loaded: false, err: '' };

  async function load() {
    const [t, i, q, a, an] = await Promise.all([
      sb.from('rt_tests').select('*'),
      sb.from('rt_invites').select('*').order('created_at', { ascending: false }),
      sb.from('rt_questions').select('*').order('position'),
      sb.from('rt_attempts').select('*').order('started_at', { ascending: false }),
      sb.from('rt_answers').select('*')
    ]);
    const er = t.error || i.error || q.error || a.error || an.error;
    st.err = er ? (/relation|does not exist|schema cache/i.test(er.message) ? 'SQL' : er.message) : '';
    st.tests = (t.data || []).sort((x, y) => x.kind === y.kind ? 0 : (x.kind === 'manager' ? -1 : 1));
    st.invs = i.data || []; st.qs = q.data || []; st.atts = a.data || []; st.ans = an.data || []; st.loaded = true;
  }

  const curTest = () => st.tests.find(x => x.id === st.sel) || st.tests[0];
  const univName = id => { const u = (typeof D !== 'undefined' && D.univ || []).find(x => x.id === id); return u ? u.name : ''; };
  const linkOf = v => location.origin + location.pathname.replace('index.html', '') + '?test=' + v.token;
  const tag = (txt, c) => `<span style='background:${c};color:#fff;padding:2px 8px;border-radius:99px;font-size:12px'>${txt}</span>`;
  const kindLabel = k => k === 'manager' ? 'manager' : 'ambassadeur';

  function render() {
    if (st.err === 'SQL') return `<div class='card'><h2>🧪 Tests de recrutement</h2><p>La base n'est pas prête : les fichiers SQL de recrutement n'ont pas été appliqués.</p></div>`;
    if (st.err) return `<div class='card'><p class='err'>${E(st.err)}</p></div>`;
    const t = curTest();
    if (!t) return `<div class='card'><p class='mu'>Aucun test trouvé.</p></div>`;
    st.sel = t.id;
    const qs = st.qs.filter(x => x.test_id === t.id), invs = st.invs.filter(x => x.test_id === t.id), atts = st.atts.filter(x => x.test_id === t.id);
    const secs = qs.reduce((a, x) => a + x.seconds, 0);
    const tabs = st.tests.map(x => `<button class='${x.id === t.id ? 'p' : 's'}' data-id='${x.id}' onclick='ADG_RT.pickTest(this.dataset.id)'>${x.kind === 'manager' ? '👔 Manager' : '🤝 Ambassadeur'}</button>`).join('');
    let h = `<div class='acts' style='margin-bottom:10px'>${tabs}</div>`;
    h += `<div class='card'><h2>${E(t.title)}</h2><p class='mu'><small>${qs.length} questions · ${Math.ceil(secs / 60)} min · ${t.active ? 'ouvert' : 'fermé'}</small></p><div class='acts'><button class='s' onclick='ADG_RT.toggle()'>${t.active ? 'Fermer ce test' : 'Rouvrir ce test'}</button></div></div>`;
    h += `<div class='card'><h2>Liens à usage unique</h2><p class='mu'><small>Un lien par candidat : il devient caduc dès que le candidat commence le test.</small></p><input id='rtl' placeholder='Destinataire (optionnel, pour vous repérer)'><button class='p' onclick='ADG_RT.newLink()'>➕ Générer et copier un lien</button>`;
    h += invs.slice(0, 60).map(v => {
      const at = v.attempt_id ? st.atts.find(x => x.id === v.attempt_id) : null;
      return `<div class='row' style='align-items:center'><div style='flex:1'><b>${E(v.label || 'Sans nom')}</b><br><small class='mu'>${v.used_at ? 'Utilisé' + (at ? ' par ' + E(at.full_name) : '') : 'Disponible'} · ${new Date(v.created_at).toLocaleDateString('fr-FR')}</small></div>${v.used_at ? tag('Utilisé', '#6b7280') : `<button class='p' data-id='${v.id}' onclick='ADG_RT.copyLink(this.dataset.id)'>Copier</button> <button class='ko' data-id='${v.id}' onclick='ADG_RT.delInv(this.dataset.id)'>🗑</button>`}</div>`;
    }).join('') || `<p class='mu'>Aucun lien pour le moment.</p>`;
    h += `</div><div class='card'><h2>Candidats (${atts.length})</h2>`;
    h += atts.slice().sort((a, b) => (b.score ?? -1) - (a.score ?? -1)).map(a => {
      const need = st.ans.some(x => x.attempt_id === a.id && x.score == null);
      const dec = a.decision === 'retained' ? tag('Retenu' + (a.decision_role ? ' · ' + kindLabel(a.decision_role) : ''), '#16a34a') : a.decision === 'rejected' ? tag('Refusé', '#dc2626') : '';
      const u = univName(a.university_id);
      return `<div class='row' style='align-items:flex-start;cursor:pointer' data-id='${a.id}' onclick='ADG_RT.open(this.dataset.id)'><div><b>${E(a.full_name)}</b><br><small>${E(a.phone)} · ${E(a.email)}</small><br><small>${u ? E(u) + ' · ' : ''}${a.status === 'finished' ? 'terminé' : 'en cours'} · ${a.leaves} sortie(s) de page${need ? ' · ✍️ à noter' : ''}</small></div><div style='text-align:right'><b style='font-size:20px'>${a.score == null ? '—' : Math.round(a.score) + '%'}</b><br>${dec}</div></div>`;
    }).join('') || `<p class='mu'>Aucun candidat pour le moment.</p>`;
    h += `</div><div class='card'><h2>Questions</h2>`;
    h += qs.map(x => `<div class='row' style='align-items:flex-start'><div style='flex:1'><small class='mu'>${x.position}. ${E(x.criterion)} · ${x.kind === 'choice' ? 'choix' : 'texte'} · ${x.points} pts</small><br>${E(x.prompt)}</div><div style='min-width:84px;text-align:right'><input type='number' min='10' max='900' value='${x.seconds}' style='width:70px' data-id='${x.id}' onchange='ADG_RT.secs(this.dataset.id,this.value)'> s<br><button class='ko' data-id='${x.id}' onclick='ADG_RT.delQ(this.dataset.id)'>🗑</button></div></div>`).join('');
    h += `<details style='margin-top:10px'><summary><b>➕ Ajouter une question</b></summary><form onsubmit='ADG_RT.addQ(event)'><input id='qc' placeholder='Critère visé (ex. Leadership)' required><textarea id='qp' placeholder='Question' required></textarea><select id='qk'><option value='choice'>Choix multiple</option><option value='text'>Réponse écrite (notée à la main)</option></select><textarea id='qo' placeholder='Choix : un par ligne (pour le choix multiple)'></textarea><input id='qr' type='number' min='1' placeholder='N° de la bonne réponse (1, 2, 3…)'><input id='qs' type='number' min='10' max='900' value='45' placeholder='Durée en secondes'><input id='qt' type='number' min='1' value='10' placeholder='Points'><button class='p'>Ajouter</button></form></details></div>`;
    return h;
  }

  const paint = () => { const b = $q('#rtbox'); if (b) b.innerHTML = render(); };
  const reload = async () => { await load(); paint(); };

  function open(id) {
    const a = st.atts.find(x => x.id === id); if (!a) return;
    const test = st.tests.find(x => x.id === a.test_id);
    const qs = st.qs.filter(x => x.test_id === a.test_id);
    const list = (typeof D !== 'undefined' && D.univ || []).filter(u => u.active !== false);
    const uopts = '<option value="">— Université —</option>' + list.map(u => `<option value='${E(u.id)}'${u.id === a.university_id ? ' selected' : ''}>${E(u.name)}</option>`).join('');
    const rows = qs.map(q => {
      const r = st.ans.find(x => x.attempt_id === a.id && x.question_id === q.id);
      if (!r) return `<div class='row'><div><small class='mu'>${q.position}. ${E(q.criterion)}</small><br>${E(q.prompt)}<br><small class='mu'>Non posée</small></div></div>`;
      let ans;
      if (q.kind === 'choice') {
        const i = r.answer === '' || r.answer == null ? null : parseInt(r.answer, 10);
        ans = (i == null ? '<i>Pas de réponse</i>' : E((q.options || [])[i] || '?')) + ' ' + (r.score > 0 ? '✅' : '❌');
      } else {
        ans = (r.answer ? `<div style='white-space:pre-wrap;background:var(--bg);padding:8px;border-radius:8px'>${E(r.answer)}</div>` : '<i>Pas de réponse</i>') +
          (r.late ? '' : `<div style='margin-top:6px'>Note : <input type='number' min='0' max='${q.points}' step='0.5' value='${r.score == null ? '' : r.score}' style='width:70px' id='g-${r.id}'> / ${q.points} <button class='s' data-a='${r.id}' data-t='${a.id}' onclick='ADG_RT.gradeBtn(this)'>Noter</button></div>`);
      }
      const dur = r.late ? 'hors délai' : Math.max(0, Math.round((new Date(r.answered_at) - new Date(r.served_at)) / 1000)) + ' s / ' + q.seconds + ' s';
      return `<div class='row' style='align-items:flex-start'><div style='width:100%'><small class='mu'>${q.position}. ${E(q.criterion)} · ${dur}</small><br>${E(q.prompt)}<div style='margin-top:6px'>${ans}</div></div></div>`;
    }).join('');
    const btn = (cls, label, d, r, m) => `<button class='${cls}' data-id='${a.id}' data-d='${d}' data-r='${r}' data-m='${m}' onclick='ADG_RT.decideBtn(this)'>${label}</button>`;
    const html = `<h2>${E(a.full_name)}</h2><p class='mu'><small>${test ? 'Test ' + kindLabel(test.kind) + ' · ' : ''}${E(a.phone)} · ${E(a.email)}<br>Score : <b>${a.score == null ? '—' : Math.round(a.score) + '%'}</b> · ${a.leaves} sortie(s) de page</small></p>${rows}<span class='lb'>Université d'affectation (managers)</span><select id='rtu'>${uopts}</select><div class='acts' style='flex-wrap:wrap'>${btn('ok', '✅ Retenu + e-mail', 'retained', '', '1')}${btn('ko', '❌ Refusé + e-mail', 'rejected', '', '1')}</div><div class='acts' style='flex-wrap:wrap'>${btn('p', '➕ Manager', 'retained', 'manager', '0')}${btn('p', '➕ Ambassadeur', 'retained', 'ambassador', '0')}</div><p class='mu'><small>Si la personne n'a pas encore de compte, demandez-lui de s'inscrire avec <b>${E(a.email)}</b>, puis recliquez sur Manager / Ambassadeur.</small></p><button class='s' style='width:100%;margin-top:6px' data-id='${a.id}' onclick='ADG_RT.reset(this.dataset.id)'>🗑 Supprimer cette tentative (permet de repasser le test avec un nouveau lien)</button><button class='s' style='width:100%;margin-top:8px' onclick='closeModal()'>Fermer</button>`;
    if (typeof openModal === 'function') openModal(html); else alert('Fenêtre indisponible');
  }

  async function gradeBtn(b) {
    const ansId = b.dataset.a, attId = b.dataset.t;
    const v = parseFloat(String(($q('#g-' + ansId) || {}).value || '').replace(',', '.'));
    if (isNaN(v)) return alert('Entrez une note.');
    const r = await sb.rpc('rt_grade', { p_answer: ansId, p_score: v });
    if (r.error) return alert(r.error.message);
    T('Note enregistrée'); await load(); paint(); open(attId);
  }

  function mailto(a, decision) {
    const first = (a.full_name || '').split(' ')[0];
    const test = st.tests.find(x => x.id === a.test_id);
    const role = test ? kindLabel(test.kind) : 'ambassadeur';
    const app = location.origin + location.pathname;
    const ok = decision === 'retained';
    const sub = ok ? 'Answer Digital — Vous êtes retenu(e)' : 'Answer Digital — Résultat de votre test';
    const lines = ok
      ? ['Bonjour ' + first + ',', '', 'Félicitations ! Vous avez été retenu(e) à l\'issue de notre test de recrutement (poste : ' + role + ').', '', 'Pour la suite, créez votre compte sur ADG Ambassadeurs avec cette adresse e-mail :', app, '', 'L\'équipe Answer Digital']
      : ['Bonjour ' + first + ',', '', 'Merci d\'avoir passé notre test de recrutement. Après étude de votre dossier, nous ne pouvons pas donner suite pour le moment. Nous vous encourageons à retenter votre chance lors de nos prochains recrutements.', '', 'L\'équipe Answer Digital'];
    return 'mailto:' + encodeURIComponent(a.email) + '?subject=' + encodeURIComponent(sub) + '&body=' + lines.map(encodeURIComponent).join('%0A');
  }

  function decideBtn(b) { return decide(b.dataset.id, b.dataset.d, b.dataset.r || null, b.dataset.m === '1'); }

  async function decide(id, decision, role, mail) {
    const a = st.atts.find(x => x.id === id); if (!a) return;
    if (decision === 'rejected' && !confirm('Marquer ' + a.full_name + ' comme refusé(e) ?')) return;
    const r = await sb.rpc('rt_decide', { p_attempt: id, p_decision: decision, p_role: role, p_univ: ($q('#rtu') || {}).value || null });
    if (r.error) return alert(r.error.message);
    const m = { ok: 'Décision enregistrée', applied: role === 'manager' ? 'Manager nommé ✔' : 'Ambassadeur confirmé ✔', pending_signup: 'Enregistré. Pas encore de compte avec cet e-mail : la personne doit s\'inscrire avec ' + a.email + ', puis recliquez.', univ_has_manager: 'Cette université a déjà un manager.', need_univ: 'Choisissez d\'abord l\'université d\'affectation.', is_admin: 'Ce compte est administrateur.' }[r.data] || 'OK';
    T(m);
    await load(); paint();
    if (typeof closeModal === 'function') closeModal();
    if (mail) location.href = mailto(a, decision);
  }

  async function reset(id) {
    if (!confirm('Supprimer définitivement cette tentative et ses réponses ?')) return;
    const r = await sb.from('rt_attempts').delete().eq('id', id);
    if (r.error) return alert(r.error.message);
    if (typeof closeModal === 'function') closeModal();
    await load(); paint();
  }

  function pickTest(id) { st.sel = id; paint(); }
  async function toggle() { const t = curTest(); await sb.from('rt_tests').update({ active: !t.active }).eq('id', t.id); await reload(); }

  async function copyText(txt) { try { await navigator.clipboard.writeText(txt); return true; } catch (e) { prompt('Copiez le lien :', txt); return false; } }
  async function newLink() {
    const t = curTest();
    const r = await sb.from('rt_invites').insert({ test_id: t.id, label: ($q('#rtl') || {}).value || '' }).select().single();
    if (r.error) return alert(r.error.message);
    const ok = await copyText(linkOf(r.data));
    if (ok) T('Lien créé et copié (usage unique)');
    await reload();
  }
  async function copyLink(id) { const v = st.invs.find(x => x.id === id); if (v && await copyText(linkOf(v))) T('Lien copié'); }
  async function delInv(id) { if (!confirm('Supprimer ce lien ?')) return; const r = await sb.from('rt_invites').delete().eq('id', id); if (r.error) return alert(r.error.message); await reload(); }

  async function secs(id, v) { const n = parseInt(v, 10); if (!(n >= 10 && n <= 900)) return alert('Entre 10 et 900 secondes.'); const r = await sb.from('rt_questions').update({ seconds: n }).eq('id', id); if (r.error) return alert(r.error.message); T('Durée mise à jour'); await load(); }
  async function delQ(id) { if (!confirm('Supprimer cette question ?')) return; const r = await sb.from('rt_questions').delete().eq('id', id); if (r.error) return alert(r.error.message); await reload(); }
  async function addQ(e) {
    e.preventDefault();
    const t = curTest(), kind = $q('#qk').value;
    const opts = $q('#qo').value.split(String.fromCharCode(10)).map(s => s.trim()).filter(Boolean);
    const corr = parseInt($q('#qr').value, 10);
    if (kind === 'choice' && (opts.length < 2 || !(corr >= 1 && corr <= opts.length))) return alert('Choix multiple : au moins 2 choix et un numéro de bonne réponse valide.');
    const pos = st.qs.filter(x => x.test_id === t.id).reduce((m, x) => Math.max(m, x.position), 0) + 1;
    const r = await sb.from('rt_questions').insert({ test_id: t.id, position: pos, criterion: $q('#qc').value.trim(), prompt: $q('#qp').value.trim(), kind, options: kind === 'choice' ? opts : [], correct: kind === 'choice' ? corr - 1 : null, seconds: parseInt($q('#qs').value, 10) || 45, points: parseInt($q('#qt').value, 10) || 10 });
    if (r.error) return alert(r.error.message);
    T('Question ajoutée'); await reload();
  }

  /* Rafraîchissement automatique de l'onglet (nouveaux candidats) */
  setInterval(() => {
    try {
      if (typeof tab !== 'undefined' && tab === 'rec' && !document.querySelector('.modal') && !/INPUT|TEXTAREA|SELECT/.test((document.activeElement || {}).tagName || '')) reload();
    } catch (e) { /* ignore */ }
  }, 20000);

  window.ADG_RT = {
    isTest: () => !!Q,
    run, start, pick, submit,
    adminHtml: () => '<div id="rtbox">' + (st.loaded ? render() : '<p class="mu">Chargement…</p>') + '</div>',
    adminMount: () => { load().then(paint); },
    open, gradeBtn, decideBtn, reset, pickTest, toggle, newLink, copyLink, delInv, secs, delQ, addQ
  };
})();
