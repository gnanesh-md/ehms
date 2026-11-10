import { usePharmacyData } from "../data/usePharmacyData"
import { useState, useEffect } from "react"
import {
  Search,
  Filter,
  X,
  User,
  Stethoscope,
  FileText,
  CheckCircle,
  Play,
  XCircle,
  MessageSquare,
  ChevronRight,
  PlusCircle,
  Trash2,
  Clock,
  RefreshCw,
  Sparkles,
  AlertCircle,
} from "lucide-react"
import { PharmacyDatabase } from "../../../services/pharmacyDb"
import { findMatchingMedicine } from "../../../utils/medicineMatcher"

import PageHeader from "../components/PageHeader"
import StatusBadge from "../components/StatusBadge"

const filters = [
  "Active Queue",
  "Pending",
  "Ready",
  "Dispensed",
  "All",
]

interface PrescriptionQueueProps {
  onNavigate: (page: string) => void
}

function checkItemStock(item: any, medicinesList: any[], batchesList: any[]) {
  if (!item || typeof item !== "object") return false
  const match = findMatchingMedicine(item, medicinesList, batchesList)
  return match.hasStock
}

function getPrescriptionStockStatus(rawItems: any[], medicinesList: any[], batchesList: any[]) {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return {
      type: "empty",
      label: "No Items",
      badgeClass: "bg-slate-50 text-slate-600 border-slate-200",
      dotClass: "bg-slate-400",
      desc: "Prescription has no items",
    }
  }

  let inStockCount = 0
  let inCatalogCount = 0

  rawItems.forEach((item) => {
    const match = findMatchingMedicine(item, medicinesList, batchesList)
    if (match.hasStock) {
      inStockCount++
    }
    if (match.matchedMedicine) {
      inCatalogCount++
    }
  })

  if (inStockCount === rawItems.length) {
    return {
      type: "in_stock",
      label: "In-Inventory",
      subLabel: "100% In-Stock",
      badgeClass: "bg-emerald-50 text-emerald-700 border-emerald-200",
      dotClass: "bg-emerald-500",
      desc: "All medicines are available in active hospital inventory (FEFO ready)",
    }
  } else if (inStockCount > 0) {
    return {
      type: "mixed",
      label: "Semi-Inventory",
      subLabel: `${inStockCount}/${rawItems.length} In-Stock`,
      badgeClass: "bg-amber-50 text-amber-800 border-amber-200",
      dotClass: "bg-amber-500",
      desc: `Partial stock: ${inStockCount} of ${rawItems.length} medicines available in inventory`,
    }
  } else if (inCatalogCount > 0) {
    return {
      type: "out_of_stock",
      label: "Out of Stock",
      subLabel: "In Catalog (0 Stock)",
      badgeClass: "bg-amber-50 text-amber-800 border-amber-200",
      dotClass: "bg-amber-500",
      desc: "Medicines are recognized in hospital formulary but have 0 stock",
    }
  } else {
    return {
      type: "non_inventory",
      label: "Non-Inventory",
      subLabel: "Not Stocked",
      badgeClass: "bg-rose-50 text-rose-700 border-rose-200",
      dotClass: "bg-rose-500",
      desc: "Non-inventory medicines (requires external purchase/PO)",
    }
  }
}

