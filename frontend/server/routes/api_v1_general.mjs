import express from 'express';

const router = express.Router();

const HR_REPORTS = [
  { key: 'attendance_summary', title: 'Attendance Summary', available: true },
  { key: 'headcount', title: 'Headcount & Movement', available: true },
  { key: 'payroll_register', title: 'Payroll Register', available: true },
  { key: 'leave_register', title: 'Leave Register', available: true },
  { key: 'overtime', title: 'Overtime Summary', available: true },
  { key: 'leave_balances', title: 'Leave Balances', available: true },
  { key: 'shift_coverage', title: 'Shift Coverage', available: true },
  { key: 'employees', title: 'Staff Directory', available: true },
];

function humanize(str = '') {
  return String(str)
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── 1. Training & Certifications ──────────────────────────────────────────
router.get('/training/matrix', (req, res) => {
  return res.json({
    programs: [],
    rows: [],
    gaps: 0,
  });
});

router.get('/training/programs', (req, res) => res.json([]));
router.post('/training/programs', (req, res) => {
  const b = req.body || {};
  return res.status(201).json({
    id: `PRG-${Date.now()}`,
    code: b.code || 'BLS',
    title: b.title || 'Basic Life Support',
    category: b.category || 'bls',
    validity_months: b.validity_months ? Number(b.validity_months) : 24,
    mandatory_for: b.mandatory_for || [],
    pass_score: b.pass_score ? Number(b.pass_score) : null,
  });
});

router.get('/training/sessions', (req, res) => res.json([]));
router.post('/training/sessions', (req, res) => {
  const b = req.body || {};
  return res.status(201).json({
    id: `SES-${Date.now()}`,
    program_id: b.program_id,
    program: 'Training Session',
    category: 'bls',
    starts_at: b.starts_at || new Date().toISOString(),
    ends_at: b.ends_at || new Date().toISOString(),
    location: b.location || null,
    trainer: b.trainer || null,
    capacity: b.capacity || null,
    enrolled: 0,
    status: 'scheduled',
  });
});

router.get('/training/sessions/:id/enrollments', (req, res) => res.json([]));
router.post('/training/sessions/:id/enroll', (req, res) => {
  const ids = req.body?.employee_ids || [];
  return res.json({ enrolled: ids.length });
});
router.post('/training/enrollments/:id/result', (req, res) => {
  return res.json({
    id: req.params.id,
    status: req.body?.status || 'passed',
    score: req.body?.score ?? 100,
  });
});

router.get('/training/certifications', (req, res) => res.json([]));
router.post('/training/certifications', (req, res) => {
  return res.status(201).json({
    id: `CERT-${Date.now()}`,
    expires_on: null,
  });
});

// ── 2. Reports & Analytics ────────────────────────────────────────────────
router.get('/reports/hr', (req, res) => res.json(HR_REPORTS));
router.get('/reports/hr/runs', (req, res) => res.json([]));
router.post('/reports/hr/schedules', (req, res) => {
  return res.status(201).json({
    id: `SCHED-${Date.now()}`,
    report: req.body?.report,
    frequency: req.body?.frequency || 'weekly',
    status: 'scheduled',
  });
});

router.get('/reports/hr/:key/export.csv', (req, res) => {
  const key = req.params.key;
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${key}.csv"`);
  res.send('Employee ID,Employee Name,Department,Designation,Status\n');
});

router.get('/reports/hr/:key', (req, res) => {
  const key = req.params.key;
  const rep = HR_REPORTS.find((r) => r.key === key);
  return res.json({
    key,
    title: rep ? rep.title : humanize(key),
    filters: req.query || {},
    columns: [
      { key: 'employee_id', label: 'Employee ID' },
      { key: 'name', label: 'Employee Name' },
      { key: 'department', label: 'Department' },
      { key: 'designation', label: 'Designation' },
      { key: 'status', label: 'Status' },
    ],
    rows: [],
    generated_at: new Date().toISOString(),
  });
});

// ── 3. Performance ────────────────────────────────────────────────────────
router.get('/performance/reviews', (req, res) => res.json([]));
router.get('/performance/cycles', (req, res) => res.json([]));
router.post('/performance/cycles', (req, res) => {
  const b = req.body || {};
  return res.status(201).json({
    id: `CYC-${Date.now()}`,
    name: b.name || 'Annual Review',
    status: 'active',
  });
});
router.post('/performance/reviews/:id/submit', (req, res) => {
  return res.json({ id: req.params.id, status: 'completed' });
});

// ── 4. Compliance ─────────────────────────────────────────────────────────
router.get('/compliance/alerts', (req, res) => res.json([]));
router.get('/compliance/records', (req, res) => res.json([]));
router.post('/compliance/scan', (req, res) => {
  return res.json({ compliant: 0, expiring: 0, non_compliant: 0, new_alerts: 0 });
});
router.post('/compliance/alerts/:id/acknowledge', (req, res) => {
  return res.json({ id: req.params.id, status: 'acknowledged' });
});

// ── 5. Workforce & Staffing ───────────────────────────────────────────────
router.get('/workforce/coverage/live', (req, res) => {
  return res.json({ rows: [], total_shortage: 0, census_error: null });
});
router.get('/workforce/coverage', (req, res) => {
  return res.json({ rows: [], total_shortage: 0 });
});
router.get('/workforce/shifts', (req, res) => res.json([]));
router.get('/workforce/requirements', (req, res) => res.json([]));
router.post('/workforce/requirements', (req, res) => {
  return res.status(201).json({ id: `REQ-${Date.now()}`, ...req.body });
});
router.get('/workforce/allocations', (req, res) => res.json([]));
router.post('/workforce/allocations', (req, res) => {
  return res.status(201).json({ id: `ALC-${Date.now()}`, ...req.body });
});
router.get('/workforce/handovers', (req, res) => res.json([]));

// ── 6. Recruitment & Vacancies ────────────────────────────────────────────
router.get('/recruitment/requisitions', (req, res) => res.json([]));
router.post('/recruitment/requisitions', (req, res) => {
  return res.status(201).json({ id: `REQ-${Date.now()}`, code: `REQ-${Date.now().toString().slice(-4)}`, status: 'submitted', ...req.body });
});
router.get('/recruitment/vacancies', (req, res) => res.json([]));
router.post('/recruitment/vacancies', (req, res) => {
  return res.status(201).json({ id: `VAC-${Date.now()}`, status: 'open', ...req.body });
});
router.get('/recruitment/candidates', (req, res) => res.json([]));
router.get('/recruitment/applications', (req, res) => res.json([]));

// ── 7. Attendance & Punches ───────────────────────────────────────────────
router.get('/attendance/live', (req, res) => {
  return res.json({ date: new Date().toISOString().split('T')[0], total: 0, records: [] });
});
router.get('/attendance/daily', (req, res) => {
  return res.json({ items: [], total: 0, page: 1, page_size: 50, pages: 1, summary: {} });
});
router.get('/attendance/devices', (req, res) => res.json([]));
router.get('/attendance/punches', (req, res) => {
  return res.json({ items: [], total: 0, page: 1, page_size: 50, pages: 1 });
});
router.get('/attendance/integrations', (req, res) => res.json([]));
router.get('/attendance/mappings', (req, res) => res.json([]));
router.get('/attendance/unmapped', (req, res) => res.json([]));
router.get('/attendance/sync-logs', (req, res) => {
  return res.json({ items: [], total: 0, page: 1, page_size: 25, pages: 1 });
});
router.get('/attendance/exceptions', (req, res) => {
  return res.json({ items: [], total: 0, page: 1, page_size: 50, pages: 1 });
});
router.get('/attendance/corrections', (req, res) => res.json([]));
router.get('/attendance/overtime', (req, res) => res.json([]));

// ── 8. Leave & Self-Service ───────────────────────────────────────────────
router.get('/leave/balances', (req, res) => res.json([]));
router.get('/leave/policies', (req, res) => res.json([]));
router.get('/leave/types', (req, res) => res.json([]));
router.get('/leave/requests', (req, res) => res.json([]));

// ── 9. Notifications ──────────────────────────────────────────────────────
router.get('/me/notifications', (req, res) => res.json([]));

export default router;
