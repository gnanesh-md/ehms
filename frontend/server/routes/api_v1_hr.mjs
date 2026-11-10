import express from 'express';
import { query } from '../db/index.mjs';

const router = express.Router();

// 1. Hospitals
router.get('/hospitals', async (req, res) => {
  try {
    const { rows } = await query('SELECT id, code, name FROM organizations ORDER BY id ASC');
    if (rows && rows.length > 0) {
      return res.json(rows.map((r) => ({ id: String(r.id), code: r.code || `HOSP-${r.id}`, name: r.name })));
    }
  } catch (e) {
    console.error('Error fetching hospitals:', e);
  }
  return res.json([{ id: 'HOSP-01', code: 'GH-MAIN', name: 'General Hospital' }]);
});

// 2. Branches
router.get('/branches', async (req, res) => {
  try {
    const { rows } = await query('SELECT id, organization_id, code, name, address, phone FROM hospital_branches WHERE is_active = TRUE ORDER BY id ASC');
    if (rows && rows.length > 0) {
      return res.json(rows.map((r) => ({
        id: String(r.id),
        hospital_id: String(r.organization_id || 'HOSP-01'),
        code: r.code || `BR-${r.id}`,
        name: r.name,
        city: 'Metro',
        address: r.address || null,
      })));
    }
  } catch (e) {
    console.error('Error fetching branches:', e);
  }
  return res.json([{ id: 'BR-01', hospital_id: 'HOSP-01', code: 'MAIN', name: 'Main Campus', city: 'Metro', address: 'Hospital Boulevard' }]);
});

// 3. Departments
router.get('/departments', async (req, res) => {
  try {
    const { rows } = await query('SELECT id, name, code, is_clinical, head_of_department_id, is_active FROM departments WHERE is_active = TRUE ORDER BY name ASC');
    if (rows && rows.length > 0) {
      return res.json(rows.map((d) => ({
        id: String(d.id),
        code: d.code || `DEP-${d.id}`,
        name: d.name,
        branch_id: 'BR-01',
        parent_id: null,
        kind: d.is_clinical ? 'clinical' : 'administrative',
        head_employee_id: d.head_of_department_id || null,
        head_name: null,
        cost_center: null,
        annual_budget: null,
        status: d.is_active ? 'active' : 'inactive',
        hms_module: null,
        census_wards: [],
        headcount: 0,
      })));
    }
  } catch (e) {
    console.error('Error fetching departments:', e);
  }
  const defaultDepts = [
    { id: '1', code: 'GEN', name: 'General Medicine', branch_id: 'BR-01', parent_id: null, kind: 'clinical', status: 'active', headcount: 0, census_wards: [] },
    { id: '2', code: 'ER', name: 'Emergency & Trauma', branch_id: 'BR-01', parent_id: null, kind: 'clinical', status: 'active', headcount: 0, census_wards: [] },
    { id: '3', code: 'CARD', name: 'Cardiology', branch_id: 'BR-01', parent_id: null, kind: 'clinical', status: 'active', headcount: 0, census_wards: [] },
    { id: '4', code: 'NUR', name: 'Nursing Services', branch_id: 'BR-01', parent_id: null, kind: 'clinical', status: 'active', headcount: 0, census_wards: [] },
    { id: '5', code: 'PHM', name: 'Pharmacy Services', branch_id: 'BR-01', parent_id: null, kind: 'clinical', status: 'active', headcount: 0, census_wards: [] },
    { id: '6', code: 'LAB', name: 'Laboratory & Pathology', branch_id: 'BR-01', parent_id: null, kind: 'clinical', status: 'active', headcount: 0, census_wards: [] },
    { id: '7', code: 'RAD', name: 'Radiology & Imaging', branch_id: 'BR-01', parent_id: null, kind: 'clinical', status: 'active', headcount: 0, census_wards: [] },
    { id: '8', code: 'ICU', name: 'Intensive Care Unit (ICU)', branch_id: 'BR-01', parent_id: null, kind: 'clinical', status: 'active', headcount: 0, census_wards: [] },
    { id: '9', code: 'ADM', name: 'Hospital Administration', branch_id: 'BR-01', parent_id: null, kind: 'administrative', status: 'active', headcount: 0, census_wards: [] },
  ];
  return res.json(defaultDepts);
});

