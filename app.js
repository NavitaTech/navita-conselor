/* Navita Study Plan Builder — counselor tool.
   Rules come from the scholarship regulation (decision 103 of 2/4/2025) and the
   ministry's scholarship plan for 2026/2027. */
'use strict';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num = n => Number(n || 0).toLocaleString('en-US');
const clean = s => String(s ?? '').trim();

let PLAN = null, UNIS = [], PROGS = [], META = null, PARTNERS = null;
const partnerIds = new Set();
const uniById = new Map();
let progsByUni = new Map();

/* ---------- state ---------- */
const S = {
  nationality: 'yes', stream: 'science', planLang: 'ar', planSize: 'one',
  subjects: [], // {name, level, grade, session}
};

/* ---------- grade tables (regulation, article 3) ---------- */
const IG_LETTER = {'A*':100, 'A':95, 'B':85, 'C':75, 'D':65};
const IG_NUM = {'9':100, '8':98, '7':95, '6':88, '5':82, '4':75, '3':62};
const GRADES = ['A*','A','B','C','D','9','8','7','6','5','4','3'];
const EXCLUDED = /arabic|islam|quran|qur'an|عرب|إسلام|قرآن|music|art(?!ificial)|drama|theat|physical education|sport|موسيق|رياضة بدنية|مسرح|فنية/i;
const SCI = {math:/math/i, phys:/phys/i, chem:/chem/i, bio:/bio/i};

const gradeValue = g => IG_LETTER[g] ?? IG_NUM[g] ?? null;

/* ---------- boot ---------- */
(async function boot() {
  [PLAN, UNIS, META, PARTNERS] = await Promise.all([
    fetch('data/plan.json').then(r => r.json()),
    fetch('data/universities.json').then(r => r.json()),
    fetch('data/meta.json').then(r => r.json()),
    fetch('data/partners.json').then(r => r.json()),
  ]);
  const pr = await fetch('data/programs.json').then(r => r.json());
  const str = pr.strings;
  PROGS = pr.rows.map(r => ({uid: r[1], major: str[r[2]], majorAr: str[r[3]], st: r[6], merit: r[7]}));
  PROGS.forEach(p => {
    if (!progsByUni.has(p.uid)) progsByUni.set(p.uid, []);
    progsByUni.get(p.uid).push(p);
  });
  const cname = new Map(META.countriesList.map(c => [c.id, c.en]));
  UNIS.forEach(u => { u.country = cname.get(u.c) || ''; uniById.set(u.id, u); });
  PARTNERS.partners.forEach(p => partnerIds.add(p.uid));

  initForm();
  recompute();
})();

/* ---------- form wiring ---------- */
function initForm() {
  const today = new Date().toISOString().slice(0, 10);
  $('#q_date').value = today;

  const gy = $('#q_gradYear'), yNow = new Date().getFullYear();
  for (let y = yNow + 1; y >= yNow - 8; y--) gy.add(new Option(`${y - 1}/${y}`, String(y)));
  gy.value = String(yNow);

  // majors and countries from the plan
  const majors = new Map();
  PLAN.countries.forEach(c => c.majors.forEach(m => {
    if (!majors.has(m.en)) majors.set(m.en, m.ar);
  }));
  const mOpts = '<option value="">—</option>' +
    [...majors.entries()].sort((a, b) => a[0].localeCompare(b[0]))
      .map(([en, ar]) => `<option value="${esc(en)}">${esc(en)} — ${esc(ar)}</option>`).join('');
  document.querySelectorAll('.majorSel').forEach(s => s.innerHTML = mOpts);

  const cOpts = '<option value="">—</option>' +
    PLAN.countries.map(c => `<option value="${c.code}">${esc(c.en)} — ${esc(c.ar)}</option>`).join('');
  document.querySelectorAll('.ctrySel').forEach(s => s.innerHTML = cOpts);

  $('#uniList').innerHTML = UNIS.slice().sort((a, b) => a.en.localeCompare(b.en))
    .map(u => `<option value="${esc(u.en)}">`).join('');

  // segmented controls
  document.querySelectorAll('[data-seg]').forEach(seg => {
    const key = seg.dataset.seg;
    const sync = () => seg.querySelectorAll('button').forEach(b =>
      b.setAttribute('aria-pressed', String((S[key] ?? '') === b.dataset.v)));
    seg.querySelectorAll('button').forEach(b => b.onclick = () => {
      S[key] = b.dataset.v; sync();
      if (key === 'planLang' || key === 'planSize') renderPlan(); else recompute();
    });
    sync();
  });

  addSubject(); addSubject(); addSubject();
  $('#addSubj').onclick = () => { addSubject(); recompute(); };
  $('#q_cert').onchange = () => { certUI(); recompute(); };
  certUI();

  document.querySelectorAll('input,select,textarea').forEach(el => {
    el.addEventListener('input', recompute);
    el.addEventListener('change', recompute);
  });

  $('#q_status').onchange = () => { trackUI(); recompute(); };
  trackUI();

  $('#buildBtn').onclick = () => { buildPlan(); document.body.classList.add('planning'); window.scrollTo(0, 0); };
  $('#backBtn').onclick = () => { document.body.classList.remove('planning'); window.scrollTo(0, 0); };
  $('#printBtn').onclick = () => window.print();
  $('#lhToggle').onchange = () => document.querySelectorAll('.sheet')
    .forEach(el => el.classList.toggle('lh', $('#lhToggle').checked));
  const rb = $('#resetBtn'); if (rb) rb.onclick = () => { if (confirm('Clear every answer and start again?')) location.reload(); };
}

function certUI() {
  const t = $('#q_cert').value;
  $('#f_subjects').style.display = t === 'en' ? '' : 'none';
  $('#f_us').style.display = t === 'us' ? '' : 'none';
  $('#f_ib').style.display = t === 'ib' ? '' : 'none';
  $('#f_sa').style.display = t === 'sa' ? '' : 'none';
  $('#f_equiv').style.display = t === 'kw' ? 'none' : '';
  const derived = (t === 'en' || t === 'ib');
  $('#f_stream').style.display = derived ? 'none' : '';
  $('#f_pct').style.display = derived ? 'none' : '';
}

function trackUI() {
  const st = $('#q_status').value;
  $('#sec_join').style.display = (st === 'selffund' || st === 'diploma') ? '' : 'none';
  $('#sec_rejoin').style.display = st === 'expelled' ? '' : 'none';
  $('#sec_pg').style.display = st === 'bachelor' ? '' : 'none';
  $('#sec_hs').style.display = st === 'bachelor' ? 'none' : '';
}

