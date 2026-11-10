import json
import os
import secrets
import hashlib
import hmac
from datetime import datetime, timedelta, timezone
from typing import Optional, Union

import bcrypt
from utils.database import (
    get_connection,
    add_employee,
    generate_employee_id,
    check_if_first_user,
    resolve_hospital_id,
    normalize_hospital_code,
    _to_sql_params,
)

SESSION_COOKIE_NAME = os.getenv("SESSION_COOKIE_NAME", "hospai_session")
SESSION_TTL_HOURS = int(os.getenv("SESSION_TTL_HOURS", "12"))
SESSION_TTL_SECONDS = SESSION_TTL_HOURS * 60 * 60
SESSION_PEPPER = os.getenv("SESSION_PEPPER", "")
ADMIN_ROUTE_PASSWORD = os.getenv("ADMIN_ROUTE_PASSWORD", "")
ADMIN_ROUTE_AUTH_COOKIE_NAME = os.getenv(
    "ADMIN_ROUTE_AUTH_COOKIE_NAME", "hospai_admin_route_auth"
)
ADMIN_ROUTE_AUTH_TTL_SECONDS = int(os.getenv("ADMIN_ROUTE_AUTH_TTL_SECONDS", "3600"))
ADMIN_ROUTE_AUTH_SECRET = (
    os.getenv("ADMIN_ROUTE_AUTH_SECRET", "")
    or SESSION_PEPPER
    or "hospai-admin-route-auth"
)

USER_TYPES = ("admin", "normal")

# Modules a normal (non-admin) user can be granted. Each maps to a base "view"
# permission (its read/GET routes) plus zero or more sub-items that gate a
# specific write/delete action within it (see SUB_MODULES below). This stays
# out of "emergency"/"icu"/"ambulance"/"nurse"/"queue" deliberately -- those
# backend blueprints are stub scaffolding (Phase A/E/F/G) with no real pages
# behind them yet; there's nothing to protect there. "beds" (Phase H) and "er"
# (ER module Phase 1) are the ones from that batch with a real implementation --
# see modules/beds/routes.py and modules/er/routes.py.
# Ordered to match the sidebar's visual grouping (Overview -> OP Management ->
# Operations -> AI -> Finance -> Administration) so the RBAC checkbox list in
# Employee Management reads in the same order an admin sees the modules laid
# out in their own sidebar -- see MODULE_OPTIONS in frontend/src/lib/constants.ts,
# which must be kept in this same order.
ASSIGNABLE_MODULES = (
    "dashboard",  # Overview
    "patients",  # OP Management
    "op",  # Operations
    "beds",  # Operations
    "er",  # Operations
    "pharmacy",  # Operations
    "symptom_ai",  # AI
    "billing",  # Finance
    "accounts",  # Finance -- general ledger
    "hrms",  # Administration
    "employees",  # Administration
    "patient_experience",  # Administration
    "facility",  # Administration -- facility & admin coordination (hr-api)
)

MODULE_BASE_PERMISSION = {
    "dashboard": "patients.read",
    "patients": "patients.read",
    "op": "op.read",
    "beds": "beds.read",
    "er": "er.read",
    "pharmacy": "pharmacy.read",
    "symptom_ai": "symptom_ai.use",
    "billing": "billing.read",
    "accounts": "accounts.read",
    "hrms": "hr.read",
    "employees": "employees.read",
    "patient_experience": "patient_experience.read",
    "facility": "facility.read",
}

