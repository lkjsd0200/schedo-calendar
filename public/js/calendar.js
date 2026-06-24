// ===== STATE =====
const session = JSON.parse(sessionStorage.getItem('calSession') || 'null');
if (!session) { location.href = '/'; }

const { roomId, roomName } = session;
let me = session.participant;
let events = session.events || [];
let participants = session.participants || [];
let checklists = session.checklists || [];
let categoriesArr = session.categories || [];
let CATEGORIES = {};

let currentView = 'month';
let currentDate = new Date();
let editingEventId = null;
let hiddenParticipants = new Set();
let selectedCategory = 'default';
let pollTimer = null;

// Google Calendar state
let googleEvents = [];
let googleCalConnected = false;
let showGoogleCal = false;

// ===== CATEGORIES =====
function buildCategories() {
  CATEGORIES = {};
  categoriesArr.forEach(c => {
    CATEGORIES[c.key] = { id: c.id, label: c.label, icon: c.icon, color: c.color || null };
  });
}

function getCat(key) {
  return CATEGORIES[key] || { label: '', icon: '', color: null };
}

function getEventColor(ev, p) {
  const cat = getCat(ev.category);
  return cat.color || (p ? p.color : '#888');
}

// ===== INIT =====
buildCategories();
document.getElementById('room-name-display').textContent = roomName;
document.getElementById('my-name-display').textContent = me.name;
document.getElementById('my-color-badge').style.background = me.color;
document.getElementById('share-code-display').textContent = roomId;
renderParticipants();
renderCategoryBtns();
renderCalendar();
renderChecklist();
startPolling();
initGoogleCal();

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
      const catChanged = JSON.stringify(data.categories) !== JSON.stringify(categoriesArr);
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
      if (catChanged) {
        categoriesArr = data.categories || [];
        buildCategories();
        renderCategoryBtns();
        renderCatManageList();
        renderCalendar();
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
document.getElementById('btn-cat-settings').addEventListener('click', openCatModal);

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
  if (showGoogleCal) fetchGoogleEvents().then(() => renderCalendar());
  else renderCalendar();
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
      const cat = getCat(ev.category);
      chip.style.background = getEventColor(ev, p);
      const isStart = ev.date === dateStr;
      const timePrefix = (!ev.all_day && ev.start_time && isStart) ? `${ev.start_time.slice(0,5)} ` : '';
      const catIcon = cat.icon ? cat.icon + ' ' : '';
      chip.textContent = catIcon + timePrefix + ev.title;
      chip.addEventListener('click', e => { e.stopPropagation(); showEventPopup(ev, e); });
      cell.appendChild(chip);
    });

    if (dayEvents.length > 3) {
      const more = document.createElement('div');
      more.className = 'more-events';
      more.textContent = `+${dayEvents.length - 3}개`;
      cell.appendChild(more);
    }

    // Google Calendar 이벤트 오버레이
    const gEvents = getGoogleEventsForDate(dateStr);
    const gSlots = Math.max(0, 3 - dayEvents.length);
    gEvents.slice(0, gSlots).forEach(ev => {
      const chip = document.createElement('div');
      chip.className = 'event-chip gcal-chip';
      const time = ev.start?.dateTime ? ev.start.dateTime.slice(11, 16) + ' ' : '';
      chip.textContent = 'G ' + time + (ev.summary || '(제목 없음)');
      chip.title = ev.summary || '';
      chip.addEventListener('click', e => { e.stopPropagation(); showGcalPopup(ev, e); });
      cell.appendChild(chip);
    });
    if (gEvents.length > gSlots) {
      const more = document.createElement('div');
      more.className = 'more-events';
      more.textContent = `+G${gEvents.length - gSlots}개`;
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
      const cat = getCat(ev.category);
      const [sh, sm] = ev.start_time.split(':').map(Number);
      const [eh, em] = (ev.end_time || `${sh + 1}:00`).split(':').map(Number);
      const top = (sh * 60 + sm) / 60 * 48;
      const height = Math.max(((eh * 60 + em) - (sh * 60 + sm)) / 60 * 48, 20);
      const el = document.createElement('div');
      el.className = 'week-event';
      el.style.cssText = `top:${top}px;height:${height}px;background:${getEventColor(ev, p)}`;
      el.textContent = (cat.icon ? cat.icon + ' ' : '') + ev.title;
      el.addEventListener('click', e => { e.stopPropagation(); showEventPopup(ev, e); });
      col.appendChild(el);
    });

    // Google Calendar 이벤트 (시간 있는 것만 주간 뷰에 표시)
    getGoogleEventsForDate(dateStr).forEach(ev => {
      if (!ev.start?.dateTime) return;
      const [sh, sm] = ev.start.dateTime.slice(11, 16).split(':').map(Number);
      const endDt = ev.end?.dateTime;
      const [eh, em] = endDt ? endDt.slice(11, 16).split(':').map(Number) : [sh + 1, 0];
      const top = (sh * 60 + sm) / 60 * 48;
      const height = Math.max(((eh * 60 + em) - (sh * 60 + sm)) / 60 * 48, 20);
      const el = document.createElement('div');
      el.className = 'week-event gcal-week-event';
      el.style.cssText = `top:${top}px;height:${height}px`;
      el.textContent = 'G ' + (ev.summary || '(제목 없음)');
      el.addEventListener('click', e => { e.stopPropagation(); showGcalPopup(ev, e); });
      col.appendChild(el);
    });

    col.addEventListener('click', e => { if (!e.target.closest('.week-event')) closePopup(); });
    weekGrid.appendChild(col);
  });
}

