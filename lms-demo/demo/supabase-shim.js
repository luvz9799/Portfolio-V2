/* Portfolio demo of the Akshardham Academy LMS.
 *
 * The real app talks to Supabase. Here the SAME schema.sql and migration files run inside the
 * browser on PGlite (PostgreSQL compiled to WebAssembly), and this file stands in for the
 * Supabase client: sb.from(...) becomes a SELECT/INSERT/UPDATE with PostgREST-style embedding,
 * sb.rpc(...) calls the real PL/pgSQL functions, and every query runs as the signed-in user with
 * row level security on. Nothing leaves the browser; a refresh starts from fresh sample data.
 *
 * ponytail: a small PostgREST subset (eq / in / not-is-null / order / single, one-level FK
 * embedding, counts) — exactly what app.js and admin.js call. A new query shape needs a case here.
 */
(function () {
  'use strict';
  const BASE = document.currentScript.src.replace(/[^/]*$/, '');
  const ROLE = document.documentElement.dataset.demoRole || 'learner';
  const ID = {
    admin: '00000000-0000-4000-8000-00000000000a',
    rahul: '00000000-0000-4000-8000-000000000001',
  };
  // ?as=priya opens the learner portal as the sample learner who finished the whole training (certificate)
  const AS = { priya: ['00000000-0000-4000-8000-000000000002', 'priya.demo@example.com'] }[new URLSearchParams(location.search).get('as')];
  const ME = AS ? AS[0] : ROLE === 'admin' ? ID.admin : ID.rahul;
  const ME_EMAIL = AS ? AS[1] : ROLE === 'admin' ? 'admin.demo@example.com' : 'rahul.demo@example.com';

  // ---------- boot ----------
  let db, meta;
  const status = msg => { const el = document.getElementById('demo-boot'); if (el) el.textContent = msg; };
  const ready = (async () => {
    const { PGlite } = await import(BASE + 'pglite/index.js');
    db = new PGlite();
    status('Starting the demo database…');
    await db.exec(`create role authenticated; create role anon; create schema auth;
      create table auth.users (id uuid primary key, email text);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('demo.uid', true), '')::uuid $$;
      create function auth.jwt() returns jsonb language sql stable as $$ select jsonb_build_object('email', current_setting('demo.email', true)) $$;`);
    const files = ['schema', 'sheet-sync', 'learner-dashboard', 'assignments', 'levels', 'sheet-answers', 'essay', 'exam',
      'essay-length', 'video', 'checkpoints', 'camera', 'checkpoint-time', 'fixes', 'certificate'];
    const sql = await Promise.all(files.map(f => fetch(`${BASE}sql/${f}.sql`).then(r => { if (!r.ok) throw new Error(f + '.sql missing'); return r.text(); })));
    for (const s of sql) await db.exec(s);
    await db.exec(`grant usage on schema public, auth to authenticated;
      grant all on all tables in schema public to authenticated;
      grant execute on all functions in schema public, auth to authenticated;`);
    meta = await loadMeta();
    status('Loading sample trainings…');
    await window.DEMO_SEED({ db, as, rpcAs, ID });
    // ?cam: the sample learner has no camera exemption, so the real on-device face check runs on the visitor's webcam
    if (new URLSearchParams(location.search).has('cam')) await db.query(`update profiles set camera_exempt = false where id = '00000000-0000-4000-8000-000000000001'`);
    const el = document.getElementById('demo-boot'); if (el) el.remove();
  })();
  ready.catch(e => { status('The demo could not start: ' + e.message); console.error(e); });

  async function loadMeta() {
    const fks = (await db.query(`select tc.table_name as child, kcu.column_name as child_col, ccu.table_name as parent, ccu.column_name as parent_col
      from information_schema.table_constraints tc
      join information_schema.key_column_usage kcu on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
      join information_schema.constraint_column_usage ccu on ccu.constraint_name = tc.constraint_name and ccu.table_schema = tc.table_schema
      where tc.constraint_type = 'FOREIGN KEY' and tc.table_schema = 'public'`)).rows;
    const pks = (await db.query(`select tc.table_name as t, kcu.column_name as c from information_schema.table_constraints tc
      join information_schema.key_column_usage kcu on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
      where tc.constraint_type = 'PRIMARY KEY' and tc.table_schema = 'public' order by kcu.ordinal_position`)).rows;
    const fns = (await db.query(`select p.proname as name, p.proretset as set, t.typname as ret, t.typtype as kind,
        coalesce(p.proargnames, '{}') as args, oidvectortypes(p.proargtypes) as types
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_type t on t.oid = p.prorettype
      where n.nspname = 'public'`)).rows;
    const pk = {};
    pks.forEach(r => (pk[r.t] = pk[r.t] || []).push(r.c));
    // overloaded functions (register has a 4- and a 5-argument version): keep the widest, like PostgREST picks by the keys sent
    const byName = {};
    fns.forEach(f => { if (!byName[f.name] || (f.args || []).length > (byName[f.name].args || []).length) byName[f.name] = f; });
    return { fks, pk, fns: byName };
  }

  // ---------- run SQL as a user, with RLS (one connection, so calls queue up) ----------
  let chain = Promise.resolve();
  const lit = s => `'${String(s).replace(/'/g, "''")}'`;
  function as(uid, email, fn) {
    const job = chain.then(async () => {
      await db.exec(`reset role; select set_config('demo.uid', ${lit(uid || '')}, false), set_config('demo.email', ${lit(email || '')}, false); set role authenticated;`);
      try { return await fn(); } finally { await db.exec('reset role'); }
    });
    chain = job.catch(() => {});
    return job;
  }

  // ---------- rpc ----------
  async function callRpc(name, args) {
    const f = meta.fns[name];
    if (!f) throw new Error(`function ${name} does not exist`);
    const types = f.types ? f.types.split(/,\s*/) : [];
    const names = f.args || [];
    const params = [], parts = [];
    names.forEach((n, i) => {
      if (!(n in (args || {}))) return; // left to the function's default
      let v = args[n];
      if (/json/.test(types[i]) && typeof v !== 'string') v = JSON.stringify(v);
      params.push(v);
      parts.push(`${n} => $${params.length}::${types[i]}`);
    });
    const call = `public.${name}(${parts.join(', ')})`;
    if (f.set || f.kind === 'c') {
      const rows = (await db.query(`select * from ${call}`, params)).rows;
      return f.set ? rows : rows[0] ?? null;
    }
    const v = (await db.query(`select ${call} as v`, params)).rows[0].v;
    return f.ret === 'void' ? null : v;
  }
  const rpcAs = (uid, email, name, args) => as(uid, email, () => callRpc(name, args));

  // ---------- PostgREST-style select with embedded relations ----------
  function parseSelect(s) {
    const out = []; let depth = 0, cur = '';
    for (const ch of s) { if (ch === '(') depth++; if (ch === ')') depth--; if (ch === ',' && !depth) { out.push(cur.trim()); cur = ''; } else cur += ch; }
    if (cur.trim()) out.push(cur.trim());
    return out.map(p => { const m = p.match(/^(\w+)\((.*)\)$/s); return m ? { rel: m[1], inner: m[2] } : { col: p }; });
  }
  let aliasN = 0;
  function rowJson(table, alias, sel) {
    const items = parseSelect(sel || '*');
    const cols = [], rels = [];
    let star = false;
    for (const it of items) {
      if (it.col === '*') star = true;
      else if (it.col) cols.push(`${lit(it.col)}, ${alias}.${it.col}`);
      else {
        const a = 'r' + (++aliasN);
        const m2o = meta.fks.find(f => f.child === table && f.parent === it.rel);
        const o2m = meta.fks.find(f => f.child === it.rel && f.parent === table);
        let sub;
        if (it.inner.trim() === 'count') {
          sub = `jsonb_build_array(jsonb_build_object('count', (select count(*) from ${it.rel} ${a} where ${a}.${o2m.child_col} = ${alias}.${o2m.parent_col})))`;
        } else if (m2o) {
          sub = `(select ${rowJson(it.rel, a, it.inner)} from ${it.rel} ${a} where ${a}.${m2o.parent_col} = ${alias}.${m2o.child_col})`;
        } else if (o2m) {
          sub = `coalesce((select jsonb_agg(${rowJson(it.rel, a, it.inner)}) from ${it.rel} ${a} where ${a}.${o2m.child_col} = ${alias}.${o2m.parent_col}), '[]'::jsonb)`;
        } else throw new Error(`no relationship between ${table} and ${it.rel}`);
        rels.push(`${lit(it.rel)}, ${sub}`);
      }
    }
    let expr = star ? `to_jsonb(${alias})` : `jsonb_build_object(${cols.join(', ')})`;
    if (!star && !cols.length) expr = `'{}'::jsonb`;
    if (rels.length) expr = `(${expr} || jsonb_build_object(${rels.join(', ')}))`;
    return expr;
  }

  function from(table) {
    const st = { op: 'select', sel: '*', where: [], params: [], order: [], one: null, payload: null, ret: false, limit: null };
    const p = v => { st.params.push(v); return '$' + st.params.length; };
    const q = {
      select(s) { if (st.op === 'select') st.sel = s || '*'; else { st.ret = true; st.sel = s || '*'; } return q; },
      eq(c, v) { st.where.push(v === null ? `t.${c} is null` : `t.${c} = ${p(v)}`); return q; },
      neq(c, v) { st.where.push(`t.${c} <> ${p(v)}`); return q; },
      in(c, arr) { st.where.push(arr.length ? `t.${c}::text in (${arr.map(v => p(String(v))).join(', ')})` : 'false'); return q; },
      not(c, op, v) { if (op !== 'is' || v !== null) throw new Error('demo: unsupported filter'); st.where.push(`t.${c} is not null`); return q; },
      is(c, v) { st.where.push(`t.${c} is ${v === null ? 'null' : v ? 'true' : 'false'}`); return q; },
      order(c, o) { st.order.push(`t.${c} ${o && o.ascending === false ? 'desc' : 'asc'}`); return q; },
      limit(n) { st.limit = n; return q; },
      single() { st.one = 'single'; return q; },
      maybeSingle() { st.one = 'maybe'; return q; },
      insert(v) { st.op = 'insert'; st.payload = v; return q; },
      upsert(v) { st.op = 'upsert'; st.payload = v; return q; },
      update(v) { st.op = 'update'; st.payload = v; return q; },
      delete() { st.op = 'delete'; return q; },
      then(res, rej) { return run().then(res, rej); },
    };
    async function run() {
      try {
        await ready;
        const data = await as(ME, ME_EMAIL, () => exec());
        return { data, error: null };
      } catch (e) {
        return { data: null, error: { message: e.message, code: e.code } };
      }
    }
    async function exec() {
      const where = st.where.length ? ' where ' + st.where.join(' and ') : '';
      if (st.op === 'select') {
        let sql = `select ${rowJson(table, 't', st.sel)} as j from ${table} t${where}`;
        if (st.order.length) sql += ' order by ' + st.order.join(', ');
        if (st.limit) sql += ' limit ' + Number(st.limit);
        const rows = (await db.query(sql, st.params)).rows.map(r => r.j);
        return shape(rows);
      }
      if (st.op === 'delete') {
        await db.query(`delete from ${table} t${where}`, st.params);
        return null;
      }
      const list = Array.isArray(st.payload) ? st.payload : [st.payload];
      const keys = [...new Set(list.flatMap(o => Object.keys(o)))];
      const ret = st.ret ? ` returning ${rowJson(table, 't', st.sel)} as j` : '';
      let rows;
      if (st.op === 'update') {
        const json = p(JSON.stringify(st.payload));
        rows = (await db.query(`update ${table} t set ${keys.map(k => `${k} = r.${k}`).join(', ')}
          from jsonb_populate_record(null::${table}, ${json}::jsonb) r${where}${ret}`, st.params)).rows;
      } else {
        const json = p(JSON.stringify(list));
        let sql = `insert into ${table} as t (${keys.join(', ')}) select ${keys.join(', ')} from jsonb_populate_recordset(null::${table}, ${json}::jsonb)`;
        if (st.op === 'upsert') {
          const pk = meta.pk[table];
          const upd = keys.filter(k => !pk.includes(k));
          sql += ` on conflict (${pk.join(', ')}) do ${upd.length ? 'update set ' + upd.map(k => `${k} = excluded.${k}`).join(', ') : 'nothing'}`;
        }
        rows = (await db.query(sql + ret, st.params)).rows;
      }
      return st.ret ? shape(rows.map(r => r.j)) : null;
    }
    function shape(rows) {
      if (st.one === 'single') { if (rows.length !== 1) throw Object.assign(new Error('JSON object requested, multiple (or no) rows returned'), { code: 'PGRST116' }); return rows[0]; }
      if (st.one === 'maybe') return rows[0] ?? null;
      return rows;
    }
    return q;
  }

  // ---------- the client the app sees ----------
  const session = { user: { id: ME, email: ME_EMAIL } };
  let signedIn = true;
  const client = {
    auth: {
      getSession: async () => { await ready; return { data: { session: signedIn ? session : null }, error: null }; },
      signInWithOAuth: async () => { signedIn = true; location.reload(); return { error: null }; },
      signOut: async () => { signedIn = false; return { error: null }; },
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
    from,
    rpc: async (name, args) => {
      try { await ready; return { data: await rpcAs(ME, ME_EMAIL, name, args), error: null }; }
      catch (e) { return { data: null, error: { message: e.message, code: e.code } }; }
    },
  };
  window.supabase = { createClient: () => client };
  // screenshot helper for the portfolio (only with ?shots): the answer key of a paper, read as superuser
  if (new URLSearchParams(location.search).has('shots'))
    window.DEMO_KEY = async ids => { await ready; return (await db.query(`select id, kind, correct, accepted from questions where id = any($1::uuid[])`, [ids])).rows; };
})();