# module_access entries are stored as a flat JSON array of strings, same as
# before sub-modules existed -- but an entry is now either a bare module key
# ("billing" -> the module's base/read permission PLUS every sub-item's write
# permission, i.e. full access to that module -- identical to the old
# all-or-nothing behavior, so existing stored data keeps working unchanged)
# or a dotted "module.subitem" key (grants just that one sub-item's write
# permission, and implies the module's base/read permission so it becomes
# visible). This lets an admin grant e.g. "billing" broadly, or narrow it to
# just "billing.invoices" while withholding "billing.claims".
SUB_MODULES = {
    "patients": {
        "directory": {
            "label": "Patient Directory (edit/delete)",
            "permissions": ["patients.write", "patients.delete"],
        },
        "registration": {
            "label": "Patient Registration",
            "permissions": ["patients.registration.write"],
        },
        "consent_desk": {
            "label": "Consent Desk",
            "permissions": ["patients.consent.write"],
        },
        "insurance_desk": {
            "label": "Insurance Desk",
            "permissions": ["patients.insurance.write"],
        },
        "appointments": {
            "label": "Appointments",
            "permissions": ["patients.appointments.write"],
        },
        "documents": {
            "label": "Documents & OCR",
            "permissions": ["patients.documents.write"],
        },
        "clinical_records": {
            "label": "Clinical Records (encounters/notes/certificates)",
            "permissions": ["patients.clinical.write"],
        },
        "bulk_ai": {
            "label": "Bulk Patient AI",
            "permissions": ["patients.bulk_ai.write"],
        },
    },
    # Standalone, matching the sidebar's "Operations" grouping (Doctor
    # Scheduling / Pharmacy / Lab & Diagnostics / OT) -- NOT nested under
    # "patients", even though its routes are patient-adjacent.
    "op": {
        "schedules": {
            "label": "Doctor Schedules",
            "permissions": ["op.schedules.write"],
        },
        "doctors": {"label": "Doctor Directory", "permissions": ["op.doctors.write"]},
    },
    "beds": {
        "manage": {
            "label": "Add/Edit Beds & Admit/Discharge Patients",
            "permissions": ["beds.write"],
        },
    },
    "er": {
        "registration": {
            "label": "ER Registration & Intake",
            "permissions": ["er.registration.write"],
        },
        "triage": {
            "label": "Triage & Vitals",
            "permissions": ["er.triage.write"],
        },
        "treatment": {
            "label": "Emergency Treatment",
            "permissions": ["er.treatment.write"],
        },
        "doctor_assignment": {
            "label": "Doctor Assignment & Clinical Notes",
            "permissions": ["er.doctor_assignment.write"],
        },
        "disposition": {
            "label": "Disposition Decision",
            "permissions": ["er.disposition.write"],
        },
        # Deliberately not "bed_request": fulfilling an ER bed request is a Bed
        # Management action (it calls assign_patient_to_bed() unchanged) and is
        # gated on the existing beds.write permission instead, so ER clinical
        # staff and Reception/bed-management staff stay separate grants.
        "config": {
            "label": "Triage Category Configuration",
            "permissions": ["er.config.write"],
        },
    },
    "pharmacy": {
        "inventory": {
            "label": "Inventory",
            "permissions": ["pharmacy.inventory.write"],
        },
        "sales": {"label": "Sales", "permissions": ["pharmacy.sales.write"]},
        "suppliers": {
            "label": "Suppliers",
            "permissions": ["pharmacy.suppliers.write"],
        },
        "purchases": {
            "label": "Purchases",
            "permissions": ["pharmacy.purchases.write"],
        },
        "prescriptions": {
            "label": "Prescriptions",
            "permissions": ["pharmacy.prescriptions.write"],
        },
    },
    "symptom_ai": {
        "documents": {
            "label": "Knowledge Vault Documents",
            "permissions": ["symptom_ai.documents.write"],
        },
    },
    "billing": {
        "invoices": {
            "label": "Invoices & Payments",
            "permissions": ["billing.invoices.write"],
        },
        "claims": {
            "label": "Insurance Claims",
            "permissions": ["billing.claims.write"],
        },
    },
    # Split so that preparing, approving and closing can be held by different
    # people -- the maker-checker rule in modules/accounts/workflows.py also refuses
    # an approval by the voucher's own preparer, whatever permissions they hold.
    "accounts": {
        "ledger": {"label": "Post receipts, vouchers & operational entries", "permissions": ["accounts.ledger.write"]},
        "approve": {"label": "Approve vouchers & reverse journals", "permissions": ["accounts.approve"]},
        "periods": {"label": "Close periods & years, run depreciation", "permissions": ["accounts.periods.manage"]},
        "setup": {"label": "Chart of accounts, assets & budgets", "permissions": ["accounts.setup.write"]},
    },
    "hrms": {
        "departments": {
            "label": "Departments",
            "permissions": ["hr.departments.write"],
        },
        "attendance": {"label": "Attendance", "permissions": ["hr.attendance.write"]},
        "payroll": {"label": "Payroll", "permissions": ["hr.payroll.write"]},
        "leaves": {"label": "Leave Requests", "permissions": ["hr.leaves.write"]},
        # HR & Workforce service (backend/hr-api) areas.
        "shifts": {"label": "Shifts, Rosters & Staffing", "permissions": ["hr.shifts.write"]},
        "recruitment": {"label": "Recruitment & Onboarding", "permissions": ["hr.recruitment.write"]},
        "training": {"label": "Training & Certifications", "permissions": ["hr.training.write"]},
        "performance": {"label": "Performance Reviews", "permissions": ["hr.performance.write"]},
        "documents": {"label": "Employee Documents", "permissions": ["hr.documents.write"]},
        # Confidential: grievance case files and disciplinary records.
        "grievances": {"label": "Grievances & Discipline", "permissions": ["hr.grievances.manage"]},
        "reports": {"label": "HR Reports & Exports", "permissions": ["hr.reports.read"]},
        "governance": {"label": "HR Strategy & Policies", "permissions": ["hr.governance.write"]},
        "planning": {"label": "Workforce Planning & HR Budget", "permissions": ["hr.planning.write"]},
        "engagement": {"label": "Employee Engagement", "permissions": ["hr.engagement.write"]},
        "audit": {"label": "HR Audit & Compliance Review", "permissions": ["hr.audit.read"]},
    },
    "facility": {
        "requests": {"label": "Facility Requests", "permissions": ["facility.requests.write"]},
        "assets": {"label": "Assets", "permissions": ["facility.assets.write"]},
        "vendors": {"label": "Vendors & Contracts", "permissions": ["facility.vendors.write"]},
        "reports": {"label": "Facility Reports", "permissions": ["facility.reports.read"]},
    },
    "employees": {
        "profile": {
            "label": "Edit Profile Fields",
            "permissions": ["employees.profile.write"],
        },
        # Deliberately separate from "profile": this is the permission that lets
        # someone change a colleague's user_type/access_role/module_access, i.e.
        # actually grant or revoke access -- see signup_employee/update_employee
        # for the server-side clamp that stops a holder of this from granting
        # more than they themselves have.
        "access": {
            "label": "Manage Roles & Module Access",
            "permissions": ["employees.access.write"],
        },
    },
    "patient_experience": {
        "feedback": {
            "label": "Respond to Feedback",
            "permissions": ["patient_experience.write"],
        },
    },
}


def _all_sub_permissions(module: str) -> set[str]:
    result: set[str] = set()
    for sub in SUB_MODULES.get(module, {}).values():
        result.update(sub["permissions"])
    return result


MODULE_PERMISSION_MAP = {
    module: {base_permission} | _all_sub_permissions(module)
    for module, base_permission in MODULE_BASE_PERMISSION.items()
}

_VALID_MODULE_ACCESS_KEYS = set(ASSIGNABLE_MODULES) | {
    f"{module}.{sub_key}" for module, subs in SUB_MODULES.items() for sub_key in subs
}