function showGcalPopup(ev, mouseEvent) {
  const { start, end } = gEventDates(ev);
  document.getElementById('popup-color').style.background = '#4285F4';
  document.getElementById('popup-title').textContent = ev.summary || '(제목 없음)';
  document.getElementById('popup-date').textContent = start !== end ? `${start} ~ ${end}` : start;
  const timeEl = document.getElementById('popup-time');
  if (ev.start?.dateTime) {
    timeEl.textContent = ev.start.dateTime.slice(11, 16) + (ev.end?.dateTime ? ' ~ ' + ev.end.dateTime.slice(11, 16) : '');
    timeEl.classList.remove('hidden');
  } else { timeEl.classList.add('hidden'); }
  let catEl = document.getElementById('popup-category');
  if (!catEl) { catEl = document.createElement('p'); catEl.id = 'popup-category'; document.getElementById('popup-date').after(catEl); }
  catEl.textContent = '📅 Google Calendar';
  catEl.classList.remove('hidden');
  document.getElementById('popup-participant').textContent = ev.organizer?.displayName ? `👤 ${ev.organizer.displayName}` : '';
  const memoEl = document.getElementById('popup-memo');
  if (ev.description) { memoEl.textContent = ev.description.replace(/<[^>]+>/g, ''); memoEl.classList.remove('hidden'); }
  else memoEl.classList.add('hidden');
  document.getElementById('popup-actions').innerHTML = '';
  let x = mouseEvent.clientX + 8, y = mouseEvent.clientY + 8;
  popup.style.left = x + 'px'; popup.style.top = y + 'px';
  popup.classList.remove('hidden');
  requestAnimationFrame(() => {
    const pr = popup.getBoundingClientRect();
    if (pr.right > window.innerWidth - 10) popup.style.left = (x - pr.width - 16) + 'px';
    if (pr.bottom > window.innerHeight - 10) popup.style.top = (y - pr.height - 16) + 'px';
  });
}

