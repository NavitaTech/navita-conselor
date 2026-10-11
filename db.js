/* Supabase-backed storage for study plans.
   Every answer and every derived result is kept, so a plan can be reopened in full. */
'use strict';

const DB = (() => {
  const URL = 'https://veqcuykykoqyetnxpgjg.supabase.co';
  const KEY = 'sb_publishable_Xv3O6GZTbF6kDGElJ1t4Qg_NdYF2w9F';
  const sb = window.supabase.createClient(URL, KEY, {auth: {persistSession: true, autoRefreshToken: true}});
  let currentId = null;

  const session = async () => (await sb.auth.getSession()).data.session;
  const signIn = (email, password) => sb.auth.signInWithPassword({email, password});
  const signOut = () => sb.auth.signOut();
  const onAuth = fn => sb.auth.onAuthStateChange((_e, s) => fn(s));

  /* collect every form field plus the subject table */
  function snapshot() {
    const answers = {};
    document.querySelectorAll('#formView input,#formView select,#formView textarea').forEach(el => {
      if (!el.id) return;
      answers[el.id] = el.type === 'checkbox' ? el.checked : el.value;
    });
    answers.__seg = {nationality: S.nationality, stream: S.stream};
    answers.__subjects = S.subjects.filter(Boolean);
    return answers;
  }

  function restore(answers) {
    if (!answers) return;
    S.subjects.length = 0;
    document.getElementById('subjBody').innerHTML = '';
    (answers.__subjects || []).forEach(() => addSubject());
    const rows = [...document.querySelectorAll('#subjBody tr')];
    (answers.__subjects || []).forEach((s, i) => {
      S.subjects[i] = {...s};
      const f = rows[i] ? rows[i].querySelectorAll('[data-k]') : [];
      if (f.length) { f[0].value = s.name || ''; f[1].value = s.level || 'IGCSE'; f[2].value = s.grade || ''; f[3].value = s.session || ''; }
    });
    if (answers.__seg) { S.nationality = answers.__seg.nationality; S.stream = answers.__seg.stream; }
    Object.entries(answers).forEach(([k, v]) => {
      if (k.startsWith('__')) return;
      const el = document.getElementById(k);
      if (!el) return;
      if (el.type === 'checkbox') el.checked = !!v; else el.value = v ?? '';
    });
    document.querySelectorAll('[data-seg]').forEach(seg => {
      const key = seg.dataset.seg;
      seg.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String((S[key] ?? '') === b.dataset.v)));
    });
    certUI(); trackUI(); recompute();
  }

  function derived() {
    const ch = checks(), me = meritEligible(), ms = matches();
    const issues = ch.filter(c => c.level !== 'ok');
    return {
      percentage: percentage(), stream: stream(), track: track(),
      age: ageAt(document.getElementById('q_dob').value, document.getElementById('q_date').value),
      merit: me, checks: ch, issues: issues.length,
      subjects: $('#q_cert').value === 'en' ? computeSubjects() : null,
      matches: ms.map(x => ({major: x.m.en, majorAr: x.m.ar, country: x.c.code, min: x.m.min_pct, tier: x.tier})),
      universities: ms.slice(0, 3).map(x => ({
        major: x.m.en, country: x.c.code,
        list: universitiesFor(x.m.en, x.c.code).slice(0, 5).map(u => ({id: u.u.id, name: u.u.en, merit: !!u.u.merit})),
      })),
      plan_year: PLAN.year, saved_at: new Date().toISOString(),
    };
  }

  async function save() {
    const s = await session();
    if (!s) throw new Error('not signed in');
    const d = derived(), ch = d.checks;
    const row = {
      student_name: clean(document.getElementById('q_name').value),
      national_id: clean(document.getElementById('q_cid').value) || null,
      phone: clean(document.getElementById('q_phone').value) || null,
      counsellor_name: clean(document.getElementById('q_counselor').value) || null,
      interview_date: document.getElementById('q_date').value || null,
      results_date: document.getElementById('q_results').value || null,
      plan_year: PLAN.year,
      track: d.track, percentage: d.percentage, stream: d.stream,
      merit_eligible: d.merit ? d.merit.ok : null,
      checks_passed: ch.length - d.issues, checks_total: ch.length,
      answers: snapshot(), computed: d,
      plan_lang: S.planLang, plan_size: S.planSize,
    };
    if (currentId) {
      const {error} = await sb.from('study_plan').update(row).eq('id', currentId);
      if (error) throw error;
      return currentId;
    }
    const {data, error} = await sb.from('study_plan').insert(row).select('id').single();
    if (error) throw error;
    currentId = data.id;
    return currentId;
  }

  async function list(q) {
    let sel = sb.from('study_plan')
      .select('id,student_name,national_id,counsellor_name,interview_date,percentage,track,plan_year,updated_at,created_at')
      .is('deleted_at', null).order('created_at', {ascending: false}).limit(60);
    if (q) sel = sel.ilike('student_name', `%${q}%`);
    const {data, error} = await sel;
    if (error) throw error;
    return data || [];
  }

  async function open(id) {
    const {data, error} = await sb.from('study_plan').select('*').eq('id', id).single();
    if (error) throw error;
    currentId = id;
    restore(data.answers);
    if (data.plan_lang) S.planLang = data.plan_lang;
    if (data.plan_size) S.planSize = data.plan_size;
    return data;
  }

  const newPlan = () => { currentId = null; };
  const id = () => currentId;

  return {sb, session, signIn, signOut, onAuth, save, list, open, newPlan, id, snapshot, restore, derived};
})();
