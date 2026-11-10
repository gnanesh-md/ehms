from flask import Blueprint, request, jsonify
from core.auth import (
    reset_hospital_admin_password,
)
from utils.database import (
    list_hospitals,
    create_hospital,
    set_hospital_status,
    get_hospital_by_code,
)
from shared.session_auth import (
    require_platform_admin,
)
from shared.hospital import (
    validate_hospital_code,
)
from shared.responses import (
    row_to_dict,
    rows_to_dicts,
)

admin_bp = Blueprint("admin", __name__)


@admin_bp.get("/api/platform/hospitals")
def platform_hospitals_list():
    admin_gate = require_platform_admin()
    if admin_gate:
        return admin_gate
    hospitals = list_hospitals()
    return jsonify({"hospitals": rows_to_dicts(hospitals)})


@admin_bp.post("/api/platform/hospitals")
def platform_hospitals_create():
    admin_gate = require_platform_admin()
    if admin_gate:
        return admin_gate
    payload = request.get_json(force=True)
    hospital_code = validate_hospital_code(payload.get("hospital_code", ""))
    hospital_name = payload.get("name")
    hospital_id, created = create_hospital(hospital_code, hospital_name)
    hospital = get_hospital_by_code(hospital_code)
    status = 201 if created else 200
    return (
        jsonify(
            {
                "created": created,
                "hospital_id": hospital_id,
                "hospital": row_to_dict(hospital),
            }
        ),
        status,
    )


@admin_bp.post("/api/platform/hospitals/<hospital_code>/disable")
def platform_hospital_disable(hospital_code):
    admin_gate = require_platform_admin()
    if admin_gate:
        return admin_gate
    payload = request.get_json(silent=True) or {}
    code = validate_hospital_code(hospital_code)
    changed = set_hospital_status(code, "inactive", reason=payload.get("reason"))
    if not changed:
        return jsonify({"error": "Hospital not found"}), 404
    return jsonify(
        {"success": True, "hospital": row_to_dict(get_hospital_by_code(code))}
    )


@admin_bp.post("/api/platform/hospitals/<hospital_code>/enable")
def platform_hospital_enable(hospital_code):
    admin_gate = require_platform_admin()
    if admin_gate:
        return admin_gate
    code = validate_hospital_code(hospital_code)
    changed = set_hospital_status(code, "active")
    if not changed:
        return jsonify({"error": "Hospital not found"}), 404
    return jsonify(
        {"success": True, "hospital": row_to_dict(get_hospital_by_code(code))}
    )


@admin_bp.post("/api/platform/hospitals/<hospital_code>/admin/reset-password")
def platform_admin_reset_password(hospital_code):
    admin_gate = require_platform_admin()
    if admin_gate:
        return admin_gate

    code = validate_hospital_code(hospital_code)
    hospital = get_hospital_by_code(code)
    if not hospital:
        return jsonify({"error": "Hospital not found"}), 404

    payload = request.get_json(force=True)
    username = payload.get("username", "")
    new_password = payload.get("new_password", "")
    result = reset_hospital_admin_password(hospital["id"], username, new_password)
    status = 200 if result.get("success") else 400
    return jsonify(result), status


# ==================== Administration Department Core Routes ====================

from shared.session_auth import require_permissions
from shared.hospital import current_hospital_id
from shared.audit import log_audit_event
from core.auth import delete_all_user_sessions, normalize_module_access, validate_password
from utils.database import (
    get_hospital_profile,
    update_hospital_profile,
    list_admin_departments,
    create_admin_department,
    update_admin_department,
    delete_admin_department,
    list_admin_doctors,
    create_admin_doctor,
    update_admin_doctor_profile,
    delete_admin_doctor,
    list_admin_users as db_list_admin_users,
    create_admin_user as db_create_admin_user,
    update_admin_user as db_update_admin_user,
    delete_admin_user as db_delete_admin_user,
    admin_reset_user_password as db_admin_reset_user_password,
    list_admin_roles as db_list_admin_roles,
    get_admin_role as db_get_admin_role,
    create_admin_role as db_create_admin_role,
    update_admin_role as db_update_admin_role,
    apply_role_modules_to_users as db_apply_role_modules_to_users,
    list_admin_role_user_ids as db_list_admin_role_user_ids,
    delete_admin_role as db_delete_admin_role,
    list_admin_rooms as db_list_admin_rooms,
    create_admin_room as db_create_admin_room,
    update_admin_room as db_update_admin_room,
    delete_admin_room as db_delete_admin_room,
    list_admin_specialties as db_list_admin_specialties,
    create_admin_specialty as db_create_admin_specialty,
    delete_admin_specialty as db_delete_admin_specialty,
    list_admin_tariffs as db_list_admin_tariffs,
    create_admin_tariff as db_create_admin_tariff,
    update_admin_tariff as db_update_admin_tariff,
    delete_admin_tariff as db_delete_admin_tariff,
    get_admin_scheduling_rules as db_get_admin_scheduling_rules,
    save_admin_scheduling_rules as db_save_admin_scheduling_rules,
    get_all_hospital_settings as db_get_all_hospital_settings,
    save_hospital_setting as db_save_hospital_setting,
    get_admin_notification_configs as db_get_admin_notification_configs,
    save_admin_notification_config as db_save_admin_notification_config,
    get_system_health_metrics as db_get_system_health_metrics,
    list_admin_employees as db_list_admin_employees,
    get_audit_logs as db_get_audit_logs,
)