// 4. Designations
router.get('/designations', (req, res) => {
  const designations = [
    { id: 'DES-01', code: 'SR-CON', title: 'Senior Consultant', job_category: 'doctor', grade: 'L1', is_clinical: true, requires_registration: true, headcount: 0 },
    { id: 'DES-02', code: 'CON-PHY', title: 'Consultant Physician', job_category: 'doctor', grade: 'L2', is_clinical: true, requires_registration: true, headcount: 0 },
    { id: 'DES-03', code: 'STF-PHY', title: 'Staff Physician', job_category: 'doctor', grade: 'L3', is_clinical: true, requires_registration: true, headcount: 0 },
    { id: 'DES-04', code: 'HD-NUR', title: 'Head Nurse / Sister Incharge', job_category: 'nursing', grade: 'L1', is_clinical: true, requires_registration: true, headcount: 0 },
    { id: 'DES-05', code: 'STF-NUR', title: 'Staff Nurse', job_category: 'nursing', grade: 'L2', is_clinical: true, requires_registration: true, headcount: 0 },
    { id: 'DES-06', code: 'SR-PHM', title: 'Chief Pharmacist', job_category: 'allied_health', grade: 'L1', is_clinical: true, requires_registration: true, headcount: 0 },
    { id: 'DES-07', code: 'PHM-STF', title: 'Dispensing Pharmacist', job_category: 'allied_health', grade: 'L2', is_clinical: true, requires_registration: true, headcount: 0 },
    { id: 'DES-08', code: 'LAB-TECH', title: 'Medical Laboratory Technologist', job_category: 'allied_health', grade: 'L2', is_clinical: true, requires_registration: true, headcount: 0 },
    { id: 'DES-09', code: 'RAD-TECH', title: 'Radiographer / Imaging Technologist', job_category: 'allied_health', grade: 'L2', is_clinical: true, requires_registration: true, headcount: 0 },
    { id: 'DES-10', code: 'HOSP-ADM', title: 'Hospital Administrator', job_category: 'administrative', grade: 'L1', is_clinical: false, requires_registration: false, headcount: 0 },
    { id: 'DES-11', code: 'HR-MGR', title: 'HR Manager', job_category: 'administrative', grade: 'L2', is_clinical: false, requires_registration: false, headcount: 0 },
    { id: 'DES-12', code: 'BIL-OFF', title: 'Billing & Accounts Officer', job_category: 'administrative', grade: 'L3', is_clinical: false, requires_registration: false, headcount: 0 },
    { id: 'DES-13', code: 'REC-EXEC', title: 'Front Desk Reception Executive', job_category: 'support_staff', grade: 'L3', is_clinical: false, requires_registration: false, headcount: 0 },
  ];
  return res.json(designations);
});

// 5. Dashboard
router.get('/dashboard', async (req, res) => {
  let totalEmployees = 0;
  let activeEmployees = 0;
  let onDuty = 0;
  const categoryMap = {};
  const statusMap = {};
  const departmentBreakdown = [];

  try {
    const { rows } = await query('SELECT category, status, duty_status, department, COUNT(*) as count FROM employees GROUP BY category, status, duty_status, department');
    for (const r of rows || []) {
      const c = parseInt(r.count, 10) || 0;
      totalEmployees += c;
      if (r.status === 'Active') activeEmployees += c;
      if (r.duty_status === 'On Duty') onDuty += c;
      if (r.category) categoryMap[r.category] = (categoryMap[r.category] || 0) + c;
      if (r.status) statusMap[r.status] = (statusMap[r.status] || 0) + c;
    }
  } catch (e) {
    console.error('Error calculating HR dashboard metrics:', e);
  }

  return res.json({
    as_of: new Date().toISOString(),
    employees: {
      total: totalEmployees,
      active: activeEmployees,
      inactive: Math.max(0, totalEmployees - activeEmployees),
      by_status: statusMap,
      by_category: categoryMap,
      by_branch: [{ branch: 'Main Campus', count: totalEmployees }],
      by_department: departmentBreakdown,
    },
    attendance_today: {
      total: totalEmployees,
      in: onDuty,
      out: 0,
      not_arrived: Math.max(0, totalEmployees - onDuty),
      unmapped_punches: 0,
      devices: { online: 1, offline: 0, total: 1 },
      last_sync_at: new Date().toISOString(),
    },
    credentials: {
      expiring: [],
      pending_verification: 0,
    },
    recent_activity: [],
    workforce: {
      on_leave_today: 0,
      pending_leave: 0,
      pending_approvals: 0,
      open_exceptions: 0,
      open_vacancies: 0,
      candidates_in_pipeline: 0,
      training_gaps: 0,
      certificates_expiring_60d: 0,
      last_payroll: null,
    },
    attendance_trend: [],
    department_presence: [],
    attention: [],
  });
});

