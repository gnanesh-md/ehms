from flask import Blueprint, request, jsonify, g
from werkzeug.exceptions import BadRequest
from shared.session_auth import require_permissions
from shared.audit import log_audit_event
from shared.responses import (
    row_to_dict,
    rows_to_dicts,
    validate_required_fields,
)
from shared.hospital import (
    current_hospital_id,
    normalize_department_name,
)
from core.auth import (
    signup_employee,
    resolve_user_permissions,
    authorize_employee_access_change,
)
from utils.database import (
    get_all_employees,
    get_employee,
    update_employee,
    list_attendance,
    get_employee_stats,
    search_employees,
    delete_employee,
    activate_employee,
    deactivate_employee,
    list_departments,
    create_department,
    update_department,
    delete_department,
    create_attendance,
    update_attendance_record,
    delete_attendance_record,
    list_payroll,
    create_payroll_record,
    update_payroll_record,
    delete_payroll_record,
    list_leave_requests,
    create_leave_request,
    delete_leave_request,
    update_leave_status,
)

hr_bp = Blueprint("hr", __name__)


@hr_bp.get("/api/employees")
@require_permissions("employees.read")
def employees_list():
    employees = get_all_employees(hospital_id=current_hospital_id())
    return jsonify({"employees": rows_to_dicts(employees)})


# Creating brand-new accounts stays strictly admin-only -- unlike editing an
# existing employee's access (see employees_detail's PUT branch below, which
# is clamped via authorize_employee_access_change), account creation has no
# pre-existing row to clamp against, so it's the highest-risk operation to
# hand to a non-admin "employees" module grant. Not part of this redesign's
# scope.
@hr_bp.post("/api/employees")
@require_permissions("admin.use")
def employees_create():
    payload = request.get_json(force=True)
    result = signup_employee(
        payload, allow_admin_creation=True, hospital_id=current_hospital_id()
    )
    status = 201 if result.get("success") else 400
    return jsonify(result), status


@hr_bp.get("/api/employees/stats")
@require_permissions("employees.read")
def employees_stats():
    return jsonify(get_employee_stats(hospital_id=current_hospital_id()))


@hr_bp.get("/api/employees/search")
@require_permissions("employees.read")
def employees_search():
    query = request.args.get("q")
    if not query:
        return jsonify({"employees": []})
    employees = search_employees(query, hospital_id=current_hospital_id())
    return jsonify({"employees": rows_to_dicts(employees)})


_ACCESS_FIELDS = ("user_type", "access_role", "module_access", "role_key")


@hr_bp.route("/api/employees/<employee_id>", methods=["GET", "PUT", "DELETE"])
@require_permissions("employees.read")
def employees_detail(employee_id):
    hospital_id = current_hospital_id()
    if request.method == "GET":
        employee = get_employee(employee_id=employee_id, hospital_id=hospital_id)
        if not employee:
            return jsonify({"error": "Employee not found"}), 404
        return jsonify({"employee": row_to_dict(employee)})

    if request.method == "PUT":
        user_permissions = resolve_user_permissions(g.current_user)
        payload = request.get_json(force=True)
        wants_access_change = any(field in payload for field in _ACCESS_FIELDS)

        if wants_access_change:
            # Changing user_type/access_role/module_access is a distinct,
            # higher-privilege action from editing name/email/phone/etc --
            # requires its own permission, separately grantable from basic
            # profile editing.
            if "employees.access.write" not in user_permissions:
                return (
                    jsonify(
                        {
                            "error": "Forbidden",
                            "required_permissions": ["employees.access.write"],
                        }
                    ),
                    403,
                )
            ok, error = authorize_employee_access_change(
                payload.get("user_type"), payload.get("module_access"), g.current_user
            )
            if not ok:
                return jsonify({"error": error}), 403
        elif "employees.profile.write" not in user_permissions:
            return (
                jsonify(
                    {
                        "error": "Forbidden",
                        "required_permissions": ["employees.profile.write"],
                    }
                ),
                403,
            )

        updated = update_employee(employee_id, payload, hospital_id=hospital_id)
        if not updated:
            return jsonify({"error": "Employee not found"}), 404
        return jsonify({"status": "ok"})

    # DELETE -- destructive/irreversible, stays admin-only like creation.
    user_permissions = resolve_user_permissions(g.current_user)
    if "admin.use" not in user_permissions:
        return (
            jsonify({"error": "Forbidden", "required_permissions": ["admin.use"]}),
            403,
        )
    # Scoped to the caller's hospital like GET/PUT above. Without it the helper
    # fell back to the default hospital: another tenant's admin could delete its
    # staff, and a non-default tenant could not delete its own.
    deleted = delete_employee(employee_id, hospital_id=hospital_id)
    if not deleted:
        return jsonify({"error": "Employee not found"}), 404
    return jsonify({"status": "ok"})


