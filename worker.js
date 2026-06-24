// ===== DEFAULT CATEGORIES =====
const DEFAULT_CATEGORIES = [
  { key: 'default', label: '일반',     icon: '📋', color: null },
  { key: 'online',  label: '온라인행사', icon: '🖥️', color: '#3B82F6' },
  { key: 'leave',   label: '연·반차',  icon: '🏖️', color: '#F59E0B' },
  { key: 'field',   label: '외근',     icon: '🚗', color: '#10B981' },
  { key: 'dept',    label: '부서일정', icon: '👥', color: '#8B5CF6' },
];

// ===== HELPERS =====

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}

async function hashPassword(password) {
  const enc = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, key, 256);
  const saltHex = [...salt].map(b => b.toString(16).padStart(2, '0')).join('');
  const hashHex = [...new Uint8Array(bits)].map(b => b.toString(16).padStart(2, '0')).join('');
  return `pbkdf2:${saltHex}:${hashHex}`;
}

async function verifyPassword(password, stored) {
  if (!stored || !stored.startsWith('pbkdf2:')) return false;
  const [, saltHex, hashHex] = stored.split(':');
  const salt = new Uint8Array(saltHex.match(/.{2}/g).map(h => parseInt(h, 16)));
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, key, 256);
  const hashHexNew = [...new Uint8Array(bits)].map(b => b.toString(16).padStart(2, '0')).join('');
  if (hashHex.length !== hashHexNew.length) return false;
  let diff = 0;
  for (let i = 0; i < hashHex.length; i++) diff |= hashHex.charCodeAt(i) ^ hashHexNew.charCodeAt(i);
  return diff === 0;
}

function randomColor() {
  const colors = ['#4A90D9','#E25B5B','#50C878','#F5A623','#9B59B6','#1ABC9C','#E67E22','#2ECC71','#3498DB','#E91E63'];
  return colors[Math.floor(Math.random() * colors.length)];
}

