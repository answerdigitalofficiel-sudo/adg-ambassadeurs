/* ============================================================
   Recrutement : test chronométré des futurs managers
   - Page candidat (lien ?test=JETON, sans compte)
   - Onglet admin « 🧪 Test » (lien, candidats, notation, décision en un clic, questions)
   Base SQL : sql/013_recrutement_test.sql
   ============================================================ */
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
  const wrap = body => CSS + '<div class="rt"><div class="logo">' + (typeof LOGO === 'function' ? LOGO(56) : '') + '</div>' + body + '</div>';

  async function run() {
    const app = $q('#app');
    const info = await sb.rpc('rt_info', { p_token: Q });
    if (info.error || !info.data) { app.innerHTML = wrap('<div class="card"><h2>Lien invalide</h2><p>Ce test n\'est pas disponible ou le lien est incorrect.</p></div>'); return; }
    document.addEventListener('visibilitychange', () => { if (document.hidden && cur) sb.rpc('rt_flag', { p_secret: cur.sec }); });
    const sec = localStorage.getItem(KEY);
    if (sec) return next(sec, info.data);
    intro(info.data);
  }

  async function intro(info) {
    $q('#app').innerHTML = wrap('<div class="card"><h2>' + E(info.title) + '</h2>' +
      '<p><b>' + info.count + ' questions</b> · environ ' + Math.ceil(info.seconds / 60) + ' minutes au total.</p>' +
      '<ul style="padding-left:18px;line-height:1.6"><li>Chaque question a <b>son propre chrono</b> : le temps écoulé, la réponse n\'est plus acceptée.</li><li>Pas de retour en arrière. Une seule tentative.</li><li>Ne quittez pas la page : chaque sortie est enregistrée.</li><li>Répondez seul(e), avec vos propres mots.</li></ul>' +
      '<form onsubmit="ADG_RT.start(event)"><input id="rn" placeholder="Nom complet" required minlength="3" autocomplete="name"><input id="rp" type="tel" placeholder="Téléphone (WhatsApp)" required autocomplete="tel"><input id="re" type="email" placeholder="Adresse e-mail" required autocomplete="email">' +
            '<p id="rer" class="err"></p><button class="p">Commencer le test</button></form></div>');
  }

  async function start(e) {
    e.preventDefault();
    const b = e.target.querySelector('button.p'); b.disabled = true;
    const r = await sb.rpc('rt_begin', { p_token: Q, p_name: $q('#rn').value, p_phone: $q('#rp').value, p_email: $q('#re').value });
    if (r.error) {
      b.disabled = false;
      const m = r.error.message || '';
      $q('#rer').textContent = /DEJA_PASSE/.test(m) ? 'Un test a déjà été passé avec ce téléphone ou cet e-mail.' : /COORDONNEES/.test(m) ? 'Vérifiez votre nom, votre téléphone et votre e-mail.' : /TEST_INTROUVABLE/.test(m) ? 'Ce test n\'est plus disponible.' : 'Erreur : ' + m;
      return;
    }
    localStorage.setItem(KEY, r.data);
    next(r.data);
  }

  async function next(sec, info) {
    clearInterval(tick);
    const r = await sb.rpc('rt_next', { p_secret: sec });
    if (r.error) { localStorage.removeItem(KEY); if (info) return intro(info); location.reload(); return; }
    if (r.data.done) return done();
    cur = Object.assign({ sec, sel: null }, r.data);
    show();
  }

  function show() {
    const q = cur; q.end = Date.now() + q.seconds * 1000;
    const body = q.kind === 'choice'
      ? q.options.map((o, i) => '<button type="button" class="rto" id="o' + i + '" onclick="ADG_RT.pick(' + i + ')">' + E(o) + '</button>').join('')
      : '<textarea id="rta" placeholder="Votre réponse…" onpaste="return false" ondrop="return false"></textarea>';
    $q('#app').innerHTML = wrap('<div class="card"><div style="display:flex;justify-content:space-between;align-items:center"><small>Question ' + q.index + ' / ' + q.total + '</small><span class="rtt" id="rtt">' + mmss(q.seconds) + '</span></div>' +
      '<div class="rtbar" id="rtb"><i id="rti" style="width:100%"></i></div><p class="rtq">' + E(q.prompt) + '</p>' + body +
      '<button class="p" id="rtv" onclick="ADG_RT.submit(false)" style="margin-top:10px">Valider et passer à la suite</button></div>');
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
    $q('#app').innerHTML = wrap('<div class="card" style="text-align:center"><h2>✅ Test terminé</h2><p>Merci ! Vos réponses ont été enregistrées. L\'équipe Answer Digital vous contactera par e-mail ou sur WhatsApp.</p><p class="mu"><small>Vous pouvez fermer cette page.</small></p></div>');
  }

  /* ====================== ONGLET ADMIN ====================== */
  const st = { tests: [], qs: [], atts: [], ans: [], loaded: false, err: '' };

  async function load() {
    const [t, q, a, an] = await Promise.all([
      sb.from('rt_tests').select('*').order('created_at'),
      sb.from('rt_questions').select('*').order('position'),
      sb.from('rt_attempts').select('*').order('started_at', { ascending: false }),
      sb.from('rt_answers').select('*')
    ]);
    const er = t.error || q.error || a.error || an.error;
    st.err = er ? (/relation|does not exist|schema cache/i.test(er.message) ? 'SQL' : er.message) : '';
    st.tests = t.data || []; st.qs = q.data || []; st.atts = a.data || []; st.ans = an.data || []; st.loaded = true;
  }

  const univName = id => { const u = (typeof D !== 'undefined' && D.univ || []).find(x => x.id === id); return u ? u.name : ''; };
  const link = t => location.origin + location.pathname.replace(/index\.html$/, '') + '?test=' + t.token;
  const tag = (txt, c) => '<span class="tag" style="background:' + c + ';color:#fff;padding:2px 8px;border-radius:99px;font-size:12px">' + txt + '</span>';

  function render() {
    if (st.err === 'SQL') return '<div class="card"><h2>🧪 Test de recrutement</h2><p>La base n\'est pas encore prête. Dans Supabase > SQL Editor, collez et lancez le fichier <b>sql/013_recrutement_test.sql</b> (une seule fois), puis revenez ici.</p></div>';
    if (st.err) return '<div class="card"><p class="err">' + E(st.err) + '</p></div>';
    const t = st.tests[0];
    if (!t) return '<div class="card"><p class="mu">Aucun test. Relancez le SQL 013.</p></div>';
    const qs = st.qs.filter(x => x.test_id === t.id);
    const secs = qs.reduce((a, x) => a + x.seconds, 0);
    const atts = st.atts.filter(x => x.test_id === t.id);
    let h = '<div class="card"><h2>🧪 ' + E(t.title) + '</h2><p class="mu"><small>' + qs.length + ' questions · ' + Math.ceil(secs / 60) + ' min · ' + (t.active ? 'ouvert' : 'fermé') + '</small></p>' +
      '<input readonly value="' + E(link(t)) + '" onclick="this.select()">' +
      '<div class="acts"><button class="p" onclick="ADG_RT.copy()">Copier le lien</button><button class="s" onclick="ADG_RT.toggle()">' + (t.active ? 'Fermer le test' : 'Rouvrir') + '</button><button class="s" onclick="ADG_RT.rotate()">Changer le lien</button></div></div>';
    h += '<div class="card"><h2>Candidats (' + atts.length + ')</h2>';
    const sorted = atts.slice().sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
    h += sorted.map(a => {
      const need = st.ans.some(x => x.attempt_id === a.id && x.score == null);
      const dec = a.decision === 'retained' ? tag('Retenu' + (a.decision_role ? ' · ' + (a.decision_role === 'manager' ? 'manager' : 'ambassadeur') : ''), '#16a34a') : a.decision === 'rejected' ? tag('Refusé', '#dc2626') : '';
      return '<div class="row" style="align-items:flex-start;cursor:pointer" onclick="ADG_RT.open(\'' + a.id + '\')"><div><b>' + E(a.full_name) + '</b><br><small>' + E(a.phone) + ' · ' + E(a.email) + '</small><br><small>' + (univName(a.university_id) ? E(univName(a.university_id)) + ' · ' : '') + (a.status === 'finished' ? 'terminé' : 'en cours') + ' · ' + a.leaves + ' sortie(s) de page' + (need ? ' · ✍️ à noter' : '') + '</small></div><div style="text-align:right"><b style="font-size:20px">' + (a.score == null ? '—' : Math.round(a.score) + '%') + '</b><br>' + dec + '</div></div>';
    }).join('') || '<p class="mu">Aucun candidat pour le moment.</p>';
    h += '</div>';
    h += '<div class="card"><h2>Questions</h2>' + qs.map(x => '<div class="row" style="align-items:flex-start"><div style="flex:1"><small class="mu">' + x.position + '. ' + E(x.criterion) + ' · ' + (x.kind === 'choice' ? 'choix' : 'texte') + ' · ' + x.points + ' pts</small><br>' + E(x.prompt) + '</div><div style="min-width:84px;text-align:right"><input type="number" min="10" max="900" value="' + x.seconds + '" style="width:70px" onchange="ADG_RT.secs(\'' + x.id + '\',this.value)"> s<br><button class="ko" onclick="ADG_RT.delQ(\'' + x.id + '\')">🗑</button></div></div>').join('') +
      '<details style="margin-top:10px"><summary><b>➕ Ajouter une question</b></summary><form onsubmit="ADG_RT.addQ(event)"><input id="qc" placeholder="Critère visé (ex. Leadership)" required><textarea id="qp" placeholder="Question" required></textarea><select id="qk"><option value="choice">Choix multiple</option><option value="text">Réponse écrite (notée à la main)</option></select><textarea id="qo" placeholder="Choix : un par ligne (pour le choix multiple)"></textarea><input id="qr" type="number" min="1" placeholder="N° de la bonne réponse (1, 2, 3…)"><input id="qs" type="number" min="10" max="900" value="45" placeholder="Durée en secondes"><input id="qt" type="number" min="1" value="10" placeholder="Points"><button class="p">Ajouter</button></form></details></div>';
    return h;
  }

  const paint = () => { const b = $q('#rtbox'); if (b) b.innerHTML = render(); };
  const reload = async () => { await load(); paint(); };

  function open(id) {
    const a = st.atts.find(x => x.id === id); if (!a) return;
    const qs = st.qs.filter(x => x.test_id === a.test_id);
    const list = (typeof D !== 'undefined' && D.univ || []).filter(u => u.active !== false);
    const uopts = '<option value="">— Université —</option>' + list.map(u => '<option value="' + E(u.id) + '"' + (u.id === a.university_id ? ' selected' : '') + '>' + E(u.name) + '</option>').join('');
    const rows = qs.map(q => {
      const r = st.ans.find(x => x.attempt_id === a.id && x.question_id === q.id);
      if (!r) return '<div class="row"><div><small class="mu">' + q.position + '. ' + E(q.criterion) + '</small><br>' + E(q.prompt) + '<br><small class="mu">Non posée</small></div></div>';
      let ans;
      if (q.kind === 'choice') {
        const i = r.answer === '' || r.answer == null ? null : parseInt(r.answer, 10);
        ans = (i == null ? '<i>Pas de réponse</i>' : E((q.options || [])[i] || '?')) + ' ' + (r.score > 0 ? '✅' : '❌');
      } else {
        ans = (r.answer ? '<div style="white-space:pre-wrap;background:var(--bg);padding:8px;border-radius:8px">' + E(r.answer) + '</div>' : '<i>Pas de réponse</i>') +
          (r.late ? '' : '<div style="margin-top:6px">Note : <input type="number" min="0" max="' + q.points + '" step="0.5" value="' + (r.score == null ? '' : r.score) + '" style="width:70px" id="g-' + r.id + '"> / ' + q.points + ' <button class="s" onclick="ADG_RT.grade(\'' + r.id + '\',\'' + a.id + '\')">Noter</button></div>');
      }
      return '<div class="row" style="align-items:flex-start"><div style="width:100%"><small class="mu">' + q.position + '. ' + E(q.criterion) + ' · ' + (r.late ? 'hors délai' : Math.max(0, Math.round((new Date(r.answered_at) - new Date(r.served_at)) / 1000)) + ' s / ' + q.seconds + ' s') + '</small><br>' + E(q.prompt) + '<div style="margin-top:6px">' + ans + '</div></div></div>';
    }).join('');
    const html = '<h2>' + E(a.full_name) + '</h2><p class="mu"><small>' + E(a.phone) + ' · ' + E(a.email) + '<br>Score : <b>' + (a.score == null ? '—' : Math.round(a.score) + '%') + '</b> · ' + a.leaves + ' sortie(s) de page</small></p>' + rows +
      '<span class="lb">Université d\'affectation</span><select id="rtu">' + uopts + '</select>' +
      '<div class="acts" style="flex-wrap:wrap"><button class="ok" onclick="ADG_RT.decide(\'' + a.id + '\',\'retained\',null,true)">✅ Retenu + e-mail</button><button class="ko" onclick="ADG_RT.decide(\'' + a.id + '\',\'rejected\',null,true)">❌ Refusé + e-mail</button></div>' +
      '<div class="acts" style="flex-wrap:wrap"><button class="p" onclick="ADG_RT.decide(\'' + a.id + '\',\'retained\',\'manager\',false)">➕ Manager</button><button class="p" onclick="ADG_RT.decide(\'' + a.id + '\',\'retained\',\'ambassador\',false)">➕ Ambassadeur</button></div>' +
      '<p class="mu"><small>Si la personne n\'a pas encore de compte, demandez-lui de s\'inscrire avec <b>' + E(a.email) + '</b>, puis recliquez sur Manager / Ambassadeur.</small></p>' +
      '<button class="s" style="width:100%;margin-top:6px" onclick="ADG_RT.reset(\'' + a.id + '\')">🗑 Supprimer cette tentative (permet de repasser le test)</button><button class="s" style="width:100%;margin-top:8px" onclick="closeModal()">Fermer</button>';
    if (typeof openModal === 'function') openModal(html); else alert('Fenêtre indisponible');
  }

  async function grade(ansId, attId) {
    const v = parseFloat(String(($q('#g-' + ansId) || {}).value || '').replace(',', '.'));
    if (isNaN(v)) return alert('Entrez une note.');
    const r = await sb.rpc('rt_grade', { p_answer: ansId, p_score: v });
    if (r.error) return alert(r.error.message);
    T('Note enregistrée'); await load(); paint(); open(attId);
  }

  function mailto(a, decision) {
    const first = (a.full_name || '').split(' ')[0];
    const app = location.origin + location.pathname;
    const ok = decision === 'retained';
    const sub = ok ? 'Answer Digital — Vous êtes retenu(e)' : 'Answer Digital — Résultat de votre test';
    const body = ok
      ? 'Bonjour ' + first + ',\n\nFélicitations ! Vous avez été retenu(e) à l\'issue de notre test de recrutement.\n\nPour la suite, créez votre compte sur ADG Ambassadeurs avec cette adresse e-mail et choisissez votre université :\n' + app + '\n\nL\'équipe Answer Digital'
      : 'Bonjour ' + first + ',\n\nMerci d\'avoir passé notre test de recrutement. Après étude de votre dossier, nous ne pouvons pas donner suite pour le moment. Nous vous encourageons à retenter votre chance lors de nos prochains recrutements.\n\nL\'équipe Answer Digital';
    return 'mailto:' + encodeURIComponent(a.email) + '?subject=' + encodeURIComponent(sub) + '&body=' + encodeURIComponent(body);
  }

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

  const test0 = () => st.tests[0];
  async function copy() { const t = test0(); try { await navigator.clipboard.writeText(link(t)); T('Lien copié'); } catch (e) { prompt('Copiez le lien :', link(t)); } }
  async function toggle() { const t = test0(); await sb.from('rt_tests').update({ active: !t.active }).eq('id', t.id); await reload(); }
  async function rotate() {
    if (!confirm('Changer le lien ? L\'ancien lien ne fonctionnera plus (les tentatives en cours seront perdues pour ces candidats).')) return;
    const tok = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now()).replace(/-/g, '').slice(0, 16);
    const r = await sb.from('rt_tests').update({ token: tok }).eq('id', test0().id); if (r.error) return alert(r.error.message);
    await reload();
  }
  async function secs(id, v) { const n = parseInt(v, 10); if (!(n >= 10 && n <= 900)) return alert('Entre 10 et 900 secondes.'); const r = await sb.from('rt_questions').update({ seconds: n }).eq('id', id); if (r.error) return alert(r.error.message); T('Durée mise à jour'); await load(); }
  async function delQ(id) { if (!confirm('Supprimer cette question ?')) return; const r = await sb.from('rt_questions').delete().eq('id', id); if (r.error) return alert(r.error.message); await reload(); }
  async function addQ(e) {
    e.preventDefault();
    const t = test0(), kind = $q('#qk').value;
    const opts = $q('#qo').value.split('\n').map(s => s.trim()).filter(Boolean);
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
    open, grade, decide, reset, copy, toggle, rotate, secs, delQ, addQ
  };
})();