@hr_bp.post("/api/employees/<employee_id>/activate")
@require_permissions("employees.profile.write")
def employees_activate(employee_id):
    activated = activate_employee(employee_id, hospital_id=current_hospital_id())
    if not activated:
        return jsonify({"error": "Employee not found"}), 404
    return jsonify({"status": "active"})


@hr_bp.post("/api/employees/<employee_id>/deactivate")
@require_permissions("employees.profile.write")
def employees_deactivate(employee_id):
    deactivated = deactivate_employee(employee_id, hospital_id=current_hospital_id())
    if not deactivated:
        return jsonify({"error": "Employee not found"}), 404
    return jsonify({"status": "inactive"})


@hr_bp.get("/api/hr/departments")
@require_permissions("hr.read")
def hr_departments_list():
    return jsonify(
        {
            "departments": rows_to_dicts(
                list_departments(hospital_id=current_hospital_id())
            )
        }
    )


@hr_bp.post("/api/hr/departments")
@require_permissions("hr.departments.write")
def hr_departments_create():
    payload = request.get_json(force=True)
    try:
        department_name = normalize_department_name(payload.get("department_name"))
    except BadRequest as error:
        return jsonify({"error": str(error)}), 400

    existing = next(
        (
            row
            for row in rows_to_dicts(
                list_departments(hospital_id=current_hospital_id())
            )
            if (row.get("department_name") or "").strip().lower()
            == department_name.lower()
        ),
        None,
    )
    if existing:
        return jsonify(
            {
                "department_id": existing.get("id"),
                "department_name": existing.get("department_name"),
                "already_exists": True,
            }
        )

    department_id = create_department(
        {
            "department_name": department_name,
            "mapped_head_employee_id": payload.get("mapped_head_employee_id"),
        },
        hospital_id=current_hospital_id(),
    )
    log_audit_event(
        "create",
        "departments",
        str(department_id),
        {"department_name": department_name},
    )
    return jsonify({"department_id": department_id})


@hr_bp.put("/api/hr/departments/<int:department_id>")
@require_permissions("hr.departments.write")
def hr_departments_update(department_id):
    payload = request.get_json(force=True)
    if "department_name" in payload:
        try:
            payload["department_name"] = normalize_department_name(
                payload.get("department_name")
            )
        except BadRequest as error:
            return jsonify({"error": str(error)}), 400

        duplicate = next(
            (
                row
                for row in rows_to_dicts(
                    list_departments(hospital_id=current_hospital_id())
                )
                if row.get("id") != department_id
                and (row.get("department_name") or "").strip().lower()
                == payload["department_name"].lower()
            ),
            None,
        )
        if duplicate:
            return jsonify({"error": "Department already exists"}), 409

    updated = update_department(
        department_id, payload, hospital_id=current_hospital_id()
    )
    if not updated:
        return jsonify({"error": "Department not found"}), 404
    log_audit_event(
        "update", "departments", str(department_id), {"department_id": department_id}
    )
    return jsonify({"status": "ok"})


@hr_bp.delete("/api/hr/departments/<int:department_id>")
@require_permissions("hr.departments.write")
def hr_departments_delete(department_id):
    deleted = delete_department(
        department_id,
        hospital_id=current_hospital_id(),
        actor=g.current_user.get("username"),
    )
    if not deleted:
        return jsonify({"error": "Department not found"}), 404
    log_audit_event(
        "delete", "departments", str(department_id), {"department_id": department_id}
    )
    return jsonify({"status": "ok"})


@hr_bp.get("/api/hr/attendance")
@require_permissions("hr.read")
def hr_attendance_list():
    employee_id = request.args.get("employee_id")
    return jsonify(
        {"attendance": rows_to_dicts(list_attendance(employee_id=employee_id))}
    )


