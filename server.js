const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// ===== DEFAULT CATEGORIES =====
const DEFAULT_CATEGORIES = [
  { key: 'default', label: '일반',     icon: '📋', color: null },
  { key: 'online',  label: '온라인행사', icon: '🖥️', color: '#3B82F6' },
  { key: 'leave',   label: '연·반차',  icon: '🏖️', color: '#F59E0B' },
  { key: 'field',   label: '외근',     icon: '🚗', color: '#10B981' },
  { key: 'dept',    label: '부서일정', icon: '👥', color: '#8B5CF6' },
];

// ===== JSON FILE DB =====
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function loadDB() {
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf8').replace(/^﻿/, '');
    const db = JSON.parse(raw);
    if (!db.checklists) db.checklists = {};
    if (!db.categories) db.categories = {};
    return db;
  } catch {
    return { rooms: {}, participants: {}, events: {}, checklists: {}, categories: {} };
  }
}

function saveDB(db) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
  } catch (err) {
    console.error('DB 저장 오류:', err.message);
    throw err;
  }
}

let db = loadDB();

function getOrSeedCategories(roomId) {
  const cats = Object.values(db.categories).filter(c => c.room_id === roomId)
    .sort((a, b) => a.sort_order - b.sort_order || a.created_at - b.created_at);
  if (cats.length > 0) return cats;

  // Seed defaults
  DEFAULT_CATEGORIES.forEach((c, i) => {
    const id = uuidv4();
    db.categories[id] = { id, room_id: roomId, key: c.key, label: c.label, icon: c.icon, color: c.color || null, sort_order: i, created_at: Date.now() };
  });
  saveDB(db);
  return Object.values(db.categories).filter(c => c.room_id === roomId).sort((a, b) => a.sort_order - b.sort_order);
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ===== API =====

// 방 생성
app.post('/api/rooms', (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: '이름을 입력하세요.' });
    const id = uuidv4().replace(/-/g, '').slice(0, 12);
    db.rooms[id] = { id, name, password_hash: '', created_at: Date.now() };
    DEFAULT_CATEGORIES.forEach((c, i) => {
      const cid = uuidv4();
      db.categories[cid] = { id: cid, room_id: id, key: c.key, label: c.label, icon: c.icon, color: c.color || null, sort_order: i, created_at: Date.now() };
    });
    saveDB(db);
    res.json({ id, name });
  } catch (err) {
    console.error('방 생성 오류:', err.message);
    res.status(500).json({ error: '서버 오류: ' + err.message });
  }
});

// 방 입장
app.post('/api/rooms/:id/join', (req, res) => {
  try {
    const { participantName, participantColor } = req.body;
    const room = db.rooms[req.params.id];
    if (!room) return res.status(404).json({ error: '방을 찾을 수 없습니다.' });

    let participant = Object.values(db.participants).find(p => p.room_id === room.id && p.name === participantName);
    if (!participant) {
      const pid = uuidv4();
      participant = { id: pid, room_id: room.id, name: participantName, color: participantColor || randomColor(), created_at: Date.now() };
      db.participants[pid] = participant;
      saveDB(db);
    }

    const events = Object.values(db.events).filter(e => e.room_id === room.id);
    const participants = Object.values(db.participants).filter(p => p.room_id === room.id);
    const checklists = Object.values(db.checklists).filter(c => c.room_id === room.id).sort((a, b) => a.created_at - b.created_at);
    const categories = getOrSeedCategories(room.id);
    res.json({ room: { id: room.id, name: room.name }, participant, events, participants, checklists, categories });
  } catch (err) {
    console.error('방 입장 오류:', err.message);
    res.status(500).json({ error: '서버 오류: ' + err.message });
  }
});

// 설정
app.get('/api/config', (req, res) => {
  res.json({ googleClientId: process.env.GOOGLE_CLIENT_ID || '' });
});

// 폴링 동기화
app.get('/api/rooms/:id/sync', (req, res) => {
  const room = db.rooms[req.params.id];
  if (!room) return res.status(404).json({ error: '방 없음' });
  const events = Object.values(db.events).filter(e => e.room_id === room.id);
  const participants = Object.values(db.participants).filter(p => p.room_id === room.id);
  const checklists = Object.values(db.checklists).filter(c => c.room_id === room.id).sort((a, b) => a.created_at - b.created_at);
  const categories = getOrSeedCategories(room.id);
  res.json({ events, participants, checklists, categories });
});

// 이벤트 추가
app.post('/api/rooms/:id/events', (req, res) => {
  try {
    const { participantId, title, category, date, endDate, startTime, endTime, memo, allDay } = req.body;
    const room = db.rooms[req.params.id];
    if (!room) return res.status(404).json({ error: '방 없음' });
    const participant = db.participants[participantId];
    if (!participant || participant.room_id !== room.id) return res.status(403).json({ error: '참여자 없음' });

    const id = uuidv4();
    const event = { id, room_id: room.id, participant_id: participantId, title, category: category || 'default', date, end_date: endDate || null, start_time: startTime || null, end_time: endTime || null, memo: memo || '', all_day: allDay ? 1 : 0, created_at: Date.now() };
    db.events[id] = event;
    saveDB(db);
    res.json(event);
  } catch (err) {
    console.error('이벤트 추가 오류:', err.message);
    res.status(500).json({ error: '서버 오류: ' + err.message });
  }
});

