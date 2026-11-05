require('dotenv').config();
const express = require('express');
const cors = require('cors');
const pool = require('./db');
const app = express();
app.use(cors());
app.use(express.json());

const MIN_YEAR = 2021;
const MAX_YEAR = 2030;
const parseYear = value => /^\d{4}$/.test(String(value)) && Number(value) >= MIN_YEAR && Number(value) <= MAX_YEAR ? Number(value) : null;

app.get('/', (_req, res) => res.json({ message: 'Union Territory Disease Analysis API is running' }));
app.get('/api/health', async (_req, res) => {
  try { const [rows] = await pool.query('SELECT 1 AS ok'); res.json({ status: 'ok', database: rows[0].ok === 1 }); }
  catch (err) { res.status(500).json({ status: 'error', message: 'Database connection failed' }); }
});
app.get('/api/options', async (_req, res) => {
  try {
    const [utRows] = await pool.query('SELECT DISTINCT union_territory FROM disease_cases ORDER BY union_territory');
    const [diseaseRows] = await pool.query('SELECT DISTINCT disease FROM disease_cases ORDER BY disease');
    const territories = utRows.map(r => r.union_territory).filter(n => n !== 'Ladakh');
    res.json({ unionTerritories: territories, diseases: diseaseRows.map(r => r.disease), ownershipCategories: ['All', 'Public', 'Private'], areaCategories: ['All', 'Urban', 'Rural'], yearRange: { min: MIN_YEAR, max: MAX_YEAR }, dataYears: [2021, 2022, 2023, 2024, 2025] });
  } catch (err) { res.status(500).json({ error: 'Could not load filter options. Check MySQL setup and database import.' }); }
});

function getCategorySelection(req, res) {
  const ownershipCategory = String(req.query.ownershipCategory || 'All');
  const areaCategory = String(req.query.areaCategory || 'All');
  if (!['All', 'Public', 'Private'].includes(ownershipCategory)) {
    res.status(400).json({ error: 'Please select a valid Ownership Category.' });
    return null;
  }
  if (!['All', 'Urban', 'Rural'].includes(areaCategory)) {
    res.status(400).json({ error: 'Please select a valid Area Category.' });
    return null;
  }
  if (ownershipCategory !== 'All' && areaCategory !== 'All') {
    res.status(422).json({
      error: 'Combined Ownership + Area data is not available in the source dataset. Select a specific Ownership OR Area category, and set the other filter to All.'
    });
    return null;
  }
  return ownershipCategory !== 'All' ? ownershipCategory : areaCategory;
}