@hr_bp.post("/api/hr/attendance")
@require_permissions("hr.attendance.write")
def hr_attendance_create():
    payload = request.get_json(force=True)
    validation_error = validate_required_fields(
        payload, ["employee_id", "attendance_date", "status"]
    )
    if validation_error:
        return validation_error
    attendance_id = create_attendance(payload)
    log_audit_event(
        "create",
        "attendance",
        str(attendance_id),
        {"employee_id": payload.get("employee_id")},
    )
    return jsonify({"attendance_id": attendance_id})


@hr_bp.put("/api/hr/attendance/<int:attendance_id>")
@require_permissions("hr.attendance.write")
def hr_attendance_update(attendance_id):
    payload = request.get_json(force=True)
    updated = update_attendance_record(attendance_id, payload)
    if not updated:
        return jsonify({"error": "Attendance record not found"}), 404
    log_audit_event(
        "update", "attendance", str(attendance_id), {"attendance_id": attendance_id}
    )
    return jsonify({"status": "ok"})


@hr_bp.delete("/api/hr/attendance/<int:attendance_id>")
@require_permissions("hr.attendance.write")
def hr_attendance_delete(attendance_id):
    deleted = delete_attendance_record(
        attendance_id, actor=g.current_user.get("username")
    )
    if not deleted:
        return jsonify({"error": "Attendance record not found"}), 404
    log_audit_event(
        "delete", "attendance", str(attendance_id), {"attendance_id": attendance_id}
    )
    return jsonify({"status": "ok"})


@hr_bp.get("/api/hr/payroll")
@require_permissions("hr.read")
def hr_payroll_list():
    employee_id = request.args.get("employee_id")
    return jsonify({"payroll": rows_to_dicts(list_payroll(employee_id=employee_id))})


@hr_bp.post("/api/hr/payroll")
@require_permissions("hr.payroll.write")
def hr_payroll_create():
    payload = request.get_json(force=True)
    validation_error = validate_required_fields(
        payload, ["employee_id", "payroll_month", "basic_salary"]
    )
    if validation_error:
        return validation_error
    payroll_id = create_payroll_record(payload)
    log_audit_event(
        "create",
        "payroll",
        str(payroll_id),
        {"employee_id": payload.get("employee_id")},
    )
    return jsonify({"payroll_id": payroll_id})


@hr_bp.put("/api/hr/payroll/<int:payroll_id>")
@require_permissions("hr.payroll.write")
def hr_payroll_update(payroll_id):
    payload = request.get_json(force=True)
    updated = update_payroll_record(payroll_id, payload)
    if not updated:
        return jsonify({"error": "Payroll record not found"}), 404
    log_audit_event("update", "payroll", str(payroll_id), {"payroll_id": payroll_id})
    return jsonify({"status": "ok"})


@hr_bp.delete("/api/hr/payroll/<int:payroll_id>")
@require_permissions("hr.payroll.write")
def hr_payroll_delete(payroll_id):
    deleted = delete_payroll_record(payroll_id, actor=g.current_user.get("username"))
    if not deleted:
        return jsonify({"error": "Payroll record not found"}), 404
    log_audit_event("delete", "payroll", str(payroll_id), {"payroll_id": payroll_id})
    return jsonify({"status": "ok"})


@hr_bp.get("/api/hr/leaves")
@require_permissions("hr.read")
def hr_leaves_list():
    employee_id = request.args.get("employee_id")
    return jsonify(
        {"leaves": rows_to_dicts(list_leave_requests(employee_id=employee_id))}
    )


@hr_bp.post("/api/hr/leaves")
@require_permissions("hr.leaves.write")
def hr_leaves_create():
    payload = request.get_json(force=True)
    validation_error = validate_required_fields(
        payload, ["employee_id", "leave_type", "start_date", "end_date"]
    )
    if validation_error:
        return validation_error
    leave_id = create_leave_request(payload)
    log_audit_event(
        "create",
        "leave_requests",
        str(leave_id),
        {"employee_id": payload.get("employee_id")},
    )
    return jsonify({"leave_id": leave_id})


@hr_bp.post("/api/hr/leaves/<int:leave_id>/status")
@require_permissions("hr.leaves.write")
def hr_leave_status_update(leave_id):
    payload = request.get_json(force=True)
    validation_error = validate_required_fields(payload, ["status"])
    if validation_error:
        return validation_error
    updated = update_leave_status(
        leave_id, payload.get("status", "pending"), g.current_user.get("username")
    )
    if not updated:
        return jsonify({"error": "Leave request not found"}), 404
    log_audit_event(
        "update", "leave_requests", str(leave_id), {"status": payload.get("status")}
    )
    return jsonify({"status": "ok"})


