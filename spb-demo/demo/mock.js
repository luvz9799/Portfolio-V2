// DEMO MODE: stands in for the Cloudflare Worker API (Hono + D1 + R2) with sample data in memory.
// The pages and their scripts are the real ones; only fetch('/api/...') is answered here. The Gemini steps
// (reading a post screenshot, matching buyers to listings) are simulated and labelled. Reload = fresh data.
(function () {
  const now = Date.now();
  const ts = d => new Date(now - d * 864e5).toISOString().slice(0, 19).replace('T', ' ');   // SQLite datetime (UTC)
  const P = n => '90000' + String(n).padStart(5, '0');
  const ph = (f, label) => ({ url: 'static/seed/' + f, label });
  let id = { stock: 20, req: 20, match: 10, fb: 20, news: 5 };
  // ---------- sample data (generic names and numbers) ----------
  const S = (i, o) => Object.assign({ id: i, seller_name: 'Owner ' + i, mobile: P(100 + i), colony: '', txn: 'sale', rent_monthly: null, description: '', photos: [],
    lead_count: 0, is_public: 1, status: 'active', source_type: 'direct', source_name: null, property_kind: 'plot', rakba: null, khasra_no: null, khata_no: null,
    created_at: ts(i), executive_name: null, convert_status: 'pending' }, o);
  const stock = [
    S(1, { seller_name: 'Ramesh Verma', location: 'Kota', colony: 'Borkheda', size_sqyd: 1800, rate_lakh: 24, type: 'Plot', photos: [ph('plot1.jpg', 'Front / Outside view')], description: 'East-facing corner plot on a 30 ft road. Clear registry, boundary done.', lead_count: 6, source_type: 'realtor', source_name: 'Shree Realty' }),
    S(2, { seller_name: 'Sunita Devi', location: 'Kota', colony: 'Kunhadi', size_sqyd: 1200, rate_lakh: 16.5, type: 'Plot', photos: [ph('plot2.jpg', 'Front / Outside view')], description: 'Inside an approved colony, 200 m from the main road. Water and light available.', lead_count: 4 }),
    S(3, { seller_name: 'Mahesh Gupta', location: 'Kota', colony: 'Rangbari', size_sqyd: 1500, rate_lakh: 58, type: 'Makan', photos: [ph('house1.jpg', 'Front / Outside view'), ph('house2.jpg', 'Room / Interior view')], description: 'Two-storey house, 3 bedrooms, parking. Near school and market.', lead_count: 9 }),
    S(4, { seller_name: 'Kishan Lal', location: 'Jhalawar', colony: 'Jhalrapatan Road', size_sqyd: 2400, rate_lakh: 21, type: 'Plot', photos: [ph('plot1.jpg', 'Front / Outside view')], description: 'Wide plot on Jhalrapatan Road, suitable for a house or a small shop.', lead_count: 3, source_type: 'agent', source_name: 'Demo Agent' }),
    S(5, { seller_name: 'Gopal Singh', location: 'Jhalawar', colony: 'Village Kheda', type: 'Farm House', rate_lakh: 45, property_kind: 'zameen', rakba: '5 bigha', khasra_no: '214/2', photos: [{ url: 'static/img/plot-farm.jpg', label: 'Front / Outside view' }], description: 'Agricultural land with a borewell and a small farm house. Road access.', lead_count: 5 }),
    S(6, { seller_name: 'Anita Sharma', location: 'Kota', colony: 'Ring Road', size_sqyd: 900, type: 'Commercial Plot', txn: 'rent', rent_monthly: 18000, photos: [ph('house3.jpg', 'Front / Outside view')], description: 'Shop space facing the ring road. Ideal for a showroom.', lead_count: 2 }),
    S(7, { seller_name: 'Vijay Meena', location: 'Baran', colony: 'Station Road', size_sqyd: 1000, rate_lakh: 11, type: 'Plot', photos: [ph('plot2.jpg', 'Front / Outside view')], description: 'Budget plot close to the railway station.', lead_count: 1 }),
    S(8, { seller_name: 'Prakash Jain', location: 'Kota', colony: 'Devli Arab Road', size_sqyd: 2000, rate_lakh: 29, type: 'Plot', photos: [{ url: 'static/img/plot-village.jpg', label: 'Front / Outside view' }], description: 'New layout on Devli Arab Road, fast-growing area.', lead_count: 7 }),
    S(9, { seller_name: 'Rekha Bai', location: 'Jhalawar', colony: 'Village Rampura', type: 'Plot', rate_lakh: 8, property_kind: 'zameen', rakba: '2 bigha', photos: [{ url: 'static/img/rural-hero.jpg', label: 'Front / Outside view' }], description: 'Farm land near the village, canal water.', lead_count: 0 }),
    S(10, { seller_name: 'Facebook post', location: 'Kota', colony: 'Raipura', size_sqyd: 1350, rate_lakh: 19, type: 'Plot', status: 'pending', photos: [ph('plot1.jpg', 'Front / Outside view')], description: 'Added from a Facebook post; waiting for verification.' }),
    S(11, { seller_name: 'Suresh Nagar', location: 'Ramganj Mandi', size_sqyd: 1100, rate_lakh: 13, type: 'Plot', status: 'pending', description: 'Seller submitted from the website.' }),
    S(12, { seller_name: 'Old listing', location: 'Kota', colony: 'Kunhadi', size_sqyd: 1000, rate_lakh: 14, type: 'Plot', status: 'sold', lead_count: 11 }),
  ];
  const R = (i, o) => Object.assign({ id: i, name: 'Buyer ' + i, mobile: P(i), budget_min_lakh: null, budget_max_lakh: null, timeline: 'Within 3 months', notes: '',
    source_type: 'self', telecaller_id: null, status: 'new', created_at: ts(i * 0.7) }, o);
  const reqs = [
    R(1, { name: 'Amit Kumar', location: 'Raipura', type: 'Plot', budget_min_lakh: 18, budget_max_lakh: 25, notes: 'East facing preferred, near the main road' }),
    R(2, { name: 'Neha Saxena', location: 'Kota', type: 'Makan', budget_min_lakh: 45, budget_max_lakh: 60, timeline: 'Within 1 month', status: 'contacted' }),
    R(3, { name: 'Rajendra Prasad', location: 'Jhalawar', type: 'Plot', budget_min_lakh: 15, budget_max_lakh: 22, status: 'matched' }),
    R(4, { name: 'Farhan Ali', location: 'Kota', type: 'Commercial Plot', notes: 'Shop on rent, ring road', status: 'new' }),
    R(5, { name: 'Pooja Rathore', location: 'Jhalrapatan', type: 'Farm House', budget_max_lakh: 50, source_type: 'telecaller', telecaller_id: 3, created_at: ts(8) }),
    R(6, { name: 'Dinesh Yadav', location: 'Borkheda', type: 'Plot', budget_max_lakh: 20, source_type: 'telecaller', telecaller_id: 3, created_at: ts(6) }),
    R(7, { name: 'Kavita Joshi', location: 'Kota', type: 'Plot', budget_max_lakh: 30, source_type: 'telecaller', telecaller_id: 3, created_at: ts(2) }),
    R(8, { name: 'Manoj Bairwa', location: 'Baran', type: 'Plot', budget_max_lakh: 12, status: 'closed', created_at: ts(14) }),
  ];
  const users = { 1: { id: 1, name: 'Demo Admin', role: 'admin', huddle_only: 0 }, 3: { id: 3, name: 'Demo Telecaller', role: 'telecaller', huddle_only: 0 } };
  reqs.forEach(r => { if (r.telecaller_id) r.telecaller_name = users[3].name; });
  const matches = [{ id: 1, requirement_id: 3, stock_id: 4, matched_by: 'Demo Admin', matched_at: ts(1) }, { id: 2, requirement_id: 3, stock_id: 9, matched_by: 'Demo Admin', matched_at: ts(1) },
    { id: 3, requirement_id: 2, stock_id: 3, matched_by: 'Demo Admin', matched_at: ts(0.5) }];
  const RS = ['no_need', 'future', 'not_understood', 'reg_doubt', 'must_buy', 'trust', 'no_clarity', 'no_interest', 'no_time', 'other'];
  const feedback = [[['future', 'no_time'], 'little', 'partial'], [['trust'], 'yes', 'partial'], [['not_understood', 'no_clarity'], 'little', 'none'], [['future'], 'no', 'full'],
    [['reg_doubt', 'must_buy'], 'little', 'partial'], [['trust', 'no_clarity'], 'yes', 'none'], [['no_need'], 'no', 'full'], [['future', 'not_understood'], 'little', 'partial'],
    [['no_interest'], 'no', 'full'], [['trust'], 'yes', 'partial'], [['no_time'], 'no', 'full'], [['not_understood'], 'little', 'none']]
    .map(([reasons, trust, understanding], i) => ({ id: i + 1, name: ['Ravi', 'Seema', 'Bhanu', 'Lakshmi', 'Hari', 'Komal', 'Naresh', 'Usha', 'Mukesh', 'Geeta', 'Sohan', 'Rina'][i], mobile: P(500 + i),
      location: ['Kota', 'Jhalawar', 'Baran'][i % 3], field_team: 'Team ' + 'AB'[i % 2], visit_id: null, understanding, reasons, trust, trust_detail: trust === 'yes' ? 'Worried about paperwork' : null,
      improve: ['Explain the offer with an example', 'Show registry papers first', 'Call again after harvest', ''][i % 4] || null, voice_url: null, created_at: ts(i * 0.5) }));
  const news = [
    { id: 1, city: 'Kota', title: 'Ring road work lifts plot enquiries around Borkheda', body: 'Builders report more site visits since the new stretch opened.', image_url: 'static/img/hero-landscape.png', source_url: '', expert_comment: 'Expect steady growth near the ring road over the next 2-3 years.', status: 'published', created_at: ts(2) },
    { id: 2, city: 'Jhalawar', title: 'New colonies approved on Jhalrapatan Road', body: 'Three layouts received approval this month.', image_url: 'static/img/plot-village.jpg', source_url: '', expert_comment: 'Good entry point for first-time buyers.', status: 'published', created_at: ts(5) },
  ];
  const autoNews = city => ['plot demand rises near new road projects', 'registry fees: what buyers should check', 'farm land prices steady after harvest season', 'new residential layouts get approval']
    .map((t, i) => ({ title: `${city}: ${t} (sample headline)`, link: '#', source: 'Demo news feed', pubDate: new Date(now - i * 36e5 * 9).toUTCString() }));

  // ---------- helpers ----------
  const clone = o => JSON.parse(JSON.stringify(o));
  const pub = s => { const o = clone(s); ['seller_name', 'mobile', 'source_type', 'source_name', 'executive_name', 'convert_status', 'khasra_no', 'khata_no'].forEach(k => delete o[k]); o.is_public = !!s.is_public; return o; };
  const full = s => Object.assign(clone(s), { is_public: !!s.is_public });
  const json = (b, st = 200) => new Response(JSON.stringify(b), { status: st, headers: { 'Content-Type': 'application/json' } });
  const me = () => { try { const u = localStorage.getItem('sbn_demo_user'); return u === 'none' ? null : users[u || 1]; } catch (e) { return users[1]; } };
  const setMe = v => { try { localStorage.setItem('sbn_demo_user', v); } catch (e) {} };
  const staff = () => me();
  const body = async init => { const b = init && init.body; if (!b) return {}; if (b instanceof FormData) { const o = {}; b.forEach((v, k) => { o[k] = v; }); return o; } try { return JSON.parse(b); } catch (e) { return {}; } };
  const near = { kota: ['kota', 'borkheda', 'raipura', 'devli arab road', 'kunhadi', 'rangbari', 'ring road'], jhalawar: ['jhalawar', 'jhalrapatan', 'jhalrapatan road', 'kheda', 'rampura'], baran: ['baran', 'station road'], 'ramganj mandi': ['ramganj mandi'] };
  const region = s => Object.keys(near).find(k => near[k].some(x => String(s || '').toLowerCase().includes(x)));
  const GEO = { kota: [25.18, 75.83], borkheda: [25.13, 75.86], raipura: [25.12, 75.89], kunhadi: [25.22, 75.82], rangbari: [25.14, 75.83], 'ring road': [25.16, 75.87], 'devli arab road': [25.11, 75.8],
    jhalawar: [24.6, 76.16], jhalrapatan: [24.54, 76.17], baran: [25.1, 76.52], 'ramganj mandi': [24.65, 75.94] };

  // Simulated Gemini match: same region (incl. nearby localities and spellings), budget fit, type fit.
  function suggest(r) {
    const pool = stock.filter(s => s.status === 'active' && s.txn !== 'rent'), want = region(r.location);   // buyers here want to buy
    return pool.map(s => {
      let score = 0; const why = [];
      if (region(s.location + ' ' + s.colony) === want) { score += 50; why.push(String(s.colony || s.location).toLowerCase() === String(r.location).toLowerCase() || s.location.toLowerCase() === String(r.location).toLowerCase() ? `In ${r.location}` : `${s.colony || s.location} is near ${r.location}`); }
      const max = r.budget_max_lakh, price = s.rate_lakh;
      if (!max || !price) score += 15; else if (price <= max) { score += 30; why.push('within budget'); } else if (price <= max * 1.2) { score += 12; why.push('slightly above budget'); }
      if (s.type === r.type) { score += 20; why.push('same type'); } else if (/Plot/.test(s.type) && /Plot/.test(r.type)) score += 8;
      return Object.assign(full(s), { match_count: matches.filter(m => m.stock_id === s.id).length, _score: score, _reason: why.join(', ') });
    }).filter(x => x._score >= 60).sort((a, b) => b._score - a._score);
  }

  const routes = [
    ['POST', /^\/api\/auth\/login$/, async (m, b) => { const u = { [P(1)]: 1, '9800000001': 1, [P(3)]: 3, '9800000003': 3 }[String(b.phone || '').trim()];
      if (!u || !b.password) return json({ error: 'Incorrect phone or password' }, 401); setMe(u); return json({ ok: true, user: users[u] }); }],
    ['POST', /^\/api\/auth\/logout$/, async () => { setMe('none'); return json({ ok: true }); }],
    ['GET', /^\/api\/auth\/me$/, async () => json({ user: me() })],
    ['GET', /^\/api\/stats$/, async () => json({ plots: stock.filter(s => s.status === 'active').length, buyers: reqs.length + 348, matches: matches.length + 210, locations: new Set(stock.map(s => s.location)).size + 12 })],
    ['GET', /^\/api\/stock\/browse$/, async (m, b, q) => { let x = stock.filter(s => s.status === 'active' && s.is_public);
      if (q.get('txn')) x = x.filter(s => s.txn === q.get('txn')); if (q.get('location')) x = x.filter(s => s.location === q.get('location')); if (q.get('type')) x = x.filter(s => s.type === q.get('type'));
      if (q.get('max_budget')) x = x.filter(s => s.rate_lakh != null && s.rate_lakh <= +q.get('max_budget')); if (q.get('min_area')) x = x.filter(s => s.size_sqyd >= +q.get('min_area'));
      if (q.get('max_area')) x = x.filter(s => s.size_sqyd && s.size_sqyd <= +q.get('max_area')); if (q.get('q')) { const t = q.get('q').toLowerCase(); x = x.filter(s => (s.location + ' ' + s.colony).toLowerCase().includes(t)); }
      const k = { price_asc: (a, b) => a.rate_lakh - b.rate_lakh, price_desc: (a, b) => b.rate_lakh - a.rate_lakh, area_desc: (a, b) => b.size_sqyd - a.size_sqyd }[q.get('sort')] || ((a, b) => a.created_at < b.created_at ? 1 : -1);
      return json({ items: x.sort(k).map(pub) }); }],
    ['GET', /^\/api\/stock\/(\d+)$/, async m => { const s = stock.find(x => x.id === +m[1] && x.status === 'active' && x.is_public); return s ? json(pub(s)) : json({ error: 'Property not found' }, 404); }],
    ['GET', /^\/api\/filters$/, async () => { const a = stock.filter(s => s.status === 'active' && s.is_public); return json({ locations: [...new Set(a.map(s => s.location))], types: [...new Set(a.map(s => s.type))] }); }],
    ['GET', /^\/api\/news$/, async (m, b, q) => json({ items: news.filter(n => n.status === 'published' && (!q.get('city') || n.city === q.get('city'))) })],
    ['GET', /^\/api\/news\/auto$/, async (m, b, q) => json({ items: autoNews(q.get('city') || 'Kota') })],
    ['POST', /^\/api\/requirements$/, async (m, b) => { if (!b.name || !b.mobile || !b.location || !b.type) return json({ error: 'Name, mobile, location and property type are required' }, 400);
      if (!/^\d{10}$/.test(String(b.mobile))) return json({ error: 'Mobile number must be 10 digits' }, 400);
      const tele = reqs.find(r => r.mobile === String(b.mobile) && r.source_type === 'telecaller'); if (tele) tele.status = 'contacted';
      const r = R(++id.req, { name: b.name, mobile: String(b.mobile), location: b.location, type: b.type, budget_min_lakh: +b.budget_min || null, budget_max_lakh: +b.budget_max || null, timeline: b.timeline || null, notes: b.notes || '', created_at: ts(0) });
      reqs.unshift(r); return json({ ok: true, id: r.id, message: 'Your requirement has been noted. Our team will contact you soon.' }); }],
    ['GET', /^\/api\/track$/, async (m, b, q) => { const r = reqs.find(x => x.id === +q.get('ref') && x.mobile === q.get('mobile'));
      if (!/^\d{10}$/.test(q.get('mobile') || '') || !+q.get('ref')) return json({ error: 'Enter your 10-digit mobile and reference number (e.g. 12).' }, 400);
      if (!r) return json({ error: 'No requirement found for that mobile + reference number.' }, 404);
      return json({ requirement: clone(r), matches: matches.filter(x => x.requirement_id === r.id).map(x => Object.assign(pub(stock.find(s => s.id === x.stock_id)), { matched_at: x.matched_at })) }); }],
    ['POST', /^\/api\/stock$/, async (m, b) => { if (!b.seller_name || !b.mobile || !b.location || !b.type) return json({ error: 'Name, mobile, location and property type are required' }, 400);
      if (!/^\d{10}$/.test(String(b.mobile))) return json({ error: 'Mobile number must be 10 digits' }, 400);
      const photos = ['front', 'entrance', 'room', 'extra1', 'extra2'].filter(k => b[k] && b[k].size).map(k => ({ url: URL.createObjectURL(b[k]), label: k }));
      const s = S(++id.stock, { seller_name: b.seller_name, mobile: String(b.mobile), location: b.location, colony: b.colony || '', size_sqyd: +b.size_sqyd || null, rate_lakh: +b.rate_lakh || null, type: b.type,
        txn: b.txn === 'rent' ? 'rent' : 'sale', rent_monthly: +b.rent_monthly || null, description: b.description || '', status: 'pending', is_public: b.is_public === '1' ? 1 : 0, photos,
        property_kind: b.property_kind === 'zameen' ? 'zameen' : 'plot', rakba: b.rakba || null, khasra_no: b.khasra_no || null, khata_no: b.khata_no || null, created_at: ts(0) });
      stock.unshift(s); return json({ ok: true, id: s.id, photos: photos.length, message: 'Your property has been received. Our team will verify it and activate the listing.' }); }],
    // Simulated Gemini vision step: the sample post gives its real details; any other image gets a clear demo notice.
    ['POST', /^\/api\/extract$/, async (m, b) => { await new Promise(r => setTimeout(r, 1300)); const f = b.image;
      if (window.__sbnSample && f && f.size) return json({ ok: true, fields: { seller_name: 'Shyam Property Point', mobile: '9000012345', location: 'Kota', colony: 'Borkheda', type: 'Plot', size_sqyd: '1800', rate_lakh: '22', description: 'East-facing plot, 30x60 ft on a 30 ft road. Clear registry, light and water connection. Price slightly negotiable.' } });
      return json({ error: 'Demo: AI reading is simulated. Use "Try with a sample post" to see it fill the form.' }, 400); }],
    ['POST', /^\/api\/feedback$/, async () => json({ ok: true, id: ++id.fb, message: 'Feedback received. Thank you!' })],
    ['POST', /^\/api\/tele\/requirements$/, async (m, b) => { if (!staff()) return json({ error: 'Login required' }, 401);
      if (!b.name || !b.mobile || !b.location || !b.type) return json({ error: 'Name, mobile, location and type are required' }, 400);
      if (!/^\d{10}$/.test(String(b.mobile))) return json({ error: 'Mobile number must be 10 digits' }, 400);
      const dup = reqs.find(r => r.mobile === String(b.mobile) && (now - Date.parse(r.created_at.replace(' ', 'T') + 'Z')) < 7 * 864e5);
      if (dup) return json({ error: `This mobile number was already entered in the last 7 days (#${dup.id})` }, 409);
      const r = R(++id.req, { name: b.name, mobile: String(b.mobile), location: b.location, type: b.type, budget_min_lakh: +b.budget_min || null, budget_max_lakh: +b.budget_max || null, timeline: b.timeline || null, notes: b.notes || '', source_type: 'telecaller', telecaller_id: me().id, telecaller_name: me().name, created_at: ts(0) });
      reqs.unshift(r); return json({ ok: true, id: r.id }); }],
    ['GET', /^\/api\/tele\/redflags$/, async () => json({ items: reqs.filter(r => r.source_type === 'telecaller' && ['new', 'contacted'].includes(r.status) && (now - Date.parse(r.created_at.replace(' ', 'T') + 'Z')) >= 5 * 864e5
      && !reqs.some(s => s.mobile === r.mobile && s.source_type === 'self')).map(r => Object.assign(clone(r), { days_waiting: Math.floor((now - Date.parse(r.created_at.replace(' ', 'T') + 'Z')) / 864e5) })) })],
    ['GET', /^\/api\/tele\/my-entries$/, async () => json({ items: reqs.filter(r => r.source_type === 'telecaller').map(clone) })],
    ['GET', /^\/api\/admin\/requirements$/, async (m, b, q) => { let x = reqs; if (q.get('status')) x = x.filter(r => r.status === q.get('status'));
      if (q.get('q')) { const t = q.get('q').toLowerCase(); x = x.filter(r => (r.name + r.mobile + r.location).toLowerCase().includes(t)); } return json({ items: x.map(clone) }); }],
    ['PATCH', /^\/api\/admin\/requirements\/(\d+)\/status$/, async (m, b) => { const r = reqs.find(x => x.id === +m[1]); if (r) r.status = b.status; return json({ ok: true }); }],
    ['GET', /^\/api\/admin\/requirements\/(\d+)\/suggest$/, async m => { await new Promise(r => setTimeout(r, 900)); const r = reqs.find(x => x.id === +m[1]); return r ? json({ items: suggest(r), mode: 'ai' }) : json({ error: 'Requirement not found' }, 404); }],
    ['GET', /^\/api\/admin\/stock$/, async (m, b, q) => { let x = stock; if (q.get('status')) x = x.filter(s => s.status === q.get('status'));
      if (q.get('q')) { const t = q.get('q').toLowerCase(); x = x.filter(s => (s.seller_name + s.mobile + s.location).toLowerCase().includes(t)); } return json({ items: x.map(full) }); }],
    ['PATCH', /^\/api\/admin\/stock\/(\d+)\/status$/, async (m, b) => { if (me()?.role !== 'admin') return json({ error: 'Admin access only' }, 403); const s = stock.find(x => x.id === +m[1]); if (s) s.status = b.status; return json({ ok: true }); }],
    ['PATCH', /^\/api\/admin\/stock\/(\d+)$/, async (m, b) => { const s = stock.find(x => x.id === +m[1]); if (s) Object.assign(s, b); return json({ ok: true }); }],
    ['DELETE', /^\/api\/admin\/stock\/(\d+)$/, async m => { const i = stock.findIndex(x => x.id === +m[1]); if (i >= 0) stock.splice(i, 1); return json({ ok: true }); }],
    ['POST', /^\/api\/admin\/stock\/(\d+)\/photos$/, async (m, b) => { const s = stock.find(x => x.id === +m[1]); Object.values(b).filter(v => v && v.size).forEach(f => s.photos.push({ url: URL.createObjectURL(f), label: 'Extra photo' })); return json({ ok: true, photos: s.photos }); }],
    ['DELETE', /^\/api\/admin\/stock\/(\d+)\/photos$/, async (m, b) => { const s = stock.find(x => x.id === +m[1]); s.photos = s.photos.filter(p => (p.url || p) !== b.url); return json({ ok: true, photos: s.photos }); }],
    ['POST', /^\/api\/admin\/matches$/, async (m, b) => { let added = 0;
      for (const sid of b.stock_ids || []) if (!matches.some(x => x.requirement_id === +b.requirement_id && x.stock_id === +sid)) { matches.unshift({ id: ++id.match, requirement_id: +b.requirement_id, stock_id: +sid, matched_by: me().name, matched_at: ts(0) }); stock.find(s => s.id === +sid).lead_count++; added++; }
      if (added) { const r = reqs.find(x => x.id === +b.requirement_id); if (r && r.status !== 'closed') r.status = 'matched'; }
      return json({ ok: true, added, notified: false }); }],   // notified=false: the real app then offers the wa.me link (AiSensy sends it when configured)
    ['GET', /^\/api\/admin\/matches$/, async () => json({ items: matches.map(x => { const r = reqs.find(y => y.id === x.requirement_id), s = stock.find(y => y.id === x.stock_id) || {};
      return Object.assign(clone(x), { buyer_name: r.name, buyer_mobile: r.mobile, req_location: r.location, stock_location: s.location, colony: s.colony, rate_lakh: s.rate_lakh, stock_type: s.type }); }) })],
    ['GET', /^\/api\/admin\/analytics$/, async () => { const g = (a, k) => Object.entries(a.reduce((o, x) => (o[x[k]] = (o[x[k]] || 0) + 1, o), {})).map(([v, n]) => ({ [k]: v, n }));
      const last7 = [...Array(7)].map((_, i) => { const d = new Date(now - (6 - i) * 864e5).toISOString().slice(0, 10); return { d, self: [3, 5, 2, 6, 4, 7, 5][i], telecaller: [2, 1, 3, 2, 4, 2, 3][i] }; });
      return json({ stock_by_source: g(stock, 'source_type'), req_by_source: g(reqs, 'source_type'), stock_by_status: g(stock, 'status'), req_by_status: g(reqs, 'status'),
        top_leads: [...stock].sort((a, b) => b.lead_count - a.lead_count).slice(0, 5).map(s => ({ id: s.id, location: s.location, colony: s.colony, rate_lakh: s.rate_lakh, lead_count: s.lead_count })), last7 }); }],
    ['GET', /^\/api\/admin\/feedback$/, async () => { const rc = {}, tc = { no: 0, little: 0, yes: 0 }, uc = { full: 0, partial: 0, none: 0 };
      feedback.forEach(f => { f.reasons.forEach(k => rc[k] = (rc[k] || 0) + 1); tc[f.trust]++; uc[f.understanding]++; });
      return json({ items: clone(feedback), total: feedback.length, reason_counts: rc, trust_counts: tc, understanding_counts: uc }); }],
    ['GET', /^\/api\/admin\/news$/, async () => json({ items: clone(news) })],
    ['POST', /^\/api\/admin\/news$/, async (m, b) => { const n = Object.assign({ id: ++id.news, status: 'published', created_at: ts(0) }, b); news.unshift(n); return json({ ok: true, id: n.id }); }],
    ['PATCH', /^\/api\/admin\/news\/(\d+)$/, async (m, b) => { Object.assign(news.find(n => n.id === +m[1]) || {}, b); return json({ ok: true }); }],
    ['DELETE', /^\/api\/admin\/news\/(\d+)$/, async m => { const i = news.findIndex(n => n.id === +m[1]); if (i >= 0) news.splice(i, 1); return json({ ok: true }); }],
    ['POST', /^\/api\/agent\/stock$/, async (m, b) => { if (!b.seller_name || !b.mobile || !b.location || !b.type || !b.source_name) return json({ error: 'All fields are required' }, 400);
      const s = S(++id.stock, Object.assign({}, b, { status: 'pending', source_type: ['realtor', 'agent', 'new_agent'].includes(b.source_type) ? b.source_type : 'agent', size_sqyd: +b.size_sqyd || null, rate_lakh: +b.rate_lakh || null, created_at: ts(0) }));
      stock.unshift(s); return json({ ok: true, id: s.id }); }],
  ];

  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href), method = ((init && init.method) || 'GET').toUpperCase();
    if (url.hostname === 'nominatim.openstreetmap.org') {   // geocoding for the map view, answered locally in the demo
      const q = (url.searchParams.get('q') || '').toLowerCase(), k = Object.keys(GEO).find(x => q.includes(x));
      return json(k ? [{ lat: String(GEO[k][0]), lon: String(GEO[k][1]) }] : []);
    }
    const i = url.pathname.indexOf('/api/');
    if (url.origin !== location.origin || i < 0) return realFetch(input, init);
    const path = url.pathname.slice(i);
    await new Promise(r => setTimeout(r, 120));
    for (const [m, rx, fn] of routes) { const mm = method === m && path.match(rx); if (mm) return fn(mm, await body(init), url.searchParams); }
    return json({ error: 'Demo: ' + method + ' ' + path + ' is not part of the demo' }, 404);
  };

  // demo badge, login hint, and a sample post for the screenshot → AI listing page
  document.addEventListener('DOMContentLoaded', () => {
    const tag = document.createElement('div');
    tag.textContent = 'Demo · sample data · AI simulated';
    tag.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:8px;z-index:2000;background:#221507;color:#fff;font:600 11px/1 system-ui,sans-serif;padding:6px 10px;border-radius:99px;opacity:.85;pointer-events:none';
    document.body.appendChild(tag);
    if (/login\.html$/.test(location.pathname)) {
      const f = document.querySelector('form'); if (f) f.insertAdjacentHTML('afterbegin', `<p style="background:#FEF5EC;border:1px solid #FBD1A6;border-radius:12px;padding:10px;font-size:13px;margin-bottom:12px">Demo login: admin <b>${P(1)}</b> or telecaller <b>${P(3)}</b>, any password.</p>`);
    }
    if (/capture\.html$/.test(location.pathname)) {
      const zone = document.getElementById('pick-zone'); if (!zone) return;
      zone.insertAdjacentHTML('afterend', '<button type="button" id="demo-sample" style="margin-top:10px;width:100%;padding:10px;border-radius:14px;border:1px solid #FBD1A6;background:#FEF5EC;color:#B44E0E;font-weight:700">Try with a sample post</button>');
      document.getElementById('demo-sample').onclick = async () => {
        const blob = await (await realFetch('demo/sample-post.jpg')).blob(), dt = new DataTransfer();
        dt.items.add(new File([blob], 'sample-post.jpg', { type: 'image/jpeg' })); window.__sbnSample = true;
        const inp = document.getElementById('img'); inp.files = dt.files; inp.dispatchEvent(new Event('change'));
        document.getElementById('demo-sample').remove();
      };
    }
  });
})();
