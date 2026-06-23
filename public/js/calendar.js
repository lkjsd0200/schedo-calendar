// ===== CATEGORIES =====
const CATEGORIES = {
  'default': { label: '일반',     icon: '📋', color: null },
  'online':  { label: '온라인행사', icon: '🖥️', color: '#3B82F6' },
  'annual':  { label: '연차',     icon: '🏖️', color: '#F59E0B' },
  'half':    { label: '반차',     icon: '☀️', color: '#FBBF24' },
  'quarter': { label: '반반차',   icon: '☕', color: '#A78BFA' },
  'field':   { label: '외근',     icon: '🚗', color: '#10B981' },
  'dept':    { label: '부서일정', icon: '👥', color: '#8B5CF6' },
};

// ===== STATE =====
const session = JSON.parse(sessionStorage.getItem('calSession') || 'null');
if (!session) { location.href = '/'; }

const { roomId, roomName } = session;
let me = session.participant;
let events = session.events || [];
let participants = session.participants || [];
let checklists = session.checklists || [];
let currentView = 'month';
let currentDate = new Date();
let editingEventId = null;
let hiddenParticipants = new Set();
let selectedCategory = 'default';
let pollTimer = null;

// ===== INIT =====
document.getElementById('room-name-display').textContent = roomName;
document.getElementById('my-name-display').textContent = me.name;
document.getElementById('my-color-badge').style.background = me.color;
document.getElementById('share-code-display').textContent = roomId;
renderParticipants();
renderCalendar();
renderChecklist();
startPolling();

// ===== POLLING =====
function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    try {
      const res = await fetch(`/api/rooms/${roomId}/sync`);
      if (!res.ok) return;
      const data = await res.json();
      const evChanged = JSON.stringify(data.events) !== JSON.stringify(events);
      const pChanged = JSON.stringify(data.participants) !== JSON.stringify(participants);
      const clChanged = JSON.stringify(data.checklists) !== JSON.stringify(checklists);
      if (evChanged || pChanged) {
        events = data.events || [];
        participants = data.participants || [];
        renderCalendar();
        renderParticipants();
      }
      if (clChanged) {
        checklists = data.checklists || [];
        renderChecklist();
      }
    } catch {}
  }, 5000);
}

// ===== HEADER =====
document.getElementById('btn-prev').addEventListener('click', () => navigateDate(-1));
document.getElementById('btn-next').addEventListener('click', () => navigateDate(1));
document.getElementById('btn-today').addEventListener('click', () => { currentDate = new Date(); renderCalendar(); });
document.getElementById('btn-add-event').addEventListener('click', () => openModal(null, toDateStr(currentDate)));
document.getElementById('btn-share').addEventListener('click', () => document.getElementById('share-modal').classList.remove('hidden'));
document.getElementById('share-modal-close').addEventListener('click', () => document.getElementById('share-modal').classList.add('hidden'));
document.getElementById('btn-copy-share').addEventListener('click', () => {
  navigator.clipboard.writeText(roomId).then(() => showToast('방 코드가 복사되었습니다!'));
});

document.querySelectorAll('.view-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentView = btn.dataset.view;
    document.getElementById('month-view').classList.toggle('hidden', currentView !== 'month');
    document.getElementById('week-view').classList.toggle('hidden', currentView !== 'week');
    document.getElementById('category-view').classList.toggle('hidden', currentView !== 'category');
    renderCalendar();
  });
});

// ===== NAVIGATE =====
function navigateDate(dir) {
  if (currentView === 'month') {
    currentDate = new Date(currentDate.getFullYear(), currentDate.getMonth() + dir, 1);
  } else if (currentView === 'week') {
    currentDate = new Date(currentDate.getTime() + dir * 7 * 86400000);
  }
  renderCalendar();
}

// ===== RENDER =====
function renderCalendar() {
  if (currentView === 'month') renderMonth();
  else if (currentView === 'week') renderWeek();
  else if (currentView === 'category') renderCategory();
}