function addSubject() {
  const tb = $('#subjBody'), i = S.subjects.length;
  S.subjects.push({name: '', level: 'IGCSE', grade: '', session: ''});
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><input type="text" data-i="${i}" data-k="name" placeholder="Mathematics"></td>
    <td><select data-i="${i}" data-k="level"><option>IGCSE</option><option>AS</option><option>A</option></select></td>
    <td><select data-i="${i}" data-k="grade"><option value="">—</option>${GRADES.map(g => `<option>${g}</option>`).join('')}</select></td>
    <td><select data-i="${i}" data-k="session"><option value="">—</option>${
      ['Jun 2026','Jan 2026','Jun 2025','Jan 2025','Jun 2024','Jan 2024','Jun 2023','earlier']
        .map(s => `<option>${s}</option>`).join('')}</select></td>
    <td class="x"><button class="iconbtn" title="Remove">×</button></td>`;
  tb.appendChild(tr);
  tr.querySelectorAll('[data-k]').forEach(el => el.addEventListener('input', e => {
    S.subjects[+e.target.dataset.i][e.target.dataset.k] = e.target.value;
    recompute();
  }));
  tr.querySelector('.iconbtn').onclick = () => { S.subjects[i] = null; tr.remove(); recompute(); };
}

/* ---------- engine ---------- */
function ageAt(dobStr, atStr) {
  if (!dobStr) return null;
  const d = new Date(dobStr), at = atStr ? new Date(atStr) : new Date();
  if (isNaN(d) || isNaN(at)) return null;
  let a = at.getFullYear() - d.getFullYear();
  const m = at.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && at.getDate() < d.getDate())) a--;
  return a;
}
const studyStart = () => {
  const y = +($('#q_gradYear').value || new Date().getFullYear());
  return `${y + 1}-09-01`; // ministry plans start the following September
};

function computeSubjects() {
  const rows = S.subjects.filter(Boolean).filter(s => clean(s.name) && s.grade);
  const kept = rows.filter(s => !EXCLUDED.test(s.name));
  const igcse = kept.filter(s => s.level === 'IGCSE');
  const advanced = kept.filter(s => s.level === 'AS' || s.level === 'A');
  const vals = igcse.map(s => gradeValue(s.grade)).filter(v => v != null);
  const pct = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  const has = re => kept.some(s => re.test(s.name));
  const science = has(SCI.math) && has(SCI.phys) && has(SCI.chem) && has(SCI.bio);
  const belowC = kept.filter(s => ['D','4','3'].includes(s.grade) || ['3'].includes(s.grade));
  const dCount = kept.filter(s => s.grade === 'D' || s.grade === '3').length;
  return {
    rows, kept, count: kept.length, igcseCount: igcse.length, advCount: advanced.length,
    pct: pct == null ? null : Math.round(pct * 100) / 100,
    science, dCount, excluded: rows.length - kept.length,
  };
}

function percentage() {
  const t = $('#q_cert').value;
  if (t === 'en') return computeSubjects().pct;
  if (t === 'ib') {
    const p = +$('#q_ibPts').value;
    return p ? Math.round((p / 45) * 100 * 100) / 100 : null;
  }
  if (t === 'sa') {
    const g = +$('#q_pct').value, q = +$('#q_qud').value, h = +$('#q_tah').value;
    if (g && q && h) return Math.round((g * 0.3 + q * 0.3 + h * 0.4) * 100) / 100;
    return g || null;
  }
  return +$('#q_pct').value || null;
}

function stream() {
  const t = $('#q_cert').value;
  if (t === 'en') return computeSubjects().science ? 'science' : 'arts';
  if (t === 'ib') return $('#q_ibSci').checked ? 'science' : 'arts';
  if (t === 'us') return $('#q_usSci').checked ? 'science' : 'arts';
  return S.stream;
}

function track() {
  const st = $('#q_status').value;
  if (st === 'bachelor') return $('#q_pgTarget').value === 'medicine' ? 'medicine' : 'masters';
  if (st === 'selffund') return 'join';
  if (st === 'diploma') return 'join_diploma';
  if (st === 'expelled') return 'rejoin';
  if (st === 'inkuwait') return 'none';
  return 'fresh';
}
const TRACK_NAME = {
  fresh: ['بعثة اعتيادية أو متميزة', 'Ordinary or merit scholarship'],
  join: ['الضم للبعثة', 'Joining the scholarship'],
  join_diploma: ['الضم لحاملي دبلوم الكليات التطبيقية', 'Joining, applied-colleges diploma'],
  rejoin: ['إعادة الضم', 'Re-joining the scholarship'],
  masters: ['بعثة الماجستير', 'Master\'s scholarship'],
  medicine: ['برنامج الطب المتقدم', 'Advanced medicine programme'],
  none: ['لا ينطبق مسار', 'No applicable track'],
};

/* eligibility checks — each returns {ok, ar, en, ref, level} */
function checks() {
  const out = [];
  const add = (ok, ar, en, ref, level) => out.push({ok, ar, en, ref, level: level || (ok ? 'ok' : 'bad')});
  const tr = track();
  const age = ageAt($('#q_dob').value, $('#q_date').value);
  const ageStart = ageAt($('#q_dob').value, studyStart());

  add(S.nationality === 'yes', 'الطالب كويتي الجنسية', 'Kuwaiti national', 'م2/1');

  if (age != null) {
    if (tr === 'fresh') add(age >= 16 && age <= 23, `السن ${age} سنة، والمطلوب من 16 إلى 23`, `Age ${age}, the range is 16 to 23`, 'م2/2');
    else if (tr === 'join') add(age <= 25, `السن ${age} سنة، والحد الأقصى 25`, `Age ${age}, the limit is 25`, 'م14/أولاً/2');
    else if (tr === 'join_diploma') add(age <= 27, `السن ${age} سنة، والحد الأقصى 27`, `Age ${age}, the limit is 27`, 'م14/رابعاً/2');
    else if (tr === 'medicine') add(age <= 30, `السن ${age} سنة، والحد الأقصى 30`, `Age ${age}, the limit is 30`, 'م18/أولاً/2');
  }

  if (tr === 'fresh' || tr === 'join' || tr === 'join_diploma')
    add($('#q_status').value !== 'bachelor', 'لا يحمل الدرجة الجامعية الأولى', 'Does not already hold a bachelor\'s degree', 'م2/5');

  add(!$('#q_prevSch').checked, 'لم يسبق له الحصول على بعثة أو منحة للبكالوريوس دون استرداد', 'No prior unrepaid scholarship or grant', 'م2/6');
  add(!$('#q_prevEnded').checked, 'لم تنتهِ له بعثة خارجية بالفصل أو الانسحاب بعد الالتحاق', 'No prior external scholarship ended in dismissal or withdrawal', 'خطة ص35');
  add(!$('#q_employed').checked, 'غير موظف في أي جهة من جهات الدولة', 'Not employed by a state body', 'م2/8');

  // certificate validity
  const gy = +$('#q_gradYear').value;
  if (gy) {
    const label = `${gy - 1}/${gy}`;
    const ok = PLAN.general.cert_validity_years.includes(label);
    add(ok, `شهادة الثانوية لعام ${label}، والمقبول ${PLAN.general.cert_validity_years.join(' و ')}`,
        `Certificate from ${label}; accepted years are ${PLAN.general.cert_validity_years.join(' and ')}`, 'م3/أولاً/1');
  }

  if ($('#q_cert').value === 'en') {
    const s = computeSubjects();
    add(s.count >= 8, `عدد المقررات المحتسبة ${s.count}، والمطلوب ثمانية`, `${s.count} counted subjects, eight are required`, 'م3/ثانياً/1');
    add(s.advCount >= 2, `عدد مقررات AS أو A هو ${s.advCount}، والمطلوب اثنان`, `${s.advCount} AS or A-Level subjects, two are required`, 'م3/ثانياً/1');
    add(s.dCount <= 1, `عدد المقررات بتقدير D هو ${s.dCount}، والمسموح واحد`, `${s.dCount} subjects at D, one is allowed`, 'م3/ثانياً/5');
  }
  if ($('#q_cert').value === 'ib') {
    add(+$('#q_ibSubj').value >= 6, 'أتم ست مواد على الأقل', 'Six subjects at least', 'م3/رابعاً/2');
    add(+$('#q_ibHL').value >= 3, 'اجتاز ثلاث مواد بالمستوى العالي', 'Three higher-level subjects', 'م3/رابعاً/3');
    add($('#q_ibMathEng').checked, 'الرياضيات واللغة الإنجليزية ضمن المواد', 'Mathematics and English among the subjects', 'م3/رابعاً/4');
    add($('#q_ibTok').checked, 'اجتاز نظرية المعرفة والمقالة الموسعة', 'Passed TOK and the Extended Essay', 'م3/رابعاً/5');
  }
  if ($('#q_cert').value !== 'kw' && $('#q_equiv').value !== 'done')
    add(false, 'معادلة الشهادة من إدارة التعليم الخاص لم تصدر بعد', 'Ministry of Education equivalency not yet issued', 'خطة ص36', 'warn');

  // language
  const lst = $('#q_langStatus').value;
  if (lst === 'done') {
    const type = $('#q_langType').value, ov = +$('#q_langOverall').value, bd = +$('#q_langBand').value;
    if (type === 'toefl') {
      add(ov >= PLAN.general.toefl_min, `التوفل ${ov}، والحد الأدنى ${PLAN.general.toefl_min}`, `TOEFL ${ov}, minimum is ${PLAN.general.toefl_min}`, 'خطة ص38');
      if ($('#q_langWhere').value !== 'kw')
        add(false, 'التوفل يُقبل من مركز معتمد داخل دولة الكويت فقط', 'TOEFL is accepted only from an approved centre inside Kuwait', 'خطة ص38', 'warn');
    } else {
      add(ov >= PLAN.general.ielts_min_overall && bd >= PLAN.general.ielts_min_band,
        `الآيلتس ${ov} وأقل بند ${bd}، والحد الأدنى ${PLAN.general.ielts_min_overall} في الاثنين`,
        `IELTS ${ov} overall, lowest band ${bd}; the floor is ${PLAN.general.ielts_min_overall} for both`, 'خطة ص38');
    }
  } else {
    add(false, 'لم يحقق درجة اللغة بعد، والمهلة عام ميلادي كامل من إعلان النتائج',
        'English score not yet achieved; the window is one calendar year from the results', 'م2/10', 'warn');
  }

  // national capacity tests
  const wantsMedEng = [1, 2, 3].map(i => $('#q_major' + i).value)
    .some(m => /medicine|dentistry|pharmac|veterinary|engineering/i.test(m || ''));
  if (wantsMedEng && $('#q_natTests').value !== 'done')
    add(false, 'الاختبارات الوطنية الموحدة مطلوبة للتخصصات الطبية والهندسية ولم يؤدها بعد',
        'The national capacity tests are required for medical and engineering majors and have not been taken', 'خطة ص35', 'warn');

  // guardian rule
  const needsGuardian = ageStart != null && ageStart < 18 &&
    [1, 2, 3].map(i => $('#q_ctry' + i).value).some(c => c === 'IE' || c === 'AU');
  if (needsGuardian)
    add(!!$('#q_guardian').value, 'ترتيب المرافقة مطلوب لأن عمر الطالب أقل من 18 عند بدء الدراسة',
        'A guardian arrangement is required because the student is under 18 at the start of study', 'خطة ص39',
        $('#q_guardian').value ? 'ok' : 'warn');

  // track-specific
  if (tr === 'join') {
    const cr = +$('#q_jCredits').value, need = $('#q_jSystem').value === 'qtr' ? 42 : 27;
    add(cr >= need, `الوحدات المجتازة ${cr}، والمطلوب ${need}`, `${cr} credits passed, ${need} are required`, 'م14/ثالثاً/1');
    add(+$('#q_jGpa').value >= 2.5, `المعدل التراكمي ${$('#q_jGpa').value || '—'}، والمطلوب 2.50`, `CGPA ${$('#q_jGpa').value || '—'}, 2.50 is required`, 'م14/ثالثاً/4');
    add(!$('#q_jBreak').checked, 'لم ينقطع عن الدراسة أكثر من عام دراسي', 'Not out of study for more than one academic year', 'م14/أولاً/3');
    const u = UNIS.find(x => x.en.toLowerCase() === clean($('#q_jUni').value).toLowerCase());
    if (clean($('#q_jUni').value))
      add(!!u, u ? 'الجامعة الحالية ضمن قوائم الجهاز الوطني للاعتماد الأكاديمي' : 'الجامعة الحالية غير مدرجة في قوائم الجهاز',
          u ? 'The current university is on the NBAQ list' : 'The current university is not on the NBAQ list', 'م14/أولاً/7');
  }
  if (tr === 'rejoin') {
    add($('#q_rReason').value !== 'disciplinary' || $('#q_rCleared').checked,
        'سبب الفصل ليس تأديبيًا أو رُدّ إليه اعتباره', 'The dismissal was not disciplinary, or it was reversed', 'م15/أولاً/2');
    const merit = $('#q_rMerit').checked;
    add(+$('#q_rCredits').value >= (merit ? 15 : 27),
        `الوحدات بعد الفصل ${$('#q_rCredits').value || 0}، والمطلوب ${merit ? 15 : 27}`,
        `${$('#q_rCredits').value || 0} credits since, ${merit ? 15 : 27} required`, merit ? 'م15/ثانياً/1' : 'م15/أولاً/5');
    add(+$('#q_rGpa').value >= (merit ? 2.0 : 2.5),
        `المعدل ${$('#q_rGpa').value || '—'}، والمطلوب ${merit ? '2.00' : '2.50'}`,
        `CGPA ${$('#q_rGpa').value || '—'}, ${merit ? '2.00' : '2.50'} required`, 'م15/أولاً/6');
    if ($('#q_rDate').value) {
      const yrs = (Date.now() - new Date($('#q_rDate').value)) / (365.25 * 864e5);
      add(yrs <= 2, 'الطلب مقدم خلال عامين من قرار الفصل أو الانسحاب', 'Applied within two years of the decision', 'م15/أولاً/1');
    }
  }
  if (tr === 'masters') {
    if ($('#q_pgDate').value) {
      const yrs = (Date.now() - new Date($('#q_pgDate').value)) / (365.25 * 864e5);
      add(yrs <= 1, 'خلال عام ميلادي من الحصول على البكالوريوس', 'Within one calendar year of the bachelor\'s', 'م19/أولاً');
    }
    add($('#q_pgNoExt').checked, 'أنهى البكالوريوس دون تمديد', 'Completed the bachelor\'s without an extension', 'م19/أولاً/1');
    add(+$('#q_pgNonTrad').value <= 6, 'لم يتجاوز ستة مقررات بالتعليم غير التقليدي', 'No more than six non-traditional courses', 'م19/ثامناً/1');
    const g = parseFloat($('#q_pgGrade').value);
    if ($('#q_pgSystem').value === 'us' && g)
      add(g >= 3.25, `المعدل ${g}، والمطلوب 3.25`, `Grade ${g}, 3.25 is required`, 'م19/أولاً/2');
  }
  if (tr === 'medicine') {
    add(/engineer|science|pharmac|medical/i.test($('#q_pgMajor').value || ''),
        'تخصص البكالوريوس ضمن التخصصات العلمية المقبولة', 'The bachelor\'s is in an accepted science field', 'م18/أولاً/4');
    add(!$('#q_pgHigher').checked, 'لا يحمل ماجستير أو دكتوراه', 'Does not hold a master\'s or doctorate', 'م18/أولاً/7');
    add(stream() === 'science', 'الثانوية بالقسم العلمي', 'High-school certificate in the science stream', 'م18/أولاً/3');
    const g = parseFloat($('#q_pgGrade').value);
    if ($('#q_pgSystem').value === 'us' && g)
      add(g >= 3.0, `المعدل ${g}، والمطلوب 3.00`, `Grade ${g}, 3.00 is required`, 'م18/أولاً/4');
  }
  return out;
}

function meritEligible() {
  const p = percentage();
  if (p == null) return null;
  const wantsMedical = [1, 2, 3].map(i => $('#q_major' + i).value)
    .some(m => PLAN.general.merit_medical_majors.some(x => (m || '').includes(x)));
  const need = wantsMedical ? PLAN.general.merit_min_pct_medical : PLAN.general.merit_min_pct;
  return {ok: p >= need, need, pct: p};
}

/* candidate majors across the plan */
function matches() {
  const p = percentage(), str = stream();
  if (p == null) return [];
  const wanted = [1, 2, 3].map(i => $('#q_major' + i).value).filter(Boolean);
  const wantedC = [1, 2, 3].map(i => $('#q_ctry' + i).value).filter(Boolean);
  const out = [];
  PLAN.countries.forEach(c => {
    if (wantedC.length && !wantedC.includes(c.code)) return;
    c.majors.forEach(m => {
      if (wanted.length && !wanted.includes(m.en)) return;
      if (m.stream === 'science' && str !== 'science') return;
      const gap = p - m.min_pct;
      if (gap < -3) return;
      out.push({c, m, gap, tier: gap >= 5 ? 'safe' : gap >= 0 ? 'match' : 'reach'});
    });
  });
  const order = {safe: 0, match: 1, reach: 2};
  out.sort((a, b) => order[a.tier] - order[b.tier] || b.gap - a.gap || a.m.en.localeCompare(b.m.en));
  return out;
}

/* universities offering a plan major in a plan country.
   Ranking: accreditation and eligibility first, then the commercial preference. */
function universitiesFor(planMajorEn, countryCode) {
  const CMAP = {
    USA: 'United States of America', UK: 'United Kingdom of Great Britain and Northern Ireland',
    IE: 'Republic of Ireland', AU: 'Australia', NZ: 'New Zealand',
    MT: 'Republic of Malta', BH: 'Kingdom of Bahrain', SA: 'Kingdom of Saudi Arabia',
  };
  const cname = CMAP[countryCode];
  const key = planMajorEn.toLowerCase().split(/[\/(]/)[0].trim();
  const words = key.split(/\s+/).filter(w => w.length > 3);
  const hits = [];
  for (const u of UNIS) {
    if (u.country !== cname || u.stopped) continue;
    const ps = progsByUni.get(u.id) || [];
    const match = ps.find(p => {
      const mm = (p.major || '').toLowerCase();
      if (!mm) return false;
      if (mm.includes(key)) return true;
      if (/^all (majors|colleges)/i.test(p.major)) return true;
      return words.length > 1 && words.every(w => mm.includes(w));
    });
    if (match) hits.push({u, prog: match, allMajors: /^all (majors|colleges)/i.test(match.major)});
  }
  hits.sort((a, b) =>
    (partnerIds.has(b.u.id) - partnerIds.has(a.u.id)) ||
    (b.u.merit - a.u.merit) ||
    (a.allMajors - b.allMajors) ||
    (b.u.n - a.u.n) ||
    a.u.en.localeCompare(b.u.en));
  return hits;
}

/* ---------- live panel ---------- */
function recompute() {
  const p = percentage(), str = stream(), tr = track();
  const age = ageAt($('#q_dob').value, $('#q_date').value);
  const ageStart = ageAt($('#q_dob').value, studyStart());
  const me = meritEligible();
  const ch = checks();
  const failed = ch.filter(c => c.level === 'bad');
  const warned = ch.filter(c => c.level === 'warn');

  const kv = (k, v) => `<div class="kv"><span>${k}</span><b>${v}</b></div>`;
  $('#live').innerHTML =
    kv('Track', esc(TRACK_NAME[tr][1])) +
    kv('Age now', age == null ? '—' : age) +
    kv('Age at start', ageStart == null ? '—' : ageStart) +
    kv('Percentage', p == null ? '—' : p + '%') +
    kv('Stream', str === 'science' ? 'Science' : 'Arts') +
    kv('Merit programme', me == null ? '—' :
      me.ok ? '<span class="pill p-ok">eligible</span>' : `<span class="pill p-warn">needs ${me.need}%</span>`) +
    kv('Checks passed', `${ch.length - failed.length - warned.length} of ${ch.length}`);

  $('#flags').innerHTML =
    (failed.map(c => `<div class="flag flag-bad">${esc(c.en)} <span style="opacity:.7">· ${esc(c.ref)}</span></div>`).join('') +
     warned.map(c => `<div class="flag flag-warn">${esc(c.en)} <span style="opacity:.7">· ${esc(c.ref)}</span></div>`).join('')) ||
    '<div class="flag flag-ok">Nothing blocking so far.</div>';

  const ms = matches();
  $('#matches').innerHTML = ms.length
    ? ms.slice(0, 12).map(x => `<div class="matchrow">
        <div class="m"><b>${esc(x.m.en)}</b><span>${esc(x.c.en)} · needs ${x.m.min_pct}%</span></div>
        <span class="pill ${x.tier === 'safe' ? 'p-ok' : x.tier === 'match' ? 'p-info' : 'p-warn'}">${x.tier}</span></div>`).join('') +
      (ms.length > 12 ? `<div style="font-size:11.5px;color:var(--text-3);padding-top:6px">and ${ms.length - 12} more</div>` : '')
    : '<div style="font-size:12.5px;color:var(--text-3)">Enter a percentage to see the majors the student qualifies for.</div>';

  renderPartnerPanel(ms);
  $('#buildBtn').disabled = !clean($('#q_name').value);
}

function renderPartnerPanel(ms) {
  const box = $('#partners');
  const countries = new Set(ms.map(x => x.c.code));
  const CMAP = {USA: 'United States of America', UK: 'United Kingdom of Great Britain and Northern Ireland',
    IE: 'Republic of Ireland', AU: 'Australia', NZ: 'New Zealand', MT: 'Republic of Malta',
    BH: 'Kingdom of Bahrain', SA: 'Kingdom of Saudi Arabia'};
  const wanted = new Set([...countries].map(c => CMAP[c]));
  const rel = PARTNERS.partners.filter(p => !wanted.size || wanted.has(p.country));
  const me = meritEligible();

  let html = '';
  if (me && me.ok)
    html += `<div class="flag flag-warn">This student qualifies for the merit programme. No partner university is on the merit list, so steering them to one costs the extra 50% monthly allowance for the whole degree.</div>`;
  html += rel.length
    ? rel.map(p => `<div class="matchrow">
        <div class="m"><b>${esc(p.name)}</b><span>${esc(p.country)}${p.expires ? ' · until ' + p.expires : ''}${p.note_ar ? ' · ⚠' : ''}</span></div>
        <span class="partner-tag">${p.state === 'pending' ? 'PENDING' : 'PARTNER'}</span></div>`).join('')
    : '<div style="font-size:12.5px;color:var(--text-3)">No partner university in the selected countries.</div>';
  if (PARTNERS.not_accredited.length)
    html += `<div class="flag flag-bad" style="margin-top:9px">${PARTNERS.not_accredited.length} signed partners are not on the NBAQ list and cannot be offered to a scholarship student: ${
      esc(PARTNERS.not_accredited.map(x => x.name).join(', '))}</div>`;
  box.innerHTML = html;
}

/* ---------- plan ---------- */
const T = {
  ar: {
    title: 'الخطة التنفيذية للدراسة بالخارج', sub: 'مبنية على لائحة البعثات والمنح وخطة بعثات وزارة التعليم العالي',
    s1: 'ملف الطالب والمسار', s2: 'فحص الأهلية', s3: 'النسبة والتصنيف', s4: 'الترشيحات',
    s5: 'الجدول الزمني', s6: 'المستندات', s7: 'الخطة الأكاديمية', s8: 'الالتزامات المالية',
    s9: 'المخاطر', s10: 'الخطة البديلة', s11: 'الإقرار والتوقيعات',
    name: 'الاسم', cid: 'الرقم المدني', dob: 'تاريخ الميلاد', age: 'العمر', phone: 'الهاتف',
    counselor: 'المستشار', date: 'تاريخ المقابلة', track: 'المسار', cert: 'الثانوية', streamL: 'التصنيف',
    pct: 'النسبة', science: 'علمي', arts: 'أدبي', item: 'البند', status: 'الحالة', ref: 'المرجع',
    ok: 'مستوفى', bad: 'غير مستوفى', warn: 'يحتاج استكمالًا',
    major: 'التخصص', country: 'الدولة', need: 'الحد الأدنى', level: 'التقييم', unis: 'جامعات مقترحة',
    safe: 'آمن', match: 'مناسب', reach: 'طموح',
    when: 'الموعد', what: 'المطلوب', doc: 'المستند', note: 'ملاحظة',
    disclaimer: 'هذه الخطة وثيقة استشارية أعدّها مستشار نڤيتا بناءً على لائحة البعثات والمنح الصادرة بالقرار الوزاري رقم (103) بتاريخ 2025/4/2 وخطة بعثات وزارة التعليم العالي للعام الجامعي 2026/2027. المرجع الرسمي في أي قرار نهائي هو وزارة التعليم العالي والجهاز الوطني للاعتماد الأكاديمي.',
    sigS: 'توقيع الطالب', sigG: 'توقيع ولي الأمر', sigC: 'توقيع المستشار',
    page: 'صفحة', of: 'من', notesH: 'ملاحظات المستشار',
  },
  en: {
    title: 'Study Abroad Action Plan', sub: 'Built on the scholarship regulation and the Ministry of Higher Education scholarship plan',
    s1: 'Student profile and track', s2: 'Eligibility check', s3: 'Percentage and stream', s4: 'Recommendations',
    s5: 'Timeline', s6: 'Documents', s7: 'Academic plan', s8: 'Financial obligations',
    s9: 'Risks', s10: 'Fallback plan', s11: 'Acknowledgement and signatures',
    name: 'Name', cid: 'Civil ID', dob: 'Date of birth', age: 'Age', phone: 'Phone',
    counselor: 'Counselor', date: 'Interview date', track: 'Track', cert: 'Certificate', streamL: 'Stream',
    pct: 'Percentage', science: 'Science', arts: 'Arts', item: 'Item', status: 'Status', ref: 'Reference',
    ok: 'Met', bad: 'Not met', warn: 'Needs action',
    major: 'Major', country: 'Country', need: 'Minimum', level: 'Fit', unis: 'Suggested universities',
    safe: 'Safe', match: 'Match', reach: 'Reach',
    when: 'When', what: 'What is required', doc: 'Document', note: 'Note',
    disclaimer: 'This plan is an advisory document prepared by a Navita counselor under the scholarship regulation issued by ministerial decision 103 of 2 April 2025 and the Ministry of Higher Education scholarship plan for 2026/2027. The official reference for any final decision is the Ministry of Higher Education and the National Bureau for Academic Accreditation.',
    sigS: 'Student signature', sigG: 'Guardian signature', sigC: 'Counselor signature',
    page: 'Page', of: 'of', notesH: 'Counselor notes',
  },
};

const CERT_NAME = {
  kw: ['الثانوية الكويتية الموحدة', 'Kuwaiti unified'], en: ['الثانوية الإنجليزية', 'English'],
  us: ['الثانوية الأمريكية', 'American'], ib: ['البكالوريا الدولية', 'International Baccalaureate'],
  sa: ['الثانوية السعودية', 'Saudi'], other: ['شهادة معادَلة', 'Equivalated certificate'],
};

function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); }
function addYears(d, n) { const x = new Date(d); x.setFullYear(x.getFullYear() + n); return x.toISOString().slice(0, 10); }

function buildPlan() { renderPlan(); }

/* ---------- one-page plan ---------- */
function renderOnePage() {
  const L = S.planLang, t = T[L], rtl = L === 'ar', i = rtl ? 0 : 1;
  const lh = $('#lhToggle').checked;
  const p = percentage(), str = stream(), tr = track();
  const age = ageAt($('#q_dob').value, $('#q_date').value);
  const ch = checks(), ms = matches(), me = meritEligible();
  const issues = ch.filter(c => c.level !== 'ok');
  const res = $('#q_results').value;
  const nm = clean($('#q_name').value);

  let h = `<div class="hd"><div><h2>${esc(t.title)}</h2><div class="lede">${esc(t.sub)}</div></div>
    <div class="meta"><b>${esc(nm)}</b><br>${esc(t.cid)} ${esc(clean($('#q_cid').value) || '—')} · ${esc($('#q_date').value || '')}
    <br>${esc(t.counselor)}: ${esc(clean($('#q_counselor').value) || '—')} · ${esc(PLAN.year)}</div></div>`;

  h += `<div class="chips">
    <div class="chip-stat"><span class="k">${esc(t.pct)}</span><span class="v">${p == null ? '—' : p + '%'}</span></div>
    <div class="chip-stat"><span class="k">${esc(t.streamL)}</span><span class="v">${esc(str === 'science' ? t.science : t.arts)}</span></div>
    <div class="chip-stat"><span class="k">${esc(t.age)}</span><span class="v">${age == null ? '—' : age}</span></div>
    <div class="chip-stat accent"><span class="k">${esc(t.track)}</span><span class="v" style="font-size:7.4pt">${esc(TRACK_NAME[tr][i])}</span></div>
    ${me ? `<div class="chip-stat ${me.ok ? 'accent' : ''}"><span class="k">${rtl ? 'البعثة المتميزة' : 'Merit'}</span>
      <span class="v" style="font-size:7.4pt">${me.ok ? (rtl ? 'مؤهل' : 'Eligible') : (rtl ? `يحتاج ${me.need}%` : `Needs ${me.need}%`)}</span></div>` : ''}
  </div>`;

  h += `<div class="cols"><div>`;

  /* eligibility */
  h += `<h3><span class="n">1.</span>${esc(t.s2)}</h3>`;
  h += `<p class="inline"><b>${ch.length - issues.length}</b> ${rtl ? `من ${ch.length} بندًا مستوفاة` : `of ${ch.length} checks met`}${
    issues.length ? (rtl ? '، والباقي أدناه.' : '; the rest are below.') : (rtl ? '.' : '.')}</p>`;
  if (issues.length) {
    h += `<table><tbody>` + issues.map(c => `<tr class="${c.level}"><td>${esc(c[rtl ? 'ar' : 'en'])}</td>
      <td style="width:20%"><span class="st st-${c.level === 'bad' ? 'bad' : 'warn'}">${esc(c.level === 'bad' ? t.bad : t.warn)}</span></td>
      <td style="width:17%">${esc(c.ref)}</td></tr>`).join('') + `</tbody></table>`;
  }

  /* timeline */
  h += `<h3><span class="n">3.</span>${esc(t.s5)}</h3>`;
  if (res) {
    const rows = [
      [res, rtl ? 'إعلان نتائج القبول' : 'Results announced'],
      [addDays(res, 60), rtl ? 'الثانوية الأصلية وتوقيع التعهد عبر سهل، واستكمال التسجيل' : 'Original certificate, undertaking via Sahel, registration complete'],
      [addYears(res, 1), rtl ? 'تحقيق درجة اللغة قبل السفر' : 'English score achieved, before travel'],
      [studyStart(), rtl ? 'بداية الدراسة، والوصول قبلها بأسبوعين كحد أقصى' : 'Study starts; arrive at most two weeks before'],
    ];
    h += `<table><tbody>` + rows.map(r => `<tr><td style="width:27%">${r[0]}</td><td>${esc(r[1])}</td></tr>`).join('') + `</tbody></table>`;
  } else {
    h += `<p class="inline">${rtl ? 'أدخل تاريخ إعلان النتائج لتظهر المواعيد.' : 'Enter the results date to see the deadlines.'}</p>`;
  }

  /* documents */
  h += `<h3><span class="n">5.</span>${esc(t.s6)}</h3><p class="inline">${esc(rtl
    ? 'كشف درجات الثانوية النهائي والمعتمد · إفادة معادلة الشهادة لخريجي الثانويات الأجنبية · شهادتا القدرات والتحصيلي للمتقدمين للسعودية · البطاقة المدنية للطالب ولولي الأمر · صفحة بيانات جواز السفر · نتيجة الآيلتس أو التوفل الأصلية.'
    : 'Final certified transcript · Ministry equivalency letter for foreign certificates · Qudurat and Tahsili for Saudi applicants · civil ID for student and guardian · passport data page · original IELTS or TOEFL result.')}</p>`;

  h += `</div><div>`;

  /* recommendations */
  h += `<h3><span class="n">2.</span>${esc(t.s4)}</h3>`;
  if (!ms.length) {
    h += `<p class="inline">${rtl ? 'لا توجد ترشيحات مطابقة بالمعطيات الحالية.' : 'No matching recommendations yet.'}</p>`;
  } else {
    h += `<table><thead><tr><th>${esc(t.major)}</th><th style="width:26%">${esc(t.country)}</th>
      <th style="width:12%">${esc(t.need)}</th><th style="width:16%">${esc(t.level)}</th></tr></thead><tbody>` +
      ms.slice(0, 8).map(x => `<tr><td>${esc(rtl ? x.m.ar : x.m.en)}</td><td>${esc(rtl ? x.c.ar : x.c.en)}</td>
        <td>${x.m.min_pct}%</td><td><span class="tier tier-${x.tier}">${esc(t[x.tier])}</span></td></tr>`).join('') +
      `</tbody></table>`;
  }

  /* universities for the top two majors */
  const top = ms.slice(0, 2);
  if (top.length) {
    h += `<h3><span class="n">4.</span>${esc(t.unis)}</h3>`;
    top.forEach(x => {
      const us = universitiesFor(x.m.en, x.c.code).slice(0, 4);
      h += `<p class="inline" style="margin-bottom:.3mm"><b>${esc(rtl ? x.m.ar : x.m.en)}</b> — ${esc(rtl ? x.c.ar : x.c.en)}</p>`;
      h += us.length
        ? `<p class="inline" style="margin-top:0">${us.map(u => esc(u.u.en) + (u.u.merit ? (rtl ? ' (قائمة التميز)' : ' (merit list)') : '')).join(' · ')}</p>`
        : `<p class="inline" style="margin-top:0">${rtl ? 'لا توجد جامعة معتمدة مطابقة.' : 'No accredited match found.'}</p>`;
    });
  }

  /* obligations + risk, condensed */
  h += `<h3><span class="n">6.</span>${esc(t.s7)} · ${esc(t.s9)}</h3><p class="inline">${esc(rtl
    ? '27 وحدة سنويًا بنظام الفصلين أو 42 بالفصول الثلاثة · معدل لا يقل عن 2.00 · التفرغ التام ولا يجوز العمل · لا انتساب ولا مراسلة · الإنذار الأول يخصم 25% من المخصص والثاني 50% والثالث 75% · ثلاثة إنذارات متتالية أو أربعة متفرقة تعني الفصل · الغياب بدون عذر فوق 20% يُخصم · الفصل أو الانسحاب بعد الالتحاق يعني استرداد 50% من المخصصات.'
    : '27 credits a year on a semester system or 42 on a quarter system · term GPA at least 2.00 · full-time study, no employment · no correspondence or external study · warnings deduct 25%, then 50%, then 75% of the monthly allowance · three consecutive or four separate warnings mean dismissal · unexcused absence above 20% is deducted · dismissal or withdrawal after arrival means repaying half the allowances.')}</p>`;

  if ($('#q_planB').checked) {
    h += `<h3><span class="n">7.</span>${esc(t.s10)}</h3><p class="inline">${esc(rtl
      ? 'الالتحاق على النفقة الخاصة بمؤسسة معتمدة من الجهاز في تخصص مطروح بالخطة، ثم التقدم للضم بعد 27 وحدة بنظام الفصلين أو 42 بالفصول الثلاثة وبمعدل 2.50 فأعلى، في بداية العام أو أحد الفصلين الأول والثاني، ولا ضم في الفصل الصيفي.'
      : 'Enrol at own expense at an NBAQ-listed institution in a major that is in the plan, then apply to join after 27 credits on a semester system or 42 on a quarter system with a CGPA of 2.50 or above, at the start of the year or in the first or second term. No joining in the summer term.')}</p>`;
  }

  const notes = clean($('#q_notes').value);
  if (notes) h += `<h3>${esc(t.notesH)}</h3><p class="inline">${esc(notes)}</p>`;

  h += `</div></div>`;
  h += `<div class="sig"><div>${esc(t.sigS)}</div><div>${esc(t.sigG)}</div><div>${esc(t.sigC)}</div></div>`;
  h += `<div class="foot">${esc(t.disclaimer)}</div>`;

  $('#sheets').innerHTML = `<section class="sheet one${lh ? ' lh' : ''}" dir="${rtl ? 'rtl' : 'ltr'}">${h}</section>`;
  $('#planMeta').textContent = `${nm || '—'} · ${rtl ? 'صفحة واحدة' : '1 page'} · ${PLAN.year}`;
  syncPlanToggles();
}

function syncPlanToggles() {
  document.querySelectorAll('[data-seg="planLang"] button').forEach(b =>
    b.setAttribute('aria-pressed', String(b.dataset.v === S.planLang)));
  document.querySelectorAll('[data-seg="planSize"] button').forEach(b =>
    b.setAttribute('aria-pressed', String(b.dataset.v === S.planSize)));
}

function renderPlan() {
  if (S.planSize === 'one') return renderOnePage();
  const L = S.planLang, t = T[L], rtl = L === 'ar', i = rtl ? 0 : 1;
  const lh = $('#lhToggle').checked;
  const p = percentage(), str = stream(), tr = track();
  const age = ageAt($('#q_dob').value, $('#q_date').value);
  const ch = checks(), ms = matches(), me = meritEligible();
  const res = $('#q_results').value;
  const sheets = [];
  const S_ = (inner) => `<section class="sheet${lh ? ' lh' : ''}" dir="${rtl ? 'rtl' : 'ltr'}">${inner}</section>`;
  const head = (n) => `<div class="hd"><div><h2>${esc(t.title)}</h2><div class="lede">${esc(t.sub)}</div></div>
    <div class="meta">${esc(clean($('#q_name').value))}<br>${esc($('#q_date').value || '')}</div></div>`;

  /* --- sheet 1 : profile + eligibility --- */
  let s1 = head(1);
  s1 += `<h3><span class="n">1.</span>${esc(t.s1)}</h3><table>
    <tr><th style="width:32%">${esc(t.name)}</th><td>${esc(clean($('#q_name').value))}</td>
        <th style="width:18%">${esc(t.cid)}</th><td>${esc(clean($('#q_cid').value))}</td></tr>
    <tr><th>${esc(t.dob)}</th><td>${esc($('#q_dob').value)} ${age != null ? `(${age})` : ''}</td>
        <th>${esc(t.phone)}</th><td>${esc(clean($('#q_phone').value))}</td></tr>
    <tr><th>${esc(t.track)}</th><td><b>${esc(TRACK_NAME[tr][i])}</b></td>
        <th>${esc(t.counselor)}</th><td>${esc(clean($('#q_counselor').value))}</td></tr>
    </table>`;
  s1 += `<h3><span class="n">2.</span>${esc(t.s2)}</h3><table>
    <thead><tr><th>${esc(t.item)}</th><th style="width:22%">${esc(t.status)}</th><th style="width:18%">${esc(t.ref)}</th></tr></thead><tbody>` +
    ch.map(c => `<tr class="${c.level}"><td>${esc(c[rtl ? 'ar' : 'en'])}</td>
      <td><span class="st st-${c.level === 'bad' ? 'bad' : c.level === 'warn' ? 'warn' : 'ok'}">${
        esc(c.level === 'bad' ? t.bad : c.level === 'warn' ? t.warn : t.ok)}</span></td>
      <td>${esc(c.ref)}</td></tr>`).join('') + `</tbody></table>`;
  s1 += `<div class="foot">${esc(t.disclaimer)}</div>`;
  sheets.push(S_(s1));

  /* --- sheet 2 : percentage + recommendations --- */
  let s2 = head(2);
  s2 += `<h3><span class="n">3.</span>${esc(t.s3)}</h3><table>
    <tr><th style="width:32%">${esc(t.cert)}</th><td>${esc(CERT_NAME[$('#q_cert').value][i])}</td></tr>
    <tr><th>${esc(t.pct)}</th><td><b>${p == null ? '—' : p + '%'}</b></td></tr>
    <tr><th>${esc(t.streamL)}</th><td>${esc(str === 'science' ? t.science : t.arts)}</td></tr>`;
  if (me) s2 += `<tr><th>${rtl ? 'برنامج البعثات المتميزة' : 'Merit programme'}</th><td>${
    me.ok ? `<span class="st st-ok">${rtl ? 'مؤهل' : 'Eligible'}</span>`
          : `<span class="st st-warn">${rtl ? `يحتاج ${me.need}%` : `Needs ${me.need}%`}</span>`}</td></tr>`;
  s2 += `</table>`;
  if ($('#q_cert').value === 'en') {
    const cs = computeSubjects();
    s2 += `<p class="lede">${rtl
      ? `احتُسبت النسبة من ${cs.igcseCount} مقررًا بمستوى IGCSE، واستُبعدت درجات ${cs.advCount} مقررًا بمستوى AS أو A من الحساب، واستُبعد ${cs.excluded} مقررًا غير محتسب.`
      : `The percentage is the average of ${cs.igcseCount} IGCSE subjects. ${cs.advCount} AS or A-Level subjects are excluded from the average, and ${cs.excluded} subjects are excluded entirely.`}</p>`;
  }
  s2 += `<h3><span class="n">4.</span>${esc(t.s4)}</h3>`;
  if (!ms.length) {
    s2 += `<p>${rtl ? 'لا توجد ترشيحات مطابقة بالمعطيات الحالية.' : 'No matching recommendations with the current inputs.'}</p>`;
  } else {
    s2 += `<table><thead><tr><th>${esc(t.major)}</th><th style="width:20%">${esc(t.country)}</th>
      <th style="width:13%">${esc(t.need)}</th><th style="width:14%">${esc(t.level)}</th></tr></thead><tbody>` +
      ms.slice(0, 18).map(x => `<tr><td>${esc(rtl ? x.m.ar : x.m.en)}</td><td>${esc(rtl ? x.c.ar : x.c.en)}</td>
        <td>${x.m.min_pct}%</td><td><span class="tier tier-${x.tier}">${esc(t[x.tier])}</span></td></tr>`).join('') +
      `</tbody></table>`;
  }
  s2 += `<div class="foot">${esc(t.disclaimer)}</div>`;
  sheets.push(S_(s2));

  /* --- sheet 3 : universities per top majors --- */
  const top = ms.slice(0, 3);
  if (top.length) {
    let s3 = head(3);
    s3 += `<h3><span class="n">4.1</span> ${esc(t.unis)}</h3>`;
    top.forEach(x => {
      const us = universitiesFor(x.m.en, x.c.code).slice(0, 5);
      s3 += `<p style="margin:3mm 0 1mm"><b>${esc(rtl ? x.m.ar : x.m.en)}</b> — ${esc(rtl ? x.c.ar : x.c.en)}</p>`;
      s3 += us.length
        ? `<table><tbody>${us.map(h => `<tr><td>${esc(h.u.en)}${
            h.u.ar ? `<div style="font-size:8pt;color:#8b95a3">${esc(h.u.ar)}</div>` : ''}</td>
            <td style="width:26%">${h.u.merit ? `<span class="st st-ok">${rtl ? 'قائمة التميز' : 'Merit list'}</span>` : ''}</td></tr>`).join('')}</tbody></table>`
        : `<p class="lede">${rtl ? 'لا توجد جامعة معتمدة مطابقة في بيانات الجهاز.' : 'No accredited match found in the NBAQ data.'}</p>`;
    });
    s3 += `<div class="foot">${esc(t.disclaimer)}</div>`;
    sheets.push(S_(s3));
  }

  /* --- sheet 4 : timeline + documents --- */
  let s4 = head(4);
  s4 += `<h3><span class="n">5.</span>${esc(t.s5)}</h3>`;
  if (res) {
    const rows = [
      [res, rtl ? 'إعلان نتائج القبول في خطة البعثات' : 'Scholarship results announced'],
      [addDays(res, 60), rtl ? 'آخر موعد لتقديم شهادة الثانوية الأصلية وتوقيع التعهد المالي والأكاديمي عبر تطبيق سهل، وإلا أُلغيت البعثة' : 'Deadline to present the original certificate and sign the undertaking through the Sahel app, or the scholarship is cancelled'],
      [addDays(res, 60), rtl ? 'آخر موعد لاستكمال إجراءات التسجيل لدى الوزارة' : 'Deadline to complete registration with the ministry'],
      [addYears(res, 1), rtl ? 'آخر موعد لتحقيق درجة اللغة المطلوبة، قبل الالتحاق بمقر البعثة' : 'Deadline to achieve the required English score, before travelling'],
      [studyStart(), rtl ? 'بداية الدراسة المتوقعة، ولا يجوز الوصول قبلها بأكثر من أسبوعين' : 'Expected start of study; arrival no earlier than two weeks before'],
    ];
    s4 += `<table><thead><tr><th style="width:26%">${esc(t.when)}</th><th>${esc(t.what)}</th></tr></thead><tbody>` +
      rows.map(r => `<tr><td>${r[0]}</td><td>${esc(r[1])}</td></tr>`).join('') + `</tbody></table>`;
  } else {
    s4 += `<p class="lede">${rtl ? 'أدخل تاريخ إعلان النتائج لتظهر المواعيد بتواريخ فعلية.' : 'Enter the results announcement date to see real dates.'}</p>`;
  }
  s4 += `<h3><span class="n">6.</span>${esc(t.s6)}</h3><ol>` +
    (rtl ? [
      'كشف درجات شهادة الثانوية النهائي والمعتمد متضمنًا تسلسل الأعوام الدراسية دون انقطاع.',
      'إفادة معادلة الشهادة من إدارة التعليم الخاص بوزارة التربية، لخريجي الثانويات الأجنبية.',
      'شهادتا اختبار القدرات والاختبار التحصيلي، لمن يتقدم للدراسة في المملكة العربية السعودية.',
      'نسخة من البطاقة المدنية للطالب ولولي الأمر الذي سيصادق على التعهد.',
      'نسخة من جواز السفر، صفحة البيانات.',
      'نسخة أصلية ومعتمدة من نتيجة الآيلتس أو التوفل.',
    ] : [
      'Final, certified high-school transcript showing an unbroken sequence of academic years.',
      'Equivalency letter from the Ministry of Education, for foreign certificates.',
      'Qudurat and Tahsili certificates, for applicants to Saudi Arabia.',
      'Copy of the civil ID for the student and for the guardian who signs the undertaking.',
      'Copy of the passport data page.',
      'Original certified IELTS or TOEFL result.',
    ]).map(x => `<li>${esc(x)}</li>`).join('') + `</ol>`;
  s4 += `<div class="foot">${esc(t.disclaimer)}</div>`;
  sheets.push(S_(s4));

  /* --- sheet 5 : academic plan, money, risks, fallback, signatures --- */
  let s5 = head(5);
  s5 += `<h3><span class="n">7.</span>${esc(t.s7)}</h3><ul>` +
    (rtl ? [
      'إنهاء 27 وحدة دراسية في العام بنظام الفصلين، أو 42 وحدة بنظام الفصول الثلاثة، ومن لم ينهها يستكملها في الصيف.',
      'اجتياز السنة التمهيدية، ويجوز إعادتها مرة واحدة بشرط ألا يقل الحضور عن 80%.',
      'المحافظة على معدل فصلي لا يقل عن 2.00، أو 50% في النظام البريطاني.',
      'التفرغ التام للدراسة، ولا يجوز العمل أثناءها.',
      'لا يجوز الدراسة بالانتساب أو المراسلة، وحد التعليم غير التقليدي ستة مقررات طوال الدراسة.',
    ] : [
      'Pass 27 credits a year on a semester system, or 42 on a quarter system; any shortfall is made up in the summer.',
      'Pass the foundation year. It may be repeated once, provided attendance is at least 80%.',
      'Keep a term GPA of at least 2.00, or 50% in the British system.',
      'Study full time. Employment during the scholarship is not allowed.',
      'No correspondence or external study, and at most six non-traditional courses across the degree.',
    ]).map(x => `<li>${esc(x)}</li>`).join('') + `</ul>`;

  s5 += `<h3><span class="n">8.</span>${esc(t.s8)}</h3><p>${esc(rtl
    ? 'تتحمل الوزارة الرسوم الدراسية كاملة، والمخصص الشهري، وبدل الكتب والأدوات والملابس في بداية كل عام، وتذكرة الالتحاق والتذكرة السنوية وتذكرة العودة عند التخرج، والتأمين الصحي للطالب ومرافقيه. ويستحق طالب البعثة المتميزة مكافأة شهرية إضافية بنسبة 50% من المخصص الاعتيادي. وتصرف علاوة اجتماعية عن الزوج أو الزوجة غير الموظف، وعلاوة أبناء بحد أقصى ثلاثة أبناء، وتتحمل الوزارة مصاريف تعليم المرافقين. قيم المخصصات محددة بقرارات منظمة منفصلة تصدر عن الوزارة.'
    : 'The ministry covers tuition in full, the monthly allowance, a books and clothing allowance at the start of each year, the travel ticket on arrival, the annual ticket and the final return ticket, and health insurance for the student and dependants. A merit scholarship adds 50% to the monthly allowance. A social allowance is paid for a non-working spouse and for up to three children, and the ministry covers dependants\' schooling. The amounts themselves are set by separate ministerial decisions.')}</p>`;

  s5 += `<h3><span class="n">9.</span>${esc(t.s9)}</h3><table>
    <thead><tr><th>${rtl ? 'الحالة' : 'Trigger'}</th><th style="width:38%">${rtl ? 'الأثر' : 'Consequence'}</th></tr></thead><tbody>` +
    (rtl ? [
      ['الإنذار الأكاديمي الأول', 'خصم 25% من المخصص الشهري مرة واحدة'],
      ['الإنذار الثاني', 'خصم 50% من المخصص الشهري مرة واحدة'],
      ['الإنذار الثالث', 'خصم 75% من المخصص الشهري، والنظر في الفصل'],
      ['ثلاثة إنذارات متتالية أو أربعة متفرقة', 'فصل الطالب من البعثة'],
      ['الغياب بدون عذر فوق 20%', 'خصم أيام الغياب من المخصصات'],
      ['الفصل أو الانسحاب بعد الالتحاق', 'استرداد 50% من المخصصات والبدلات'],
    ] : [
      ['First academic warning', '25% deducted from the monthly allowance, once'],
      ['Second warning', '50% deducted from the monthly allowance, once'],
      ['Third warning', '75% deducted, and dismissal is considered'],
      ['Three consecutive or four separate warnings', 'Dismissal from the scholarship'],
      ['Unexcused absence above 20%', 'The absent days are deducted from the allowance'],
      ['Dismissal or withdrawal after arrival', 'Half of the allowances and benefits are recovered'],
    ]).map(r => `<tr><td>${esc(r[0])}</td><td>${esc(r[1])}</td></tr>`).join('') + `</tbody></table>`;

  if ($('#q_planB').checked) {
    s5 += `<h3><span class="n">10.</span>${esc(t.s10)}</h3><p>${esc(rtl
      ? 'إذا لم يُقبل الطالب في خطة البعثات، يلتحق على نفقته الخاصة بإحدى المؤسسات المعتمدة من الجهاز الوطني للاعتماد الأكاديمي، في تخصص مطروح في خطة البعثات لنفس العام. وبعد إتمام 27 وحدة دراسية بنظام الفصلين أو 42 وحدة بنظام الفصول الثلاثة، وبمعدل تراكمي لا يقل عن 2.50، يتقدم بطلب الضم في بداية العام أو في أحد الفصلين الأول والثاني، ولا يتم الضم في الفصل الصيفي.'
      : 'If the student is not accepted into the scholarship plan, they enrol at their own expense at an institution on the NBAQ list, in a major listed in the same year\'s plan. After completing 27 credits on a semester system or 42 on a quarter system, with a CGPA of at least 2.50, they apply to join at the start of the year or in the first or second term. Joining is not granted in the summer term.')}</p>`;
  }

  const notes = clean($('#q_notes').value);
  if (notes) s5 += `<h3>${esc(t.notesH)}</h3><p>${esc(notes)}</p>`;

  s5 += `<h3><span class="n">11.</span>${esc(t.s11)}</h3><p class="lede">${esc(t.disclaimer)}</p>
    <div class="sig"><div>${esc(t.sigS)}</div><div>${esc(t.sigG)}</div><div>${esc(t.sigC)}</div></div>`;
  sheets.push(S_(s5));

  $('#sheets').innerHTML = sheets.join('');
  $('#planMeta').textContent = `${clean($('#q_name').value) || '—'} · ${sheets.length} pages · ${PLAN.year}`;
  syncPlanToggles();
}