# Admin always gets literally everything any module/sub-item can grant, plus
# the two permissions with no module-level equivalent (derived, not
# hand-listed, so it can never drift out of sync with MODULE_PERMISSION_MAP).
ADMIN_PERMISSIONS = set().union(*MODULE_PERMISSION_MAP.values()) | {
    "audit.read",
    "admin.use",
}


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt(10)).decode()


def verify_password(password: str, hashed: str) -> bool:
    if not password or not hashed:
        return False
    try:
        return bcrypt.checkpw(password.encode(), hashed.encode())
    except (ValueError, TypeError):
        return False


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _format_ts(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat()


def _parse_ts(value: Union[str, datetime]) -> datetime:
    if isinstance(value, datetime):
        parsed = value
    else:
        parsed = datetime.fromisoformat(value)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def _hash_session_token(token: str) -> str:
    token_bytes = f"{token}{SESSION_PEPPER}".encode()
    return hashlib.sha256(token_bytes).hexdigest()


def is_admin_route_auth_configured() -> bool:
    return bool(ADMIN_ROUTE_PASSWORD)


def verify_admin_route_password(password: str) -> bool:
    if not is_admin_route_auth_configured():
        return False
    return hmac.compare_digest(password or "", ADMIN_ROUTE_PASSWORD)


def create_admin_route_auth_token() -> str:
    nonce = secrets.token_urlsafe(18)
    expires_at = int(_now_utc().timestamp()) + ADMIN_ROUTE_AUTH_TTL_SECONDS
    payload = f"{nonce}:{expires_at}"
    signature = hmac.new(
        ADMIN_ROUTE_AUTH_SECRET.encode(), payload.encode(), hashlib.sha256
    ).hexdigest()
    return f"{nonce}.{expires_at}.{signature}"


def verify_admin_route_auth_token(token: Optional[str]) -> bool:
    if not token or "." not in token:
        return False
    parts = token.split(".")
    if len(parts) != 3:
        return False
    nonce, expires_str, signature = parts
    try:
        expires_at = int(expires_str)
    except ValueError:
        return False
    if int(_now_utc().timestamp()) >= expires_at:
        return False
    payload = f"{nonce}:{expires_at}"
    expected_signature = hmac.new(
        ADMIN_ROUTE_AUTH_SECRET.encode(), payload.encode(), hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(signature, expected_signature)


def normalize_user_type(
    user_type: Optional[str],
    access_role: Optional[str] = None,
    legacy_role: Optional[str] = None,
) -> str:
    normalized = (user_type or "").strip().lower()
    if normalized in USER_TYPES:
        return normalized

    normalized_access_role = (access_role or "").strip().lower()
    if normalized_access_role in {"owner", "hr_manager"}:
        return "admin"

    normalized_legacy_role = (legacy_role or "").strip().lower()
    if normalized_legacy_role == "employee":
        return "admin"

    return "normal"


def _parse_modules(raw_modules) -> list[str]:
    if raw_modules is None:
        return []
    if isinstance(raw_modules, list):
        candidates = raw_modules
    elif isinstance(raw_modules, str):
        text = raw_modules.strip()
        if not text:
            candidates = []
        else:
            try:
                decoded = json.loads(text)
                candidates = decoded if isinstance(decoded, list) else [text]
            except json.JSONDecodeError:
                candidates = [part.strip() for part in text.split(",") if part.strip()]
    else:
        candidates = []

    normalized = []
    for module_name in candidates:
        module_key = str(module_name).strip().lower()
        if not module_key:
            continue
        if (
            module_key == "*"
            or ":" in module_key
            or "." in module_key
            or module_key in _VALID_MODULE_ACCESS_KEYS
            or any(c.isalnum() for c in module_key)
        ):
            if module_key not in normalized:
                normalized.append(module_key)
    return normalized


def normalize_module_access(
    raw_modules,
    user_type: Optional[str] = None,
    access_role: Optional[str] = None,
    legacy_role: Optional[str] = None,
) -> list[str]:
    normalized_type = normalize_user_type(user_type, access_role, legacy_role)
    if normalized_type == "admin":
        return list(ASSIGNABLE_MODULES)

    parsed = _parse_modules(raw_modules)
    if parsed:
        return parsed

    # Default deny for every non-admin account. Access is granted only through
    # System Administration and is never inferred from a job/legacy role.
    return []


def modules_to_storage(modules: list[str]) -> str:
    return json.dumps(modules, separators=(",", ":"))


def get_permissions(
    user_type: Optional[str],
    module_access=None,
    access_role: Optional[str] = None,
    legacy_role: Optional[str] = None,
) -> list[str]:
    normalized_type = normalize_user_type(user_type, access_role, legacy_role)
    if normalized_type == "admin":
        return sorted(ADMIN_PERMISSIONS)

    permissions: set[str] = set()
    for entry in normalize_module_access(
        module_access, normalized_type, access_role, legacy_role
    ):
        if "." in entry:
            module_name, sub_key = entry.split(".", 1)
            sub = SUB_MODULES.get(module_name, {}).get(sub_key)
            if not sub:
                continue
            permissions.update(sub["permissions"])
            base_permission = MODULE_BASE_PERMISSION.get(module_name)
            if base_permission:
                # Granting a sub-item's write access implies the module itself
                # is visible, even if the bare module key wasn't also selected.
                permissions.add(base_permission)
        else:
            permissions.update(MODULE_PERMISSION_MAP.get(entry, set()))

    return sorted(permissions)


def module_access_tree(module_access: list[str]) -> dict[str, list[str]]:
    """Expand a stored module_access array into {module: [granted sub-item keys]}
    for the Employee Management UI -- a bare module entry expands to ALL of its
    sub-item keys (full access), a dotted entry contributes just that one."""
    tree: dict[str, set[str]] = {}
    for entry in module_access or []:
        if "." in entry:
            module_name, sub_key = entry.split(".", 1)
            if module_name in SUB_MODULES and sub_key in SUB_MODULES[module_name]:
                tree.setdefault(module_name, set()).add(sub_key)
        elif entry in ASSIGNABLE_MODULES:
            tree.setdefault(entry, set()).update(SUB_MODULES.get(entry, {}).keys())
    return {module: sorted(subs) for module, subs in tree.items()}


def resolve_user_profile(user_row) -> dict:
    user_type = normalize_user_type(
        user_row.get("user_type"), user_row.get("access_role"), user_row.get("role")
    )
    module_access = normalize_module_access(
        user_row.get("module_access"),
        user_type,
        user_row.get("access_role"),
        user_row.get("role"),
    )

    return {
        "username": user_row.get("username"),
        "role": user_row.get("role_key") or ("ROLE_ADMIN" if user_type == "admin" else user_row.get("role")),
        "role_key": user_row.get("role_key") or ("ROLE_ADMIN" if user_type == "admin" else None),
        "access_role": user_row.get("access_role"),
        "job_role": user_row.get("job_role"),
        "user_type": user_type,
        "module_access": module_access,
        "permissions": get_permissions(
            user_type, module_access, user_row.get("access_role"), user_row.get("role")
        ),
        "full_name": user_row.get("full_name"),
        "email": user_row.get("email"),
        "phone": user_row.get("phone"),
        "employee_id": user_row.get("employee_id"),
        "status": user_row.get("status"),
        "hospital_code": user_row.get("hospital_code"),
    }


def resolve_user_permissions(user: dict) -> set[str]:
    explicit_permissions = user.get("permissions")
    if explicit_permissions:
        return set(explicit_permissions)

    return set(
        get_permissions(
            user.get("user_type"),
            user.get("module_access"),
            user.get("access_role"),
            user.get("role"),
        )
    )


def _entry_is_within(entry: str, granter_permissions: set[str]) -> bool:
    if "." in entry:
        module_name, sub_key = entry.split(".", 1)
        sub = SUB_MODULES.get(module_name, {}).get(sub_key)
        perms = set(sub["permissions"]) if sub else set()
    else:
        perms = MODULE_PERMISSION_MAP.get(entry, set())
    return bool(perms) and perms.issubset(granter_permissions)


def authorize_employee_access_change(
    requested_user_type, requested_module_access, granter_user: dict
):
    """Guard against privilege escalation via the employee-management "manage
    roles & module access" permission (employees.access.write). Without this,
    anyone holding that permission -- not just a full admin -- could set an
    arbitrary user_type="admin" or module_access list on themselves or any
    other account, since update_employee/signup_employee otherwise write
    whatever the request body contains straight to the users table.

    Returns (ok: bool, error_message: Optional[str]). Full admins are always
    unrestricted (matches existing behavior). A non-admin granter can never
    set user_type to "admin", and can never grant a module/sub-item whose
    permissions exceed what the granter's own account currently holds.
    """
    granter_is_admin = (
        normalize_user_type(
            granter_user.get("user_type"),
            granter_user.get("access_role"),
            granter_user.get("role"),
        )
        == "admin"
    )
    if granter_is_admin:
        return True, None

    if (
        requested_user_type is not None
        and (requested_user_type or "").strip().lower() == "admin"
    ):
        return False, "Only an existing admin can grant admin access."

    if requested_module_access is not None:
        granter_permissions = resolve_user_permissions(granter_user)
        disallowed = [
            entry
            for entry in _parse_modules(requested_module_access)
            if not _entry_is_within(entry, granter_permissions)
        ]
        if disallowed:
            return (
                False,
                f"Cannot grant access you do not have yourself: {', '.join(disallowed)}",
            )

    return True, None


def validate_password(password: str) -> Optional[str]:
    if not password or len(password) < 8:
        return "Password must be at least 8 characters long."
    return None


INITIAL_ROLE_TEMPLATES = {
    # Keep the platform administrator in the same catalogue as every other
    # role.  The UI previously rendered this role locally while the database
    # returned only the clinical/operational templates, which made the roles
    # page look as though it contained just one item when the initial request
    # was interrupted.  Its full access is still enforced by the admin flag,
    # not by this display list.
    "ROLE_ADMIN": ("System Administrator", "Full hospital configuration, governance and access administration.", list(ASSIGNABLE_MODULES)),
    "ROLE_DOCTOR": ("Doctor", "Clinical consultation, prescriptions and assigned patient workflow.", ["dashboard", "patients.clinical_records", "op"]),
    "ROLE_SURGEON": ("Surgeon", "Surgical consultation, patient records and operation workflow.", ["dashboard", "patients.clinical_records", "op", "beds"]),
    "ROLE_ANESTHETIST": ("Anesthetist", "Pre-operative and clinical patient workflow.", ["dashboard", "patients.clinical_records", "op", "beds"]),
    "ROLE_ER_PHYSICIAN": ("Emergency Physician", "Emergency triage, treatment and patient clinical workflow.", ["dashboard", "patients.clinical_records", "er"]),
    "ROLE_PATHOLOGIST": ("Pathologist", "Diagnostic documents and laboratory review workflow.", ["dashboard", "patients.documents", "symptom_ai.documents"]),
    "ROLE_RECEPTIONIST": ("Receptionist", "Patient registration, appointments and front-desk billing.", ["dashboard", "patients.registration", "patients.appointments", "patients.directory", "billing.invoices"]),
    "ROLE_FRONT_OFFICE_MANAGER": ("Front Office Manager", "Front-desk supervision, registration, appointments and billing.", ["dashboard", "patients", "billing.invoices"]),
    "ROLE_NURSE": ("Nurse", "Vitals, bedside clinical records and care coordination.", ["dashboard", "patients.clinical_records", "beds", "er.triage"]),
    "ROLE_NURSING_SUPERVISOR": ("Nursing Supervisor", "Nursing coordination, beds and clinical patient records.", ["dashboard", "patients.clinical_records", "beds", "er"]),
    "ROLE_PHYSIOTHERAPIST": ("Physiotherapist", "Assigned patient clinical documentation and follow-up care.", ["dashboard", "patients.clinical_records"]),
    "ROLE_PHARMACIST": ("Pharmacist", "Prescription queue, dispensing, stock and purchase workflow.", ["dashboard", "pharmacy.prescriptions", "pharmacy.inventory", "pharmacy.sales", "pharmacy.purchases"]),
    "ROLE_PHARMACY_MANAGER": ("Pharmacy Manager", "Pharmacy inventory, suppliers, purchases and dispensing operations.", ["dashboard", "pharmacy"]),
    "ROLE_LAB_TECHNICIAN": ("Lab Technician", "Laboratory-related patient documents and diagnostic workflow.", ["dashboard", "patients.documents", "symptom_ai.documents"]),
    "ROLE_RADIOLOGY_TECHNICIAN": ("Radiology Technician", "Diagnostic documents and imaging workflow support.", ["dashboard", "patients.documents", "symptom_ai.documents"]),
    "ROLE_HR_MANAGER": ("HR Manager", "Employee administration, attendance, leave, payroll and HR reporting.", ["dashboard", "employees", "hrms"]),
    "ROLE_HR_EXECUTIVE": ("HR Executive", "Employee profiles, attendance, leave and HR documents.", ["dashboard", "employees.profile", "hrms.attendance", "hrms.leaves", "hrms.documents"]),
    "ROLE_ACCOUNTANT": ("Accountant", "General ledger, operational entries and financial controls.", ["dashboard", "accounts.ledger"]),
    "ROLE_FINANCE_MANAGER": ("Finance Manager", "Financial posting, approvals and period controls.", ["dashboard", "accounts.ledger", "accounts.approve", "accounts.periods"]),
    "ROLE_BILLING_EXECUTIVE": ("Billing Executive", "Invoices, payments and insurance-claim processing.", ["dashboard", "billing.invoices", "billing.claims"]),
    "ROLE_INSURANCE_TPA_OFFICER": ("Insurance / TPA Officer", "Insurance desk and claims processing.", ["dashboard", "patients.insurance_desk", "billing.claims"]),
    "ROLE_RADIOLOGIST": ("Radiologist", "Diagnostic document review and clinical reporting access.", ["dashboard", "patients.documents", "symptom_ai"]),
    "ROLE_MEDICAL_RECORDS_OFFICER": ("Medical Records Officer", "Patient directory, documents and controlled clinical records.", ["dashboard", "patients.directory", "patients.documents", "patients.clinical_records"]),
    "ROLE_INVENTORY_MANAGER": ("Inventory Manager", "Pharmacy stock, suppliers and purchasing workflow.", ["dashboard", "pharmacy.inventory", "pharmacy.suppliers", "pharmacy.purchases"]),
    "ROLE_FACILITY_MANAGER": ("Facility Manager", "Facility requests, assets, vendors and operational reporting.", ["dashboard", "facility"]),
    "ROLE_COMPLIANCE_OFFICER": ("Compliance Officer", "HR audit, documents and compliance reporting.", ["dashboard", "hrms.audit", "hrms.documents", "hrms.reports"]),
    "ROLE_IT_SUPPORT": ("IT Support", "Operational dashboard and facility support coordination.", ["dashboard", "facility.requests"]),
}

INITIAL_SPECIALTIES = (
    "General Medicine", "Cardiology", "Neurology", "Orthopedics",
    "Pediatrics", "Obstetrics & Gynecology", "General Surgery",
    "Ophthalmology", "ENT", "Dermatology", "Psychiatry",
    "Radiology", "Pathology", "Anesthesiology", "Emergency Medicine",
)


def seed_initial_access_roles(hospital_id: Optional[int] = None):
    """Create editable hospital role templates without creating any staff."""
    scoped_hospital_id = hospital_id or resolve_hospital_id()
    with get_connection() as conn:
        cursor = conn.cursor()
        for role_key, (role_name, description, modules) in INITIAL_ROLE_TEMPLATES.items():
            cursor.execute(
                """
                INSERT INTO hospital_roles
                    (hospital_id, role_key, role_name, description, allowed_modules, status, is_system)
                VALUES (?, ?, ?, ?, ?, 'active', TRUE)
                ON CONFLICT (hospital_id, role_key) DO UPDATE
                SET is_system = TRUE
                """,
                (
                    scoped_hospital_id,
                    role_key,
                    role_name,
                    description,
                    json.dumps(normalize_module_access(modules, user_type="normal")),
                ),
            )
        for specialty_name in INITIAL_SPECIALTIES:
            cursor.execute(
                """
                INSERT INTO clinical_specialties
                    (hospital_id, specialty_name, department_name, status)
                VALUES (?, ?, ?, 'active')
                ON CONFLICT (hospital_id, specialty_name) DO NOTHING
                """,
                (scoped_hospital_id, specialty_name, specialty_name),
            )
        conn.commit()


def create_default_users():
    """Create the first System Admin on an empty database.

    Never creates demo staff, and never modifies an existing account: the admin's
    password is only set here when the account is first created, so a password
    changed by the administrator survives restarts. The first-boot password comes
    from INITIAL_ADMIN_PASSWORD (default "Admin@123" for local installs) and must
    be changed after the first sign-in.
    """
    hospital_id = resolve_hospital_id()
    initial_password = os.getenv("INITIAL_ADMIN_PASSWORD", "").strip() or "Admin@123"
    with get_connection() as conn:
        cursor = conn.cursor()

        defaults = [
            {
                "username": "admin",
                "email": "admin@hospital.com",
                "password_hash": hash_password(initial_password),
                "role": "employee",
                "access_role": "owner",
                "user_type": "admin",
                "module_access": list(ASSIGNABLE_MODULES),
                "job_role": "Administrator",
                "full_name": "Admin User",
                "phone": "+1-234-567-8901",
                "department": "Administration",
                "status": "active",
                "address": "",
                "emergency_contact": "",
            },
        ]

        for user in defaults:
            # Existing account (any hospital row with this username/email): leave
            # it exactly as the administrator configured it.
            cursor.execute(
                """
                SELECT 1 FROM users
                WHERE LOWER(username) = LOWER(?) OR LOWER(email) = LOWER(?)
                """,
                (user["username"], user["email"]),
            )
            exists = cursor.fetchone() is not None
            # Close this connection's read transaction before add_employee(),
            # which opens its own connection.
            conn.commit()
            if not exists:
                user["employee_id"] = generate_employee_id(hospital_id=hospital_id)
                try:
                    add_employee(user, hospital_id=hospital_id)
                except Exception as exc:
                    message = str(exc).lower()
                    if "unique constraint" in message or "duplicate key" in message:
                        continue
                    raise
    seed_initial_access_roles(hospital_id)


def authenticate(
    username: str,
    password: str,
    hospital_id: Optional[int] = None,
    expected_role_id: Optional[str] = None,
):
    """Authenticate user and return rich profile or error."""
    scoped_hospital_id = hospital_id or resolve_hospital_id()
    with get_connection() as conn:
        cursor = conn.cursor()
        clean_identifier = (username or "").strip()
        try:
            cursor.execute(
                """
                SELECT u.id, u.hospital_id, u.username, u.password_hash, u.role, u.role_key, u.access_role, u.user_type,
                       u.module_access, u.job_role, u.full_name, u.email, u.phone, u.employee_id, u.status,
                       h.code as hospital_code, h.status as hospital_status,
                       r.status as assigned_role_status
                FROM users u
                LEFT JOIN hospitals h ON h.id = u.hospital_id
                LEFT JOIN hospital_roles r ON r.hospital_id = u.hospital_id AND r.role_key = u.role_key
                WHERE (LOWER(u.username) = LOWER(?) OR LOWER(u.email) = LOWER(?) OR LOWER(u.employee_id) = LOWER(?)) AND u.hospital_id = ?
            """,
                (clean_identifier, clean_identifier, clean_identifier, scoped_hospital_id),
            )
        except Exception as exc:
            # Backward compatibility for stale/legacy schemas or stale runtime modules.
            msg = str(exc).lower()
            if (
                "no such column: hospital_id" in msg
                or "incorrect number of bindings supplied" in msg
            ):
                cursor.execute(
                    """
                    SELECT id, username, password_hash, role, access_role, job_role, user_type, module_access, full_name, email, phone, employee_id, status
                    FROM users WHERE (LOWER(username) = LOWER(?) OR LOWER(email) = LOWER(?))
                """,
                    (clean_identifier, clean_identifier),
                )
            else:
                raise
        user = cursor.fetchone()
        # Only accounts that exist in `users` (created by an administrator or via
        # Doctor Master, both of which store the admin-chosen password) may sign in.
        # A doctors-table row alone is not a credential.

        if not user:
            return None
        user_map = dict(user)
        is_admin = normalize_user_type(
            user_map.get("user_type"), user_map.get("access_role"), user_map.get("role")
        ) == "admin" or (user_map.get("username") or "").lower() == "admin"
        assigned_role = str(user_map.get("role_key") or "").upper()
        selected_role = str(expected_role_id or "").strip().upper()
        is_doctor = (
            assigned_role in ("ROLE_DOCTOR", "ROLE_CLINICIAN", "DOCTOR")
            or str(user_map.get("access_role") or "").lower() == "clinician"
            or str(user_map.get("job_role") or "").lower() == "doctor"
        )
        # The stored bcrypt hash is the only accepted credential.
        pw_valid = verify_password(password, user_map.get("password_hash", ""))
        if pw_valid:
            if user_map.get("status") != "active":
                return {"error": "Account is not active. Please contact administrator."}
            if user_map.get("hospital_status") not in (None, "active"):
                return {
                    "error": "Hospital account is disabled. Please contact administrator."
                }
            if user_map.get("role_key") and str(user_map.get("assigned_role_status") or "active").lower() != "active":
                return {"error": "The assigned role is inactive. Please contact your administrator."}
            if selected_role and not (
                is_admin
                or (is_doctor and selected_role in ("ROLE_DOCTOR", "ROLE_CLINICIAN", "DOCTOR", "CLINICIAN"))
                or selected_role in ("ADMIN", "ROLE_ADMIN")
                or selected_role == assigned_role
                or selected_role == f"ROLE_{str(user_map.get('access_role') or '').upper()}"
                or selected_role.replace("ROLE_", "").lower() == str(user_map.get("access_role") or "").lower()
                or selected_role.replace("ROLE_", "").lower() == str(user_map.get("job_role") or "").lower()
            ):
                return {"error": "The selected role does not match this account."}
            profile = resolve_user_profile(
                {
                    "username": user_map.get("username"),
                    "role": user_map.get("role"),
                    "role_key": user_map.get("role_key"),
                    "access_role": user_map.get("access_role"),
                    "user_type": user_map.get("user_type"),
                    "job_role": user_map.get("job_role"),
                    "module_access": user_map.get("module_access"),
                    "full_name": user_map.get("full_name"),
                    "email": user_map.get("email"),
                    "phone": user_map.get("phone"),
                    "employee_id": user_map.get("employee_id"),
                    "status": user_map.get("status"),
                    "hospital_code": user_map.get("hospital_code"),
                }
            )
            profile["id"] = user_map.get("id")
            profile["hospital_id"] = user_map.get("hospital_id") or scoped_hospital_id
            return profile
    return None


def signup_employee(
    data: dict, allow_admin_creation: bool = True, hospital_id: Optional[int] = None
) -> dict:
    """Register a new employee account."""
    scoped_hospital_id = hospital_id or resolve_hospital_id()
    password_error = validate_password(data.get("password", ""))
    if password_error:
        return {"success": False, "message": password_error}

    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT id FROM users WHERE username = ? AND hospital_id = ?",
            (data["username"], scoped_hospital_id),
        )
        if cursor.fetchone():
            return {"success": False, "message": "Username already exists"}

    employee_id = generate_employee_id(hospital_id=scoped_hospital_id)
    is_first = check_if_first_user(hospital_id=scoped_hospital_id)
    requested_user_type = normalize_user_type(
        data.get("user_type"), data.get("access_role"), data.get("role")
    )
    user_type = requested_user_type if allow_admin_creation else "normal"
    module_access = normalize_module_access(
        data.get("module_access"),
        user_type,
        data.get("access_role"),
        data.get("role"),
    )

    employee_data = {
        "username": data["username"],
        "password_hash": hash_password(data["password"]),
        "role": "employee",
        # Without this, the account never matches any hospital_roles row: it is
        # invisible to the role-scoped login screen (list_login_users_for_role)
        # and, if a role is ever selected at sign-in, authenticate() rejects it
        # with "The selected role does not match this account."
        "role_key": (data.get("role_key") or data.get("roleId") or "").strip().upper() or None,
        "access_role": "owner" if user_type == "admin" else "receptionist",
        "user_type": user_type,
        "module_access": module_access,
        "job_role": data.get("job_role"),
        "full_name": data.get("full_name"),
        "email": data.get("email"),
        "phone": data.get("phone"),
        "department": data.get("department"),
        "employee_id": employee_id,
        "status": "active",
        "address": data.get("address", ""),
        "emergency_contact": data.get("emergency_contact", ""),
    }

    try:
        add_employee(employee_data, hospital_id=scoped_hospital_id)
        return {
            "success": True,
            "message": f"Registration successful! Employee ID: {employee_id}",
            "is_first_user": is_first,
            "employee_id": employee_id,
            "username": data["username"],
            "user_type": user_type,
            "module_access": module_access,
        }
    except Exception as exc:  # pragma: no cover - defensive
        return {"success": False, "message": f"Registration failed: {exc}"}


def signup_hospital_admin(data: dict, hospital_id: Optional[int] = None) -> dict:
    """Create the first admin user for a hospital (one-time bootstrap)."""
    scoped_hospital_id = hospital_id or resolve_hospital_id()
    if not check_if_first_user(hospital_id=scoped_hospital_id):
        return {
            "success": False,
            "message": "Admin already configured for this hospital.",
        }

    password_error = validate_password(data.get("password", ""))
    if password_error:
        return {"success": False, "message": password_error}

    username = (data.get("username") or "").strip()
    if not username:
        return {"success": False, "message": "Username is required."}

    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT id FROM users WHERE username = ? AND hospital_id = ?",
            (username, scoped_hospital_id),
        )
        if cursor.fetchone():
            return {"success": False, "message": "Username already exists"}

    employee_id = generate_employee_id(hospital_id=scoped_hospital_id)
    employee_data = {
        "username": username,
        "password_hash": hash_password(data["password"]),
        "role": "employee",
        "access_role": "owner",
        "user_type": "admin",
        "job_role": data.get("job_role") or "Hospital Admin",
        "full_name": data.get("full_name") or "Hospital Admin",
        "email": data.get("email"),
        "phone": data.get("phone"),
        "department": data.get("department") or "Administration",
        "employee_id": employee_id,
        "status": "active",
        "address": data.get("address", ""),
        "emergency_contact": data.get("emergency_contact", ""),
    }

    try:
        add_employee(employee_data, hospital_id=scoped_hospital_id)
        return {
            "success": True,
            "message": f"Hospital admin created. Employee ID: {employee_id}",
            "employee_id": employee_id,
            "username": username,
        }
    except Exception as exc:  # pragma: no cover - defensive
        return {"success": False, "message": f"Admin setup failed: {exc}"}