// ===== MONTH VIEW =====
function renderMonth() {
  const y = currentDate.getFullYear(), m = currentDate.getMonth();
  document.getElementById('cal-title').textContent = `${y}년 ${m + 1}월`;
  const grid = document.getElementById('month-grid');
  grid.innerHTML = '';

  const firstDay = new Date(y, m, 1).getDay();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const totalCells = Math.ceil((firstDay + daysInMonth) / 7) * 7;
  const today = toDateStr(new Date());
  const visibleEvents = events.filter(e => !hiddenParticipants.has(e.participant_id));

  for (let i = 0; i < totalCells; i++) {
    const cellDate = new Date(y, m, 1 + (i - firstDay));
    const dateStr = toDateStr(cellDate);
    const isCurrentMonth = cellDate.getMonth() === m;

    const cell = document.createElement('div');
    cell.className = 'day-cell' + (isCurrentMonth ? '' : ' other-month') + (dateStr === today ? ' today' : '');
    cell.dataset.date = dateStr;

    const numEl = document.createElement('div');
    numEl.className = 'day-num';
    numEl.textContent = cellDate.getDate();
    cell.appendChild(numEl);

    const dayEvents = visibleEvents.filter(e => {
      const s = e.date, en = e.end_date || e.date;
      return dateStr >= s && dateStr <= en;
    }).sort((a, b) => a.date.localeCompare(b.date));

    dayEvents.slice(0, 3).forEach(ev => {
      const chip = document.createElement('div');
      chip.className = 'event-chip';
      const p = participants.find(p => p.id === ev.participant_id);
      const cat = CATEGORIES[ev.category] || CATEGORIES['default'];
      chip.style.background = cat.color || (p ? p.color : '#888');
      const isStart = ev.date === dateStr;
      const timePrefix = (!ev.all_day && ev.start_time && isStart) ? `${ev.start_time.slice(0,5)} ` : '';
      const catIcon = (ev.category && ev.category !== 'default') ? cat.icon + ' ' : '';
      chip.textContent = catIcon + timePrefix + ev.title;
      chip.dataset.eventId = ev.id;
      chip.addEventListener('click', e => { e.stopPropagation(); showEventPopup(ev, e); });
      cell.appendChild(chip);
    });

    if (dayEvents.length > 3) {
      const more = document.createElement('div');
      more.className = 'more-events';
      more.textContent = `+${dayEvents.length - 3}개`;
      cell.appendChild(more);
    }

    cell.addEventListener('dblclick', () => openModal(null, dateStr));
    cell.addEventListener('click', e => {
      if (!e.target.closest('.event-chip') && !e.target.closest('.more-events')) closePopup();
    });
    grid.appendChild(cell);
  }
}

