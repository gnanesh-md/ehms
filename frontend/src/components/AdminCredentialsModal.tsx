import React, { useState, useEffect } from "react"
import { Lock, User, Mail, Phone, Eye, EyeOff, ShieldCheck, Check, AlertCircle, Loader2 } from "lucide-react"
import { apiFetch } from "../lib/api"
import { RoleDatabase } from "../services/roleDb"

interface AdminCredentialsModalProps {
  isOpen: boolean
  onClose: () => void
  onSaved?: (updated: { username: string; name: string; email?: string; phone?: string }) => void
}

export function AdminCredentialsModal({ isOpen, onClose, onSaved }: AdminCredentialsModalProps) {
  const [username, setUsername] = useState("admin")
  const [name, setName] = useState("System Administrator")
  const [email, setEmail] = useState("admin@hospital.com")
  const [phone, setPhone] = useState("+1-234-567-8901")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [fetching, setFetching] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")

  useEffect(() => {
    if (!isOpen) {
      setError("")
      setSuccess("")
      setPassword("")
      return
    }

    // Fetch latest credentials from backend or local storage
    setFetching(true)
    apiFetch<{ success: boolean; user?: any }>("/api/auth/current-credentials")
      .then((res) => {
        if (res?.user) {
          setUsername(res.user.username || "admin")
          setName(res.user.full_name || res.user.name || "System Administrator")
          setEmail(res.user.email || "")
          setPhone(res.user.phone || "")
        }
      })
      .catch(() => {
        // Fallback to RoleDatabase
        const users = RoleDatabase.getUsers()
        const adminUser = users.find((u) => u.username === "admin" || u.roleId === "ROLE_ADMIN")
        if (adminUser) {
          setUsername(adminUser.username)
          setName(adminUser.name)
        }
      })
      .finally(() => {
        setFetching(false)
      })
  }, [isOpen])

  if (!isOpen) return null

  const handleGeneratePassword = () => {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*"
    let pass = "Admin@"
    for (let i = 0; i < 6; i++) {
      pass += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    setPassword(pass)
    setShowPassword(true)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setSuccess("")

    const cleanUser = username.trim().toLowerCase()
    const cleanName = name.trim()

    if (!cleanUser) {
      setError("Username / User ID is required.")
      return
    }
    if (!cleanName) {
      setError("Administrator full name is required.")
      return
    }
    if (password && password.length < 6) {
      setError("New password must be at least 6 characters long.")
      return
    }

    setLoading(true)
    try {
      const payload: Record<string, string> = {
        username: cleanUser,
        name: cleanName,
        email: email.trim(),
        phone: phone.trim(),
      }
      if (password) {
        payload.password = password
      }

      let res: { success?: boolean; message?: string; error?: string; user?: any } | null = null
      try {
        res = await apiFetch<{ success: boolean; message?: string; error?: string; user?: any }>(
          "/api/auth/update-credentials",
          {
            method: "POST",
            body: JSON.stringify(payload),
          }
        )
      } catch (authErr: any) {
        // If unauthenticated session, fallback to direct admin reset endpoint
        res = await apiFetch<{ success: boolean; message?: string; error?: string; user?: any }>(
          "/api/auth/reset-admin-credentials",
          {
            method: "POST",
            body: JSON.stringify(payload),
          }
        )
      }

      if (!res?.success) {
        throw new Error(res?.error || "Failed to update admin credentials.")
      }

      // Also sync to frontend RoleDatabase
      const currentUsers = RoleDatabase.getUsers()
      const adminIdx = currentUsers.findIndex((u) => u.username === "admin" || u.roleId === "ROLE_ADMIN")
      if (adminIdx >= 0) {
        const adminObj = { ...currentUsers[adminIdx] }
        adminObj.username = cleanUser
        adminObj.name = cleanName
        if (password) adminObj.password = password
        RoleDatabase.upsertUser(adminObj)
      }

      setSuccess("System Administrator credentials updated successfully.")
      if (onSaved) {
        onSaved({ username: cleanUser, name: cleanName, email: email.trim(), phone: phone.trim() })
      }

      setTimeout(() => {
        onClose()
      }, 1500)
    } catch (err: any) {
      setError(err?.message || "An error occurred while saving credentials.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
      <div className="bg-white border border-[#CBD5E1] shadow-2xl rounded-none w-full max-w-lg overflow-hidden flex flex-col animate-in fade-in duration-200">
        {/* Header */}
        <div className="px-6 py-4.5 bg-gradient-to-r from-[#0C1524] to-[#1E293B] text-white flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="w-8 h-8 rounded-full bg-[#1B4FD8] flex items-center justify-center text-white">
              <ShieldCheck className="w-5 h-5" />
            </span>
            <div>
              <h3 className="text-[15px] font-bold tracking-tight">Edit System Admin Credentials</h3>
              <p className="text-[11.5px] text-[#94A3B8]">Update master administrator login, name and password</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[#94A3B8] hover:text-white font-bold p-1 transition-colors cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-[12px] flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
              <span>{error}</span>
            </div>
          )}

          {success && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-[12px] flex items-center gap-2 font-medium">
              <Check className="w-4 h-4 shrink-0 text-emerald-600" />
              <span>{success}</span>
            </div>
          )}

          {fetching ? (
            <div className="py-12 flex flex-col items-center justify-center text-[#64748B] text-[13px] gap-2">
              <Loader2 className="w-6 h-6 animate-spin text-[#1B4FD8]" />
              <span>Loading current credentials...</span>
            </div>
          ) : (
            <>
              {/* User ID / Username */}
              <div>
                <label className="block text-[12px] font-bold text-[#334155] mb-1">
                  Login User ID / Username <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <User className="w-4 h-4 text-[#94A3B8] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    required
                    value={username}
                    onChange={(e) => setUsername(e.target.value.toLowerCase().trim())}
                    placeholder="e.g. admin"
                    className="w-full bg-[#FBFCFE] border border-[#DDE2EC] pl-9 pr-3.5 py-2 text-[13px] text-[#0F172A] font-mono focus:bg-white focus:outline-none focus:border-[#1B4FD8]"
                  />
                </div>
                <p className="text-[11px] text-[#64748B] mt-1">
                  Used at sign-in step 2 under System Administrator.
                </p>
              </div>

              {/* Full Name */}
              <div>
                <label className="block text-[12px] font-bold text-[#334155] mb-1">
                  Administrator Display Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. System Administrator or Dr. Admin"
                  className="w-full bg-[#FBFCFE] border border-[#DDE2EC] px-3.5 py-2 text-[13px] text-[#0F172A] focus:bg-white focus:outline-none focus:border-[#1B4FD8]"
                />
              </div>

              {/* Email & Phone */}
              <div className="grid grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-[12px] font-bold text-[#334155] mb-1">
                    Official Email
                  </label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-[#94A3B8] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="admin@hospital.com"
                      className="w-full bg-[#FBFCFE] border border-[#DDE2EC] pl-9 pr-3.5 py-2 text-[13px] text-[#0F172A] focus:bg-white focus:outline-none focus:border-[#1B4FD8]"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[12px] font-bold text-[#334155] mb-1">
                    Contact Phone
                  </label>
                  <div className="relative">
                    <Phone className="w-4 h-4 text-[#94A3B8] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="+1-234-567-8901"
                      className="w-full bg-[#FBFCFE] border border-[#DDE2EC] pl-9 pr-3.5 py-2 text-[13px] text-[#0F172A] focus:bg-white focus:outline-none focus:border-[#1B4FD8]"
                    />
                  </div>
                </div>
              </div>

              {/* Password */}
              <div className="pt-2 border-t border-[#E2E8F0]">
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-[12px] font-bold text-[#334155]">
                    New Password <span className="text-[#64748B] font-normal">(leave blank to keep current)</span>
                  </label>
                  <button
                    type="button"
                    onClick={handleGeneratePassword}
                    className="text-[11px] font-semibold text-[#1B4FD8] hover:underline cursor-pointer"
                  >
                    🎲 Generate Password
                  </button>
                </div>
                <div className="relative">
                  <Lock className="w-4 h-4 text-[#94A3B8] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter new password to change..."
                    autoComplete="new-password"
                    className="w-full bg-[#FBFCFE] border border-[#DDE2EC] pl-9 pr-10 py-2 text-[13px] text-[#0F172A] font-mono focus:bg-white focus:outline-none focus:border-[#1B4FD8]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-[#94A3B8] hover:text-[#1B4FD8] transition-colors"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {password && (
                  <p className="text-[11px] text-[#059669] font-medium mt-1">
                    ✓ Password will be securely hashed with bcrypt upon saving.
                  </p>
                )}
              </div>

              {/* Actions */}
              <div className="pt-3 flex items-center justify-end gap-2.5 border-t border-[#E2E8F0]">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={loading}
                  className="px-4 py-2 text-[12.5px] font-semibold text-[#64748B] hover:text-[#0F172A] bg-white border border-[#CBD5E1] transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-5 py-2 text-[12.5px] font-bold text-white bg-[#1B4FD8] hover:bg-[#163FB5] flex items-center gap-2 transition-colors cursor-pointer disabled:opacity-50"
                >
                  {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>Save Admin Credentials</span>
                </button>
              </div>
            </>
          )}
        </form>
      </div>
    </div>
  )
}