// 이벤트 수정
app.put('/api/rooms/:roomId/events/:eventId', (req, res) => {
  try {
    const { participantId, title, category, date, endDate, startTime, endTime, memo, allDay } = req.body;
    const event = db.events[req.params.eventId];
    if (!event || event.room_id !== req.params.roomId) return res.status(404).json({ error: '이벤트 없음' });
    if (event.participant_id !== participantId) return res.status(403).json({ error: '수정 권한 없음' });
    Object.assign(event, { title, category: category || 'default', date, end_date: endDate || null, start_time: startTime || null, end_time: endTime || null, memo: memo || '', all_day: allDay ? 1 : 0 });
    saveDB(db);
    res.json(event);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 이벤트 삭제
app.delete('/api/rooms/:roomId/events/:eventId', (req, res) => {
  try {
    const { participantId } = req.body;
    const event = db.events[req.params.eventId];
    if (!event || event.room_id !== req.params.roomId) return res.status(404).json({ error: '이벤트 없음' });
    if (event.participant_id !== participantId) return res.status(403).json({ error: '삭제 권한 없음' });
    delete db.events[req.params.eventId];
    saveDB(db);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 체크리스트 추가
app.post('/api/rooms/:id/checklists', (req, res) => {
  try {
    const { participantId, title } = req.body;
    const room = db.rooms[req.params.id];
    if (!room) return res.status(404).json({ error: '방 없음' });
    const participant = db.participants[participantId];
    if (!participant || participant.room_id !== room.id) return res.status(403).json({ error: '참여자 없음' });
    const id = uuidv4();
    const item = { id, room_id: room.id, participant_id: participantId, title, checked: 0, created_at: Date.now() };
    db.checklists[id] = item;
    saveDB(db);
    res.json(item);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 체크리스트 토글
app.put('/api/rooms/:roomId/checklists/:itemId', (req, res) => {
  try {
    const item = db.checklists[req.params.itemId];
    if (!item || item.room_id !== req.params.roomId) return res.status(404).json({ error: '항목 없음' });
    item.checked = item.checked ? 0 : 1;
    saveDB(db);
    res.json(item);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 체크리스트 삭제
app.delete('/api/rooms/:roomId/checklists/:itemId', (req, res) => {
  try {
    const { participantId } = req.body;
    const item = db.checklists[req.params.itemId];
    if (!item || item.room_id !== req.params.roomId) return res.status(404).json({ error: '항목 없음' });
    if (item.participant_id !== participantId) return res.status(403).json({ error: '삭제 권한 없음' });
    delete db.checklists[req.params.itemId];
    saveDB(db);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 카테고리 추가
app.post('/api/rooms/:id/categories', (req, res) => {
  try {
    const { label, icon, color } = req.body;
    const room = db.rooms[req.params.id];
    if (!room) return res.status(404).json({ error: '방 없음' });
    if (!label || !label.trim()) return res.status(400).json({ error: '이름을 입력하세요.' });

    const roomCats = Object.values(db.categories).filter(c => c.room_id === room.id);
    const maxOrder = roomCats.reduce((m, c) => Math.max(m, c.sort_order), -1);
    const id = uuidv4();
    const key = id.replace(/-/g, '').slice(0, 12);
    const cat = { id, room_id: room.id, key, label: label.trim(), icon: icon || '📋', color: color || null, sort_order: maxOrder + 1, created_at: Date.now() };
    db.categories[id] = cat;
    saveDB(db);
    res.json(cat);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 카테고리 삭제
app.delete('/api/rooms/:roomId/categories/:catId', (req, res) => {
  try {
    const cat = db.categories[req.params.catId];
    if (!cat || cat.room_id !== req.params.roomId) return res.status(404).json({ error: '카테고리 없음' });
    const count = Object.values(db.categories).filter(c => c.room_id === req.params.roomId).length;
    if (count <= 1) return res.status(400).json({ error: '마지막 카테고리는 삭제할 수 없습니다.' });
    delete db.categories[req.params.catId];
    saveDB(db);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Socket.io
io.on('connection', (socket) => {
  socket.on('join:room', (roomId) => socket.join(roomId));
  socket.on('leave:room', (roomId) => socket.leave(roomId));
});

function randomColor() {
  const colors = ['#4A90D9','#E25B5B','#50C878','#F5A623','#9B59B6','#1ABC9C','#E67E22','#2ECC71','#3498DB','#E91E63'];
  return colors[Math.floor(Math.random() * colors.length)];
}

// ===== 서버 시작 =====
const PORT = process.env.PORT || 3000;
const USE_TUNNEL = process.argv.includes('--tunnel');

server.listen(PORT, async () => {
  console.log(`\n✅ Schedo Calendar 실행 중`);
  console.log(`   로컬 주소: http://localhost:${PORT}`);

  if (USE_TUNNEL) {
    try {
      console.log('\n🌐 인터넷 공개 URL 생성 중...');
      const localtunnel = require('localtunnel');
      const tunnel = await localtunnel({ port: PORT });
      console.log(`\n🔗 공개 URL: ${tunnel.url}`);
      console.log(`   이 주소를 참여자들에게 공유하세요!\n`);
      tunnel.on('close', () => console.log('터널이 닫혔습니다.'));
      tunnel.on('error', err => console.error('터널 오류:', err.message));
    } catch (err) {
      console.error('터널 생성 실패:', err.message);
    }
  } else {
    console.log(`   (인터넷 공개: node server.js --tunnel 로 실행)\n`);
  }
});

process.on('uncaughtException', err => console.error('예외 발생:', err.message));