async function getOrSeedCategories(env, roomId) {
  const { results } = await env.DB.prepare(
    'SELECT * FROM categories WHERE room_id = ? ORDER BY sort_order ASC, created_at ASC'
  ).bind(roomId).all();
  if (results.length > 0) return results;

  const stmts = DEFAULT_CATEGORIES.map((c, i) =>
    env.DB.prepare('INSERT INTO categories (id, room_id, key, label, icon, color, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), roomId, c.key, c.label, c.icon, c.color || null, i)
  );
  await env.DB.batch(stmts);

  const { results: seeded } = await env.DB.prepare(
    'SELECT * FROM categories WHERE room_id = ? ORDER BY sort_order ASC'
  ).bind(roomId).all();
  return seeded;
}

// ===== ROOMS =====

async function createRoom(request, env) {
  const { name } = await request.json();
  if (!name) return json({ error: '이름을 입력하세요.' }, 400);
  const id = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  await env.DB.prepare('INSERT INTO rooms (id, name, password_hash) VALUES (?, ?, ?)').bind(id, name, '').run();

  const stmts = DEFAULT_CATEGORIES.map((c, i) =>
    env.DB.prepare('INSERT INTO categories (id, room_id, key, label, icon, color, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), id, c.key, c.label, c.icon, c.color || null, i)
  );
  await env.DB.batch(stmts);

  return json({ id, name });
}

async function joinRoom(request, env, roomId) {
  const { participantName, participantColor } = await request.json();
  const room = await env.DB.prepare('SELECT * FROM rooms WHERE id = ?').bind(roomId).first();
  if (!room) return json({ error: '방을 찾을 수 없습니다.' }, 404);

  let participant = await env.DB.prepare('SELECT * FROM participants WHERE room_id = ? AND name = ?').bind(roomId, participantName).first();
  if (!participant) {
    const pid = crypto.randomUUID();
    const color = participantColor || randomColor();
    await env.DB.prepare('INSERT INTO participants (id, room_id, name, color) VALUES (?, ?, ?, ?)').bind(pid, roomId, participantName, color).run();
    participant = await env.DB.prepare('SELECT * FROM participants WHERE id = ?').bind(pid).first();
  }

  const { results: events } = await env.DB.prepare('SELECT * FROM events WHERE room_id = ?').bind(roomId).all();
  const { results: participants } = await env.DB.prepare('SELECT * FROM participants WHERE room_id = ?').bind(roomId).all();
  const { results: checklists } = await env.DB.prepare('SELECT * FROM checklists WHERE room_id = ? ORDER BY created_at ASC').bind(roomId).all();
  const categories = await getOrSeedCategories(env, roomId);
  return json({ room: { id: room.id, name: room.name }, participant, events, participants, checklists, categories });
}

async function syncRoom(env, roomId) {
  const { results: events } = await env.DB.prepare('SELECT * FROM events WHERE room_id = ?').bind(roomId).all();
  const { results: participants } = await env.DB.prepare('SELECT * FROM participants WHERE room_id = ?').bind(roomId).all();
  const { results: checklists } = await env.DB.prepare('SELECT * FROM checklists WHERE room_id = ? ORDER BY created_at ASC').bind(roomId).all();
  const categories = await getOrSeedCategories(env, roomId);
  return json({ events, participants, checklists, categories });
}

// ===== EVENTS =====

async function addEvent(request, env, roomId) {
  const { participantId, title, category, date, endDate, startTime, endTime, memo, allDay } = await request.json();
  const room = await env.DB.prepare('SELECT id FROM rooms WHERE id = ?').bind(roomId).first();
  if (!room) return json({ error: '방 없음' }, 404);
  const participant = await env.DB.prepare('SELECT id FROM participants WHERE id = ? AND room_id = ?').bind(participantId, roomId).first();
  if (!participant) return json({ error: '참여자 없음' }, 403);

  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO events (id, room_id, participant_id, title, category, date, end_date, start_time, end_time, memo, all_day)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, roomId, participantId, title, category || 'default', date, endDate || null, startTime || null, endTime || null, memo || '', allDay ? 1 : 0).run();

  return json(await env.DB.prepare('SELECT * FROM events WHERE id = ?').bind(id).first());
}

async function updateEvent(request, env, roomId, eventId) {
  const { participantId, title, category, date, endDate, startTime, endTime, memo, allDay } = await request.json();
  const event = await env.DB.prepare('SELECT * FROM events WHERE id = ? AND room_id = ?').bind(eventId, roomId).first();
  if (!event) return json({ error: '이벤트 없음' }, 404);
  if (event.participant_id !== participantId) return json({ error: '수정 권한 없음' }, 403);

  await env.DB.prepare(
    `UPDATE events SET title=?, category=?, date=?, end_date=?, start_time=?, end_time=?, memo=?, all_day=?, updated_at=unixepoch() WHERE id=?`
  ).bind(title, category || 'default', date, endDate || null, startTime || null, endTime || null, memo || '', allDay ? 1 : 0, eventId).run();

  return json(await env.DB.prepare('SELECT * FROM events WHERE id = ?').bind(eventId).first());
}

async function deleteEvent(request, env, roomId, eventId) {
  const { participantId } = await request.json();
  const event = await env.DB.prepare('SELECT * FROM events WHERE id = ? AND room_id = ?').bind(eventId, roomId).first();
  if (!event) return json({ error: '이벤트 없음' }, 404);
  if (event.participant_id !== participantId) return json({ error: '삭제 권한 없음' }, 403);
  await env.DB.prepare('DELETE FROM events WHERE id = ?').bind(eventId).run();
  return json({ ok: true });
}

// ===== CHECKLISTS =====

async function addChecklist(request, env, roomId) {
  const { participantId, title } = await request.json();
  const room = await env.DB.prepare('SELECT id FROM rooms WHERE id = ?').bind(roomId).first();
  if (!room) return json({ error: '방 없음' }, 404);
  const participant = await env.DB.prepare('SELECT id FROM participants WHERE id = ? AND room_id = ?').bind(participantId, roomId).first();
  if (!participant) return json({ error: '참여자 없음' }, 403);

  const id = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO checklists (id, room_id, participant_id, title) VALUES (?, ?, ?, ?)').bind(id, roomId, participantId, title).run();
  return json(await env.DB.prepare('SELECT * FROM checklists WHERE id = ?').bind(id).first());
}

async function toggleChecklist(request, env, roomId, itemId) {
  const item = await env.DB.prepare('SELECT * FROM checklists WHERE id = ? AND room_id = ?').bind(itemId, roomId).first();
  if (!item) return json({ error: '항목 없음' }, 404);
  await env.DB.prepare('UPDATE checklists SET checked = ? WHERE id = ?').bind(item.checked ? 0 : 1, itemId).run();
  return json(await env.DB.prepare('SELECT * FROM checklists WHERE id = ?').bind(itemId).first());
}

async function deleteChecklist(request, env, roomId, itemId) {
  const { participantId } = await request.json();
  const item = await env.DB.prepare('SELECT * FROM checklists WHERE id = ? AND room_id = ?').bind(itemId, roomId).first();
  if (!item) return json({ error: '항목 없음' }, 404);
  if (item.participant_id !== participantId) return json({ error: '삭제 권한 없음' }, 403);
  await env.DB.prepare('DELETE FROM checklists WHERE id = ?').bind(itemId).run();
  return json({ ok: true });
}

// ===== CATEGORIES =====

async function addCategory(request, env, roomId) {
  const room = await env.DB.prepare('SELECT id FROM rooms WHERE id = ?').bind(roomId).first();
  if (!room) return json({ error: '방 없음' }, 404);

  const { label, icon, color } = await request.json();
  if (!label || !label.trim()) return json({ error: '이름을 입력하세요.' }, 400);

  const existing = await env.DB.prepare('SELECT MAX(sort_order) as m FROM categories WHERE room_id = ?').bind(roomId).first();
  const sortOrder = (existing?.m ?? -1) + 1;

  const id = crypto.randomUUID();
  const key = id.replace(/-/g, '').slice(0, 12);
  await env.DB.prepare(
    'INSERT INTO categories (id, room_id, key, label, icon, color, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, roomId, key, label.trim(), icon || '📋', color || null, sortOrder).run();

  return json(await env.DB.prepare('SELECT * FROM categories WHERE id = ?').bind(id).first());
}

async function deleteCategory(request, env, roomId, catId) {
  const cat = await env.DB.prepare('SELECT * FROM categories WHERE id = ? AND room_id = ?').bind(catId, roomId).first();
  if (!cat) return json({ error: '카테고리 없음' }, 404);

  const { count } = await env.DB.prepare('SELECT COUNT(*) as count FROM categories WHERE room_id = ?').bind(roomId).first();
  if (count <= 1) return json({ error: '마지막 카테고리는 삭제할 수 없습니다.' }, 400);

  await env.DB.prepare('DELETE FROM categories WHERE id = ?').bind(catId).run();
  return json({ ok: true });
}

// ===== CONFIG =====

function getConfig(env) {
  return json({ googleClientId: env.GOOGLE_CLIENT_ID || '' });
}

// ===== GOOGLE CALENDAR =====

function startGoogleAuth(env, url) {
  const clientId = env.GOOGLE_CLIENT_ID;
  const clientSecret = env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return new Response('Google OAuth가 설정되지 않았습니다. GOOGLE_CLIENT_ID와 GOOGLE_CLIENT_SECRET을 확인하세요.', { status: 500 });
  }
  const participantId = url.searchParams.get('participantId');
  if (!participantId) return json({ error: 'participantId 필요' }, 400);

  const redirectUri = `${url.origin}/api/auth/google/callback`;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/calendar.readonly',
    access_type: 'offline',
    state: participantId,
    prompt: 'consent'
  });
  return Response.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`, 302);
}

async function handleGoogleCallback(env, url) {
  const code = url.searchParams.get('code');
  const participantId = url.searchParams.get('state');
  if (!code || !participantId) {
    return Response.redirect(`${url.origin}/calendar.html#gcal-error`, 302);
  }

  const redirectUri = `${url.origin}/api/auth/google/callback`;
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code'
    })
  });

  const tokens = await tokenRes.json();
  if (!tokens.access_token) {
    return Response.redirect(`${url.origin}/calendar.html#gcal-error`, 302);
  }

  const expiresAt = Date.now() + (tokens.expires_in || 3600) * 1000;
  await env.DB.prepare(
    'INSERT OR REPLACE INTO google_tokens (participant_id, access_token, refresh_token, expires_at) VALUES (?, ?, ?, ?)'
  ).bind(participantId, tokens.access_token, tokens.refresh_token || null, expiresAt).run();

  return Response.redirect(`${url.origin}/calendar.html#gcal-ok`, 302);
}

