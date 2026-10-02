// MessMind dashboard demo interactions. Replace these sample values with API data later.
const toast = document.querySelector('#toast');
let toastTimer;
let backendConnected = false;
const sessionOnlyAttendanceRecords = [];
const INDIA_TIME_ZONE = 'Asia/Kolkata';
const MEAL_SCHEDULE = [
  { meal: 'Breakfast', start: 7 * 60, end: 10 * 60, prepStart: 5 * 60 + 30, cleanupEnd: 10 * 60 + 30 },
  { meal: 'Lunch', start: 12 * 60, end: 14 * 60 + 30, prepStart: 10 * 60, cleanupEnd: 15 * 60 },
  { meal: 'Snacks', start: 16 * 60, end: 18 * 60, prepStart: 14 * 60 + 30, cleanupEnd: 18 * 60 + 30 },
  { meal: 'Dinner', start: 19 * 60, end: 21 * 60 + 30, prepStart: 17 * 60 + 30, cleanupEnd: 22 * 60 }
];
const API_BASE = (window.location.protocol === 'file:'
  || ['localhost', '127.0.0.1'].includes(window.location.hostname) && window.location.port !== '8000')
  ? 'http://127.0.0.1:8000' : '';

function getISTWeekday() {
  return new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: INDIA_TIME_ZONE }).format(new Date());
}

function getCurrentMealPeriod() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: INDIA_TIME_ZONE, weekday: 'long', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  const nowMinutes = Number(values.hour) * 60 + Number(values.minute);
  const services = MEAL_SCHEDULE;
  const weekday = values.weekday;
  const active = services.find((service) => nowMinutes >= service.start && nowMinutes < service.end);
  const prep = services.find((service) => nowMinutes >= service.prepStart && nowMinutes < service.cleanupEnd);
  if (active) return { ...active, weekday, active: true, kitchenOpen: true, kitchenMode: 'service' };
  const next = services.find((service) => service.start > nowMinutes) || services[0];
  const nextDay = !services.some((service) => service.start > nowMinutes);
  const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const nextWeekday = nextDay ? weekdays[(weekdays.indexOf(weekday) + 1) % weekdays.length] : weekday;
  return { ...next, weekday: nextWeekday, active: false, kitchenOpen: Boolean(prep), kitchenMode: prep ? 'prep' : 'closed' };
}