def reset_hospital_admin_password(
    hospital_id: int, username: str, new_password: str
) -> dict:
    password_error = validate_password(new_password)
    if password_error:
        return {"success": False, "message": password_error}

    user_name = (username or "").strip()
    if not user_name:
        return {"success": False, "message": "Username is required."}

    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT id, access_role, status
            FROM users
            WHERE username = ? AND hospital_id = ?
            """,
            (user_name, hospital_id),
        )
        user = cursor.fetchone()
        if not user:
            return {"success": False, "message": "Admin account not found."}
        if user["access_role"] != "owner":
            return {
                "success": False,
                "message": "Target account is not a hospital admin.",
            }

        cursor.execute(
            "UPDATE users SET password_hash = ?, status = 'active', password_changed_at = CURRENT_TIMESTAMP WHERE id = ?",
            (hash_password(new_password), user["id"]),
        )
        cursor.execute(
            "DELETE FROM sessions WHERE user_id = ? AND hospital_id = ?",
            (user["id"], hospital_id),
        )
        conn.commit()
        return {"success": True, "message": "Admin password reset successfully."}


def check_username_exists(username: str, hospital_id: Optional[int] = None) -> bool:
    scoped_hospital_id = hospital_id or resolve_hospital_id()
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT id FROM users WHERE username = ? AND hospital_id = ?",
            (username, scoped_hospital_id),
        )
        return cursor.fetchone() is not None


def purge_expired_sessions():
    now = _format_ts(_now_utc())
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM sessions WHERE expires_at <= ?", (now,))
        conn.commit()


def create_session(
    user_id: int,
    hospital_id: int,
    ip_address: Optional[str] = None,
    user_agent: Optional[str] = None,
):
    purge_expired_sessions()
    expires_at = _now_utc() + timedelta(hours=SESSION_TTL_HOURS)
    expires_at_str = _format_ts(expires_at)

    with get_connection() as conn:
        cursor = conn.cursor()
        for _attempt in range(5):
            token = secrets.token_urlsafe(32)
            token_hash = _hash_session_token(token)
            try:
                cursor.execute(
                    """
                    INSERT INTO sessions (user_id, hospital_id, token_hash, expires_at, ip_address, user_agent)
                    VALUES (?, ?, ?, ?, ?, ?)
                """,
                    (
                        user_id,
                        hospital_id,
                        token_hash,
                        expires_at_str,
                        ip_address,
                        user_agent,
                    ),
                )
                conn.commit()
                return token, expires_at
            except Exception:  # pragma: no cover - extremely rare token collisions
                conn.rollback()
                continue

    raise RuntimeError("Failed to create session")


def get_session_user(token: Optional[str]):
    if not token:
        return None

    token_hash = _hash_session_token(token)
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT s.id as session_id,
                   s.expires_at as expires_at,
                   s.created_at as session_created_at,
                   s.hospital_id as hospital_id,
                   u.id as user_id,
                   u.username,
                   u.role,
                   u.access_role,
                   u.job_role,
                   u.user_type,
                   u.module_access,
                   u.full_name,
                   u.email,
                   u.phone,
                   u.employee_id,
                   u.status,
                   u.password_changed_at,
                   h.code as hospital_code,
                   h.status as hospital_status
            FROM sessions s
            JOIN users u ON s.user_id = u.id AND s.hospital_id = u.hospital_id
            JOIN hospitals h ON s.hospital_id = h.id
            WHERE s.token_hash = ?
        """,
            (token_hash,),
        )
        row = cursor.fetchone()
        if not row:
            return None

        expires_at = _parse_ts(row["expires_at"])
        if expires_at <= _now_utc():
            cursor.execute("DELETE FROM sessions WHERE id = ?", (row["session_id"],))
            conn.commit()
            return None

        if row["password_changed_at"]:
            session_created_at = _parse_ts(row["session_created_at"])
            password_changed_at = _parse_ts(row["password_changed_at"])
            if session_created_at < password_changed_at:
                cursor.execute(
                    "DELETE FROM sessions WHERE id = ?", (row["session_id"],)
                )
                conn.commit()
                return None

        if row["status"] != "active":
            cursor.execute("DELETE FROM sessions WHERE id = ?", (row["session_id"],))
            conn.commit()
            return None

        if row["hospital_status"] != "active":
            cursor.execute("DELETE FROM sessions WHERE id = ?", (row["session_id"],))
            conn.commit()
            return None

        cursor.execute(
            "UPDATE sessions SET last_seen = CURRENT_TIMESTAMP WHERE id = ?",
            (row["session_id"],),
        )
        conn.commit()

    profile = resolve_user_profile(
        {
            "id": row["user_id"],
            "hospital_id": row["hospital_id"],
            "username": row["username"],
            "role": row["role"],
            "access_role": row["access_role"],
            "job_role": row["job_role"],
            "user_type": row["user_type"],
            "module_access": row["module_access"],
            "full_name": row["full_name"],
            "email": row["email"],
            "phone": row["phone"],
            "employee_id": row["employee_id"],
            "status": row["status"],
            "hospital_code": row["hospital_code"],
        }
    )
    # resolve_user_profile() intentionally omits internal DB ids from the client-safe
    # profile shape; re-attach them here (mirroring authenticate()) since callers like
    # current_hospital_id() and the session-management routes need them server-side.
    # Routes that jsonify this profile directly must strip "id" before responding,
    # the same way the login/setup-admin routes already do.
    profile["id"] = row["user_id"]
    profile["hospital_id"] = row["hospital_id"]
    return profile