# The administration suite is part of the normal authenticated application.
# Apply this check to every central-admin endpoint; no route-password or
# alternate browser flow is registered for these records.
admin_access_required = require_permissions("admin.use")


def _safe_admin_error(error):
    """Return client-safe validation feedback without leaking database details."""
    message = str(error)
    if "UNIQUE constraint failed" in message or "duplicate key" in message.lower():
        return "A record with those unique details already exists."
    return message if isinstance(error, ValueError) else "Unable to process the request."


def _validate_account_payload(payload):
    """Validate a central account before it reaches the persistence layer.

    This route creates ordinary, scoped accounts only.  Privileged account
    creation remains a separately governed platform operation, preventing a
    role label in a browser request from minting an unrestricted admin.
    """
    password_error = validate_password(str(payload.get("password") or ""))
    if password_error:
        raise ValueError(password_error)

    role_id = str(payload.get("roleId") or payload.get("role_id") or "").upper()
    if not role_id:
        raise ValueError("An assigned role is required for every staff account.")
    if "ADMIN" in role_id:
        raise ValueError("Privileged administrator accounts require the platform approval workflow.")
    role = db_get_admin_role(role_id, current_hospital_id())
    if not role:
        raise ValueError("Select an existing access role before creating this account.")
    if str(role.get("status") or "active").lower() != "active":
        raise ValueError("Inactive roles cannot be assigned to a staff account.")

    # The role is the source of truth. Never accept an arbitrary browser grant
    # while creating a user, or a caller could give that user extra access.
    payload["allowedModules"] = normalize_module_access(role.get("allowedModules", []), user_type="normal")
    payload["module_access"] = payload["allowedModules"]
    payload["roleId"] = role_id
    return payload


def _validate_account_update(payload):
    """Clamp account changes to ordinary, explicitly-scoped access.

    User type is intentionally not editable here.  A System Administrator can
    manage staff access, but cannot create a second unrestricted administrator
    through a browser request.
    """
    payload = dict(payload or {})
    role_id = str(payload.get("roleId") or payload.get("role_id") or "").strip().upper()
    if role_id:
        if "ADMIN" not in role_id:
            role = db_get_admin_role(role_id, current_hospital_id())
            if role and str(role.get("status") or "active").lower() != "active":
                raise ValueError("Inactive roles cannot be assigned to a staff account.")
            payload["role_key"] = role_id
            if role:
                payload["allowedModules"] = normalize_module_access(role.get("allowedModules", []), user_type="normal")
        else:
            payload["role_key"] = "ROLE_ADMIN"

    if "allowedModules" in payload or "module_access" in payload:
        modules = payload.get("allowedModules", payload.get("module_access", []))
        payload["allowedModules"] = normalize_module_access(modules, user_type="normal")

    if "status" in payload:
        payload["status"] = str(payload["status"]).strip().lower()
    if "username" in payload:
        payload["username"] = str(payload["username"]).strip().lower()
    if "password" in payload and str(payload["password"]).strip():
        payload["password"] = str(payload["password"]).strip()
    return payload


# --- 1. Hospital & Organization ---

@admin_bp.get("/api/admin/hospital")
@admin_access_required
def admin_hospital_get():
    profile = get_hospital_profile(current_hospital_id())
    if not profile:
        return jsonify({"success": False, "error": "Hospital profile not found"}), 404
    return jsonify({"success": True, "hospital": profile})


