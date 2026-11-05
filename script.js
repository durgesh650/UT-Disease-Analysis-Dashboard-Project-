'use strict';

// Frontend logic for the Union Territory Disease Analysis Dashboard.
// Page structure is defined in index.html. This file only loads data and updates elements.

const API_BASE = 'http://localhost:5000';
const AVAILABLE_YEAR_OPTIONS = Array.from({ length: 10 }, (_, index) => String(2021 + index));
const FIVE_YEARS = [2021, 2022, 2023, 2024, 2025];
const PAGE_TITLES = {
  home: 'Home',
  filters: 'Dashboard Filters',
  overview: 'Dashboard Overview',
  'top-diseases': 'Top 5 Diseases',
  'cases-by-disease': 'Cases by Disease',
  trends: 'Disease Trends & Growth',
  'data-table': 'Data Table'
};

const DEFAULT_FILTERS = {
  unionTerritory: 'All',
  disease: 'All',
  ownershipCategory: 'All',
  areaCategory: 'All',
  analysisMode: 'five-year',
  oldPeriod: '2021',
  newPeriod: '2025'
};

let options = {
  unionTerritories: [],
  diseases: [],
  categories: [],
  periods: AVAILABLE_YEAR_OPTIONS
};
let draftFilters = { ...DEFAULT_FILTERS };
let appliedFilters = { ...DEFAULT_FILTERS };
let dashboard = null;
let currentPage = 'home';
let noticeTimer;
const chartInstances = {};
const CHART_COLORS = {
  old: '#3577f6',
  newer: '#17a99a',
  extra: ['#3577f6', '#17a99a', '#f5a623', '#8b6ce8', '#e16b83', '#37a6c8', '#83b84b', '#ef8e45', '#63708a', '#bc77b9']
};

// Small helpers keep repeated tasks consistent and beginner-friendly.
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const number = value => Number(value || 0).toLocaleString('en-IN');
const pctText = value => value === null || value === undefined
  ? 'N/A'
  : `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;

function showNotice(message, isError = false) {
  const notice = $('#notice');
  notice.textContent = message;
  notice.classList.remove('hidden', 'error');

  if (isError) notice.classList.add('error');
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => notice.classList.add('hidden'), 6500);
}

// Request JSON from the Express API and show a useful error for failed requests.
async function getJSON(url) {
  const response = await fetch(url);
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status})`);
  }
  return data;
}

// Add options to an existing select element without generating HTML strings.
function fillSelect(selectElement, items, selectedValue, firstLabel) {
  selectElement.replaceChildren();

  const firstOption = document.createElement('option');
  firstOption.value = 'All';
  firstOption.textContent = firstLabel;
  selectElement.appendChild(firstOption);

  items.forEach(item => {
    const option = document.createElement('option');
    option.value = item;
    option.textContent = item;
    selectElement.appendChild(option);
  });

  selectElement.value = selectedValue;
}

function fillYearSelect(selectElement, selectedValue) {
  selectElement.replaceChildren();

  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = selectElement.id === 'oldPeriod' ? 'Select Old Year' : 'Select New Year';
  placeholder.selected = !selectedValue;
  selectElement.appendChild(placeholder);

  AVAILABLE_YEAR_OPTIONS.forEach(year => {
    const option = document.createElement('option');
    option.value = year;
    option.textContent = year;
    selectElement.appendChild(option);
  });
  selectElement.value = selectedValue || '';
}

function updateYearFieldVisibility() {
  const twoYear = $('#analysisMode').value === 'two-year';
  $('#old-year-field').classList.toggle('hidden', !twoYear);
  $('#new-year-field').classList.toggle('hidden', !twoYear);
  $('#oldPeriod').required = twoYear;
  $('#newPeriod').required = twoYear;
}

function renderFilters() {
  fillSelect($('#unionTerritory'), options.unionTerritories, draftFilters.unionTerritory, 'All Union Territories');
  fillSelect($('#disease'), options.diseases, draftFilters.disease, 'All Diseases');
  $('#ownershipCategory').value = draftFilters.ownershipCategory || 'All';
  $('#areaCategory').value = draftFilters.areaCategory || 'All';
  $('#analysisMode').value = draftFilters.analysisMode || 'five-year';
  updateYearFieldVisibility();
  fillYearSelect($('#oldPeriod'), draftFilters.oldPeriod);
  fillYearSelect($('#newPeriod'), draftFilters.newPeriod);
  $('#applied-filter-summary').textContent = filterSummary();
}