async function buildDashboard(req, res, years, mode) {
  const unionTerritory = String(req.query.unionTerritory || 'All');
  const disease = String(req.query.disease || 'All');
  const selectedCategory = getCategorySelection(req, res);
  if (selectedCategory === null) return;

  try {
    const placeholders = years.map(() => '?').join(', ');
    const [availabilityRows] = await pool.query(
      `SELECT year, COUNT(*) AS recordCount FROM disease_cases WHERE year IN (${placeholders}) GROUP BY year`, years
    );
    const availableYears = new Set(availabilityRows.filter(row => Number(row.recordCount) > 0).map(row => Number(row.year)));
    const missingYears = years.filter(year => !availableYears.has(year));
    if (missingYears.length) {
      return res.status(404).json({ error: missingYears.map(year => `Data not found for ${year}. Please add the dataset for this year.`).join(' '), missingYears });
    }

    let where = `year IN (${placeholders})`;
    const params = [...years];
    if (unionTerritory !== 'All') { where += ' AND union_territory = ?'; params.push(unionTerritory); }
    if (disease !== 'All') { where += ' AND disease = ?'; params.push(disease); }
    where += ' AND category = ?'; params.push(selectedCategory);

    const [rows] = await pool.query(
      `SELECT union_territory, year, disease, SUM(cases) AS cases FROM disease_cases WHERE ${where} GROUP BY union_territory, year, disease ORDER BY disease, year`, params
    );
    if (!rows.length) return res.status(404).json({ error: 'No matching disease records found for the selected years and filters.' });
    const yearsWithFilteredRecords = new Set(rows.map(row => Number(row.year)));
    const filteredMissingYears = years.filter(year => !yearsWithFilteredRecords.has(year));
    if (filteredMissingYears.length) return res.status(404).json({ error: `No matching disease records found for ${filteredMissingYears.join(' and ')} with the selected filters.`, missingYears: filteredMissingYears });

    if (mode === 'five-year') {
      const diseaseMap = new Map();
      const totals = Object.fromEntries(years.map(year => [year, 0]));
      for (const row of rows) {
        const year = Number(row.year), cases = Number(row.cases);
        totals[year] += cases;
        if (!diseaseMap.has(row.disease)) diseaseMap.set(row.disease, { disease: row.disease, values: Object.fromEntries(years.map(y => [y, 0])) });
        diseaseMap.get(row.disease).values[year] += cases;
      }
      const comparisons = [...diseaseMap.values()].map(item => ({ ...item, total: years.reduce((sum, year) => sum + item.values[year], 0) }));
      const topByYear = Object.fromEntries(years.map(year => [year, [...comparisons].sort((a,b) => b.values[year] - a.values[year]).slice(0,5).map(item => ({ disease: item.disease, cases: item.values[year] }))]));
      const [tableRows] = await pool.query(`SELECT union_territory, disease, year, SUM(cases) AS cases FROM disease_cases WHERE ${where} GROUP BY union_territory, disease, year ORDER BY disease, union_territory, year`, params);
      return res.json({ mode: 'five-year', years, filters: { unionTerritory, disease, ownershipCategory: req.query.ownershipCategory || 'All', areaCategory: req.query.areaCategory || 'All' }, totals, comparisons, topByYear, tableRows });
    }

    const diseaseMap = new Map();
    for (const row of rows) {
      if (!diseaseMap.has(row.disease)) diseaseMap.set(row.disease, { disease: row.disease, oldCases: 0, newCases: 0, oldRows: 0, newRows: 0 });
      const item = diseaseMap.get(row.disease);
      if (Number(row.year) === years[0]) { item.oldCases += Number(row.cases); item.oldRows++; }
      if (Number(row.year) === years[1]) { item.newCases += Number(row.cases); item.newRows++; }
    }
    const comparisons = [...diseaseMap.values()].map(d => ({ ...d, difference: d.newCases - d.oldCases, growthPercent: d.oldCases === 0 ? null : Number((((d.newCases - d.oldCases) / d.oldCases) * 100).toFixed(2)) }));
    const oldTotal = comparisons.reduce((sum, d) => sum + d.oldCases, 0);
    const newTotal = comparisons.reduce((sum, d) => sum + d.newCases, 0);
    const highest = [...comparisons].sort((a,b) => b.newCases - a.newCases)[0];
    const topOld = [...comparisons].sort((a,b) => b.oldCases - a.oldCases).slice(0,5);
    const topNew = [...comparisons].sort((a,b) => b.newCases - a.newCases).slice(0,5);
    const [tableRows] = await pool.query(`SELECT union_territory, disease, year, SUM(cases) AS cases FROM disease_cases WHERE ${where} GROUP BY union_territory, disease, year ORDER BY disease, union_territory, year`, params);
    return res.json({ filters: { unionTerritory, disease, ownershipCategory: req.query.ownershipCategory || 'All', areaCategory: req.query.areaCategory || 'All', oldPeriod: years[0], newPeriod: years[1] }, summary: { oldTotal, newTotal, difference: newTotal-oldTotal, growthPercent: oldTotal === 0 ? null : Number((((newTotal-oldTotal)/oldTotal)*100).toFixed(2)), highestDisease: highest ? highest.disease : 'N/A' }, comparisons, topOld, topNew, tableRows });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Could not load dashboard data. Check database connection and disease_cases table.' });
  }
}

app.get('/api/dashboard', async (req, res) => {
  const oldYear = parseYear(req.query.oldPeriod || '');
  const newYear = parseYear(req.query.newPeriod || '');
  if (!oldYear || !newYear) return res.status(400).json({ error: 'Please select valid years from 2021 to 2030.' });
  if (oldYear === newYear) return res.status(400).json({ error: 'Please select two different years for comparison.' });
  return buildDashboard(req, res, [oldYear, newYear], 'two-year');
});

app.get('/api/five-year-dashboard', async (req, res) => {
  return buildDashboard(req, res, [2021, 2022, 2023, 2024, 2025], 'five-year');
});

const port = Number(process.env.PORT || 5000);

async function startServer() {
  try {
    await pool.query('SELECT 1');
    console.log('\x1b[32m%s\x1b[0m', '✓ MySQL Database Connected Successfully');

    app.listen(port, () => {
      console.log('\x1b[32m%s\x1b[0m', `✓ Server running at http://localhost:${port}`);
    });
  } catch (error) {
    console.error('\x1b[31m%s\x1b[0m', '✗ MySQL Database Connection Failed');
    console.error(error.message);
    process.exit(1);
  }
}

startServer();