@admin_bp.put("/api/admin/hospital")
@admin_access_required
def admin_hospital_update():
    payload = request.get_json(force=True) or {}
    h_id = current_hospital_id()
    ok = update_hospital_profile(h_id, payload)
    if not ok:
        return jsonify({"success": False, "error": "Failed to update hospital profile"}), 400
    log_audit_event("update", "admin", str(h_id), {"hospital_updated": payload})
    return jsonify({"success": True, "hospital": get_hospital_profile(h_id)})


# --- 2. Departments ---

@admin_bp.get("/api/admin/departments")
@admin_access_required
def admin_departments_list():
    depts = list_admin_departments(current_hospital_id())
    return jsonify({"success": True, "departments": depts})


@admin_bp.post("/api/admin/departments")
@admin_access_required
def admin_departments_create():
    payload = request.get_json(force=True) or {}
    try:
        dept_id = create_admin_department(payload, current_hospital_id())
        log_audit_event("create", "departments", str(dept_id), {"department": payload.get("department_name")})
        return jsonify({"success": True, "department_id": dept_id, "message": "Department created successfully"}), 201
    except Exception as e:
        return jsonify({"success": False, "error": _safe_admin_error(e)}), 400


@admin_bp.put("/api/admin/departments/<int:dept_id>")
@admin_access_required
def admin_departments_update(dept_id):
    payload = request.get_json(force=True) or {}
    ok = update_admin_department(dept_id, payload, current_hospital_id())
    if not ok:
        return jsonify({"success": False, "error": "Department not found or update failed"}), 400
    log_audit_event("update", "departments", str(dept_id), payload)
    return jsonify({"success": True, "message": "Department updated successfully"})


@admin_bp.delete("/api/admin/departments/<int:dept_id>")
@admin_access_required
def admin_departments_delete(dept_id):
    ok = delete_admin_department(dept_id, current_hospital_id())
    if not ok:
        return jsonify({"success": False, "error": "Department not found"}), 404
    log_audit_event("deactivate", "departments", str(dept_id), {})
    return jsonify({"success": True, "message": "Department deactivated successfully"})


# --- 3. Doctor Master ---

@admin_bp.get("/api/admin/doctors")
@admin_access_required
def admin_doctors_list():
    dept = request.args.get("department")
    search = request.args.get("search")
    status = request.args.get("status")
    doctors = list_admin_doctors(current_hospital_id(), department=dept, search=search, status=status)
    return jsonify({"success": True, "doctors": doctors})


@admin_bp.post("/api/admin/doctors")
@admin_access_required
def admin_doctors_create():
    payload = request.get_json(force=True) or {}
    try:
        doc = create_admin_doctor(payload, current_hospital_id())
        log_audit_event("create", "doctors", str(doc.get("id")), {"name": doc.get("name")})
        return jsonify({"success": True, "doctor": doc, "message": "Doctor registered successfully"}), 201
    except Exception as e:
        return jsonify({"success": False, "error": _safe_admin_error(e)}), 400


@admin_bp.put("/api/admin/doctors/<doctor_id>")
@admin_access_required
def admin_doctors_update(doctor_id):
    payload = request.get_json(force=True) or {}
    ok = update_admin_doctor_profile(doctor_id, payload, current_hospital_id())
    if not ok:
        return jsonify({"success": False, "error": "Doctor not found or update failed"}), 400
    log_audit_event("update", "doctors", str(doctor_id), payload)
    return jsonify({"success": True, "message": "Doctor profile updated successfully"})


@admin_bp.delete("/api/admin/doctors/<doctor_id>")
@admin_access_required
def admin_doctors_delete(doctor_id):
    ok = delete_admin_doctor(doctor_id, current_hospital_id())
    if not ok:
        return jsonify({"success": False, "error": "Doctor not found"}), 404
    log_audit_event("deactivate", "doctors", str(doctor_id), {})
    return jsonify({"success": True, "message": "Doctor deactivated successfully"})


# --- 4. User Accounts & Credentials ---

@admin_bp.get("/api/admin/users/all")
@admin_access_required
def admin_users_all():
    search = request.args.get("search")
    role = request.args.get("role")
    status = request.args.get("status")
    users = db_list_admin_users(current_hospital_id(), search=search, role=role, status=status)
    return jsonify({"success": True, "users": users})


@admin_bp.post("/api/admin/users/create")
@admin_access_required
def admin_user_create_record():
    payload = request.get_json(force=True) or {}
    try:
        payload = _validate_account_payload(payload)
        uid = db_create_admin_user(payload, current_hospital_id())
        log_audit_event("create", "users", str(uid), {"username": payload.get("username")})
        return jsonify({"success": True, "user_id": uid, "message": "User account created successfully"}), 201
    except Exception as e:
        return jsonify({"success": False, "error": _safe_admin_error(e)}), 400