async function loadOptions() {
  try {
    options = await getJSON(`${API_BASE}/api/options`);
    $('#api-status').textContent = 'API connected';
    $('.status-dot').style.background = '#27c69b';
  } catch (error) {
    $('#api-status').textContent = 'API not connected';
    $('.status-dot').style.background = '#f5a623';
    showNotice('Backend API is not reachable. Start the Node.js server and confirm MySQL is running. Filters and charts need the API.', true);
    options = { unionTerritories: [], diseases: [], categories: [], periods: AVAILABLE_YEAR_OPTIONS };
  }
  renderFilters();
}

// Fetch data only when Submit or Reset is pressed. The backend API stays unchanged.
async function fetchDashboard(filters = appliedFilters) {
  const query = new URLSearchParams(filters).toString();
  dashboard = null;
  try {
    const endpoint = filters.analysisMode === 'five-year' ? '/api/five-year-dashboard' : '/api/dashboard';
    dashboard = await getJSON(`${API_BASE}${endpoint}?${query}`);
  } catch (error) {
    renderCurrentPage();
    throw error;
  }
  appliedFilters = { ...filters };
  renderCurrentPage();
  return dashboard;
}

function filterSummary() {
  const territory = appliedFilters.unionTerritory === 'All' ? 'All Union Territories' : appliedFilters.unionTerritory;
  const disease = appliedFilters.disease === 'All' ? 'All Diseases' : appliedFilters.disease;
  const ownership = appliedFilters.ownershipCategory;
  const area = appliedFilters.areaCategory;
  const years = appliedFilters.analysisMode === 'five-year'
    ? '2021–2025 (5-Year Analysis)'
    : `${appliedFilters.oldPeriod} vs ${appliedFilters.newPeriod} (2-Year Comparison)`;
  return `${territory} · ${disease} · Ownership: ${ownership} · Area: ${area} · ${years}`;
}

function setContentVisibility(elementId, shouldShow) {
  $(`#${elementId}`).classList.toggle('hidden', !shouldShow);
}

function renderOverview() {
  const hasData = Boolean(dashboard);
  setContentVisibility('overview-empty', !hasData);
  setContentVisibility('overview-content', hasData);
  $('#overview-kicker').textContent = hasData ? 'Analysis results' : 'Dashboard';
  $('#overview-description').textContent = hasData ? filterSummary() : 'Apply filters to load your analysis.';
  if (!hasData) return;

  const firstYear = dashboard.years ? dashboard.years[0] : Number(appliedFilters.oldPeriod);
  const lastYear = dashboard.years ? dashboard.years[dashboard.years.length - 1] : Number(appliedFilters.newPeriod);
  const firstTotal = dashboard.years ? dashboard.totals[firstYear] : dashboard.summary.oldTotal;
  const lastTotal = dashboard.years ? dashboard.totals[lastYear] : dashboard.summary.newTotal;
  const difference = lastTotal - firstTotal;
  const growth = firstTotal === 0 ? null : Number(((difference / firstTotal) * 100).toFixed(2));
  const highest = [...dashboard.comparisons].sort((a, b) =>
    (dashboard.years ? b.values[lastYear] - a.values[lastYear] : b.newCases - a.newCases))[0];

  $('#old-total-title').textContent = dashboard.years ? `${firstYear} Cases` : 'Old Period Cases';
  $('#new-total-title').textContent = dashboard.years ? `${lastYear} Cases` : 'New Period Cases';
  $('#old-total').textContent = number(firstTotal);
  $('#new-total').textContent = number(lastTotal);
  $('#old-period-label').textContent = `Reporting year ${firstYear}`;
  $('#new-period-label').textContent = `Reporting year ${lastYear}`;
  $('#growth-percent').textContent = pctText(growth);
  $('#case-difference').textContent = `${number(difference)} net case difference`;
  $('#change-icon').textContent = difference >= 0 ? '↗' : '↘';
  $('#highest-disease').textContent = highest ? highest.disease : 'N/A';
  $('#overview-old-legend').textContent = String(firstYear);
  $('#overview-new-legend').textContent = String(lastYear);
  $('#disease-category-count').textContent = dashboard.comparisons.length;
  $('#overview-period-tag').textContent = dashboard.years ? '2021 → 2025' : `${firstYear} → ${lastYear}`;
}