export default function PrescriptionQueue({
  onNavigate,
}: PrescriptionQueueProps) {
  const { prescriptions, medicines, batches = [], refresh } = usePharmacyData()
  const [activeFilter, setActiveFilter] = useState("Active Queue")
  const [selected, setSelected] = useState<typeof prescriptions[0] | null>(null)
  const [search, setSearch] = useState("")
  const [isRefreshing, setIsRefreshing] = useState(false)

  const selectedStock = selected
    ? getPrescriptionStockStatus(selected.rawItems, medicines, batches)
    : null

  const handleManualRefresh = () => {
    setIsRefreshing(true)
    refresh()
    setTimeout(() => setIsRefreshing(false), 500)
  }

  const counts = useMemo(() => {
    const list = prescriptions || []
    return {
      "Active Queue": list.filter((rx) => {
        const s = (rx.status || "").toLowerCase()
        return s !== "dispensed" && s !== "rejected" && s !== "cancelled"
      }).length,
      Pending: list.filter((rx) => (rx.status || "").toLowerCase() === "pending").length,
      Ready: list.filter((rx) => (rx.status || "").toLowerCase() === "ready").length,
      Dispensed: list.filter((rx) => (rx.status || "").toLowerCase() === "dispensed").length,
      All: list.length,
    }
  }, [prescriptions])

  const filtered = (prescriptions || [])
    .filter((rx) => {
      if (!rx) return false
      const rxStatus = (rx.status || "").toLowerCase()
      const isDispensed = rxStatus === "dispensed"
      const isClosed = isDispensed || rxStatus === "rejected" || rxStatus === "cancelled"
      
      let matchStatus = true
      if (activeFilter === "Active Queue") {
        matchStatus = !isClosed
      } else if (activeFilter === "Dispensed") {
        matchStatus = isDispensed
      } else if (activeFilter !== "All") {
        matchStatus = rxStatus === activeFilter.toLowerCase()
      }

      const q = (search || "").toLowerCase().trim()
      const matchSearch =
        !q ||
        (rx.patient || "").toLowerCase().includes(q) ||
        (rx.id || "").toLowerCase().includes(q) ||
        (rx.doctor || "").toLowerCase().includes(q) ||
        (rx.diagnosis || "").toLowerCase().includes(q)
      return matchStatus && matchSearch
    })
    .sort((a, b) => {
      const timeB = new Date((b as any).arrivalTime || (b as any).createdAt || b.date || 0).getTime()
      const timeA = new Date((a as any).arrivalTime || (a as any).createdAt || a.date || 0).getTime()
      return timeB - timeA || (b.id || "").localeCompare(a.id || "")
    })

  const handleDispense = () => {
    if (selected) {
      localStorage.setItem("_v2_pharmacy_dispense_rx", selected.id)
      onNavigate("dispensing")
    }
  }

  return (
    <div className="flex h-full overflow-hidden">
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="p-6 pb-0">
          <PageHeader
            breadcrumbs={[
              { label: "Pharmacy" },
              { label: "Prescription Queue" },
            ]}
            title="Prescription Queue"
            description="Manage incoming doctor prescriptions"
            onNavigate={onNavigate}
          />

          {/* Filters & Actions */}
          <div className="flex items-center gap-3 mt-4 mb-0 flex-wrap">
            <div className="flex rounded border border-[#E2E8F0] overflow-hidden bg-white text-[13px]">
              {filters.map((f) => {
                const count = (counts as any)[f] ?? 0
                const isSelected = activeFilter === f
                return (
                  <button
                    key={f}
                    onClick={() => setActiveFilter(f)}
                    className="px-3.5 py-2 font-medium transition-colors border-r last:border-r-0 border-[#E2E8F0] flex items-center gap-1.5 cursor-pointer"
                    style={{
                      background: isSelected ? "#0F1624" : "#fff",
                      color: isSelected ? "#fff" : "#64748B",
                    }}
                  >
                    <span>{f}</span>
                    <span
                      className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
                        isSelected
                          ? "bg-white/20 text-white"
                          : f === "Active Queue" && count > 0
                            ? "bg-amber-100 text-amber-800"
                            : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {count}
                    </span>
                  </button>
                )
              })}
            </div>
            <div className="flex items-center gap-2 ml-auto">
              <button
                type="button"
                onClick={handleManualRefresh}
                title="Refresh Prescriptions"
                className="flex items-center gap-1.5 px-3 py-2 text-[12px] font-semibold text-[#0F766E] bg-white border border-[#E2E8F0] hover:bg-[#F0FDFA] rounded transition-colors"
              >
                <RefreshCw size={13} className={isRefreshing ? "animate-spin text-[#0F766E]" : "text-[#0F766E]"} />
                <span>Sync Live</span>
              </button>
              <div className="flex items-center gap-2 bg-white border border-[#E2E8F0] rounded px-3 py-2">
                <Search size={14} className="text-[#94A3B8]" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search patient, doctor, ID..."
                  className="text-[13px] outline-none text-[#0F1624] placeholder:text-[#94A3B8] w-44"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-y-auto px-6 pb-6 pt-4">
          <div className="bg-white rounded-xl shadow-sm border border-[#E2E8F0] overflow-hidden">
            <table className="w-full text-left border-collapse">
              <thead className="bg-[#ECFDF5] border-y border-[#A7F3D0]">
                <tr>
                  <th className="py-3 px-4 text-[11px] font-bold text-[#065F46] uppercase tracking-wider">Prescription ID</th>
                  <th className="py-3 px-4 text-[11px] font-bold text-[#065F46] uppercase tracking-wider">Patient</th>
                  <th className="py-3 px-4 text-[11px] font-bold text-[#065F46] uppercase tracking-wider">Doctor</th>
                  <th className="py-3 px-4 text-[11px] font-bold text-[#065F46] uppercase tracking-wider">Date & Time of Arrival</th>
                  <th className="py-3 px-4 text-[11px] font-bold text-[#065F46] uppercase tracking-wider text-center">Items & Inventory Stock</th>
                  <th className="py-3 px-4 text-[11px] font-bold text-[#065F46] uppercase tracking-wider">Priority</th>
                  <th className="py-3 px-4 text-[11px] font-bold text-[#065F46] uppercase tracking-wider">Status</th>
                  <th className="py-3 px-4 text-[11px] font-bold text-[#065F46] uppercase tracking-wider">Pharmacist</th>
                  <th className="py-3 px-4 text-[11px] font-bold text-[#065F46] uppercase tracking-wider">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E8F0]">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-16 text-center">
                      <div className="w-12 h-12 rounded bg-[#F0F2F5] flex items-center justify-center mx-auto">
                        <FileText size={22} className="text-[#94A3B8]" />
                      </div>
                      <p className="font-medium text-[#334155] mt-3">
                        No prescriptions found
                      </p>
                    </td>
                  </tr>
                ) : (
                  filtered.map((rx) => {
                    const stockStatus = getPrescriptionStockStatus(rx.rawItems, medicines, batches)
                    return (
                      <tr key={rx.id} onClick={() => setSelected(rx)} className="hover:bg-[#F0FDFA] transition-colors cursor-pointer"
                      >
                        <td className="py-3.5 px-4 font-mono text-[12px] font-semibold text-[#0F766E]">
                          {rx.id}
                        </td>
                        <td className="py-3.5 px-4">
                          <p className="font-medium text-[#0F1624] text-[13px]">
                            {rx.patient}
                          </p>
                          <p className="text-[11px] text-[#94A3B8] whitespace-nowrap">
                            {rx.age}y · {rx.gender} · {rx.contact}
                          </p>
                        </td>
                        <td className="py-3.5 px-4">
                          <p className="text-[13px] text-[#334155]">
                            {rx.doctor}
                          </p>
                          <p className="text-[11px] text-[#94A3B8]">
                            {rx.department}
                          </p>
                        </td>
                        <td className="py-3.5 px-4 text-[12px] whitespace-nowrap">
                          <p className="text-[#0F1624] font-medium">{rx.date}</p>
                          <p className="text-[11px] font-semibold text-[#0F766E] flex items-center gap-1 mt-0.5">
                            <Clock size={11} className="text-[#0F766E]" />
                            {rx.arrivalTime || rx.time || "Just now"}
                          </p>
                        </td>
                        <td className="py-3.5 px-4 text-[13px] font-semibold text-center">
                          <div className="flex flex-col items-center gap-1">
                            <span>{rx.items} {rx.items === 1 ? "item" : "items"}</span>
                            <span
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${stockStatus.badgeClass}`}
                              title={stockStatus.desc}
                            >
                              <span className={`w-1.5 h-1.5 rounded-full ${stockStatus.dotClass}`} />
                              {stockStatus.label}
                            </span>
                          </div>
                        </td>
                        <td className="py-3.5 px-4">
                          <StatusBadge status={rx.priority} size="sm" />
                        </td>
                        <td className="py-3.5 px-4">
                          <StatusBadge status={rx.status} size="sm" />
                        </td>
                        <td className="py-3.5 px-4 text-[13px] text-[#64748B]">
                          {rx.pharmacist ?? (
                            <span className="text-[#94A3B8] text-[12px]">—</span>
                          )}
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                setSelected(rx)
                              }}
                              className="flex items-center gap-1 text-[12px] font-medium px-2 py-1 rounded border border-[#E2E8F0] text-[#334155] hover:bg-[#F0F2F5] transition-colors"
                            >
                              View <ChevronRight size={12} />
                            </button>
                            {rx.status !== "dispensed" ? (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  localStorage.setItem("_v2_pharmacy_dispense_rx", rx.id)
                                  onNavigate("dispensing")
                                }}
                                className={`flex items-center gap-1 text-[11.5px] font-bold px-2.5 py-1 rounded transition-colors shadow-2xs cursor-pointer ${
                                  stockStatus.type === "mixed"
                                    ? "bg-amber-600 hover:bg-amber-700 text-white"
                                    : "bg-[#0F766E] hover:bg-[#0c5e58] text-white"
                                }`}
                                title={
                                  stockStatus.type === "mixed"
                                    ? "Sell available inventory items and complete dispensing"
                                    : "Dispense prescription"
                                }
                              >
                                <Play size={11} />{" "}
                                {stockStatus.type === "mixed"
                                  ? "Dispense Available"
                                  : "Dispense"}
                              </button>
                            ) : (
                              <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded">
                                ✓ Dispensed
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Detail Drawer */}
      {selected && (
        <div className="fixed inset-0 z-50 lg:static lg:inset-auto lg:z-auto w-full lg:w-96 bg-white border-l border-[#E2E8F0] flex flex-col flex-shrink-0 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-[#F0F2F5]">
            <div>
              <p className="font-semibold text-[14px] text-[#0F1624]">
                {selected.id}
              </p>
              <p className="text-[12px] text-[#0F766E] font-medium flex items-center gap-1 mt-0.5">
                <Clock size={12} /> Arrived: {selected.date} · {selected.arrivalTime || selected.time}
              </p>
            </div>
            <button
              onClick={() => setSelected(null)}
              className="p-1.5 rounded hover:bg-[#F0F2F5] text-[#94A3B8] transition-colors"
            >
              <X size={16} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            <Section icon={<User size={14} />} title="Patient">
              <Row label="Name" value={selected.patient} />
              <Row
                label="Age / Gender"
                value={selected.age + "y · " + selected.gender}
              />
              <Row label="Contact" value={selected.contact} />
              <Row label="Priority">
                <StatusBadge status={selected.priority} size="sm" />
              </Row>
            </Section>

            <Section icon={<Stethoscope size={14} />} title="Doctor & Clinical">
              <Row label="Doctor" value={selected.doctor} />
              <Row label="Department" value={selected.department} />
              <Row label="Diagnosis" value={selected.diagnosis} />
            </Section>

            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-[11px] font-semibold text-[#64748B] uppercase tracking-wide">
                  Prescribed Medicines
                </p>
                <span className="text-[11px] font-medium text-[#64748B]">
                  {selected.rawItems?.length || 0} items
                </span>
              </div>
              <div className="space-y-2">
                {selected.rawItems?.map((m: any, i: number) => {
                  const match = findMatchingMedicine(m, medicines, batches)
                  const isStocked = match.hasStock
                  const matchedMed = match.matchedMedicine
                  const rawName = m.medicineName || m.name || "Medicine"

                  return (
                    <div
                      key={i}
                      className={`p-3 rounded-lg border transition-all ${
                        isStocked
                          ? "border-emerald-200 bg-emerald-50/40"
                          : matchedMed
                          ? "border-amber-200 bg-amber-50/40"
                          : "border-rose-200 bg-rose-50/40"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-[13px] font-semibold text-[#0F1624]">
                            {rawName}
                          </p>
                          {matchedMed && (
                            <div className="text-[11px] text-[#0F766E] font-medium flex flex-wrap items-center gap-1.5 mt-1">
                              <span className="font-semibold text-emerald-800 flex items-center gap-0.5">
                                <Sparkles size={11} className="text-emerald-600" /> Matched:
                              </span>
                              <span className="text-slate-800 font-semibold">
                                {matchedMed.medicineName || matchedMed.brandName}
                              </span>
                              {matchedMed.strength && (
                                <span className="text-slate-500 font-mono text-[10px]">
                                  ({matchedMed.strength})
                                </span>
                              )}
                              <span
                                className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${
                                  match.hasStock
                                    ? "bg-emerald-100 text-emerald-800"
                                    : "bg-amber-100 text-amber-800"
                                }`}
                              >
                                {match.hasStock ? `${match.totalStock} in stock` : "0 in stock"}
                              </span>
                            </div>
                          )}
                          {!matchedMed && (
                            <p className="text-[11px] text-rose-600 flex items-center gap-1 mt-1">
                              <AlertCircle size={11} /> Not found in hospital catalog
                            </p>
                          )}
                        </div>
                        <span
                          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold shrink-0 ${
                            isStocked
                              ? "bg-emerald-100 text-emerald-800"
                              : matchedMed
                              ? "bg-amber-100 text-amber-800"
                              : "bg-rose-100 text-rose-800"
                          }`}
                        >
                          {isStocked
                            ? "In Inventory"
                            : matchedMed
                            ? "Out of Stock"
                            : "Non-Inventory"}
                        </span>
                      </div>
                      <p className="text-[11px] text-[#64748B] mt-1.5">
                        {m.dosage || "1 dose"} · {m.frequency || "Once"} · {m.duration || "Course"}
                      </p>
                      <p className="text-[11px] font-bold mt-1 text-[#0F766E]">
                        Qty: {m.quantity || 1}
                      </p>
                    </div>
                  )
                })}
              </div>
            </div>

            {selected.verificationNotes && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-[12px] text-amber-900">
                <p className="font-bold text-[11px] uppercase tracking-wide text-amber-800 mb-1">
                  Pharmacy Verification Note
                </p>
                <p>{selected.verificationNotes}</p>
              </div>
            )}

            <div className="flex items-center justify-between pt-1">
              <span className="text-[12px] text-[#64748B]">Status</span>
              <StatusBadge status={selected.status} />
            </div>
          </div>

          <div className="p-4 border-t border-[#E2E8F0] space-y-2">
            {selectedStock?.type === "mixed" && (
              <div className="p-2.5 bg-amber-50 border border-amber-200 text-amber-800 text-[11.5px] rounded">
                <strong>Semi-Inventory:</strong> Only available medicines will be allocated and sold. Completing sale will mark prescription as Dispensed and remove it from the active queue.
              </div>
            )}
            {selected.status !== "dispensed" && (
              <div className="grid grid-cols-1 gap-2">
                <button
                  onClick={handleDispense}
                  className={`flex items-center justify-center gap-1.5 py-2.5 rounded text-white text-[13px] font-bold hover:opacity-90 transition-colors shadow-xs cursor-pointer ${
                    selectedStock?.type === "mixed"
                      ? "bg-amber-600 hover:bg-amber-700"
                      : "bg-[#0F766E] hover:bg-[#0c5e58]"
                  }`}
                >
                  <Play size={13} />{" "}
                  {selectedStock?.type === "mixed"
                    ? "⚡ Dispense Available Items"
                    : "Dispense Prescription"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function Section({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode
  title: string
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2">
        <span className="text-[#64748B]">{icon}</span>
        <p className="text-[11px] font-semibold text-[#64748B] uppercase tracking-wide">
          {title}
        </p>
      </div>
      <div className="space-y-1.5 pl-5">{children}</div>
    </div>
  )
}

function Row({
  label,
  value,
  children,
}: {
  label: string
  value?: string
  children?: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[12px] text-[#94A3B8] flex-shrink-0">{label}</span>
      {children ?? (
        <span className="text-[13px] text-[#0F1624] font-medium text-right">
          {value}
        </span>
      )}
    </div>
  )
}