function formatScheduleTime(minutes) {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${String(minute).padStart(2, '0')} ${suffix}`;
}

function renderMealTimeline() {
  const grid = document.querySelector('#meal-timeline-grid');
  if (!grid) return;
  const period = getCurrentMealPeriod();
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: INDIA_TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  const nowMinutes = Number(values.hour) * 60 + Number(values.minute);
  const nextMeal = period.meal;
  grid.replaceChildren(...MEAL_SCHEDULE.map((service) => {
    const card = document.createElement('article');
    const isActive = nowMinutes >= service.start && nowMinutes < service.end;
    const isUpcoming = service.meal === nextMeal && !isActive;
    const status = isActive ? 'Serving now' : isUpcoming ? (period.weekday === getISTWeekday() ? 'Next service' : 'Tomorrow') : nowMinutes >= service.end ? 'Completed' : 'Preparing';
    card.className = `meal-timeline-card ${isActive ? 'is-active' : ''} ${isUpcoming ? 'is-upcoming' : ''}`;
    card.innerHTML = `<div class="meal-timeline-top"><strong></strong><span></span></div><div class="meal-timeline-time"></div><small></small>`;
    card.querySelector('strong').textContent = service.meal;
    card.querySelector('span').textContent = status;
    card.querySelector('.meal-timeline-time').textContent = `${formatScheduleTime(service.start)} – ${formatScheduleTime(service.end)}`;
    card.querySelector('small').textContent = isActive ? 'Kitchen serving' : service.meal === nextMeal ? `Prep from ${formatScheduleTime(service.prepStart)}` : `Prep from ${formatScheduleTime(service.prepStart)}`;
    return card;
  }));
}

function updateOperationalStatus() {
  const period = getCurrentMealPeriod();
  const kitchenStatus = document.querySelector('#kitchen-status-value');
  const kitchenDetail = document.querySelector('#kitchen-status-detail');
  const messStatus = document.querySelector('#mess-status-value');
  const nextService = document.querySelector('#next-service-value');
  if (!kitchenStatus || !kitchenDetail || !messStatus || !nextService) return;
  if (period.kitchenMode === 'service') {
    kitchenStatus.textContent = `OPEN · ${period.meal.toUpperCase()} SERVICE`;
    kitchenDetail.textContent = `${formatScheduleTime(period.start)}–${formatScheduleTime(period.end)} IST`;
    messStatus.textContent = 'SERVING';
  } else if (period.kitchenMode === 'prep') {
    kitchenStatus.textContent = 'OPEN · PREP WINDOW';
    kitchenDetail.textContent = `Next ${period.meal.toLowerCase()} service at ${formatScheduleTime(period.start)} IST`;
    messStatus.textContent = 'PREPARING';
  } else {
    kitchenStatus.textContent = 'CLOSED';
    kitchenDetail.textContent = `Opens at ${formatScheduleTime(MEAL_SCHEDULE[0].prepStart)} IST`;
    messStatus.textContent = 'CLOSED';
  }
  nextService.textContent = `${period.meal} · ${formatScheduleTime(period.start)}${period.weekday !== getISTWeekday() ? ' tomorrow' : ''}`;
  renderMealTimeline();
}

function getISTDateISO() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: INDIA_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function formatISTTimestamp(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  const formatted = new Intl.DateTimeFormat('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true,
    timeZone: INDIA_TIME_ZONE
  }).format(date);
  return `${formatted} IST`;
}

function formatISTClock(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return `${new Intl.DateTimeFormat('en-IN', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true,
    timeZone: INDIA_TIME_ZONE
  }).format(date)} IST`;
}

function updateISTClock() {
  const now = new Date();
  document.querySelector('#ist-clock').textContent = formatISTTimestamp(now);
  document.querySelector('#ist-status-clock').textContent = formatISTClock(now);
  document.querySelectorAll('[data-current-ist]').forEach((element) => {
    element.textContent = formatISTClock(now);
  });
  updateOperationalStatus();
}

async function backendRequest(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers }
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'The data service could not complete that request.');
  return result;
}

function renderServiceRecord(record) {
  const row = document.createElement('tr');
  [record.campus.replace(' Mess', ''), record.date, record.meal, record.cuisine || '—', record.forecast,
    record.attendance, `${record.prepared} kg`, `${record.leftover} kg`, record.source,
    record.createdAt ? formatISTTimestamp(record.createdAt) : formatISTTimestamp()].forEach((value) => {
    const cell = document.createElement('td');
    cell.textContent = value;
    row.append(cell);
  });
  const records = document.querySelector('#collection-records');
  records.querySelector('.empty-row')?.remove();
  records.prepend(row);
}

function buildDemoAttendance(campus, days) {
  const today = new Date(`${getISTDateISO()}T00:00:00Z`);
  const campusOffset = campus === 'North Campus Mess' ? 0 : 1;
  const meals = [
    ['Breakfast', 310, 'Poha and seasonal breakfast (demo)'],
    ['Lunch', 470, 'Dal, rice and daily special (demo)'],
    ['Dinner', 390, 'Paneer or vegetable curry (demo)'],
    ['Snacks', 125, 'Tea and savory snack (demo)']
  ];
  return Array.from({ length: days }, (_, index) => index).flatMap((age) => {
    const date = new Date(today.getTime() - age * 86400000).toISOString().slice(0, 10);
    return meals.map(([meal, base, cuisine], mealIndex) => {
      const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
      const weekend = weekday === 6 ? 14 : weekday === 0 ? 24 : 0;
      const attendance = Math.max(0, base + weekend + ((age * 7 + campusOffset * 13 + mealIndex * 17) % 43) - 21);
      const forecast = Math.max(0, attendance + ((age * 11 + campusOffset * 5 + mealIndex * 3) % 31) - 15);
      return { date, campus, meal, cuisine, attendance, forecast, isSynthetic: true };
    });
  });
}

function drawAttendanceChart(services) {
  const svg = document.querySelector('#attendance-chart');
  const dates = [...new Set(services.map((row) => row.date))].sort();
  if (!dates.length) return;
  const totals = new Map(dates.map((date) => [date, { attendance: 0, forecast: 0 }]));
  services.forEach((row) => {
    const total = totals.get(row.date);
    total.attendance += Number(row.attendance) || 0;
    total.forecast += Number(row.forecast) || 0;
  });
  const maxValue = Math.max(100, ...[...totals.values()].flatMap((value) => [value.attendance, value.forecast]));
  const scale = Math.ceil(maxValue / 100) * 100;
  const x = (index) => dates.length === 1 ? 350 : index * 700 / (dates.length - 1);
  const y = (value) => 234 - value / scale * 216;
  const pathFor = (key) => dates.map((date, index) => `${index ? 'L' : 'M'}${x(index).toFixed(1)} ${y(totals.get(date)[key]).toFixed(1)}`).join(' ');
  const forecast = pathFor('forecast');
  const actual = pathFor('attendance');
  svg.querySelector('.forecast-line').setAttribute('d', forecast);
  svg.querySelector('.actual-line').setAttribute('d', actual);
  svg.querySelector('.forecast-area').setAttribute('d', `${forecast} L700 234 L0 234Z`);
  const ns = 'http://www.w3.org/2000/svg';
  [['.dot-green', 'forecast'], ['.dot-blue', 'attendance']].forEach(([selector, key]) => {
    svg.querySelector(selector).replaceChildren(...dates.map((date, index) => {
      const dot = document.createElementNS(ns, 'circle');
      dot.setAttribute('cx', x(index));
      dot.setAttribute('cy', y(totals.get(date)[key]));
      dot.setAttribute('r', '3.5');
      return dot;
    }));
  });
  document.querySelector('.y-axis').replaceChildren(...[4, 3, 2, 1, 0].map((value) => {
    const label = document.createElement('span');
    label.textContent = String(Math.round(scale * value / 4));
    return label;
  }));
  const stepCount = Math.min(dates.length, 7);
  const ticks = [...new Set(Array.from({ length: stepCount }, (_, index) =>
    Math.round(index * (dates.length - 1) / Math.max(1, stepCount - 1))))];
  document.querySelector('.x-axis').replaceChildren(...ticks.map((index) => {
    const label = document.createElement('span');
    label.textContent = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', timeZone: 'UTC' })
      .format(new Date(`${dates[index]}T00:00:00Z`));
    return label;
  }));
}

async function loadAttendanceTimeline() {
  const campus = document.querySelector('#mess-select').value;
  const days = Number(document.querySelector('#attendance-days').value);
  let services;
  let dataType;
  try {
    const params = new URLSearchParams({ days: String(days), campus });
    const result = await backendRequest(`/api/analytics/attendance?${params}`);
    services = result.services;
    dataType = result.dataType;
  } catch {
    services = [];
    dataType = 'synthetic demo preview';
  }
  if (!services.length) {
    services = buildDemoAttendance(campus, days);
    dataType = 'synthetic demo preview';
  }
  const unsavedRows = sessionOnlyAttendanceRecords.filter((row) => row.campus === campus);
  if (unsavedRows.length) {
    services = [...services.filter((row) => !unsavedRows.some((local) => local.date === row.date && local.meal === row.meal)), ...unsavedRows];
  }
  services.sort((a, b) => b.date.localeCompare(a.date) || a.meal.localeCompare(b.meal));
  drawAttendanceChart(services);
  const isSynthetic = dataType.includes('synthetic');
  document.querySelector('#attendance-data-label').textContent = unsavedRows.length ? 'SESSION-ONLY INPUTS' : isSynthetic ? 'SYNTHETIC DEMO DATA' : 'SAVED ATTENDANCE DATA';
  document.querySelector('#attendance-chart-note').textContent = unsavedRows.length
    ? `${unsavedRows.length} unsaved record(s) in this browser session${isSynthetic ? ' · demo history also shown' : ''}`
    : isSynthetic
      ? 'Generated demo entries; replace with verified service records.'
    : `Saved ${services.length} service entries · selected campus`;
  const tbody = document.querySelector('#attendance-timeline');
  tbody.replaceChildren();
  services.slice(0, days * 4).forEach((service) => {
    const row = document.createElement('tr');
    [service.date, service.meal, service.cuisine || 'Cuisine not recorded',
      Math.round(service.attendance), Math.round(service.forecast)].forEach((value) => {
      const cell = document.createElement('td');
      cell.textContent = value;
      row.append(cell);
    });
    tbody.append(row);
  });
}

function renderFeedback(feedback, clear = false) {
  const records = document.querySelector('#feedback-records');
  if (clear) records.replaceChildren();
  const row = document.createElement('tr');
  [feedback.rating, feedback.meal || '—', feedback.dish, feedback.comment || '—', feedback.createdAt ? formatISTTimestamp(feedback.createdAt) : formatISTTimestamp()].forEach((value) => {
    const cell = document.createElement('td');
    cell.textContent = value;
    row.append(cell);
  });
  records.prepend(row);
}

function renderFeedbackAnalysis(rows) {
  const table = document.querySelector('#feedback-analysis');
  if (!table) return;
  table.replaceChildren();
  if (!rows.length) {
    const row = document.createElement('tr');
    row.innerHTML = '<td colspan="8">No menu-linked feedback has been recorded yet.</td>';
    table.append(row);
    return;
  }
  rows.forEach((item) => {
    const row = document.createElement('tr');
    [item.date, item.meal, item.dish, item.responses, item.averageRating ? `${item.averageRating} / 4` : '—',
      item.attendance ?? '—', item.leftoverKg === null ? '—' : `${item.leftoverKg.toFixed(1)} kg`, item.wastePercent === null ? '—' : `${item.wastePercent}%`]
      .forEach((value) => { const cell = document.createElement('td'); cell.textContent = value; row.append(cell); });
    table.append(row);
  });
}

async function loadDashboardSummary() {
  const campus = document.querySelector('#mess-select').value;
  const meal = document.querySelector('#meal-select').value;
  try {
    const summary = await backendRequest(`/api/dashboard?campus=${encodeURIComponent(campus)}&meal=${encodeURIComponent(meal)}`);
    if (summary.status !== 'ready') return;
    const cards = document.querySelectorAll('.kpi-card');
    const expected = document.querySelector('[data-metric="diners"]');
    if (expected) expected.textContent = summary.expectedDiners;
    if (cards[1]) {
      const value = cards[1].querySelector('.kpi-value');
      const progress = cards[1].querySelector('.progress i');
      const percent = cards[1].querySelector('.progress-row small');
      const note = cards[1].querySelector('.kpi-note');
      const checkedPercent = summary.expectedDiners ? Math.round(summary.checkedIn / summary.expectedDiners * 100) : 0;
      if (value) value.innerHTML = `${summary.checkedIn} <small>/ ${summary.expectedDiners}</small>`;
      if (progress) progress.style.width = `${Math.min(100, checkedPercent)}%`;
      if (percent) percent.textContent = `${checkedPercent}%`;
      if (note) note.textContent = `${Math.max(0, summary.expectedDiners - summary.checkedIn)} yet to check in · verified record`;
    }
    if (cards[2]) cards[2].querySelector('.kpi-value').textContent = summary.forecastErrorPercent === null ? '—' : `${summary.forecastErrorPercent}%`;
    if (cards[3]) cards[3].querySelector('.kpi-value').innerHTML = `${summary.foodSavedKg} <small>kg</small>`;
  } catch {
    // Sample labels remain visible when no verified service record exists.
  }
}

async function loadWasteRecommendation() {
  const title = document.querySelector('#waste-control-title');
  const detail = document.querySelector('#waste-control-detail');
  const next = document.querySelector('#waste-control-next');
  if (!title || !detail || !next) return;
  try {
    const campus = document.querySelector('#mess-select').value;
    const meal = document.querySelector('#meal-select').value;
    const result = await backendRequest(`/api/waste-recommendation?campus=${encodeURIComponent(campus)}&meal=${encodeURIComponent(meal)}`);
    if (result.status === 'ready') {
      title.textContent = `Reduce ${result.dish} first`;
      detail.textContent = `${result.evidence} Average measured waste is ${result.measuredWastePercent}% of prepared quantity.`;
      next.textContent = result.nextAction;
    } else {
      title.textContent = result.status === 'insufficient_history' ? `Keep measuring ${result.dish}` : 'Waiting for measured kitchen records';
      detail.textContent = result.message;
      next.textContent = result.status === 'insufficient_history' ? 'Collect more comparable services' : 'Collect 3 comparable services';
    }
  } catch {
    title.textContent = 'Waste control unavailable';
    detail.textContent = 'Reconnect and save measured dish-level records to generate a recommendation.';
    next.textContent = 'Reconnect to sync';
  }
}

function renderReinvestmentPlan(items) {
  const grid = document.querySelector('#reinvestment-grid');
  if (!grid) return;
  if (!items?.length) {
    grid.innerHTML = '<div class="reinvestment-empty">No measured savings are available yet.</div>';
    return;
  }
  grid.replaceChildren(...items.map((item) => {
    const card = document.createElement('article');
    card.className = 'reinvestment-card';
    card.innerHTML = '<div class="reinvestment-card-top"><strong></strong><span></span></div><b></b><small></small>';
    card.querySelector('strong').textContent = item.name;
    card.querySelector('span').textContent = `${item.share}%`;
    card.querySelector('b').textContent = `₹${Number(item.monthlyAmount || 0).toLocaleString('en-IN')} / month`;
    card.querySelector('small').textContent = item.purpose;
    return card;
  }));
}

async function loadCostManagement() {
  const campus = document.querySelector('#mess-select')?.value || 'North Campus Mess';
  const days = Number(document.querySelector('#cost-period')?.value || 30);
  const cost = Number(document.querySelector('#cost-per-kg')?.value || 120);
  const label = document.querySelector('#cost-data-label');
  try {
    const params = new URLSearchParams({ days: String(days), campus, cost_per_kg: String(cost) });
    const result = await backendRequest(`/api/analytics/cost-management?${params}`);
    document.querySelector('#cost-avoidable-kg').textContent = Number(result.avoidableKg || 0).toFixed(1);
    document.querySelector('#cost-window-value').textContent = Number(result.measuredValue || 0).toLocaleString('en-IN');
    document.querySelector('#cost-monthly-value').textContent = Number(result.projectedMonthlySavings || 0).toLocaleString('en-IN');
    document.querySelector('#cost-service-count').textContent = result.serviceCount || 0;
    document.querySelector('#cost-avoidable-note').textContent = result.status === 'ready' ? `${result.leftoverKg} kg total leftover measured` : 'Add dish-level records to measure';
    document.querySelector('#cost-service-note').textContent = `${days}-day review window`;
    document.querySelector('#cost-recommendation').textContent = result.recommendation;
    document.querySelector('#cost-plan-note').textContent = result.status === 'ready'
      ? `Based on ${result.serviceCount} measured service record(s), ₹${Number(result.costPerKg).toLocaleString('en-IN')} per kg, and avoidable waste only.`
      : 'Only avoidable waste is counted as recoverable budget. Save measured records to replace this zero-state.';
    label.textContent = result.status === 'ready' ? 'MEASURED PLAN' : 'WAITING FOR MEASUREMENTS';
    renderReinvestmentPlan(result.reinvestment);
  } catch {
    label.textContent = 'PLAN UNAVAILABLE';
    document.querySelector('#cost-recommendation').textContent = 'Reconnect to load measured savings and a reinvestment plan.';
    renderReinvestmentPlan([]);
  }
}

async function connectBackend() {
  const label = document.querySelector('#backend-status');
  try {
    const health = await backendRequest('/api/health');
    const [{ records }, { feedback }] = await Promise.all([
      backendRequest('/api/service-records?days=30'), backendRequest('/api/feedback')
    ]);
    if (records.length) {
      document.querySelector('#collection-records').replaceChildren();
      records.slice().reverse().forEach(renderServiceRecord);
    }
    if (feedback.length) {
      feedback.slice().reverse().forEach((entry, index) => renderFeedback(entry, index === 0));
    }
    const analytics = await backendRequest(`/api/analytics/menu-feedback?days=30&campus=${encodeURIComponent(document.querySelector('#mess-select').value)}`);
    renderFeedbackAnalysis(analytics.rows);
    await loadDashboardSummary();
    await loadWasteDetailAnalysis();
    await loadWasteRecommendation();
    await loadCostManagement();
    backendConnected = true;
    label.textContent = 'DATA SYNCED';
    label.classList.add('backend-online');
  } catch {
    backendConnected = false;
    label.textContent = 'DATA SYNC PAUSED';
  }
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 2800);
}

document.querySelector('#generate-plan').addEventListener('click', () => {
  showToast('Food plan generated for 470 diners.');
});

document.querySelector('#edit-menu').addEventListener('click', () => {
  showToast('Menu items shown are sample data.');
});

function activateView() {
  const requestedId = window.location.hash.slice(1) || 'overview';
  const requestedView = document.getElementById(requestedId);
  const activeView = requestedView?.classList.contains('app-view')
    ? requestedView
    : document.getElementById('overview');
  document.querySelectorAll('.app-view').forEach((view) => {
    view.classList.toggle('active', view === activeView);
  });
  document.querySelectorAll('.nav-link').forEach((link) => {
    link.classList.toggle('active', link.getAttribute('href') === `#${activeView.id}`);
  });
  if (activeView.id === 'settings') {
    document.querySelector('#settings-campus').value = document.querySelector('#mess-select').value;
    document.querySelector('#settings-meal').value = document.querySelector('#meal-select').value;
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function navigateToView(viewId) {
  const nextHash = `#${viewId}`;
  if (window.location.hash !== nextHash) {
    window.location.hash = nextHash;
  }
  activateView();
}

document.querySelectorAll('.nav-link').forEach((link) => {
  link.addEventListener('click', (event) => {
    event.preventDefault();
    navigateToView(link.getAttribute('href').slice(1));
  });
});
document.querySelector('.brand').addEventListener('click', (event) => {
  event.preventDefault();
  navigateToView('overview');
});
document.querySelectorAll('[data-go-view]').forEach((link) => {
  link.addEventListener('click', () => navigateToView(link.dataset.goView));
});
window.addEventListener('popstate', activateView);
window.addEventListener('hashchange', activateView);
activateView();

const weeklyMenusByCampus = {
  'North Campus Mess': {
    Monday: { Breakfast: ['Poha', 'Egg bhurji'], Lunch: ['Dal tadka', 'Chicken curry'], Dinner: ['Kadai paneer', 'Egg masala'], Snacks: ['Vegetable puff', 'Chicken roll'] },
    Tuesday: { Breakfast: ['Idli sambar', null], Lunch: ['Chole', null], Dinner: ['Aloo gobi', null], Snacks: ['Samosa', null] },
    Wednesday: { Breakfast: ['Upma', 'Boiled eggs'], Lunch: ['Rajma', 'Chicken korma'], Dinner: ['Vegetable pulao', 'Fish curry'], Snacks: ['Dhokla', 'Chicken sandwich'] },
    Thursday: { Breakfast: ['Poha', null], Lunch: ['Dal tadka', null], Dinner: ['Paneer curry', null], Snacks: ['Vegetable sandwich', null] },
    Friday: { Breakfast: ['Pongal', 'Egg dosa'], Lunch: ['Veg biryani', 'Chicken 65'], Dinner: ['Dal makhani', 'Chicken stew'], Snacks: ['Aloo tikki', 'Chicken cutlet'] },
    Saturday: { Breakfast: ['Stuffed aloo paratha', null], Lunch: ['Kashmiri dum aloo', null], Dinner: ['Shahi paneer', null], Snacks: ['Street-style chaat platter', null] },
    Sunday: { Breakfast: ['Masala dosa', 'Egg dosa'], Lunch: ['Paneer biryani', 'Hyderabadi chicken biryani'], Dinner: ['Veg kofta curry', 'Egg masala'], Snacks: ['Pav bhaji', 'Chicken sandwich'] },
  },
  'South Campus Mess': {
    Monday: { Breakfast: ['Pongal', 'Egg dosa'], Lunch: ['Sambar rice', 'Chicken chettinad'], Dinner: ['Avial', 'Egg curry'], Snacks: ['Sundal', 'Chicken puff'] },
    Tuesday: { Breakfast: ['Upma', null], Lunch: ['Lemon rice', null], Dinner: ['Paneer kurma', null], Snacks: ['Medu vada', null] },
    Wednesday: { Breakfast: ['Idli', 'Boiled eggs'], Lunch: ['Vegetable pulao', 'Chicken biryani'], Dinner: ['Rasam rice', 'Chicken roast'], Snacks: ['Bajji', 'Chicken roll'] },
    Thursday: { Breakfast: ['Rava dosa', null], Lunch: ['Chole masala', null], Dinner: ['Vegetable kurma', null], Snacks: ['Sundal', null] },
    Friday: { Breakfast: ['Ven pongal', 'Masala omelette'], Lunch: ['Curd rice', 'Fish fry'], Dinner: ['Mushroom masala', 'Chicken stew'], Snacks: ['Onion pakora', 'Egg sandwich'] },
    Saturday: { Breakfast: ['Appam with vegetable stew', null], Lunch: ['Kerala-style veg sadya', null], Dinner: ['Malabar paneer curry', null], Snacks: ['Banana fritters', null] },
    Sunday: { Breakfast: ['Masala dosa', 'Boiled eggs'], Lunch: ['Veg meals', 'Chicken biryani'], Dinner: ['Tomato rice', 'Fish curry'], Snacks: ['Bonda', 'Chicken sandwich'] },
  },
};

function renderMenu(meal, campus) {
  const selectedCampus = campus || document.querySelector('#mess-select').value;
  const menu = weeklyMenusByCampus[selectedCampus][selectedWeekday][meal];
  const menuList = document.querySelector('#food-plan-list');
  const menuTitle = document.querySelector('#menu-service-title');
  const campusName = selectedCampus.replace(' Mess', '');
  menuTitle.textContent = `${campusName} · ${meal} · ${selectedWeekday.slice(0, 3)}`;
  const period = getCurrentMealPeriod();
  const periodStart = `${String(Math.floor(period.start / 60)).padStart(2, '0')}:${String(period.start % 60).padStart(2, '0')}`;
  const periodEnd = `${String(Math.floor(period.end / 60)).padStart(2, '0')}:${String(period.end % 60).padStart(2, '0')}`;
  const selectedPeriod = period.meal === meal;
  document.querySelector('#current-menu-time').textContent = selectedPeriod
    ? period.active ? `Serving now · ${periodStart}–${periodEnd} IST` : `Next service · ${periodStart} IST`
    : `${meal} menu · ${period.active ? `${period.meal} serving now` : `Next: ${period.meal}`}`;
  document.querySelector('#current-service-label').textContent = selectedPeriod
    ? `${meal} ${period.active ? 'in service' : 'next'}`
    : `${meal} menu selected`;
  document.querySelector('#current-service-status').textContent = selectedPeriod
    ? period.active ? 'Serving now' : `Next at ${periodStart} IST`
    : 'Menu selected';
  document.querySelector('#forecast-campus').textContent = campusName;
  document.querySelector('#forecast-service').textContent = meal;
  document.querySelector('#comparison-campus').textContent = campusName;
  document.querySelector('#comparison-meal').textContent = meal;
  document.querySelector('#insights-campus').textContent = campusName;
  document.querySelector('#insights-meal').textContent = meal;
  const rows = [['Veg', menu[0]], ['Non-veg', menu[1]]].map(([type, item]) => {
    const row = document.createElement('li');
    const label = document.createElement('span');
    label.className = `menu-category ${type === 'Veg' ? 'veg-category' : 'nonveg-category'}`;
    label.textContent = type;
    const name = document.createElement('span');
    name.textContent = item || 'Not served today';
    if (!item) row.classList.add('menu-not-served');
    row.append(label, name);
    return row;
  });
  menuList.replaceChildren(...rows);
  const feedbackMeal = document.querySelector('#feedback-meal');
  const feedbackDish = document.querySelector('#feedback-dish');
  const feedbackContext = document.querySelector('#feedback-context');
  if (feedbackMeal && feedbackDish) {
    feedbackMeal.value = meal;
    feedbackDish.replaceChildren(...menu.filter(Boolean).map((item) => {
      const option = document.createElement('option');
      option.value = item;
      option.textContent = item;
      return option;
    }));
    if (!menu.filter(Boolean).length) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'No menu item recorded for this service';
      feedbackDish.append(option);
    }
    const feedbackDate = document.querySelector('#feedback-date')?.value || getISTDateISO();
    if (feedbackContext) feedbackContext.textContent = `Feedback will be linked to ${selectedCampus} · ${feedbackDate} · ${meal} · ${menu.filter(Boolean).join(' + ')}.`;
  }
  syncMenuFromBackend(meal, selectedCampus, selectedWeekday);
}