function renderTopDiseases() {
  const hasData = Boolean(dashboard);
  setContentVisibility('top-diseases-content', hasData);
  $('#top-diseases-description').textContent = !hasData ? 'Submit dashboard filters to view rankings.' :
    `Top five disease counts for ${dashboard.years ? dashboard.years.join(', ') : `${appliedFilters.oldPeriod} and ${appliedFilters.newPeriod}`}.`;
  if (hasData) {
    $('#top-old-legend').textContent = dashboard.years ? '2021–2023' : appliedFilters.oldPeriod;
    $('#top-new-legend').textContent = dashboard.years ? '2024–2025' : appliedFilters.newPeriod;
  }
}

function renderCasesByDisease() {
  const hasData = Boolean(dashboard);
  setContentVisibility('cases-content', hasData);
  $('#cases-description').textContent = hasData ? filterSummary() : 'Submit dashboard filters to view the distribution.';
  if (hasData) $('#cases-chart-description').textContent = `Recorded cases by year: ${dashboard.years ? dashboard.years.join(', ') : `${appliedFilters.oldPeriod}, ${appliedFilters.newPeriod}`}.`;
}

function renderTrends() {
  const hasData = Boolean(dashboard);
  setContentVisibility('trends-content', hasData);
  $('#trends-description').textContent = hasData ? filterSummary() : 'Submit dashboard filters to calculate trends.';
  if (!hasData) return;
  const years = dashboard.years || [Number(appliedFilters.oldPeriod), Number(appliedFilters.newPeriod)];
  const totals = dashboard.years ? dashboard.totals : {
    [years[0]]: dashboard.summary.oldTotal, [years[1]]: dashboard.summary.newTotal
  };
  const first = totals[years[0]], last = totals[years[years.length - 1]];
  const diff = last - first;
  const growth = first === 0 ? null : Number(((diff / first) * 100).toFixed(2));
  $('#trend-growth-value').textContent = pctText(growth);
  $('#trend-growth-description').textContent = `From ${years[0]} to ${years[years.length - 1]}, total cases changed by ${number(diff)}.`;
  const highest = [...dashboard.comparisons].sort((a, b) => dashboard.years
    ? b.values[years[years.length - 1]] - a.values[years[years.length - 1]]
    : b.newCases - a.newCases)[0];
  $('#trend-highest-disease').textContent = highest ? highest.disease : 'N/A';
}

// Build table rows with DOM methods; the table structure itself stays in index.html.
function renderDataTable() {
  const hasData = Boolean(dashboard);
  setContentVisibility('data-table-content', hasData);
  setContentVisibility('table-export-actions', hasData);
  $('#table-description').textContent = hasData ? 'Disease-level summary and report downloads for the applied filters.' : 'Submit filters to view data.';
  if (!hasData) return;

  const rows = dashboard.comparisons || [];
  const years = dashboard.years || [Number(appliedFilters.oldPeriod), Number(appliedFilters.newPeriod)];
  $('#table-summary').textContent = `${filterSummary()} · ${rows.length} disease categories`;
  const table = $('.table-scroll table');
  const head = table.querySelector('thead tr');
  head.replaceChildren();
  ['Disease', ...years.map(year => `${year} cases`)].forEach(label => {
    const th = document.createElement('th'); th.textContent = label; head.appendChild(th);
  });
  const body = $('#comparison-table-body');
  body.replaceChildren();
  if (!rows.length) {
    const tr = document.createElement('tr'); const td = document.createElement('td');
    td.colSpan = years.length + 1; td.className = 'empty-state'; td.textContent = 'No matching records.';
    tr.appendChild(td); body.appendChild(tr); return;
  }
  rows.forEach(item => {
    const tr = document.createElement('tr');
    tr.appendChild(createTextCell(item.disease));
    years.forEach(year => {
      const value = dashboard.years ? item.values[year] : (year === years[0] ? item.oldCases : item.newCases);
      tr.appendChild(createNumberCell(value));
    });
    body.appendChild(tr);
  });
}

