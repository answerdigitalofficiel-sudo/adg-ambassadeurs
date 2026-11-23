/* ADG Ambassadeurs — fonctions ajoutées (chargé avant le script principal ; n'utilise D, me, sb… qu'au moment des appels).
   1) Le manager valide ses ambassadeurs ; l'administration voit leur nombre et leur identité enregistrée.
   2) Remise et reprise entre managers (nomination possible depuis une autre université).
   3) QR code et lien de partage de l'application.
   Nécessite la migration sql/010_manager_valide_remise_reprise.sql (sans elle, seules les nominations directes sont impossibles : le reste de l'application fonctionne comme avant). */

/* ---------- Administration : équipes des managers ---------- */
function mgrOfUniv(uid) { return (D.mgrs || []).find(m => m.university_id === uid && m.active); }
function hasMgr(a) { return !!a.university_id && !!mgrOfUniv(a.university_id); }
function teamOf(m) { return (D.ambs || []).filter(a => a.university_id === m.university_id); }
function nbTeam(m) {
  const t = teamOf(m), n = t.filter(a => a.stage === 'active').length, w = t.length - n;
  return n + ' ambassadeur' + (n > 1 ? 's' : '') + (w ? ' · ' + w + ' en cours de validation' : '');
}
function showTeamIdentity(mid) {
  const m = (D.mgrs || []).find(x => x.id === mid); if (!m) return;
  const t = teamOf(m), un = ((D.univ || []).find(u => u.id === m.university_id) || {}).name || '';
  const rows = t.map(a => `<div class='row'><div><b>${esc(a.full_name)}</b> ${a.is_chief ? '👑' : ''}<br><small><a href='${wa(a.phone)}' target='_blank'>${esc(a.phone)}</a> · ${esc(stageTxt[a.stage] || '')}${a.momo_number ? ' · ' + esc(a.momo_network || '') + ' ' + esc(a.momo_number) : ''}</small></div>${a.id_doc_path ? `<button class='s' data-id='${a.id}' onclick='closeModal();viewKyc(this.dataset.id)'>Identité</button>` : `<small class='mu'>pas de dossier</small>`}</div>`).join('');
  openModal(`<h2>👥 ${esc(m.full_name)} — ${esc(un)}</h2><p class='mu'>${esc(nbTeam(m))}. Identité enregistrée de chaque ambassadeur (lecture seule : c'est le manager qui valide).</p>${rows || `<p class='mu'>Aucun ambassadeur pour le moment.</p>`}<button class='s' style='width:100%;margin-top:10px' onclick='closeModal()'>Fermer</button>`);
}

