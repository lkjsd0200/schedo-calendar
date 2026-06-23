// ===== HELPERS =====

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
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

// ===== API HANDLERS =====

async function createRoom(request, env) {
  const { name, password } = await request.json();
  if (!name || !password) return json({ error: '이름과 비밀번호를 입력하세요.' }, 400);
  const id = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  const hash = await hashPassword(password);
  await env.DB.prepare('INSERT INTO rooms (id, name, password_hash) VALUES (?, ?, ?)').bind(id, name, hash).run();
  return json({ id, name });
}

async function joinRoom(request, env, roomId) {
  const { password, participantName, participantColor } = await request.json();
  const room = await env.DB.prepare('SELECT * FROM rooms WHERE id = ?').bind(roomId).first();
  if (!room) return json({ error: '방을 찾을 수 없습니다.' }, 404);
  if (!(await verifyPassword(password, room.password_hash))) return json({ error: '비밀번호가 틀렸습니다.' }, 401);

  let participant = await env.DB.prepare('SELECT * FROM participants WHERE room_id = ? AND name = ?').bind(roomId, participantName).first();
  if (!participant) {
    const pid = crypto.randomUUID();
    const color = participantColor || randomColor();
    await env.DB.prepare('INSERT INTO participants (id, room_id, name, color) VALUES (?, ?, ?, ?)').bind(pid, roomId, participantName, color).run();
    participant = await env.DB.prepare('SELECT * FROM participants WHERE id = ?').bind(pid).first();
  }

  const { results: events } = await env.DB.prepare('SELECT * FROM events WHERE room_id = ?').bind(roomId).all();
  const { results: participants } = await env.DB.prepare('SELECT * FROM participants WHERE room_id = ?').bind(roomId).all();
  return json({ room: { id: room.id, name: room.name }, participant, events, participants });
}

async function syncRoom(env, roomId) {
  const { results: events } = await env.DB.prepare('SELECT * FROM events WHERE room_id = ?').bind(roomId).all();
  const { results: participants } = await env.DB.prepare('SELECT * FROM participants WHERE room_id = ?').bind(roomId).all();
  return json({ events, participants });
}

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

  const event = await env.DB.prepare('SELECT * FROM events WHERE id = ?').bind(id).first();
  return json(event);
}

async function updateEvent(request, env, roomId, eventId) {
  const { participantId, title, category, date, endDate, startTime, endTime, memo, allDay } = await request.json();
  const event = await env.DB.prepare('SELECT * FROM events WHERE id = ? AND room_id = ?').bind(eventId, roomId).first();
  if (!event) return json({ error: '이벤트 없음' }, 404);
  if (event.participant_id !== participantId) return json({ error: '수정 권한 없음' }, 403);

  await env.DB.prepare(
    `UPDATE events SET title=?, category=?, date=?, end_date=?, start_time=?, end_time=?, memo=?, all_day=?, updated_at=unixepoch() WHERE id=?`
  ).bind(title, category || 'default', date, endDate || null, startTime || null, endTime || null, memo || '', allDay ? 1 : 0, eventId).run();

  const updated = await env.DB.prepare('SELECT * FROM events WHERE id = ?').bind(eventId).first();
  return json(updated);
}

async function deleteEvent(request, env, roomId, eventId) {
  const { participantId } = await request.json();
  const event = await env.DB.prepare('SELECT * FROM events WHERE id = ? AND room_id = ?').bind(eventId, roomId).first();
  if (!event) return json({ error: '이벤트 없음' }, 404);
  if (event.participant_id !== participantId) return json({ error: '삭제 권한 없음' }, 403);
  await env.DB.prepare('DELETE FROM events WHERE id = ?').bind(eventId).run();
  return json({ ok: true });
}

// ===== CONFIG =====

function getConfig(env) {
  return json({ googleClientId: env.GOOGLE_CLIENT_ID || '' });
}

// ===== ROUTER =====

async function handleAPI(request, env, url) {
  const method = request.method;
  const parts = url.pathname.replace(/^\/api\//, '').split('/').filter(Boolean);
  // parts: ['rooms'], ['rooms', id, 'join'], ['rooms', id, 'sync'], ['rooms', id, 'events'], ['rooms', id, 'events', eventId]

  try {
    if (parts[0] === 'config' && method === 'GET') return getConfig(env);
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
    if (url.pathname.startsWith('/api/')) {
      return handleAPI(request, env, url);
    }
    return env.ASSETS.fetch(request);
  }
};