const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
let selectedWeekday = getISTWeekday();
const syncedMenuKeys = new Set();

async function syncMenuFromBackend(meal, campus, weekday) {
  const date = new Date();
  const dayIndex = weekdays.indexOf(weekday);
  const todayIndex = date.getDay() === 0 ? 6 : date.getDay() - 1;
  date.setDate(date.getDate() + dayIndex - todayIndex);
  const dateText = date.toISOString().slice(0, 10);
  const key = `${campus}|${dateText}|${meal}`;
  if (syncedMenuKeys.has(key)) return;
  syncedMenuKeys.add(key);
  try {
    const result = await backendRequest(`/api/menu?campus=${encodeURIComponent(campus)}&meal=${encodeURIComponent(meal)}&date=${dateText}`);
    if (!result.menu) return;
    weeklyMenusByCampus[campus][weekday][meal] = [result.menu.veg, result.menu.nonVeg || result.menu.non_veg || null];
    renderMenu(meal, campus);
    renderWeeklyMenu(weekday, campus);
  } catch {
    // Keep the editable preview menu visible until a saved backend menu exists.
  }
}

function renderWeeklyMenu(day, campus) {
  selectedWeekday = weekdays.includes(day) ? day : selectedWeekday;
  const selectedCampus = campus || document.querySelector('#mess-select').value;
  const schedule = weeklyMenusByCampus[selectedCampus][selectedWeekday];
  const menuGrid = document.querySelector('#weekly-menu-grid');
  document.querySelector('#food-plan-campus-label').textContent = selectedCampus;
  document.querySelector('#weekend-special-note').hidden = !['Saturday', 'Sunday'].includes(selectedWeekday);
  menuGrid.replaceChildren(...Object.entries(schedule).map(([service, categories]) => {
    const card = document.createElement('article');
    const heading = document.createElement('h3');
    card.className = 'weekly-service-card';
    heading.textContent = service;
    card.append(heading);
    if (['Saturday', 'Sunday'].includes(selectedWeekday)) card.classList.add('weekend-special-card');
    [['Veg', categories[0]], ['Non-veg', categories[1]]].forEach(([type, dish]) => {
      const row = document.createElement('div');
      const label = document.createElement('span');
      const value = document.createElement('strong');
      row.className = `weekly-dish ${type === 'Veg' ? 'veg-dish' : 'nonveg-dish'}`;
      label.textContent = type;
      value.textContent = dish || 'Not served today';
      if (!dish) row.classList.add('not-served');
      row.append(label, value);
      card.append(row);
    });
    return card;
  }));
  document.querySelectorAll('[data-weekday]').forEach((button) => {
    const active = button.dataset.weekday === selectedWeekday;
    button.classList.toggle('selected', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

function renderFoodItems() {
  const search = document.querySelector('#food-item-search').value.trim().toLowerCase();
  const selectedType = document.querySelector('#food-item-type').value;
  const itemsByKey = new Map();
  Object.entries(weeklyMenusByCampus).forEach(([campus, days]) => {
    Object.entries(days).forEach(([day, services]) => {
      Object.entries(services).forEach(([service, dishes]) => {
        [['Veg', dishes[0]], ['Non-veg', dishes[1]]].forEach(([type, name]) => {
          if (!name) return;
          const key = `${type}:${name}`;
          if (!itemsByKey.has(key)) itemsByKey.set(key, { name, type, campuses: new Set(), services: new Set() });
          itemsByKey.get(key).campuses.add(campus.replace(' Mess', ''));
          itemsByKey.get(key).services.add(service);
        });
      });
    });
  });

  const grid = document.querySelector('#food-catalog-grid');
  const matches = [...itemsByKey.values()]
    .filter((item) => item.name.toLowerCase().includes(search))
    .filter((item) => selectedType === 'all' || item.type === selectedType)
    .sort((a, b) => a.name.localeCompare(b.name));
  if (!matches.length) {
    const empty = document.createElement('p');
    empty.className = 'catalog-empty';
    empty.textContent = 'No food items match these filters.';
    grid.replaceChildren(empty);
    return;
  }

  grid.replaceChildren(...matches.map((item) => {
    const card = document.createElement('article');
    const title = document.createElement('h2');
    const type = document.createElement('span');
    const details = document.createElement('p');
    card.className = 'food-item-card';
    title.textContent = item.name;
    type.className = `menu-category ${item.type === 'Veg' ? 'veg-category' : 'nonveg-category'}`;
    type.textContent = item.type;
    details.textContent = `${[...item.campuses].join(', ')} · ${[...item.services].join(', ')}`;
    card.append(title, type, details);
    return card;
  }));
}

let lastAutomaticMealSlot = '';
function syncCurrentMealPeriod() {
  const period = getCurrentMealPeriod();
  const slotKey = `${period.weekday}:${period.meal}`;
  if (slotKey === lastAutomaticMealSlot) return;
  lastAutomaticMealSlot = slotKey;
  selectedWeekday = period.weekday;
  document.querySelector('#meal-select').value = period.meal;
  renderWeeklyMenu(period.weekday);
  renderMenu(period.meal);
}

syncCurrentMealPeriod();
renderFoodItems();
updateISTClock();
setInterval(updateISTClock, 1000);
setInterval(syncCurrentMealPeriod, 15000);
const serviceDateInput = document.querySelector('[name="date"]');
serviceDateInput.value = getISTDateISO();
document.querySelectorAll('[data-weekday]').forEach((button) => {
  button.setAttribute('aria-pressed', String(button.dataset.weekday === selectedWeekday));
});

document.querySelector('#food-item-search').addEventListener('input', renderFoodItems);
document.querySelector('#food-item-type').addEventListener('change', renderFoodItems);

document.querySelectorAll('[data-weekday]').forEach((button) => {
  button.addEventListener('click', () => {
    renderWeeklyMenu(button.dataset.weekday);
    renderMenu(document.querySelector('#meal-select').value);
  });
});

document.querySelector('#meal-select').addEventListener('change', (event) => {
  renderMenu(event.target.value);
  loadDashboardSummary();
  loadWasteRecommendation();
  showToast(`${event.target.value} menu selected.`);
});

document.querySelector('#mess-select').addEventListener('change', (event) => {
  renderMenu(document.querySelector('#meal-select').value, event.target.value);
  renderWeeklyMenu(selectedWeekday, event.target.value);
  loadAttendanceTimeline();
  loadWasteAnalysis();
  loadWasteDetailAnalysis();
  loadDemandBaseline();
  loadDashboardSummary();
  loadWasteRecommendation();
  loadCostManagement();
  showToast(`${event.target.value} selected.`);
});

document.querySelector('#waste-control-refresh').addEventListener('click', loadWasteRecommendation);
document.querySelector('#refresh-cost-plan').addEventListener('click', loadCostManagement);
document.querySelector('#cost-period').addEventListener('change', loadCostManagement);

document.querySelector('#attendance-days').addEventListener('change', loadAttendanceTimeline);

document.querySelector('#save-preferences').addEventListener('click', () => {
  const campusSelect = document.querySelector('#mess-select');
  const mealSelect = document.querySelector('#meal-select');
  campusSelect.value = document.querySelector('#settings-campus').value;
  mealSelect.value = document.querySelector('#settings-meal').value;
  renderMenu(mealSelect.value, campusSelect.value);
  renderWeeklyMenu(selectedWeekday, campusSelect.value);
  showToast('Dashboard selections applied.');
});

document.querySelector('#data-entry-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget).entries());
  const record = { ...data, cuisine: data.cuisine.trim(), forecast: Number(data.forecast), attendance: Number(data.attendance), prepared: Number(data.prepared), leftover: Number(data.leftover), createdAt: new Date().toISOString() };
  try {
    if (backendConnected) {
      const result = await backendRequest('/api/service-records', { method: 'POST', body: JSON.stringify(record) });
      renderServiceRecord(result.record);
      showToast('Service record saved to operations data.');
    } else {
      renderServiceRecord(record);
      sessionOnlyAttendanceRecords.push({ ...record, isSynthetic: false });
      showToast('Data sync paused: record added for this session only.');
    }
  } catch (error) {
    showToast(error.message);
    return;
  }
  event.currentTarget.reset();
  event.currentTarget.elements.date.value = getISTDateISO();
  loadAttendanceTimeline();
  loadWasteAnalysis();
  loadDemandBaseline();
});

async function loadDemandBaseline() {
  const status = document.querySelector('#sim-model-status');
  try {
    const params = new URLSearchParams({
      campus: document.querySelector('#mess-select').value,
      meal: document.querySelector('#meal-select').value,
      date: getISTDateISO()
    });
    const model = await backendRequest(`/api/model/forecast?${params}`);
    status.dataset.modelStatus = model.status;
    status.dataset.matchedRecords = model.matchedRecords;
    status.textContent = model.baseline === null
      ? 'No saved attendance history is available. Enter a verified baseline manually or save service records first.'
      : `${model.method} ${model.matchedRecords} matching record(s); ${model.trainingRecords} ${model.dataType || 'historical'} record(s) used.`;
    if (model.baseline !== null && !document.querySelector('#sim-attendance').dataset.manual) {
      document.querySelector('#sim-attendance').value = model.baseline;
    }
    return model;
  } catch {
    status.dataset.modelStatus = 'unavailable';
    status.textContent = 'Historical model unavailable. Check your data connection and try again.';
    return null;
  }
}

function buildDemoWasteAnalysis(campus) {
  const today = getISTDateISO();
  const todayUtc = new Date(`${today}T00:00:00Z`);
  const campusOffset = campus === 'North Campus Mess' ? 0 : 1;
  const mealData = [
    { meal: 'Breakfast', offset: 0, base: campusOffset === 0 ? 310 : 260 },
    { meal: 'Lunch', offset: 1, base: campusOffset === 0 ? 470 : 380 },
    { meal: 'Dinner', offset: 2, base: campusOffset === 0 ? 390 : 330 },
    { meal: 'Snacks', offset: 3, base: campusOffset === 0 ? 125 : 115 }
  ];
  const mod = (value, divisor) => ((value % divisor) + divisor) % divisor;
  const roundOne = (value) => Math.round(value * 10) / 10;
  const services = [];
  for (let age = 1; age <= 6; age += 1) {
    const date = new Date(todayUtc.getTime() - age * 86400000);
    const dateText = date.toISOString().slice(0, 10);
    const isoWeekday = (date.getUTCDay() + 6) % 7 + 1;
    const weekendBump = isoWeekday === 6 ? 14 : isoWeekday === 7 ? 24 : 0;
    mealData.forEach(({ meal, offset, base }) => {
      const attendance = Math.max(0, base + weekendBump + mod(age * 7 + campusOffset * 13 + offset * 17, 43) - 21);
      const preparedKg = roundOne(attendance * 0.39 + mod(age * 3 + offset, 13));
      const leftoverKg = roundOne(2 + mod(age * 5 + campusOffset * 7 + offset * 11, 81) / 10);
      services.push({ date: dateText, campus, meal, preparedKg, leftoverKg,
        wastePercent: roundOne(leftoverKg / preparedKg * 100) });
    });
  }
  services.sort((a, b) => b.date.localeCompare(a.date) || b.meal.localeCompare(a.meal));
  const preparedKg = roundOne(services.reduce((sum, row) => sum + row.preparedKg, 0));
  const leftoverKg = roundOne(services.reduce((sum, row) => sum + row.leftoverKg, 0));
  const fromDate = new Date(todayUtc.getTime() - 6 * 86400000).toISOString().slice(0, 10);
  return { status: 'ready', dataType: 'synthetic demo', campus, fromDate, throughDate: today,
    serviceCount: services.length, preparedKg, leftoverKg,
    wastePercent: roundOne(leftoverKg / preparedKg * 100), services };
}

async function loadWasteAnalysis() {
  const rows = document.querySelector('#waste-records');
  const campus = document.querySelector('#mess-select').value;
  let result;
  let demoFallback = false;
  try {
    const params = new URLSearchParams({ days: '7', campus });
    result = await backendRequest(`/api/analytics/waste?${params}`);
    // Keep the screen useful when the backend is reachable but has not been seeded yet.
    if (!Array.isArray(result.services) || result.services.length === 0) {
      result = buildDemoWasteAnalysis(campus);
      demoFallback = true;
    }
  } catch {
    result = buildDemoWasteAnalysis(campus);
    demoFallback = true;
  }
  try {
    document.querySelector('#waste-data-label').textContent = result.dataType === 'synthetic demo'
      ? demoFallback ? 'SYNTHETIC DEMO PREVIEW' : 'SYNTHETIC DEMO DATA'
      : result.serviceCount ? 'SAVED SERVICE DATA' : 'NO SERVICE DATA';
    document.querySelector('#waste-prepared').textContent = result.preparedKg.toFixed(1);
    document.querySelector('#waste-leftover').textContent = result.leftoverKg.toFixed(1);
    document.querySelector('#waste-rate').textContent = result.wastePercent === null ? '—' : result.wastePercent.toFixed(1);
    document.querySelector('#waste-service-count').textContent = result.serviceCount;
    document.querySelector('#waste-date-range').textContent = `${result.fromDate} to ${result.throughDate} IST · ${campus}`;
    document.querySelector('#waste-analysis-note').textContent = result.dataType === 'synthetic demo'
      ? demoFallback
        ? 'Local demo preview shown because the API is unreachable. These generated amounts are not measured kitchen quantities.'
        : 'Demo results use generated history, not measured kitchen quantities.'
      : result.serviceCount
        ? 'Results summarize saved preparation and leftover records. Waste rate is based on their combined quantities.'
        : 'No saved service records are available for this campus and period.';

    rows.replaceChildren();
    if (!result.services.length) {
      const empty = document.createElement('tr');
      empty.className = 'empty-row';
      const message = document.createElement('td');
      message.colSpan = 6;
      message.textContent = 'No service records for this period.';
      empty.append(message);
      rows.append(empty);
      return;
    }
    result.services.forEach((service) => {
      const row = document.createElement('tr');
      [service.date, service.campus.replace(' Mess', ''), service.meal,
        `${service.preparedKg.toFixed(1)} kg`, `${service.leftoverKg.toFixed(1)} kg`,
        service.wastePercent === null ? '—' : `${service.wastePercent.toFixed(1)}%`].forEach((value) => {
        const cell = document.createElement('td');
        cell.textContent = value;
        row.append(cell);
      });
      rows.append(row);
    });
  } catch {
    document.querySelector('#waste-data-label').textContent = 'DATA UNAVAILABLE';
    document.querySelector('#waste-analysis-note').textContent = 'Could not load saved kitchen records. Reconnect and try again.';
    rows.innerHTML = '<tr class="empty-row"><td colspan="6">Service data could not be loaded.</td></tr>';
  }
}

async function loadWasteDetailAnalysis() {
  const table = document.querySelector('#waste-detail-records');
  if (!table) return;
  try {
    const campus = document.querySelector('#mess-select').value;
    const result = await backendRequest(`/api/analytics/waste-detail?days=30&campus=${encodeURIComponent(campus)}`);
    table.replaceChildren();
    if (!result.byDish.length) {
      table.innerHTML = '<tr class="empty-row"><td colspan="4">No item-level waste records have been saved yet.</td></tr>';
      document.querySelector('#waste-detail-note').textContent = 'Save measured dish-level records to identify avoidable waste.';
      return;
    }
    result.byDish.forEach((item) => {
      const row = document.createElement('tr');
      [item.dish, `${item.leftoverKg.toFixed(1)} kg`, `${item.avoidableKg.toFixed(1)} kg`, item.records].forEach((value) => {
        const cell = document.createElement('td');
        cell.textContent = value;
        row.append(cell);
      });
      table.append(row);
    });
    document.querySelector('#waste-detail-note').textContent = `${result.avoidableKg.toFixed(1)} kg avoidable waste across ${result.serviceCount} measured dish record(s) from ${result.fromDate} to ${result.throughDate}.`;
  } catch {
    table.innerHTML = '<tr class="empty-row"><td colspan="4">Item-level waste analysis is unavailable. Reconnect and try again.</td></tr>';
  }
}

function calculateWasteInput() {
  const preparedInput = document.querySelector('#waste-input-prepared');
  const leftoverInput = document.querySelector('#waste-input-leftover');
  const prepared = Number(preparedInput.value);
  const leftover = Number(leftoverInput.value);
  const message = document.querySelector('#waste-calculator-message');
  if (!preparedInput.value || !leftoverInput.value) return;
  if (!preparedInput.checkValidity() || !leftoverInput.checkValidity() || leftover > prepared) {
    document.querySelector('#waste-calculation-result').hidden = true;
    message.textContent = leftover > prepared
      ? 'Leftover food cannot be greater than food prepared.'
      : 'Enter valid non-negative amounts to view the result.';
    return;
  }

  document.querySelector('#waste-result-prepared').textContent = prepared.toFixed(1);
  document.querySelector('#waste-result-leftover').textContent = leftover.toFixed(1);
  document.querySelector('#waste-result-rate').textContent = (leftover / prepared * 100).toFixed(1);
  document.querySelector('#waste-calculation-result').hidden = false;
  message.textContent = 'Results update as you enter values. This calculation preview is not saved to service history.';
}

document.querySelector('#waste-calculator').addEventListener('submit', (event) => {
  event.preventDefault();
  const leftoverInput = document.querySelector('#waste-input-leftover');
  const prepared = Number(document.querySelector('#waste-input-prepared').value);
  const leftover = Number(leftoverInput.value);
  leftoverInput.setCustomValidity(leftover > prepared ? 'Leftover food cannot be greater than food prepared.' : '');
  if (!event.currentTarget.reportValidity()) return;
  calculateWasteInput();
});

document.querySelector('#waste-record-date').value = getISTDateISO();
document.querySelector('#waste-record-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form).entries());
  const message = document.querySelector('#waste-record-message');
  const prepared = Number(data.prepared_kg);
  const served = Number(data.served_kg);
  const leftover = Number(data.leftover_kg);
  const avoidable = Number(data.avoidable_kg);
  if (served + leftover > prepared || avoidable > leftover) {
    message.textContent = 'Check quantities: served + leftover must be within prepared, and avoidable waste cannot exceed leftover.';
    return;
  }
  try {
    if (!backendConnected) await backendRequest('/api/health');
    const result = await backendRequest('/api/waste-records', {
      method: 'POST',
      body: JSON.stringify({ ...data, campus: document.querySelector('#mess-select').value,
        prepared_kg: prepared, served_kg: served, leftover_kg: leftover, avoidable_kg: avoidable })
    });
    backendConnected = true;
    message.textContent = `Saved ${result.record.dish} waste record at ${formatISTTimestamp(result.record.createdAt)}.`;
    form.reset();
    document.querySelector('#waste-record-date').value = getISTDateISO();
    await loadWasteAnalysis();
    await loadWasteDetailAnalysis();
    await loadCostManagement();
    showToast('Waste record saved to operations data.');
  } catch (error) {
    message.textContent = `Waste record was not saved: ${error.message}`;
  }
});
document.querySelectorAll('#waste-input-prepared, #waste-input-leftover').forEach((input) => {
  input.addEventListener('input', () => {
    document.querySelector('#waste-input-leftover').setCustomValidity('');
    calculateWasteInput();
  });
});
calculateWasteInput();

document.querySelector('#sim-attendance').addEventListener('input', (event) => {
  event.target.dataset.manual = 'true';
});

// Existing what-if adjustments are applied to the historical baseline.
document.querySelector('#run-simulation').addEventListener('click', async () => {
  const model = await loadDemandBaseline();
  const baseInput = document.querySelector('#sim-attendance');
  const base = model?.baseline !== null && model?.baseline !== undefined && !baseInput.dataset.manual
    ? model.baseline
    : Number(baseInput.value);
  if (!Number.isFinite(base) || base < 0) {
    document.querySelector('#sim-result-count').textContent = '—';
    document.querySelector('#sim-result-range').textContent = '—';
    document.querySelector('#sim-result-confidence').textContent = 'No data';
    document.querySelector('#sim-result-risk').textContent = 'No historical attendance or manual baseline is available, so the simulator cannot estimate diners.';
    return;
  }
  const occupancy = Number(document.querySelector('#sim-occupancy').value) || 0;
  const weather = Number(document.querySelector('#sim-weather').value) || 0;
  const popularity = Number(document.querySelector('#sim-popularity').value) || 1;
  const noShow = Math.min(100, Math.max(0, Number(document.querySelector('#sim-noshow').value) || 0));
  let factor = (occupancy / 91) * popularity * (1 - noShow / 100);
  if (document.querySelector('#sim-exam').checked) factor *= 0.96;
  if (document.querySelector('#sim-holiday').checked) factor *= 0.82;
  if (document.querySelector('#sim-event').checked) factor *= 1.05;
  const estimate = Math.max(0, Math.round(base * factor + weather));
  const trained = model?.status === 'trained' && !baseInput.dataset.manual;
  const demoModel = model?.status === 'demo_trained' && !baseInput.dataset.manual;
  const hasModelRange = (trained || demoModel) && model?.mae !== null && model?.mae !== undefined;
  const spread = hasModelRange
    ? Math.max(1, Math.round(model.mae))
    : Math.max(12, Math.round(estimate * 0.1));
  document.querySelector('#sim-result-count').textContent = estimate;
  document.querySelector('#sim-result-range').textContent = `${Math.max(0, estimate - spread)}–${estimate + spread}`;
  document.querySelector('#sim-result-confidence').textContent = trained ? 'Actual data' : demoModel ? 'Demo data' : 'Limited / manual';
  document.querySelector('#sim-result-risk').textContent = demoModel
    ? `DEMO ONLY: based on ${model.trainingRecords} synthetic attendance records, not actual student check-ins. Walk-forward MAE ${model.mae ?? 'not available'} diners across ${model.validationSamples ?? 0} checks; replace these rows with verified records before operational use.`
    : trained
    ? `Historical baseline adjusted by the displayed scenario inputs. Based on ${model.trainingRecords} past attendance records; validation MAE ${model.mae ?? 'not available'} diners across ${model.validationSamples ?? 0} historical checks. This is not a guarantee.`
    : 'Limited history or a manual baseline: treat this as a what-if scenario, not a validated forecast.';
});

document.querySelector('#capture-learning').addEventListener('click', () => {
  document.querySelector('#learning-status').textContent = 'Review captured in this session for future analysis; no model was retrained.';
  showToast('Review recorded for this session.');
});

const reviewWasteRecommendation = document.querySelector('#review-waste-recommendation');
if (reviewWasteRecommendation) {
  reviewWasteRecommendation.addEventListener('click', () => {
    const status = document.querySelector('#waste-action-status');
    if (status) status.textContent = 'Recommendation opened for manager review. The production plan is unchanged.';
  });
}
const applyWasteRecommendation = document.querySelector('#apply-waste-recommendation');
if (applyWasteRecommendation) {
  applyWasteRecommendation.addEventListener('click', () => {
    const status = document.querySelector('#waste-action-status');
    if (status) status.textContent = 'Marked reviewed in this session. No production quantity was changed.';
  });
}

document.querySelector('#approve-demo-plan').addEventListener('click', () => {
  document.querySelector('#command-status').textContent = 'Marked approved in this browser session only. No kitchen system received this plan.';
  showToast('Sample plan marked approved.');
});
document.querySelector('#modify-demo-plan').addEventListener('click', () => {
  navigateToView('food-plan');
});

document.querySelector('#feedback-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!backendConnected) {
    try {
      await backendRequest('/api/health');
      backendConnected = true;
    } catch {
      showToast('Feedback was not saved. Reconnect, then try again.');
      return;
    }
  }
  const entry = {
    rating: document.querySelector('#feedback-rating').value,
    dish: document.querySelector('#feedback-dish').value,
    comment: document.querySelector('#feedback-comment').value.trim(),
    campus: document.querySelector('#mess-select').value,
    meal: document.querySelector('#feedback-meal').value,
    menu_snapshot: [...document.querySelector('#feedback-dish').options].map((option) => option.value).filter(Boolean).join(' | '),
    date: document.querySelector('#feedback-date').value
  };
  try {
    const result = await backendRequest('/api/feedback', { method: 'POST', body: JSON.stringify(entry) });
    renderFeedback(result.feedback);
  } catch (error) {
    showToast(`Feedback was not saved: ${error.message}`);
    return;
  }
  event.currentTarget.reset();
  showToast('Feedback saved to operations data.');
});