async function getGoogleEvents(env, url) {
  const participantId = url.searchParams.get('participantId');
  if (!participantId) return json({ error: 'participantId 필요' }, 400);

  const token = await env.DB.prepare('SELECT * FROM google_tokens WHERE participant_id = ?').bind(participantId).first();
  if (!token) return json({ events: [], connected: false });

  let accessToken = token.access_token;

  if (Date.now() > token.expires_at - 300000) {
    if (!token.refresh_token) {
      await env.DB.prepare('DELETE FROM google_tokens WHERE participant_id = ?').bind(participantId).run();
      return json({ events: [], connected: false });
    }
    const refreshRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        refresh_token: token.refresh_token,
        grant_type: 'refresh_token'
      })
    });
    const refreshed = await refreshRes.json();
    if (!refreshed.access_token) {
      await env.DB.prepare('DELETE FROM google_tokens WHERE participant_id = ?').bind(participantId).run();
      return json({ events: [], connected: false });
    }
    accessToken = refreshed.access_token;
    await env.DB.prepare('UPDATE google_tokens SET access_token=?, expires_at=? WHERE participant_id=?')
      .bind(accessToken, Date.now() + (refreshed.expires_in || 3600) * 1000, participantId).run();
  }

  const timeMin = url.searchParams.get('timeMin') || new Date().toISOString();
  const timeMax = url.searchParams.get('timeMax') || new Date(Date.now() + 30 * 86400000).toISOString();

  const calRes = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?` +
    `timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&singleEvents=true&orderBy=startTime&maxResults=200`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  const calData = await calRes.json();
  if (calData.error) {
    if (calData.error.code === 401) {
      await env.DB.prepare('DELETE FROM google_tokens WHERE participant_id = ?').bind(participantId).run();
      return json({ events: [], connected: false });
    }
    return json({ error: calData.error.message }, 500);
  }

  return json({ events: calData.items || [], connected: true });
}

async function disconnectGoogle(url, env) {
  const participantId = url.searchParams.get('participantId');
  if (!participantId) return json({ error: 'participantId 필요' }, 400);
  await env.DB.prepare('DELETE FROM google_tokens WHERE participant_id = ?').bind(participantId).run();
  return json({ ok: true });
}

// ===== ROUTER =====

async function handleAPI(request, env, url) {
  const method = request.method;
  const parts = url.pathname.replace(/^\/api\//, '').split('/').filter(Boolean);

  try {
    if (parts[0] === 'config' && method === 'GET') return getConfig(env);

    // Google OAuth routes
    if (parts[0] === 'auth' && parts[1] === 'google') {
      if (!parts[2] && method === 'GET') return startGoogleAuth(env, url);
      if (parts[2] === 'callback' && method === 'GET') return handleGoogleCallback(env, url);
    }

    if (parts[0] !== 'rooms') return json({ error: '잘못된 요청' }, 404);

    if (parts.length === 1 && method === 'POST') return createRoom(request, env);

    if (parts.length >= 3) {
      const roomId = parts[1];
      const action = parts[2];

      if (action === 'join' && method === 'POST') return joinRoom(request, env, roomId);
      if (action === 'sync' && method === 'GET') return syncRoom(env, roomId);

      if (action === 'events') {
        if (!parts[3]) {
          if (method === 'GET') return syncRoom(env, roomId);
          if (method === 'POST') return addEvent(request, env, roomId);
        } else {
          if (method === 'PUT') return updateEvent(request, env, roomId, parts[3]);
          if (method === 'DELETE') return deleteEvent(request, env, roomId, parts[3]);
        }
      }

      if (action === 'checklists') {
        if (!parts[3]) {
          if (method === 'POST') return addChecklist(request, env, roomId);
        } else {
          if (method === 'PUT') return toggleChecklist(request, env, roomId, parts[3]);
          if (method === 'DELETE') return deleteChecklist(request, env, roomId, parts[3]);
        }
      }

      if (action === 'categories') {
        if (!parts[3]) {
          if (method === 'POST') return addCategory(request, env, roomId);
        } else {
          if (method === 'DELETE') return deleteCategory(request, env, roomId, parts[3]);
        }
      }

      if (action === 'google-events') {
        if (method === 'GET') return getGoogleEvents(env, url);
        if (method === 'DELETE') return disconnectGoogle(url, env);
      }
    }

    return json({ error: '잘못된 요청' }, 404);
  } catch (err) {
    console.error('API Error:', err);
    return json({ error: err.message }, 500);
  }
}

// ===== ENTRY POINT =====

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) return handleAPI(request, env, url);
    return env.ASSETS.fetch(request);
  }
};