def delete_session(token: Optional[str]):
    if not token:
        return
    token_hash = _hash_session_token(token)
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM sessions WHERE token_hash = ?", (token_hash,))
        conn.commit()


def get_user_sessions(user_id: int) -> list[dict]:
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT id, created_at, last_seen, ip_address, user_agent FROM sessions WHERE user_id = ?",
            (user_id,),
        )
        cols = [d[0] for d in cursor.description]
        return [dict(zip(cols, row)) for row in cursor.fetchall()]


def delete_specific_session(session_id: int, user_id: int):
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "DELETE FROM sessions WHERE id = ? AND user_id = ?", (session_id, user_id)
        )
        conn.commit()


def delete_other_sessions(user_id: int, current_token: str):
    token_hash = _hash_session_token(current_token)
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "DELETE FROM sessions WHERE user_id = ? AND token_hash != ?",
            (user_id, token_hash),
        )
        conn.commit()


def delete_all_user_sessions(user_id):
    try:
        numeric_id = int(user_id)
    except (ValueError, TypeError):
        numeric_id = None
    with get_connection() as conn:
        cursor = conn.cursor()
        if numeric_id is not None:
            cursor.execute("DELETE FROM sessions WHERE user_id = ?", (numeric_id,))
        else:
            cursor.execute(
                "DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE username = ?)",
                (str(user_id),),
            )
        conn.commit()