// ===== CATEGORY VIEW =====
function renderCategory() {
  document.getElementById('cal-title').textContent = '카테고리별 일정';
  const grid = document.getElementById('category-grid');
  grid.innerHTML = '';

  const visibleEvents = events.filter(e => !hiddenParticipants.has(e.participant_id));

  categoriesArr.forEach(catRow => {
    const cat = getCat(catRow.key);
    const catEvents = visibleEvents.filter(e => (e.category || 'default') === catRow.key);
    const catColor = catRow.color || '#4A90D9';

    const card = document.createElement('div');
    card.className = 'cat-card';

    const hdr = document.createElement('div');
    hdr.className = 'cat-card-header';
    hdr.style.borderLeftColor = catColor;
    hdr.innerHTML = `
      <span class="cat-card-icon">${catRow.icon}</span>
      <span class="cat-card-label">${catRow.label}</span>
      <span class="cat-card-count" style="background:${catColor}">${catEvents.length}</span>
    `;
    card.appendChild(hdr);

    const body = document.createElement('div');
    body.className = 'cat-card-body';

    if (catEvents.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'cat-card-empty';
      empty.textContent = '일정 없음';
      body.appendChild(empty);
    } else {
      [...catEvents].sort((a, b) => a.date.localeCompare(b.date)).forEach(ev => {
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
        row.addEventListener('click', e => showEventPopup(ev, e));
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

// ===== CATEGORY BUTTONS (event modal) =====
function renderCategoryBtns() {
  const container = document.getElementById('ev-category');
  container.innerHTML = '';
  categoriesArr.forEach(cat => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cat-btn';
    btn.dataset.cat = cat.key;
    btn.textContent = `${cat.icon} ${cat.label}`;
    btn.addEventListener('click', () => setCategory(cat.key));
    container.appendChild(btn);
  });
  setCategory(selectedCategory);
}

function setCategory(key) {
  const keys = Object.keys(CATEGORIES);
  if (!CATEGORIES[key] && keys.length > 0) key = keys[0];
  selectedCategory = key;
  document.querySelectorAll('#ev-category .cat-btn').forEach(btn => {
    const isActive = btn.dataset.cat === key;
    btn.classList.toggle('active', isActive);
    if (isActive) {
      const cat = CATEGORIES[key];
      btn.style.background = cat?.color || '#4A90D9';
      btn.style.borderColor = 'transparent';
      btn.style.color = '#fff';
    } else {
      btn.style.background = '';
      btn.style.borderColor = '';
      btn.style.color = '';
    }
  });
}

// ===== CATEGORY MANAGEMENT MODAL =====
const catModal = document.getElementById('cat-modal');

function openCatModal() {
  renderCatManageList();
  catModal.classList.remove('hidden');
}
function closeCatModal() { catModal.classList.add('hidden'); }

document.getElementById('cat-modal-close').addEventListener('click', closeCatModal);
document.getElementById('btn-open-cat-manage').addEventListener('click', () => {
  closeModal();
  openCatModal();
});

document.getElementById('btn-cat-add').addEventListener('click', addCategoryUI);
document.getElementById('cat-new-label').addEventListener('keydown', e => { if (e.key === 'Enter') addCategoryUI(); });

function renderCatManageList() {
  const ul = document.getElementById('cat-manage-list');
  ul.innerHTML = '';
  if (categoriesArr.length === 0) {
    ul.innerHTML = '<li style="padding:12px;color:var(--text-muted);font-size:13px;">카테고리가 없습니다.</li>';
    return;
  }
  categoriesArr.forEach(cat => {
    const li = document.createElement('li');
    li.className = 'cat-manage-item';
    const dotColor = cat.color || '#4A90D9';
    li.innerHTML = `
      <span class="cat-manage-dot" style="background:${dotColor}"></span>
      <span class="cat-manage-icon">${cat.icon}</span>
      <span class="cat-manage-label">${cat.label}</span>
      <button class="btn-cat-del" title="삭제">🗑</button>
    `;
    li.querySelector('.btn-cat-del').addEventListener('click', () => deleteCategoryUI(cat.id));
    ul.appendChild(li);
  });
}

async function addCategoryUI() {
  const icon = document.getElementById('cat-new-icon').value.trim() || '📋';
  const label = document.getElementById('cat-new-label').value.trim();
  const color = document.getElementById('cat-new-color').value;
  if (!label) { showToast('카테고리 이름을 입력하세요.'); return; }

  try {
    const res = await fetch(`/api/rooms/${roomId}/categories`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ icon, label, color })
    });
    const data = await res.json();
    if (!res.ok) { showToast(data.error || '추가 실패'); return; }
    categoriesArr.push(data);
    buildCategories();
    renderCatManageList();
    renderCategoryBtns();
    renderCalendar();
    document.getElementById('cat-new-icon').value = '';
    document.getElementById('cat-new-label').value = '';
    showToast(`'${label}' 카테고리가 추가되었습니다.`);
  } catch { showToast('서버 오류가 발생했습니다.'); }
}

async function deleteCategoryUI(catId) {
  if (!confirm('이 카테고리를 삭제할까요?')) return;
  try {
    const res = await fetch(`/api/rooms/${roomId}/categories/${catId}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) { showToast(data.error || '삭제 실패'); return; }
    categoriesArr = categoriesArr.filter(c => c.id !== catId);
    buildCategories();
    renderCatManageList();
    renderCategoryBtns();
    renderCalendar();
    showToast('카테고리가 삭제되었습니다.');
  } catch { showToast('서버 오류가 발생했습니다.'); }
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
  setCategory(ev ? (ev.category || 'default') : (Object.keys(CATEGORIES)[0] || 'default'));

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
  const cat = getCat(ev.category);
  const chipColor = getEventColor(ev, p);

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
  if (cat.icon && cat.label) {
    catEl.textContent = `${cat.icon} ${cat.label}`;
    catEl.classList.remove('hidden');
  } else {
    catEl.classList.add('hidden');
  }

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
  if (!e.target.closest('#cat-modal') && !e.target.closest('#btn-cat-settings') && !e.target.closest('#btn-open-cat-manage')) closeCatModal();
});

// ===== KEYBOARD SHORTCUTS =====
document.addEventListener('keydown', e => {
  const inInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);
  const modalOpen = !modal.classList.contains('hidden');
  const catModalOpen = !catModal.classList.contains('hidden');

  if (catModalOpen) {
    if (e.key === 'Escape') { closeCatModal(); return; }
    return;
  }

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

// ===== GOOGLE CALENDAR =====
async function initGoogleCal() {
  // OAuth 콜백 결과 처리
  if (location.hash === '#gcal-ok') {
    history.replaceState(null, '', location.pathname);
    showToast('Google Calendar가 연동되었습니다!');
  } else if (location.hash === '#gcal-error') {
    history.replaceState(null, '', location.pathname);
    showToast('Google Calendar 연동에 실패했습니다.');
  }

  // 연동 상태 확인
  try {
    const res = await fetch(`/api/rooms/${roomId}/google-events?participantId=${me.id}&timeMin=${new Date().toISOString()}&timeMax=${new Date().toISOString()}`);
    const data = await res.json();
    googleCalConnected = !!data.connected;
    updateGoogleCalUI();
  } catch {}

  // UI 이벤트
  document.getElementById('btn-gcal-connect').addEventListener('click', () => {
    location.href = `/api/auth/google?participantId=${me.id}`;
  });
  document.getElementById('btn-gcal-disconnect').addEventListener('click', disconnectGoogleCal);
  document.getElementById('gcal-show-toggle').addEventListener('change', async e => {
    showGoogleCal = e.target.checked;
    if (showGoogleCal && googleEvents.length === 0) await fetchGoogleEvents();
    renderCalendar();
  });
}

function updateGoogleCalUI() {
  document.getElementById('gcal-disconnected').classList.toggle('hidden', googleCalConnected);
  document.getElementById('gcal-connected').classList.toggle('hidden', !googleCalConnected);
  document.getElementById('gcal-show-toggle').checked = showGoogleCal;
}

async function fetchGoogleEvents() {
  if (!googleCalConnected) return;
  try {
    const y = currentDate.getFullYear(), m = currentDate.getMonth();
    const timeMin = new Date(y, m - 1, 1).toISOString();
    const timeMax = new Date(y, m + 2, 0, 23, 59, 59).toISOString();
    const res = await fetch(`/api/rooms/${roomId}/google-events?participantId=${me.id}&timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}`);
    const data = await res.json();
    if (data.connected) {
      googleEvents = data.events || [];
      googleCalConnected = true;
    } else {
      googleCalConnected = false;
      showGoogleCal = false;
      updateGoogleCalUI();
    }
  } catch {}
}

async function disconnectGoogleCal() {
  if (!confirm('Google Calendar 연동을 해제할까요?')) return;
  try {
    await fetch(`/api/rooms/${roomId}/google-events?participantId=${me.id}`, { method: 'DELETE' });
    googleCalConnected = false;
    showGoogleCal = false;
    googleEvents = [];
    updateGoogleCalUI();
    renderCalendar();
    showToast('Google Calendar 연동이 해제되었습니다.');
  } catch {}
}

// Google 이벤트를 날짜 문자열로 변환
function gEventDates(ev) {
  const start = ev.start?.date || ev.start?.dateTime?.slice(0, 10) || '';
  let end = ev.end?.date || ev.end?.dateTime?.slice(0, 10) || start;
  // 종일 이벤트의 end는 exclusive이므로 하루 빼기
  if (ev.end?.date) {
    const d = new Date(end);
    d.setDate(d.getDate() - 1);
    end = toDateStr(d);
  }
  return { start, end };
}

function getGoogleEventsForDate(dateStr) {
  if (!showGoogleCal) return [];
  return googleEvents.filter(ev => {
    const { start, end } = gEventDates(ev);
    return start <= dateStr && dateStr <= end;
  });
}

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