// ===== WEEK VIEW =====
function renderWeek() {
  const dayOfWeek = currentDate.getDay();
  const weekStart = new Date(currentDate.getTime() - dayOfWeek * 86400000);
  const days = Array.from({ length: 7 }, (_, i) => new Date(weekStart.getTime() + i * 86400000));

  const fmt = d => `${d.getMonth() + 1}/${d.getDate()}`;
  document.getElementById('cal-title').textContent = `${days[0].getFullYear()}년 ${fmt(days[0])} - ${fmt(days[6])}`;

  const weekDayNames = ['일', '월', '화', '수', '목', '금', '토'];
  const today = toDateStr(new Date());
  const header = document.getElementById('week-header');
  header.style.gridTemplateColumns = '52px repeat(7, 1fr)';
  header.innerHTML = '<div></div>';
  days.forEach((d, i) => {
    const dateStr = toDateStr(d);
    const col = document.createElement('div');
    col.className = 'week-day-header' + (dateStr === today ? ' today' : '');
    col.innerHTML = `<span class="wh-num">${weekDayNames[i]}</span><span class="wh-day">${d.getDate()}</span>`;
    header.appendChild(col);
  });

  const timeCol = document.getElementById('time-col');
  timeCol.innerHTML = '<div style="height:0"></div>';
  for (let h = 0; h < 24; h++) {
    const lbl = document.createElement('div');
    lbl.className = 'time-slot-label';
    lbl.textContent = h === 0 ? '' : `${String(h).padStart(2, '0')}:00`;
    timeCol.appendChild(lbl);
  }

  const weekGrid = document.getElementById('week-grid');
  weekGrid.style.gridTemplateColumns = 'repeat(7, 1fr)';
  weekGrid.innerHTML = '';
  const visibleEvents = events.filter(e => !hiddenParticipants.has(e.participant_id));

  days.forEach(d => {
    const dateStr = toDateStr(d);
    const col = document.createElement('div');
    col.className = 'week-col' + (dateStr === today ? ' today-col' : '');

    for (let h = 0; h < 24; h++) {
      const block = document.createElement('div');
      block.className = 'time-block';
      block.addEventListener('dblclick', () => openModal(null, dateStr, `${String(h).padStart(2,'0')}:00`));
      col.appendChild(block);
    }

    visibleEvents.filter(e => {
      const s = e.date, en = e.end_date || e.date;
      return dateStr >= s && dateStr <= en;
    }).forEach(ev => {
      if (ev.all_day || !ev.start_time) return;
      const p = participants.find(p => p.id === ev.participant_id);
      const cat = CATEGORIES[ev.category] || CATEGORIES['default'];
      const [sh, sm] = ev.start_time.split(':').map(Number);
      const [eh, em] = (ev.end_time || `${sh + 1}:00`).split(':').map(Number);
      const top = (sh * 60 + sm) / 60 * 48;
      const height = Math.max(((eh * 60 + em) - (sh * 60 + sm)) / 60 * 48, 20);
      const el = document.createElement('div');
      el.className = 'week-event';
      el.style.cssText = `top:${top}px;height:${height}px;background:${cat.color || (p ? p.color : '#888')}`;
      const catIcon = (ev.category && ev.category !== 'default') ? cat.icon + ' ' : '';
      el.textContent = catIcon + ev.title;
      el.addEventListener('click', e => { e.stopPropagation(); showEventPopup(ev, e); });
      col.appendChild(el);
    });

    col.addEventListener('click', e => {
      if (!e.target.closest('.week-event')) closePopup();
    });
    weekGrid.appendChild(col);
  });
}

// ===== CATEGORY VIEW =====
function renderCategory() {
  document.getElementById('cal-title').textContent = '카테고리별 일정';
  const grid = document.getElementById('category-grid');
  grid.innerHTML = '';

  const visibleEvents = events.filter(e => !hiddenParticipants.has(e.participant_id));

  Object.entries(CATEGORIES).forEach(([key, cat]) => {
    const catEvents = visibleEvents.filter(e => (e.category || 'default') === key);

    const card = document.createElement('div');
    card.className = 'cat-card';

    const header = document.createElement('div');
    header.className = 'cat-card-header';
    const catColor = cat.color || '#4A90D9';
    header.style.borderLeftColor = catColor;
    header.innerHTML = `
      <span class="cat-card-icon">${cat.icon}</span>
      <span class="cat-card-label">${cat.label}</span>
      <span class="cat-card-count" style="background:${catColor}">${catEvents.length}</span>
    `;
    card.appendChild(header);

    const body = document.createElement('div');
    body.className = 'cat-card-body';

    if (catEvents.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'cat-card-empty';
      empty.textContent = '일정 없음';
      body.appendChild(empty);
    } else {
      const sorted = [...catEvents].sort((a, b) => a.date.localeCompare(b.date));
      sorted.forEach(ev => {
        const p = participants.find(p => p.id === ev.participant_id);
        const row = document.createElement('div');
        row.className = 'cat-event-row';
        row.innerHTML = `
          <span class="cat-ev-dot" style="background:${p ? p.color : '#888'}"></span>
          <div class="cat-ev-info">
            <div class="cat-ev-title">${ev.title}</div>
            <div class="cat-ev-meta">${ev.date}${ev.end_date && ev.end_date !== ev.date ? ' ~ ' + ev.end_date : ''} · ${p ? p.name : '?'}</div>
          </div>
        `;
        row.addEventListener('click', e => { showEventPopup(ev, e); });
        body.appendChild(row);
      });
    }

    card.appendChild(body);
    grid.appendChild(card);
  });
}