/* ---------- Administration : nommer un manager (direct s'il n'y en a pas, sinon remise et reprise) ---------- */
function univMgrHtml(u, mgr) {
  const hv = (D.hand || []).find(x => x.university_id === u.id);
  const h = `<p style='margin:4px 0'><b>Manager :</b> ${mgr ? esc(mgr.full_name) + ` <button class='s' data-id='${mgr.id}' onclick='unsetMgr(this.dataset.id)'>Retirer</button>` : `<span class='mu'>Aucun</span>`}</p>`;
  if (hv) {
    const due = r2(sum(unpaid((D.mled || []).filter(l => l.manager_id === hv.outgoing_id)), 'usd'));
    return h + `<div class='box'><small>🔁 Remise et reprise en cours</small><b>${esc(hv.outgoing_name)} → ${esc(hv.incoming_name)}</b><br><small>${hv.status === 'pending' ? 'En attente de la remise par le manager sortant' : 'Remise faite : en attente de la reprise par le successeur'}</small>${due > 0 ? `<br><small class='down'>⚠️ Gains non payés du manager sortant : ${usd(due)}. Payez-les (onglet 💰 Paie) avant la reprise.</small>` : ''}<div class='acts'><button class='ko' data-id='${hv.id}' onclick='cancelHandover(this.dataset.id)'>Annuler la remise</button></div></div>`;
  }
  const opts = (D.ambs || []).filter(a => a.stage === 'active' && a.active && (!mgr || a.id !== mgr.id)).map(a => `<option value='${a.id}'>${esc(a.full_name)} — ${esc(((D.univ || []).find(x => x.id === a.university_id) || {}).name || 'sans université')}</option>`).join('');
  return h + `<div style='display:flex;gap:6px'><select id='mp-${u.id}' style='margin:0'><option value=''>— Choisir la personne —</option>${opts}</select><button class='ok' data-id='${u.id}' data-m='${mgr ? 1 : 0}' onclick='startHandover(this.dataset.id, this.dataset.m == 1)'>${mgr ? 'Remplacer' : 'Nommer'}</button></div>${mgr ? `<p class='mu' style='margin:4px 0 0'><small>Un manager est déjà en poste : le remplacement se fait par remise et reprise entre les deux personnes. La personne peut venir d'une autre université.</small></p>` : ''}`;
}
async function startHandover(uid, hasM) {
  const sel = $('#mp-' + uid), pid = sel && sel.value;
  if (!pid) return alert('Choisissez la personne à nommer.');
  const p = (D.ambs || []).find(a => a.id === pid), un = ((D.univ || []).find(x => x.id === uid) || {}).name || '';
  const q = hasM
    ? `Remplacer le manager de « ${un} » par ${p.full_name} ? Le manager actuel fera la remise, puis ${p.full_name} fera la reprise. Tant que la reprise n'est pas faite, rien ne change.`
    : `Nommer ${p.full_name} manager de « ${un} » ? Il n'y a pas de manager : cette personne prend le relais tout de suite.`;
  if (!confirm(q)) return;
  const { data, error } = await sb.rpc('admin_start_handover', { p_univ: uid, p_user: pid });
  if (error) return alert(/duplicate|unique/i.test(error.message) ? 'Une remise et reprise est déjà en cours pour cette université.' : error.message);
  toast(data === 'direct' ? 'Manager nommé : il prend le relais directement' : 'Remise et reprise lancée : les deux personnes sont prévenues');
  await refresh();
}
async function cancelHandover(id) {
  if (!confirm(`Annuler cette remise et reprise ? Le manager actuel reste en poste.`)) return;
  const { error } = await sb.rpc('admin_cancel_handover', { p_id: id });
  if (error) return alert(error.message);
  toast('Remise et reprise annulée'); await refresh();
}