@admin_bp.put("/api/admin/users/<user_id>")
@admin_access_required
def admin_user_update_record(user_id):
    payload = request.get_json(force=True) or {}
    try:
        payload = _validate_account_update(payload)
        ok = db_update_admin_user(user_id, payload, current_hospital_id())
        if not ok:
            return jsonify({"success": False, "error": "User not found or update failed"}), 400
        # Role, module and status changes must take effect immediately.
        delete_all_user_sessions(user_id)
        log_audit_event("update", "users", str(user_id), payload)
        return jsonify({"success": True, "message": "User updated successfully; active sessions were revoked."})
    except Exception as e:
        return jsonify({"success": False, "error": _safe_admin_error(e)}), 400


@admin_bp.delete("/api/admin/users/<user_id>")
@admin_access_required
def admin_user_delete_record(user_id):
    ok = db_delete_admin_user(user_id, current_hospital_id())
    if not ok:
        return jsonify({"success": False, "error": "User not found"}), 404
    delete_all_user_sessions(user_id)
    log_audit_event("deactivate", "users", str(user_id), {})
    return jsonify({"success": True, "message": "User deactivated successfully"})


@admin_bp.post("/api/admin/users/<user_id>/reset-password")
@admin_access_required
def admin_user_reset_password(user_id):
    payload = request.get_json(force=True) or {}
    new_pw = str(payload.get("password") or "")
    password_error = validate_password(new_pw)
    if password_error:
        return jsonify({"success": False, "error": password_error}), 400
    ok = db_admin_reset_user_password(user_id, new_pw, current_hospital_id())
    if not ok:
        return jsonify({"success": False, "error": "User not found"}), 404
    delete_all_user_sessions(user_id)
    log_audit_event("reset_password", "users", str(user_id), {})
    return jsonify({"success": True, "message": "Password reset successfully"})


# --- 5. Roles & Permissions ---

@admin_bp.get("/api/admin/roles")
@admin_access_required
def admin_roles_list():
    roles = db_list_admin_roles(current_hospital_id())
    return jsonify({"success": True, "roles": roles})


@admin_bp.post("/api/admin/roles")
@admin_access_required
def admin_roles_create():
    payload = request.get_json(force=True) or {}
    try:
        role_id = str(payload.get("id") or payload.get("role_key") or "").upper()
        if "ADMIN" in role_id:
            raise ValueError("System Administrator is a platform-controlled role.")
        payload["allowedModules"] = normalize_module_access(
            payload.get("allowedModules", payload.get("allowed_modules", [])),
            user_type="normal",
        )
        payload["is_system"] = False
        rid = db_create_admin_role(payload, current_hospital_id())
        log_audit_event("create", "roles", str(rid), {"role": payload.get("name")})
        return jsonify({"success": True, "role_id": rid, "message": "Role created successfully"}), 201
    except Exception as e:
        return jsonify({"success": False, "error": _safe_admin_error(e)}), 400


@admin_bp.put("/api/admin/roles/<role_id>")
@admin_access_required
def admin_roles_update(role_id):
    payload = request.get_json(force=True) or {}
    try:
        if "ADMIN" in str(role_id).upper():
            raise ValueError("System Administrator is a platform-controlled role.")
        if "allowedModules" in payload or "allowed_modules" in payload:
            payload["allowedModules"] = normalize_module_access(
                payload.get("allowedModules", payload.get("allowed_modules", [])),
                user_type="normal",
            )
        ok = db_update_admin_role(role_id, payload, current_hospital_id())
        if not ok:
            return jsonify({"success": False, "error": "Role update failed"}), 400
        affected_user_ids = (
            db_apply_role_modules_to_users(
                role_id,
                payload["allowedModules"],
                current_hospital_id(),
            )
            if "allowedModules" in payload
            else []
        )
        if "status" in payload:
            affected_user_ids = list(
                set(affected_user_ids) | set(db_list_admin_role_user_ids(role_id, current_hospital_id()))
            )
        for user_id in affected_user_ids:
            delete_all_user_sessions(user_id)
        log_audit_event("update", "roles", str(role_id), payload)
        # Return the canonical database row.  The client uses this response as
        # confirmation that the grants were committed, then reloads the role
        # catalogue so browser state can never be mistaken for saved access.
        role = db_get_admin_role(role_id, current_hospital_id())
        return jsonify({
            "success": True,
            "message": "Role updated successfully; affected sessions were revoked.",
            "role": role,
        })
    except Exception as e:
        return jsonify({"success": False, "error": _safe_admin_error(e)}), 400