document.querySelector('#feedback-date').value = getISTDateISO();
document.querySelector('#feedback-date').addEventListener('change', (event) => {
  const date = new Date(`${event.target.value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return;
  selectedWeekday = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' }).format(date);
  renderWeeklyMenu(selectedWeekday);
  renderMenu(document.querySelector('#feedback-meal').value);
});

const applyWasteForecast = document.querySelector('#apply-waste-forecast');
if (applyWasteForecast) {
  applyWasteForecast.addEventListener('click', () => {
    const status = document.querySelector('#waste-forecast-status');
    if (status) status.textContent = 'Recommendation marked for manager approval. No kitchen quantities were changed.';
  });
}
const reviewWasteForecast = document.querySelector('#review-waste-forecast');
if (reviewWasteForecast) {
  reviewWasteForecast.addEventListener('click', () => {
    const status = document.querySelector('#waste-forecast-status');
    if (status) status.textContent = 'Review opened. Confirm the sample record against measured kitchen data before acting.';
  });
}
document.querySelectorAll('.action-review').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelector('#action-center-status').textContent = `${button.parentElement.querySelector('strong').textContent} selected for manager review. No plan changes were made.`;
  });
});

document.querySelector('#meal-select').addEventListener('change', loadDemandBaseline);
connectBackend().then(() => {
  loadDemandBaseline();
  loadWasteAnalysis();
  document.querySelector('#data-entry-form').elements.date.value = getISTDateISO();
  loadAttendanceTimeline();
});