@hr_bp.delete("/api/hr/leaves/<int:leave_id>")
@require_permissions("hr.leaves.write")
def hr_leaves_delete(leave_id):
    deleted = delete_leave_request(leave_id, actor=g.current_user.get("username"))
    if not deleted:
        return jsonify({"error": "Leave request not found"}), 404
    log_audit_event("delete", "leave_requests", str(leave_id), {"leave_id": leave_id})
    return jsonify({"status": "ok"})


# ── API v1 HR & Organization Compatibility Endpoints ──────────
@hr_bp.get("/api/v1/hr/hospitals")
def get_v1_hr_hospitals():
    return jsonify([{"id": "HOSP-01", "code": "GH-MAIN", "name": "General Hospital"}])


@hr_bp.get("/api/v1/hr/branches")
def get_v1_hr_branches():
    return jsonify([{
        "id": "BR-01",
        "hospital_id": "HOSP-01",
        "code": "MAIN",
        "name": "Main Campus",
        "city": "Metro",
        "address": "Hospital Boulevard"
    }])


@hr_bp.get("/api/v1/hr/departments")
def get_v1_hr_departments():
    depts = [
        {"id": "1", "code": "GEN", "name": "General Medicine", "branch_id": "BR-01", "parent_id": None, "kind": "clinical", "status": "active", "headcount": 0, "census_wards": []},
        {"id": "2", "code": "ER", "name": "Emergency & Trauma", "branch_id": "BR-01", "parent_id": None, "kind": "clinical", "status": "active", "headcount": 0, "census_wards": []},
        {"id": "3", "code": "CARD", "name": "Cardiology", "branch_id": "BR-01", "parent_id": None, "kind": "clinical", "status": "active", "headcount": 0, "census_wards": []},
        {"id": "4", "code": "NUR", "name": "Nursing Services", "branch_id": "BR-01", "parent_id": None, "kind": "clinical", "status": "active", "headcount": 0, "census_wards": []},
        {"id": "5", "code": "PHM", "name": "Pharmacy Services", "branch_id": "BR-01", "parent_id": None, "kind": "clinical", "status": "active", "headcount": 0, "census_wards": []},
        {"id": "6", "code": "LAB", "name": "Laboratory & Pathology", "branch_id": "BR-01", "parent_id": None, "kind": "clinical", "status": "active", "headcount": 0, "census_wards": []},
        {"id": "7", "code": "RAD", "name": "Radiology & Imaging", "branch_id": "BR-01", "parent_id": None, "kind": "clinical", "status": "active", "headcount": 0, "census_wards": []},
        {"id": "8", "code": "ICU", "name": "Intensive Care Unit (ICU)", "branch_id": "BR-01", "parent_id": None, "kind": "clinical", "status": "active", "headcount": 0, "census_wards": []},
        {"id": "9", "code": "ADM", "name": "Hospital Administration", "branch_id": "BR-01", "parent_id": None, "kind": "administrative", "status": "active", "headcount": 0, "census_wards": []},
    ]
    return jsonify(depts)