// ===== PARTICIPANTS =====
function renderParticipants() {
  const list = document.getElementById('participants-list');
  list.innerHTML = '';
  participants.forEach(p => {
    const li = document.createElement('li');
    if (hiddenParticipants.has(p.id)) li.classList.add('dimmed');
    li.innerHTML = `<span class="p-color" style="background:${p.color}"></span><span class="p-name">${p.name}${p.id === me.id ? ' ★' : ''}</span>`;
    li.addEventListener('click', () => {
      hiddenParticipants.has(p.id) ? hiddenParticipants.delete(p.id) : hiddenParticipants.add(p.id);
      li.classList.toggle('dimmed');
      renderCalendar();
    });
    list.appendChild(li);
  });
}

// ===== CHECKLIST =====
const checklistPanel = document.getElementById('checklist-panel');
const checklistInput = document.getElementById('checklist-input');

document.getElementById('btn-checklist').addEventListener('click', () => {
  checklistPanel.classList.toggle('open');
  if (checklistPanel.classList.contains('open')) checklistInput.focus();
});
document.getElementById('checklist-close').addEventListener('click', () => {
  checklistPanel.classList.remove('open');
});

document.getElementById('btn-checklist-add').addEventListener('click', addChecklistItem);
checklistInput.addEventListener('keydown', e => { if (e.key === 'Enter') addChecklistItem(); });

async function addChecklistItem() {
  const title = checklistInput.value.trim();
  if (!title) return;
  checklistInput.value = '';
  try {
    const res = await fetch(`/api/rooms/${roomId}/checklists`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ participantId: me.id, title })
    });
    if (!res.ok) { showToast('추가 실패'); return; }
    const item = await res.json();
    checklists.push(item);
    renderChecklist();
  } catch { showToast('서버 오류가 발생했습니다.'); }
}