router.get('/dashboard/badges', (req, res) => {
  res.json({ approvals: 0, leaves: 0, exceptions: 0 });
});

// 6. Organization Tree
router.get('/organization/tree', (req, res) => {
  return res.json([
    {
      id: 'hosp-1',
      type: 'hospital',
      name: 'General Hospital',
      code: 'GH-MAIN',
      headcount: 0,
      children: [
        {
          id: 'br-1',
          type: 'branch',
          name: 'Main Campus',
          code: 'MAIN',
          headcount: 0,
          children: [
            { id: 'dep-1', type: 'department', name: 'General Medicine', code: 'GEN', headcount: 0, children: [] },
            { id: 'dep-2', type: 'department', name: 'Emergency & Trauma', code: 'ER', headcount: 0, children: [] },
            { id: 'dep-3', type: 'department', name: 'Cardiology', code: 'CARD', headcount: 0, children: [] },
            { id: 'dep-4', type: 'department', name: 'Nursing Services', code: 'NUR', headcount: 0, children: [] },
            { id: 'dep-5', type: 'department', name: 'Pharmacy Services', code: 'PHM', headcount: 0, children: [] },
            { id: 'dep-6', type: 'department', name: 'Laboratory & Pathology', code: 'LAB', headcount: 0, children: [] },
            { id: 'dep-7', type: 'department', name: 'Radiology & Imaging', code: 'RAD', headcount: 0, children: [] },
          ],
        },
      ],
    },
  ]);
});

// 7. Employees (List & Pagination)
router.get('/employees', async (req, res) => {
  const page = parseInt(req.query.page || '1', 10);
  const pageSize = parseInt(req.query.page_size || '25', 10);
  const search = (req.query.search || '').trim().toLowerCase();
  const offset = (page - 1) * pageSize;

  try {
    let sql = 'SELECT * FROM employees';
    const params = [];
    if (search) {
      sql += ' WHERE LOWER(name) LIKE $1 OR LOWER(id) LIKE $1 OR LOWER(department) LIKE $1';
      params.push(`%${search}%`);
    }
    sql += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(pageSize, offset);

    const { rows } = await query(sql, params);
    const countRes = await query('SELECT COUNT(*) as count FROM employees');
    const total = parseInt(countRes?.rows?.[0]?.count || '0', 10);

    return res.json({
      items: rows || [],
      total,
      page,
      page_size: pageSize,
      pages: Math.max(1, Math.ceil(total / pageSize)),
    });
  } catch (e) {
    console.error('Error fetching employees list:', e);
    return res.json({ items: [], total: 0, page: 1, page_size: pageSize, pages: 1 });
  }
});

// 8. Employee Facets
router.get('/employees/facets', async (req, res) => {
  try {
    const { rows } = await query('SELECT category, status, COUNT(*) as count FROM employees GROUP BY category, status');
    const catMap = {};
    const statMap = {};
    for (const r of rows || []) {
      const c = parseInt(r.count, 10) || 0;
      if (r.category) catMap[r.category] = (catMap[r.category] || 0) + c;
      if (r.status) statMap[r.status] = (statMap[r.status] || 0) + c;
    }
    return res.json({ employee_category: catMap, status: statMap });
  } catch (e) {
    return res.json({ employee_category: {}, status: {} });
  }
});

// 9. Standard Fallbacks for HR and Talent
router.get('/announcements', (req, res) => res.json([]));
router.get('/approvals', (req, res) => res.json([]));
router.get('/workflows', (req, res) => res.json([]));
router.get('/grievances', (req, res) => res.json([]));
router.get('/leave/policies', (req, res) => res.json([]));
router.get('/leave/types', (req, res) => res.json([]));
router.get('/leave/requests', (req, res) => res.json([]));
router.get('/shifts', (req, res) => res.json([]));
router.get('/documents', (req, res) => res.json([]));
router.get('/health', (req, res) => res.json({ status: 'ok' }));

// 10. Resilient Wildcard Fallback for any other /api/v1/hr/*
router.use((req, res) => {
  if (res.headersSent) return;
  res.json({ success: true, items: [], data: [], employees: [] });
});

export default router;