@hr_bp.get("/api/v1/hr/designations")
def get_v1_hr_designations():
    designations = [
        {"id": "DES-01", "code": "SR-CON", "title": "Senior Consultant", "job_category": "doctor", "grade": "L1", "is_clinical": True, "requires_registration": True, "headcount": 0},
        {"id": "DES-02", "code": "CON-PHY", "title": "Consultant Physician", "job_category": "doctor", "grade": "L2", "is_clinical": True, "requires_registration": True, "headcount": 0},
        {"id": "DES-03", "code": "STF-PHY", "title": "Staff Physician", "job_category": "doctor", "grade": "L3", "is_clinical": True, "requires_registration": True, "headcount": 0},
        {"id": "DES-04", "code": "HD-NUR", "title": "Head Nurse / Sister Incharge", "job_category": "nursing", "grade": "L1", "is_clinical": True, "requires_registration": True, "headcount": 0},
        {"id": "DES-05", "code": "STF-NUR", "title": "Staff Nurse", "job_category": "nursing", "grade": "L2", "is_clinical": True, "requires_registration": True, "headcount": 0},
        {"id": "DES-06", "code": "SR-PHM", "title": "Chief Pharmacist", "job_category": "allied_health", "grade": "L1", "is_clinical": True, "requires_registration": True, "headcount": 0},
        {"id": "DES-07", "code": "PHM-STF", "title": "Dispensing Pharmacist", "job_category": "allied_health", "grade": "L2", "is_clinical": True, "requires_registration": True, "headcount": 0},
        {"id": "DES-08", "code": "LAB-TECH", "title": "Medical Laboratory Technologist", "job_category": "allied_health", "grade": "L2", "is_clinical": True, "requires_registration": True, "headcount": 0},
        {"id": "DES-09", "code": "RAD-TECH", "title": "Radiographer / Imaging Technologist", "job_category": "allied_health", "grade": "L2", "is_clinical": True, "requires_registration": True, "headcount": 0},
        {"id": "DES-10", "code": "HOSP-ADM", "title": "Hospital Administrator", "job_category": "administrative", "grade": "L1", "is_clinical": False, "requires_registration": False, "headcount": 0},
        {"id": "DES-11", "code": "HR-MGR", "title": "HR Manager", "job_category": "administrative", "grade": "L2", "is_clinical": False, "requires_registration": False, "headcount": 0},
        {"id": "DES-12", "code": "BIL-OFF", "title": "Billing & Accounts Officer", "job_category": "administrative", "grade": "L3", "is_clinical": False, "requires_registration": False, "headcount": 0},
        {"id": "DES-13", "code": "REC-EXEC", "title": "Front Desk Reception Executive", "job_category": "support_staff", "grade": "L3", "is_clinical": False, "requires_registration": False, "headcount": 0},
    ]
    return jsonify(designations)


@hr_bp.get("/api/v1/hr/dashboard")
def get_v1_hr_dashboard():
    from datetime import datetime, timezone
    return jsonify({
        "as_of": datetime.now(timezone.utc).isoformat(),
        "employees": {"total": 0, "active": 0, "inactive": 0, "by_status": {}, "by_category": {}, "by_branch": [{"branch": "Main Campus", "count": 0}], "by_department": []},
        "attendance_today": {"total": 0, "in": 0, "out": 0, "not_arrived": 0, "unmapped_punches": 0, "devices": {"online": 1, "offline": 0, "total": 1}, "last_sync_at": datetime.now(timezone.utc).isoformat()},
        "credentials": {"expiring": [], "pending_verification": 0},
        "recent_activity": [],
        "workforce": {"on_leave_today": 0, "pending_leave": 0, "pending_approvals": 0, "open_exceptions": 0, "open_vacancies": 0, "candidates_in_pipeline": 0, "training_gaps": 0, "certificates_expiring_60d": 0, "last_payroll": None},
        "attendance_trend": [],
        "department_presence": [],
        "attention": [],
    })


@hr_bp.get("/api/v1/hr/dashboard/badges")
def get_v1_hr_dashboard_badges():
    return jsonify({"approvals": 0, "leaves": 0, "exceptions": 0})


@hr_bp.get("/api/v1/hr/organization/tree")
def get_v1_hr_org_tree():
    return jsonify([{
        "id": "hosp-1",
        "type": "hospital",
        "name": "General Hospital",
        "code": "GH-MAIN",
        "headcount": 0,
        "children": [{
            "id": "br-1",
            "type": "branch",
            "name": "Main Campus",
            "code": "MAIN",
            "headcount": 0,
            "children": [
                {"id": "dep-1", "type": "department", "name": "General Medicine", "code": "GEN", "headcount": 0, "children": []},
                {"id": "dep-2", "type": "department", "name": "Emergency & Trauma", "code": "ER", "headcount": 0, "children": []},
                {"id": "dep-3", "type": "department", "name": "Cardiology", "code": "CARD", "headcount": 0, "children": []},
                {"id": "dep-4", "type": "department", "name": "Nursing Services", "code": "NUR", "headcount": 0, "children": []},
                {"id": "dep-5", "type": "department", "name": "Pharmacy Services", "code": "PHM", "headcount": 0, "children": []},
                {"id": "dep-6", "type": "department", "name": "Laboratory & Pathology", "code": "LAB", "headcount": 0, "children": []},
                {"id": "dep-7", "type": "department", "name": "Radiology & Imaging", "code": "RAD", "headcount": 0, "children": []},
            ]
        }]
    }])