function createTextCell(value) {
  const cell = document.createElement('td');
  cell.textContent = value ?? '';
  return cell;
}

function createNumberCell(value) {
  const cell = document.createElement('td');
  cell.className = 'number-cell';
  cell.textContent = value;
  return cell;
}

function renderCurrentPage() {
  // Destroy charts before updating their data so old charts do not remain on screen.
  Object.values(chartInstances).forEach(chart => {
    if (chart) chart.destroy();
  });
  Object.keys(chartInstances).forEach(key => delete chartInstances[key]);

  renderFilters();
  renderOverview();
  renderTopDiseases();
  renderCasesByDisease();
  renderTrends();
  renderDataTable();
  setTimeout(drawCharts, 60);
}

function navigatePage(direction) {
  const pages = Object.keys(PAGE_TITLES);
  const currentIndex = pages.indexOf(currentPage);
  const nextIndex = Math.min(pages.length - 1, Math.max(0, currentIndex + direction));
  location.hash = pages[nextIndex];
}

function updatePageNavigation() {
  const pages = Object.keys(PAGE_TITLES);
  const index = pages.indexOf(currentPage);
  $('#page-counter').textContent = `Page ${index + 1} of ${pages.length}`;
  $('#go-previous').disabled = index === 0;
  $('#go-next').disabled = index === pages.length - 1;
}

function setPage(page) {
  if (!PAGE_TITLES[page]) page = 'home';
  currentPage = page;

  $$('.page').forEach(section => {
    section.classList.toggle('hidden', section.id !== `page-${page}`);
  });
  $$('.nav-link').forEach(link => {
    link.classList.toggle('active', link.dataset.page === page);
  });

  $('#page-title').textContent = PAGE_TITLES[page];
  updatePageNavigation();
  $('#sidebar').classList.remove('open');
  setTimeout(drawCharts, 80);
}

function drawCharts() {
  if (!dashboard || typeof Chart === 'undefined') return;
  const visiblePage = document.querySelector(`#page-${currentPage}`);
  if (!visiblePage) return;
  const canvas = visiblePage.querySelector('canvas');
  if (!canvas) return;
  if (chartInstances[canvas.id]) { chartInstances[canvas.id].resize(); return; }

  const years = dashboard.years || [Number(appliedFilters.oldPeriod), Number(appliedFilters.newPeriod)];
  const comparisons = dashboard.comparisons || [];
  const valuesFor = item => dashboard.years ? years.map(year => Number(item.values[year] || 0)) : [Number(item.oldCases), Number(item.newCases)];
  const colors = years.map((_, i) => CHART_COLORS.extra[i % CHART_COLORS.extra.length]);
  const makeDatasets = items => years.map((year, index) => ({
    label: String(year), data: items.map(item => valuesFor(item)[index]),
    backgroundColor: colors[index], borderColor: colors[index], borderRadius: 5,
    maxBarThickness: 38, tension: 0.25, fill: false
  }));
  const baseOptions = {
    responsive: true, maintainAspectRatio: false, animation: { duration: 250 },
    plugins: {
      legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8, padding: 18, font: { family: 'DM Sans', size: 11 } } },
      tooltip: { callbacks: { label: context => `${context.dataset.label || context.label}: ${Number(context.raw || 0).toLocaleString('en-IN')}` } }
    }
  };
  let config;
  if (canvas.id === 'overview-chart' || canvas.id === 'disease-distribution-chart') {
    const items = [...comparisons].sort((a,b) => Math.max(...valuesFor(b)) - Math.max(...valuesFor(a)));
    config = { type: 'bar', data: { labels: items.map(item => item.disease), datasets: makeDatasets(items) },
      options: { ...baseOptions, scales: {
        x: { ticks: { autoSkip: false, maxRotation: 50, minRotation: 25, font: { size: 10 } }, grid: { display: false } },
        y: { beginAtZero: true, ticks: { callback: value => Number(value).toLocaleString('en-IN') }, title: { display: true, text: 'Recorded cases' } }
      }}};
  } else if (canvas.id === 'top-five-chart') {
    let topNames;
    if (dashboard.years) {
      topNames = [...new Set(years.flatMap(year => (dashboard.topByYear[year] || []).map(item => item.disease)))];
    } else {
      topNames = [...new Set([...(dashboard.topOld || []).map(item => item.disease), ...(dashboard.topNew || []).map(item => item.disease)])];
    }
    const items = topNames.map(name => comparisons.find(item => item.disease === name)).filter(Boolean)
      .sort((a,b) => Math.max(...valuesFor(b)) - Math.max(...valuesFor(a)));
    config = { type: 'bar', data: { labels: items.map(item => item.disease), datasets: makeDatasets(items) },
      options: { ...baseOptions, scales: {
        x: { ticks: { autoSkip: false, maxRotation: 30, minRotation: 0, font: { size: 11 } }, grid: { display: false } },
        y: { beginAtZero: true, ticks: { callback: value => Number(value).toLocaleString('en-IN') }, title: { display: true, text: 'Recorded cases' } }
      }}};
  } else if (canvas.id === 'trend-chart') {
    const totals = dashboard.years ? years.map(year => Number(dashboard.totals[year] || 0)) :
      [dashboard.summary.oldTotal, dashboard.summary.newTotal];
    config = { type: 'line', data: { labels: years.map(String), datasets: [{
      label: 'Total recorded cases', data: totals, borderColor: CHART_COLORS.old,
      backgroundColor: '#3577f622', pointBackgroundColor: colors, pointRadius: 6,
      pointHoverRadius: 8, borderWidth: 3, tension: 0.25, fill: true
    }]}, options: { ...baseOptions, plugins: { ...baseOptions.plugins, legend: { display: false } },
      scales: { x: { grid: { display: false } }, y: { beginAtZero: true,
        ticks: { callback: value => Number(value).toLocaleString('en-IN') },
        title: { display: true, text: 'Total recorded cases' } } }}};
  }
  if (config) chartInstances[canvas.id] = new Chart(canvas, config);
}