@admin_bp.delete("/api/admin/roles/<role_id>")
@admin_access_required
def admin_roles_delete(role_id):
    if "ADMIN" in str(role_id).upper():
        return jsonify({"success": False, "error": "System Administrator is a platform-controlled role."}), 400
    try:
        ok = db_delete_admin_role(role_id, current_hospital_id())
    except Exception as e:
        return jsonify({"success": False, "error": _safe_admin_error(e)}), 400
    if not ok:
        return jsonify({"success": False, "error": "Cannot delete system role or role not found"}), 400
    log_audit_event("delete", "roles", str(role_id), {})
    return jsonify({"success": True, "message": "Role deleted successfully"})


# --- 6. Diagnostic Tariffs ---

@admin_bp.get("/api/admin/tariffs")
@admin_access_required
def admin_tariffs_list():
    category = request.args.get("category")
    dept = request.args.get("department")
    search = request.args.get("search")
    tariffs = db_list_admin_tariffs(current_hospital_id(), category=category, department=dept, search=search)
    return jsonify({"success": True, "tariffs": tariffs})


@admin_bp.post("/api/admin/tariffs")
@admin_access_required
def admin_tariffs_create():
    payload = request.get_json(force=True) or {}
    try:
        tid = db_create_admin_tariff(payload, current_hospital_id())
        log_audit_event("create", "tariffs", str(tid), {"tariff": payload.get("name")})
        return jsonify({"success": True, "tariff_id": tid, "message": "Tariff added successfully"}), 201
    except Exception as e:
        return jsonify({"success": False, "error": _safe_admin_error(e)}), 400


@admin_bp.put("/api/admin/tariffs/<tariff_id>")
@admin_access_required
def admin_tariffs_update(tariff_id):
    payload = request.get_json(force=True) or {}
    ok = db_update_admin_tariff(tariff_id, payload, current_hospital_id())
    if not ok:
        return jsonify({"success": False, "error": "Tariff update failed"}), 400
    log_audit_event("update", "tariffs", str(tariff_id), payload)
    return jsonify({"success": True, "message": "Tariff updated successfully"})


@admin_bp.delete("/api/admin/tariffs/<tariff_id>")
@admin_access_required
def admin_tariffs_delete(tariff_id):
    ok = db_delete_admin_tariff(tariff_id, current_hospital_id())
    if not ok:
        return jsonify({"success": False, "error": "Tariff not found"}), 404
    log_audit_event("deactivate", "tariffs", str(tariff_id), {})
    return jsonify({"success": True, "message": "Tariff deactivated successfully"})


# --- 7. Rooms & Locations ---

@admin_bp.get("/api/admin/rooms")
@admin_access_required
def admin_rooms_list():
    rooms = db_list_admin_rooms(current_hospital_id())
    return jsonify({"success": True, "rooms": rooms})


@admin_bp.post("/api/admin/rooms")
@admin_access_required
def admin_rooms_create():
    payload = request.get_json(force=True) or {}
    try:
        rid = db_create_admin_room(payload, current_hospital_id())
        log_audit_event("create", "rooms", str(rid), {"room": payload.get("room_number")})
        return jsonify({"success": True, "room_id": rid, "message": "Room created successfully"}), 201
    except Exception as e:
        return jsonify({"success": False, "error": _safe_admin_error(e)}), 400


@admin_bp.put("/api/admin/rooms/<int:room_id>")
@admin_access_required
def admin_rooms_update(room_id):
    payload = request.get_json(force=True) or {}
    ok = db_update_admin_room(room_id, payload, current_hospital_id())
    if not ok:
        return jsonify({"success": False, "error": "Room not found or update failed"}), 400
    log_audit_event("update", "rooms", str(room_id), payload)
    return jsonify({"success": True, "message": "Room updated successfully"})


@admin_bp.delete("/api/admin/rooms/<int:room_id>")
@admin_access_required
def admin_rooms_delete(room_id):
    ok = db_delete_admin_room(room_id, current_hospital_id())
    if not ok:
        return jsonify({"success": False, "error": "Room not found"}), 404
    log_audit_event("delete", "rooms", str(room_id), {})
    return jsonify({"success": True, "message": "Room deleted successfully"})


# --- 8. Specialties & Clinical Masters ---