async function toggleChecklistItem(itemId) {
  try {
    const res = await fetch(`/api/rooms/${roomId}/checklists/${itemId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({})
    });
    if (!res.ok) return;
    const updated = await res.json();
    checklists = checklists.map(c => c.id === itemId ? updated : c);
    renderChecklist();
  } catch {}
}

async function deleteChecklistItem(itemId) {
  try {
    const res = await fetch(`/api/rooms/${roomId}/checklists/${itemId}`, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ participantId: me.id })
    });
    if (!res.ok) { showToast('삭제 권한이 없습니다.'); return; }
    checklists = checklists.filter(c => c.id !== itemId);
    renderChecklist();
  } catch {}
}

function renderChecklist() {
  const ul = document.getElementById('checklist-items');
  ul.innerHTML = '';
  if (checklists.length === 0) {
    const li = document.createElement('li');
    li.className = 'checklist-empty';
    li.textContent = '항목이 없습니다.';
    ul.appendChild(li);
    return;
  }
  checklists.forEach(item => {
    const li = document.createElement('li');
    li.className = 'checklist-item' + (item.checked ? ' checked' : '');

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !!item.checked;
    cb.addEventListener('change', () => toggleChecklistItem(item.id));

    const p = participants.find(p => p.id === item.participant_id);
    const label = document.createElement('span');
    label.className = 'checklist-label';
    label.textContent = item.title;

    const meta = document.createElement('span');
    meta.className = 'checklist-meta';
    meta.textContent = p ? p.name : '';

    const del = document.createElement('button');
    del.className = 'checklist-del';
    del.textContent = '✕';
    del.title = '삭제';
    del.addEventListener('click', () => deleteChecklistItem(item.id));

    li.appendChild(cb);
    li.appendChild(label);
    li.appendChild(meta);
    li.appendChild(del);
    ul.appendChild(li);
  });
}

// ===== EVENT MODAL =====
const modal = document.getElementById('event-modal');
const evTitle = document.getElementById('ev-title');
const evDate = document.getElementById('ev-date');
const evEndDate = document.getElementById('ev-end-date');
const evAllDay = document.getElementById('ev-allday');
const evStartTime = document.getElementById('ev-start-time');
const evEndTime = document.getElementById('ev-end-time');
const evMemo = document.getElementById('ev-memo');
const timeRow = document.getElementById('time-row');
const btnSave = document.getElementById('btn-save-event');
const btnDelete = document.getElementById('btn-delete-event');

document.querySelectorAll('.cat-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedCategory = btn.dataset.cat;
  });
});

function setCategory(cat) {
  selectedCategory = cat || 'default';
  document.querySelectorAll('.cat-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.cat === selectedCategory);
  });
}

evAllDay.addEventListener('change', () => {
  timeRow.classList.toggle('hidden', evAllDay.checked);
});

function openModal(eventId, dateStr, timeStr) {
  editingEventId = eventId;
  const ev = eventId ? events.find(e => e.id === eventId) : null;
  const isOwner = ev ? ev.participant_id === me.id : true;

  document.getElementById('modal-title-label').textContent = ev ? '일정 수정' : '일정 추가';
  evTitle.value = ev ? ev.title : '';
  evDate.value = ev ? ev.date : (dateStr || toDateStr(currentDate));
  evEndDate.value = ev ? (ev.end_date || ev.date) : (dateStr || toDateStr(currentDate));
  evAllDay.checked = ev ? !!ev.all_day : !timeStr;
  timeRow.classList.toggle('hidden', evAllDay.checked);
  evStartTime.value = ev ? (ev.start_time || '') : (timeStr || '');
  evEndTime.value = ev ? (ev.end_time || '') : '';
  evMemo.value = ev ? (ev.memo || '') : '';
  setCategory(ev ? ev.category : 'default');

  btnDelete.classList.toggle('hidden', !ev || !isOwner);
  evTitle.readOnly = !isOwner && !!ev;
  evMemo.readOnly = !isOwner && !!ev;

  modal.classList.remove('hidden');
  setTimeout(() => evTitle.focus(), 50);
}

document.getElementById('modal-close').addEventListener('click', closeModal);
document.getElementById('btn-cancel-event').addEventListener('click', closeModal);
function closeModal() { modal.classList.add('hidden'); editingEventId = null; }

btnSave.addEventListener('click', saveEvent);
btnDelete.addEventListener('click', deleteEvent);

async function saveEvent() {
  const title = evTitle.value.trim();
  if (!title) { evTitle.focus(); showToast('제목을 입력하세요.'); return; }
  const date = evDate.value;
  if (!date) { showToast('날짜를 선택하세요.'); return; }

  const payload = {
    participantId: me.id, title, category: selectedCategory, date,
    endDate: evEndDate.value || date,
    startTime: evAllDay.checked ? null : evStartTime.value,
    endTime: evAllDay.checked ? null : evEndTime.value,
    memo: evMemo.value, allDay: evAllDay.checked
  };

  try {
    let res;
    if (editingEventId) {
      res = await fetch(`/api/rooms/${roomId}/events/${editingEventId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
      });
    } else {
      res = await fetch(`/api/rooms/${roomId}/events`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
      });
    }
    const data = await res.json();
    if (!res.ok) { showToast(data.error || '저장 실패'); return; }

    if (editingEventId) events = events.map(e => e.id === data.id ? data : e);
    else events.push(data);
    renderCalendar();
    closeModal();
    showToast(editingEventId ? '일정이 수정되었습니다.' : '일정이 추가되었습니다.');
  } catch { showToast('서버 오류가 발생했습니다.'); }
}

async function deleteEvent() {
  if (!editingEventId || !confirm('이 일정을 삭제할까요?')) return;
  try {
    const res = await fetch(`/api/rooms/${roomId}/events/${editingEventId}`, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ participantId: me.id })
    });
    if (!res.ok) { const d = await res.json(); showToast(d.error); return; }
    events = events.filter(e => e.id !== editingEventId);
    renderCalendar();
    closeModal();
    showToast('삭제되었습니다.');
  } catch { showToast('서버 오류가 발생했습니다.'); }
}

// ===== EVENT POPUP =====
const popup = document.getElementById('event-popup');

