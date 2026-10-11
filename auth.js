/* Sign-in gate and the saved-plans drawer. */
'use strict';

(function () {
  const gate = document.getElementById('gate');
  const toastEl = document.getElementById('toast');
  let toastTimer = null;
  const toast = msg => {
    toastEl.textContent = msg; toastEl.classList.add('on');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => toastEl.classList.remove('on'), 2600);
  };

  const showGate = show => gate.classList.toggle('hide', !show);
  const err = m => document.getElementById('gateErr').innerHTML = m ? `<div class="err">${m}</div>` : '';

  async function signIn() {
    const email = document.getElementById('authEmail').value.trim();
    const pass = document.getElementById('authPass').value;
    if (!email || !pass) { err('Enter your email and password.'); return; }
    const btn = document.getElementById('authBtn');
    btn.disabled = true; btn.textContent = 'Signing in…'; err('');
    const {error} = await DB.signIn(email, pass);
    btn.disabled = false; btn.textContent = 'Sign in';
    if (error) { err(error.message); return; }
    document.getElementById('authPass').value = '';
  }
  document.getElementById('authBtn').onclick = signIn;

  document.getElementById('forgotBtn').onclick = async e => {
    e.preventDefault();
    const email = document.getElementById('authEmail').value.trim();
    if (!email) { err('Type your email above first, then press this again.'); return; }
    const {error} = await DB.sb.auth.resetPasswordForEmail(email);
    err('');
    if (error) { err(error.message); return; }
    document.getElementById('gateErr').innerHTML =
      `<div class="err" style="background:var(--ok-bg);color:var(--ok-fg)">A reset link was sent to ${esc(email)}. Open it to set a new password, then come back and sign in.</div>`;
  };
  document.getElementById('authPass').addEventListener('keydown', e => { if (e.key === 'Enter') signIn(); });

  DB.onAuth(s => {
    showGate(!s);
    const who = document.getElementById('who');
    if (s) {
      who.innerHTML = `${esc(s.user.email)} · <a href="#" id="outBtn">sign out</a>`;
      const o = document.getElementById('outBtn');
      if (o) o.onclick = async e => { e.preventDefault(); await DB.signOut(); location.reload(); };
    } else who.textContent = '';
  });
  DB.session().then(s => showGate(!s));

  /* save */
  document.getElementById('saveBtn').onclick = async () => {
    const name = clean(document.getElementById('q_name').value);
    if (!name) { toast('Enter the student name first.'); return; }
    const btn = document.getElementById('saveBtn');
    btn.disabled = true; btn.textContent = 'Saving…';
    try { await DB.save(); toast(DB.id() ? 'Saved.' : 'Saved.'); }
    catch (e) { toast('Could not save: ' + (e.message || e)); }
    finally { btn.disabled = false; btn.textContent = 'Save'; }
  };

  document.getElementById('newBtn').onclick = () => {
    if (!confirm('Start a new plan? Save the current one first if you need it.')) return;
    DB.newPlan(); location.reload();
  };

  /* saved plans drawer */
  const drawer = document.getElementById('saved'), scrim = document.getElementById('scrim2');
  const close = () => { drawer.classList.remove('on'); scrim.classList.remove('on'); };
  scrim.onclick = close;
  document.getElementById('closeSaved').onclick = close;
  addEventListener('keydown', e => { if (e.key === 'Escape') close(); });

  async function loadList(q) {
    const box = document.getElementById('savedList');
    box.innerHTML = '<div style="font-size:12.5px;color:var(--text-3)">Loading…</div>';
    try {
      const rows = await DB.list(q);
      box.innerHTML = rows.length ? rows.map(r => `<div class="pitem2" data-id="${r.id}">
          <b>${esc(r.student_name)}</b>
          <span>${esc(r.counsellor_name || '—')} · ${esc(r.interview_date || r.created_at.slice(0,10))}
          · ${r.percentage != null ? r.percentage + '%' : '—'} · ${esc(r.plan_year || '')}</span></div>`).join('')
        : '<div style="font-size:12.5px;color:var(--text-3)">No saved plans yet.</div>';
      box.querySelectorAll('[data-id]').forEach(el => el.onclick = async () => {
        try { await DB.open(el.dataset.id); close(); toast('Plan loaded.'); }
        catch (e) { toast('Could not open: ' + (e.message || e)); }
      });
    } catch (e) {
      box.innerHTML = `<div style="font-size:12.5px;color:var(--bad-fg)">${esc(e.message || String(e))}</div>`;
    }
  }
  document.getElementById('openBtn').onclick = () => {
    drawer.classList.add('on'); scrim.classList.add('on'); loadList('');
  };
  let t = null;
  document.getElementById('savedQ').addEventListener('input', e => {
    clearTimeout(t); const v = e.target.value; t = setTimeout(() => loadList(v), 250);
  });
})();