@admin_bp.get("/api/admin/specialties")
@admin_access_required
def admin_specialties_list():
    specs = db_list_admin_specialties(current_hospital_id())
    return jsonify({"success": True, "specialties": specs})


@admin_bp.post("/api/admin/specialties")
@admin_access_required
def admin_specialties_create():
    payload = request.get_json(force=True) or {}
    try:
        sid = db_create_admin_specialty(payload, current_hospital_id())
        log_audit_event("create", "specialties", str(sid), {"specialty": payload.get("specialty_name")})
        return jsonify({"success": True, "specialty_id": sid, "message": "Specialty added successfully"}), 201
    except Exception as e:
        return jsonify({"success": False, "error": _safe_admin_error(e)}), 400


@admin_bp.delete("/api/admin/specialties/<int:specialty_id>")
@admin_access_required
def admin_specialties_delete(specialty_id):
    ok = db_delete_admin_specialty(specialty_id, current_hospital_id())
    if not ok:
        return jsonify({"success": False, "error": "Specialty not found"}), 404
    log_audit_event("delete", "specialties", str(specialty_id), {})
    return jsonify({"success": True, "message": "Specialty deleted successfully"})


# --- 9. Scheduling Rules ---

@admin_bp.get("/api/admin/scheduling-rules")
@admin_access_required
def admin_scheduling_rules_get():
    rules = db_get_admin_scheduling_rules(current_hospital_id())
    return jsonify({"success": True, "rules": rules})


@admin_bp.put("/api/admin/scheduling-rules")
@admin_access_required
def admin_scheduling_rules_save():
    payload = request.get_json(force=True) or {}
    db_save_admin_scheduling_rules(current_hospital_id(), payload)
    log_audit_event("update", "scheduling", "rules", payload)
    return jsonify({"success": True, "message": "Scheduling rules updated successfully"})


# --- 10. Operational Settings ---

@admin_bp.get("/api/admin/settings")
@admin_access_required
def admin_settings_get():
    settings = db_get_all_hospital_settings(current_hospital_id())
    return jsonify({"success": True, "settings": settings})


@admin_bp.put("/api/admin/settings")
@admin_access_required
def admin_settings_save():
    payload = request.get_json(force=True) or {}
    h_id = current_hospital_id()
    for k, v in payload.items():
        db_save_hospital_setting(h_id, k, v)
    log_audit_event("update", "settings", "hospital", payload)
    return jsonify({"success": True, "message": "Hospital settings updated successfully"})


# --- 11. Notifications ---

@admin_bp.get("/api/admin/notifications")
@admin_access_required
def admin_notifications_get():
    configs = db_get_admin_notification_configs(current_hospital_id())
    return jsonify({"success": True, "configs": configs})


@admin_bp.put("/api/admin/notifications/<channel>")
@admin_access_required
def admin_notifications_save(channel):
    payload = request.get_json(force=True) or {}
    db_save_admin_notification_config(current_hospital_id(), channel, payload)
    log_audit_event("update", "notifications", channel, payload)
    return jsonify({"success": True, "message": f"{channel} configuration saved successfully"})


# --- 12. Audit Logs ---

@admin_bp.get("/api/admin/audit-logs")
@admin_access_required
def admin_audit_logs_get():
    mod = request.args.get("module")
    limit = int(request.args.get("limit", 100))
    offset = int(request.args.get("offset", 0))
    rows, total = db_get_audit_logs(module_name=mod, limit=limit, offset=offset, hospital_id=current_hospital_id())
    return jsonify({"success": True, "logs": rows_to_dicts(rows), "total": total, "offset": offset})


@admin_bp.post("/api/admin/audit-logs")
@admin_access_required
def admin_audit_logs_record():
    payload = request.get_json(force=True) or {}
    action = payload.get("action", "General")
    module = payload.get("module", "Administration")
    key = payload.get("userId") or payload.get("entityId")
    desc = payload.get("description", "")
    log_audit_event(action, module, key, {"description": desc, **payload})
    return jsonify({"success": True})


# --- 13. System Health ---

@admin_bp.get("/api/admin/system-health")
@admin_access_required
def admin_system_health():
    metrics = db_get_system_health_metrics(current_hospital_id())
    return jsonify({"success": True, "health": metrics})


# --- 14. Employees Integration ---

@admin_bp.get("/api/admin/employees")
@admin_access_required
def admin_employees_list():
    employees = db_list_admin_employees(current_hospital_id())
    return jsonify({"success": True, "employees": employees})