function showEventPopup(ev, mouseEvent) {
  const p = participants.find(p => p.id === ev.participant_id);
  const cat = CATEGORIES[ev.category] || CATEGORIES['default'];
  const chipColor = cat.color || (p ? p.color : '#888');

  document.getElementById('popup-color').style.background = chipColor;
  document.getElementById('popup-title').textContent = ev.title;

  const dateEl = document.getElementById('popup-date');
  dateEl.textContent = ev.end_date && ev.end_date !== ev.date ? `${ev.date} ~ ${ev.end_date}` : ev.date;

  const timeEl = document.getElementById('popup-time');
  if (!ev.all_day && ev.start_time) {
    timeEl.textContent = `${ev.start_time}${ev.end_time ? ' ~ ' + ev.end_time : ''}`;
    timeEl.classList.remove('hidden');
  } else { timeEl.classList.add('hidden'); }

  let catEl = document.getElementById('popup-category');
  if (!catEl) {
    catEl = document.createElement('p');
    catEl.id = 'popup-category';
    document.getElementById('popup-date').after(catEl);
  }
  catEl.textContent = `${cat.icon} ${cat.label}`;
  catEl.className = ev.category !== 'default' ? '' : 'hidden';

  document.getElementById('popup-participant').textContent = `👤 ${p ? p.name : '알 수 없음'}`;
  const memoEl = document.getElementById('popup-memo');
  if (ev.memo) { memoEl.textContent = ev.memo; memoEl.classList.remove('hidden'); }
  else memoEl.classList.add('hidden');

  const actionsEl = document.getElementById('popup-actions');
  actionsEl.innerHTML = '';
  if (ev.participant_id === me.id) {
    const editBtn = document.createElement('button');
    editBtn.className = 'btn-edit-popup';
    editBtn.textContent = '수정';
    editBtn.addEventListener('click', () => { closePopup(); openModal(ev.id); });
    const delBtn = document.createElement('button');
    delBtn.className = 'btn-delete-popup';
    delBtn.textContent = '삭제';
    delBtn.addEventListener('click', async () => {
      if (!confirm('삭제할까요?')) return;
      try {
        const res = await fetch(`/api/rooms/${roomId}/events/${ev.id}`, {
          method: 'DELETE', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ participantId: me.id })
        });
        if (res.ok) { events = events.filter(e => e.id !== ev.id); renderCalendar(); closePopup(); showToast('삭제되었습니다.'); }
      } catch {}
    });
    actionsEl.appendChild(editBtn);
    actionsEl.appendChild(delBtn);
  }

  let x = mouseEvent.clientX + 8, y = mouseEvent.clientY + 8;
  popup.style.left = x + 'px';
  popup.style.top = y + 'px';
  popup.classList.remove('hidden');

  requestAnimationFrame(() => {
    const pr = popup.getBoundingClientRect();
    if (pr.right > window.innerWidth - 10) popup.style.left = (x - pr.width - 16) + 'px';
    if (pr.bottom > window.innerHeight - 10) popup.style.top = (y - pr.height - 16) + 'px';
  });
}

function closePopup() { popup.classList.add('hidden'); }
document.getElementById('popup-close').addEventListener('click', closePopup);
document.addEventListener('click', e => {
  if (!e.target.closest('#event-popup') && !e.target.closest('.event-chip') && !e.target.closest('.week-event') && !e.target.closest('.cat-event-row')) closePopup();
});

// ===== KEYBOARD SHORTCUTS =====
document.addEventListener('keydown', e => {
  const inInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);
  const modalOpen = !modal.classList.contains('hidden');

  if (modalOpen) {
    if (e.key === 'Escape') { closeModal(); return; }
    if (e.key === 'Enter' && !e.shiftKey && document.activeElement !== evMemo) {
      e.preventDefault(); saveEvent(); return;
    }
    if (e.key === 'Delete' && !inInput && editingEventId) { deleteEvent(); return; }
    return;
  }

  if (inInput) return;

  switch (e.key) {
    case 'n': case 'N': openModal(null, toDateStr(currentDate)); break;
    case 'ArrowLeft': navigateDate(-1); break;
    case 'ArrowRight': navigateDate(1); break;
    case 't': case 'T': currentDate = new Date(); renderCalendar(); break;
    case 'm': case 'M': document.querySelector('[data-view="month"]').click(); break;
    case 'w': case 'W': document.querySelector('[data-view="week"]').click(); break;
    case 'c': case 'C': document.querySelector('[data-view="category"]').click(); break;
    case 'l': case 'L': document.getElementById('btn-checklist').click(); break;
    case 'Escape': closePopup(); checklistPanel.classList.remove('open'); break;
  }
});

// ===== UTILS =====
function toDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}