/* ---------- Manager sortant (remise) et successeur (reprise) ---------- */
function handoverMgrHtml() {
  const hs = D.hand || [];
  const out = hs.find(h => h.outgoing_id === me.id && (h.status === 'pending' || h.status === 'handed'));
  const got = hs.find(h => h.incoming_id === me.id && h.status === 'done' && h.done_at && Date.now() - new Date(h.done_at).getTime() < 30 * 86400000);
  let x = '';
  if (out && out.status === 'pending') x += `<div class='card' style='border-color:var(--ac)'><h2>🔁 Remise et reprise</h2><p style='margin:0 0 8px'>L'administration a désigné <b>${esc(out.incoming_name)}</b> pour vous succéder comme manager de <b>${esc(out.university_name)}</b>. Laissez-lui une note de passation, puis confirmez la remise.</p><p class='mu' style='margin:0 0 8px'><small>Votre successeur reprendra l'équipe, ses ventes, ses objectifs et l'historique des consignes. Vos gains, paiements, dettes, numéro mobile money et notifications restent privés. Vous redeviendrez ambassadeur.</small></p><textarea id='hnote' rows='3' maxlength='1000' placeholder='Note de passation (optionnel) : ambassadeurs à suivre, points importants…'></textarea><p class='err' id='herr'></p><button class='p' data-id='${out.id}' onclick='giveHandover(this.dataset.id)'>Confirmer la remise</button></div>`;
  if (out && out.status === 'handed') x += `<div class='card'><h2>🔁 Remise faite</h2><p style='margin:0'>En attente de la reprise par <b>${esc(out.incoming_name)}</b>. Vous restez manager jusque-là.</p></div>`;
  if (got) x += `<div class='card'><h2>🔁 Passation de ${esc(got.outgoing_name)}</h2><p style='margin:0;white-space:pre-line'>${got.note ? esc(got.note) : `<span class='mu'>Aucune note de passation.</span>`}</p></div>`;
  return x;
}
function handoverAmbHtml() {
  const h = (D.hand || [])[0]; if (!h) return '';
  if (h.status === 'pending') return `<div class='card' style='border-color:var(--ac)'><h2>🔁 Vous allez devenir manager</h2><p style='margin:0'>L'administration vous a désigné(e) pour succéder à <b>${esc(h.outgoing_name)}</b> comme manager de <b>${esc(h.university_name)}</b>. Vous serez prévenu(e) dès que la remise sera faite.</p></div>`;
  return `<div class='card' style='border-color:var(--ac)'><h2>🔁 Reprise de ${esc(h.university_name)}</h2><p style='margin:0 0 6px'><b>${esc(h.outgoing_name)}</b> vous a fait la remise.</p>${h.note ? `<div class='box'><small>Note de passation</small><span style='white-space:pre-line'>${esc(h.note)}</span></div>` : ''}<p class='mu' style='margin:0 0 8px'><small>En reprenant, vous devenez manager : vous validez les nouveaux ambassadeurs et suivez l'équipe, ses ventes et ses objectifs. Vos données personnelles restent privées.</small></p><p class='err' id='herr'></p><button class='p' data-id='${h.id}' onclick='takeHandover(this.dataset.id)'>Reprendre la gestion</button></div>`;
}
async function giveHandover(id) {
  const er = $('#herr'); if (er) er.textContent = '';
  if (!confirm(`Confirmer la remise ? Votre successeur pourra ensuite reprendre la gestion de l'équipe.`)) return;
  const { error } = await sb.rpc('handover_give', { p_id: id, p_note: (($('#hnote') || {}).value || '') });
  if (error) { if (er) er.textContent = errMsg(error); return; }
  toast('Remise confirmée : votre successeur est prévenu'); await refresh();
}
async function takeHandover(id) {
  const er = $('#herr'); if (er) er.textContent = '';
  if (!confirm(`Reprendre la gestion de l'équipe ? Vous deviendrez manager.`)) return;
  const { error } = await sb.rpc('handover_take', { p_id: id });
  if (error) { if (er) er.textContent = errMsg(error); return; }
  toast('Vous êtes maintenant manager 🎉'); boot();
}

/* ---------- QR code et lien de partage de l'application ---------- */
function appLink() { return location.origin + (location.pathname.endsWith('index.html') ? location.pathname.slice(0, -10) : location.pathname); }
function openShare() {
  closeShare();
  const url = appLink(); let qr = '';
  try { const q = qrcode(0, 'M'); q.addData(url); q.make(); qr = q.createImgTag(8, 3, 'QR code'); } catch (e) { qr = ''; }
  const m = document.createElement('div'); m.className = 'modal'; m.id = 'shm';
  m.innerHTML = `<div style='text-align:center'><h2>📲 Partager l'application</h2><p class='mu' style='margin:0 0 8px'>Scannez ce QR code ou envoyez le lien : la personne ouvre l'application directement, puis touche « Installer ».</p><div class='qr'>${qr || `<p class='mu'>QR code indisponible (connexion ?) : utilisez le lien ci-dessous.</p>`}</div><div class='box' style='word-break:break-all;margin-top:10px'><small>Lien de l'application</small><b style='font-size:14px'>${esc(url)}</b></div><div class='acts' style='justify-content:center'><button class='p' style='width:auto' onclick='copyAppLink()'>Copier le lien</button><button class='s' onclick='shareAppLink()'>Partager…</button></div><button class='s' style='width:100%;margin-top:10px' onclick='closeShare()'>Fermer</button></div>`;
  document.body.appendChild(m);
}
function closeShare() { const m = $('#shm'); if (m) m.remove(); }
async function copyAppLink() {
  try { await navigator.clipboard.writeText(appLink()); toast('Lien copié'); }
  catch (e) { prompt('Copiez ce lien :', appLink()); }
}
async function shareAppLink() {
  const url = appLink(), txt = `Installe l'application ADG Ambassadeurs d'Answer Digital`;
  if (navigator.share) { try { await navigator.share({ title: 'ADG Ambassadeurs', text: txt, url }); } catch (e) {} }
  else window.open('https://wa.me/?text=' + encodeURIComponent(txt + ' : ' + url), '_blank');
}