@hr_bp.get("/api/v1/hr/employees")
def get_v1_hr_employees():
    return jsonify({
        "items": [],
        "total": 0,
        "page": 1,
        "page_size": 25,
        "pages": 1
    })


@hr_bp.get("/api/v1/hr/employees/facets")
def get_v1_hr_employees_facets():
    return jsonify({"employee_category": {}, "status": {}})


@hr_bp.get("/api/v1/me/notifications")
def get_v1_me_notifications():
    return jsonify([])


@hr_bp.route("/api/v1/hr/<path:subpath>", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
def v1_hr_catchall(subpath):
    return jsonify({"success": True, "items": [], "data": [], "employees": []})


HR_REPORTS_LIST = [
    {"key": "attendance_summary", "title": "Attendance Summary", "available": True},
    {"key": "headcount", "title": "Headcount & Movement", "available": True},
    {"key": "payroll_register", "title": "Payroll Register", "available": True},
    {"key": "leave_register", "title": "Leave Register", "available": True},
    {"key": "overtime", "title": "Overtime Summary", "available": True},
    {"key": "leave_balances", "title": "Leave Balances", "available": True},
    {"key": "shift_coverage", "title": "Shift Coverage", "available": True},
    {"key": "employees", "title": "Staff Directory", "available": True},
]


@hr_bp.get("/api/v1/training/matrix")
def get_v1_training_matrix():
    return jsonify({"programs": [], "rows": [], "gaps": 0})


@hr_bp.route("/api/v1/training/programs", methods=["GET", "POST"])
def v1_training_programs():
    if request.method == "POST":
        b = request.get_json(silent=True) or {}
        return jsonify({
            "id": "PRG-01",
            "code": b.get("code", "BLS"),
            "title": b.get("title", "Basic Life Support"),
            "category": b.get("category", "bls"),
            "validity_months": 24,
            "mandatory_for": [],
            "pass_score": None
        }), 201
    return jsonify([])


@hr_bp.route("/api/v1/training/sessions", methods=["GET", "POST"])
def v1_training_sessions():
    if request.method == "POST":
        return jsonify({"id": "SES-01", "status": "scheduled"}), 201
    return jsonify([])


@hr_bp.get("/api/v1/training/certifications")
def get_v1_training_certifications():
    return jsonify([])


@hr_bp.route("/api/v1/training/<path:subpath>", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
def v1_training_catchall(subpath):
    return jsonify([])


@hr_bp.get("/api/v1/reports/hr")
def get_v1_reports_hr():
    return jsonify(HR_REPORTS_LIST)


@hr_bp.get("/api/v1/reports/hr/runs")
def get_v1_reports_hr_runs():
    return jsonify([])


@hr_bp.route("/api/v1/reports/hr/schedules", methods=["POST"])
def v1_reports_hr_schedules():
    return jsonify({"id": "SCHED-01", "status": "scheduled"}), 201


@hr_bp.get("/api/v1/reports/hr/<key>")
def get_v1_report_detail(key):
    from datetime import datetime, timezone
    rep = next((r for r in HR_REPORTS_LIST if r["key"] == key), None)
    title = rep["title"] if rep else key.replace("_", " ").title()
    return jsonify({
        "key": key,
        "title": title,
        "filters": request.args.to_dict(),
        "columns": [
            {"key": "employee_id", "label": "Employee ID"},
            {"key": "name", "label": "Employee Name"},
            {"key": "department", "label": "Department"},
            {"key": "designation", "label": "Designation"},
            {"key": "status", "label": "Status"},
        ],
        "rows": [],
        "generated_at": datetime.now(timezone.utc).isoformat(),
    })


@hr_bp.route("/api/v1/performance/<path:subpath>", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
def v1_performance_catchall(subpath):
    return jsonify([])


@hr_bp.route("/api/v1/compliance/<path:subpath>", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
def v1_compliance_catchall(subpath):
    if subpath == "scan":
        return jsonify({"compliant": 0, "expiring": 0, "non_compliant": 0, "new_alerts": 0})
    return jsonify([])


@hr_bp.route("/api/v1/workforce/coverage/live")
@hr_bp.route("/api/v1/workforce/coverage")
def v1_workforce_coverage():
    return jsonify({"rows": [], "total_shortage": 0, "census_error": None})


@hr_bp.route("/api/v1/workforce/<path:subpath>", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
def v1_workforce_catchall(subpath):
    return jsonify([])