function exportCSV() {
  if (!dashboard) { showNotice('Apply filters before exporting.', true); return; }
  const years = dashboard.years || [Number(appliedFilters.oldPeriod), Number(appliedFilters.newPeriod)];
  const rows = [['Union Territory', 'Disease', 'Ownership Category', 'Area Category', ...years.map(y => `${y} Cases`)]];
  dashboard.comparisons.forEach(item => rows.push([
    appliedFilters.unionTerritory, item.disease, appliedFilters.ownershipCategory, appliedFilters.areaCategory,
    ...years.map(year => dashboard.years ? item.values[year] : (year === years[0] ? item.oldCases : item.newCases))
  ]));
  const csv = rows.map(row => row.map(value => `"${String(value ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob); const link = document.createElement('a');
  link.href = url; link.download = `disease-analysis-${years[0]}-to-${years[years.length - 1]}.csv`;
  document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
  showNotice('CSV report exported.');
}

function exportPDF() {
  if (!dashboard) { showNotice('Apply filters before exporting.', true); return; }
  if (!window.jspdf || !window.jspdf.jsPDF) { showNotice('PDF library could not load. Check your internet connection and try again.', true); return; }
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const left = 14, pageWidth = pdf.internal.pageSize.getWidth(), pageHeight = pdf.internal.pageSize.getHeight();
  const years = dashboard.years || [Number(appliedFilters.oldPeriod), Number(appliedFilters.newPeriod)];
  const rows = dashboard.comparisons || [];
  const usable = pageWidth - left * 2;
  const colWidth = usable / (years.length + 1);
  const columns = [{ title: 'Disease', x: left, width: colWidth }, ...years.map((year, i) => ({ title: `${year} Cases`, x: left + colWidth * (i + 1), width: colWidth }))];
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(16); pdf.text('Union Territory Disease Analysis Report', left, 16);
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.text(`Filters: ${filterSummary()}`, left, 23);
  pdf.text(`Generated: ${new Date().toLocaleDateString('en-IN')}`, left, 29);
  let y = 39;
  const header = () => {
    pdf.setFillColor(17, 94, 89); pdf.rect(left - 2, y - 5, usable + 4, 9, 'F');
    pdf.setTextColor(255,255,255); pdf.setFont('helvetica','bold'); pdf.setFontSize(9);
    columns.forEach(c => pdf.text(c.title, c.x, y)); pdf.setTextColor(35,45,55); pdf.setFont('helvetica','normal'); y += 8;
  };
  header();
  rows.forEach(item => {
    if (y > pageHeight - 14) { pdf.addPage(); y = 18; header(); }
    const vals = [String(item.disease), ...years.map(year => number(dashboard.years ? item.values[year] : (year === years[0] ? item.oldCases : item.newCases)))];
    columns.forEach((c, i) => pdf.text(pdf.splitTextToSize(vals[i], c.width - 3), c.x, y));
    pdf.setDrawColor(225,232,235); pdf.line(left - 2, y + 2, pageWidth - left + 2, y + 2); y += 8;
  });
  pdf.save(`disease-analysis-${years[0]}-to-${years[years.length - 1]}.pdf`);
  showNotice('PDF report downloaded.');
}

// Filter form events are registered once; the HTML form is not rebuilt in JavaScript.
$('#analysisMode').addEventListener('change', () => updateYearFieldVisibility());

$('#filter-form').addEventListener('submit', async event => {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  const mode = String(formData.get('analysisMode') || 'five-year');
  const nextFilters = {
    unionTerritory: formData.get('unionTerritory'),
    disease: formData.get('disease'),
    ownershipCategory: formData.get('ownershipCategory'),
    areaCategory: formData.get('areaCategory'),
    analysisMode: mode,
    oldPeriod: String(formData.get('oldPeriod') || '').trim(),
    newPeriod: String(formData.get('newPeriod') || '').trim()
  };
  const feedback = $('#filter-feedback');
  feedback.className = 'filter-feedback'; feedback.textContent = '';
  if (mode === 'two-year') {
    if (!AVAILABLE_YEAR_OPTIONS.includes(nextFilters.oldPeriod) || !AVAILABLE_YEAR_OPTIONS.includes(nextFilters.newPeriod)) {
      feedback.textContent = 'Please select valid years from 2021 to 2030.'; feedback.classList.add('error'); return;
    }
    if (nextFilters.oldPeriod === nextFilters.newPeriod) {
      feedback.textContent = 'Please select two different years for comparison.'; feedback.classList.add('error'); return;
    }
  }
  feedback.textContent = 'Checking database records…'; feedback.classList.add('info');
  draftFilters = { ...nextFilters };
  try {
    await fetchDashboard(nextFilters);
    feedback.textContent = 'Analysis completed successfully.';
    feedback.className = 'filter-feedback success';
    location.hash = 'overview'; showNotice('Analysis completed successfully.');
  } catch (error) {
    feedback.textContent = error.message; feedback.className = 'filter-feedback error';
    showNotice(error.message, true);
  }
});

$('#reset-filters').addEventListener('click', () => {
  draftFilters = { ...DEFAULT_FILTERS };
  appliedFilters = { ...DEFAULT_FILTERS };
  dashboard = null;
  renderFilters();
  renderCurrentPage();
  $('#filter-feedback').textContent = '';
  $('#filter-feedback').className = 'filter-feedback';
  $('#notice').classList.add('hidden');
  // Reset clears both year selections and stays on the filter page.
});

$('#menu-toggle').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
$('#table-csv').addEventListener('click', exportCSV);
$('#table-pdf').addEventListener('click', exportPDF);
$('#go-home').addEventListener('click', () => { location.hash = 'home'; });
$('#go-previous').addEventListener('click', () => navigatePage(-1));
$('#go-next').addEventListener('click', () => navigatePage(1));
window.addEventListener('hashchange', () => setPage(location.hash.replace('#', '') || 'home'));
window.addEventListener('resize', () => drawCharts());

// Start the page, load filter options, and then request the default comparison.
async function initialiseDashboard() {
  renderFilters();
  setPage(location.hash.replace('#', '') || 'home');
  await loadOptions();
  // No comparison is loaded automatically. The user must select both years and Submit.
  dashboard = null;
  renderCurrentPage();
  setPage(location.hash.replace('#', '') || 'home');
}

initialiseDashboard();
