"use client";

import { useCallback, useEffect, useState } from "react";
import { api, formatBytes, formatDate } from "@/lib/format";
import Modal from "@/components/Modal";
import ConfirmModal from "@/components/ConfirmModal";
import { showToast } from "@/components/ui/alert-toast";

interface AdminUser {
  id: string;
  account: string;
  nickname: string;
  school: string | null;
  role: string;
  createdAt: string;
  documentCount: number;
  certificateCount: number;
  storageUsed: number;
}

const emptyCreate = { account: "", nickname: "", school: "", password: "", role: "user" };

export default function UsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [meId, setMeId] = useState<string | null>(null);

  // 新增弹窗
  const [addOpen, setAddOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ ...emptyCreate });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  // 编辑弹窗（account 存入表单状态，退出动画期间 editUser 已置空也能渲染）
  const [editUser, setEditUser] = useState<AdminUser | null>(null);
  const [editForm, setEditForm] = useState({ account: "", nickname: "", school: "", role: "user", password: "" });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set("q", query.trim());
      const data = await api<{ users: AdminUser[] }>(`/api/admin/users?${params}`);
      setUsers(data.users);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    load();
  }, [load]);

  // 当前登录者 id（用于禁用“删除自己”）
  useEffect(() => {
    fetch("/api/account")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d?.user?.id && setMeId(d.user.id))
      .catch(() => {});
  }, []);

  async function addUser(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");
    setSaving(true);
    try {
      await api("/api/admin/users", { method: "POST", json: createForm });
      setAddOpen(false);
      setCreateForm({ ...emptyCreate });
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "创建失败");
    } finally {
      setSaving(false);
    }
  }

  function startEdit(u: AdminUser) {
    setEditUser(u);
    setEditForm({ account: u.account, nickname: u.nickname, school: u.school ?? "", role: u.role, password: "" });
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editUser) return;
    try {
      const payload: Record<string, string> = {
        nickname: editForm.nickname,
        school: editForm.school,
        role: editForm.role,
      };
      if (editForm.password) payload.password = editForm.password;
      await api(`/api/admin/users/${editUser.id}`, { method: "PATCH", json: payload });
      setEditUser(null);
      await load();
      showToast.success("保存成功");
    } catch (err) {
      showToast.error(err instanceof Error ? err.message : "保存失败");
    }
  }

  const [confirmUser, setConfirmUser] = useState<AdminUser | null>(null);
  const [deleting, setDeleting] = useState(false);

  function removeUser(u: AdminUser) {
    setConfirmUser(u);
  }

  async function executeRemoveUser() {
    if (!confirmUser) return;
    setDeleting(true);
    try {
      await api(`/api/admin/users/${confirmUser.id}`, { method: "DELETE" });
      setConfirmUser(null);
      await load();
      showToast.success("删除成功");
    } catch (err) {
      showToast.error(err instanceof Error ? err.message : "删除失败");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div>
      {/* 面板头 */}
      <div className="flex items-end justify-between flex-wrap gap-3 mb-5">
        <div>
          <div className="panel-title">👤 人员管理</div>
        </div>
        <button className="btn btn-ink" onClick={() => setAddOpen(true)}>
          ＋ 新增用户
        </button>
      </div>

      {/* 搜索 */}
      <div className="chip-row">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索账号 / 昵称 / 学校…"
          className="input !w-56 !py-1.5 !rounded-full text-[12.5px]"
        />
        <span className="text-[12px]" style={{ color: "var(--ink-faint)" }}>
          共 {users.length} 个账号
        </span>
      </div>

      {error && <div className="alert-error mb-4">{error}</div>}

      {loading && users.length === 0 ? (
        <p className="py-16 text-center text-sm" style={{ color: "var(--ink-faint)" }}>
          加载中…
        </p>
      ) : users.length === 0 ? (
        <div className="empty">
          <div className="empty-mark">👤</div>
          <b>暂无匹配账号</b>
        </div>
      ) : (
        <>
          {/* 桌面表格 */}
          <div className="cert-table-wrap hidden md:block">
            <table className="cert-table">
              <thead>
                <tr>
                  <th>账号</th>
                  <th>昵称</th>
                  <th>单位 / 学校</th>
                  <th>角色</th>
                  <th>材料 / 证书</th>
                  <th>占用</th>
                  <th>建档日期</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td className="mono" style={{ fontSize: 12 }}>
                      {u.account}
                    </td>
                    <td className="font-semibold">
                      {u.nickname}
                      {u.id === meId && (
                        <span className="level-pill !ml-2" style={{ background: "var(--blue-soft)", color: "var(--blue)" }}>
                          我
                        </span>
                      )}
                    </td>
                    <td style={{ color: "var(--ink-soft)" }}>{u.school || "—"}</td>
                    <td>
                      <span className={`level-pill ${u.role === "admin" ? "lv-top" : ""}`}>
                        {u.role === "admin" ? "管理员" : "用户"}
                      </span>
                    </td>
                    <td className="mono" style={{ fontSize: 12, color: "var(--ink-soft)" }}>
                      {u.documentCount} / {u.certificateCount}
                    </td>
                    <td className="mono" style={{ fontSize: 12, color: "var(--ink-faint)" }}>
                      {formatBytes(u.storageUsed)}
                    </td>
                    <td className="mono" style={{ fontSize: 12, color: "var(--ink-soft)" }}>
                      {formatDate(u.createdAt)}
                    </td>
                    <td className="whitespace-nowrap text-right">
                      <button className="link-btn" style={{ color: "var(--blue)" }} onClick={() => startEdit(u)}>
                        编辑
                      </button>
                      <button
                        className="link-btn ml-2"
                        style={{ color: "var(--stamp)" }}
                        disabled={u.id === meId}
                        onClick={() => removeUser(u)}
                        title={u.id === meId ? "不能删除自己的账号" : ""}
                      >
                        删除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 移动端卡片 */}
          <div className="space-y-3 md:hidden">
            {users.map((u) => (
              <div key={u.id} className="card p-4">
                <div className="flex items-start justify-between gap-2.5">
                  <div className="min-w-0">
                    <div className="font-semibold text-[13.5px]">
                      {u.nickname}
                      <span className={`level-pill !ml-2 ${u.role === "admin" ? "lv-top" : ""}`}>
                        {u.role === "admin" ? "管理员" : "用户"}
                      </span>
                    </div>
                    <div className="text-[12px] mt-1 mono" style={{ color: "var(--ink-soft)" }}>
                      {u.account} · {u.school || "未填单位"}
                    </div>
                    <div className="text-[11.5px] mt-1" style={{ color: "var(--ink-faint)" }}>
                      {u.documentCount} 份材料 · {formatBytes(u.storageUsed)} · {formatDate(u.createdAt)}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3 mt-3">
                  <button className="link-btn" style={{ color: "var(--blue)" }} onClick={() => startEdit(u)}>
                    编辑
                  </button>
                  <button
                    className="link-btn"
                    style={{ color: "var(--stamp)" }}
                    disabled={u.id === meId}
                    onClick={() => removeUser(u)}
                  >
                    删除
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* 新增弹窗 */}
      <Modal open={addOpen} onClose={() => setAddOpen(false)} maxWidth={480}>
        <button
          type="button"
          className="modal-close-btn"
          onClick={() => setAddOpen(false)}
          aria-label="关闭"
        >
          ✕
        </button>
        <form onSubmit={addUser}>
          <h3 className="modal-title mb-4">新增用户</h3>
          <div className="space-y-3.5">
            <div>
              <label className="label">账号（手机号 / 邮箱）*</label>
              <input
                value={createForm.account}
                onChange={(e) => setCreateForm({ ...createForm, account: e.target.value })}
                placeholder="手机号或邮箱"
                required
                className="input"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">昵称</label>
                <input
                  value={createForm.nickname}
                  onChange={(e) => setCreateForm({ ...createForm, nickname: e.target.value })}
                  placeholder="怎么称呼"
                  className="input"
                />
              </div>
              <div>
                <label className="label">单位 / 学校</label>
                <input
                  value={createForm.school}
                  onChange={(e) => setCreateForm({ ...createForm, school: e.target.value })}
                  placeholder="选填"
                  className="input"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">初始密码 *</label>
                <input
                  type="password"
                  value={createForm.password}
                  onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })}
                  placeholder="至少 8 位"
                  required
                  minLength={8}
                  className="input"
                />
              </div>
              <div>
                <label className="label">角色</label>
                <select
                  value={createForm.role}
                  onChange={(e) => setCreateForm({ ...createForm, role: e.target.value })}
                  className="input"
                >
                  <option value="user">用户</option>
                  <option value="admin">管理员</option>
                </select>
              </div>
            </div>
            {formError && <div className="alert-error">{formError}</div>}
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={() => setAddOpen(false)} className="btn btn-ghost flex-1">
                取消
              </button>
              <button type="submit" disabled={saving} className="btn btn-ink flex-1">
                {saving ? "创建中…" : "创建"}
              </button>
            </div>
          </div>
        </form>
      </Modal>

      {/* 编辑弹窗 */}
      <Modal open={!!editUser} onClose={() => setEditUser(null)} maxWidth={480}>
        <button
          type="button"
          className="modal-close-btn"
          onClick={() => setEditUser(null)}
          aria-label="关闭"
        >
          ✕
        </button>
        <form onSubmit={saveEdit}>
          <h3 className="modal-title mb-4">编辑用户</h3>
          <div className="space-y-3.5">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">昵称</label>
                <input
                  value={editForm.nickname}
                  onChange={(e) => setEditForm({ ...editForm, nickname: e.target.value })}
                  className="input"
                  required
                />
              </div>
              <div>
                <label className="label">单位 / 学校</label>
                <input
                  value={editForm.school}
                  onChange={(e) => setEditForm({ ...editForm, school: e.target.value })}
                  placeholder="选填"
                  className="input"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">角色</label>
                <select
                  value={editForm.role}
                  onChange={(e) => setEditForm({ ...editForm, role: e.target.value })}
                  className="input"
                >
                  <option value="user">用户</option>
                  <option value="admin">管理员</option>
                </select>
              </div>
              <div>
                <label className="label">重置密码</label>
                <input
                  type="password"
                  value={editForm.password}
                  onChange={(e) => setEditForm({ ...editForm, password: e.target.value })}
                  placeholder="留空则不修改"
                  minLength={8}
                  className="input"
                />
              </div>
            </div>
            {editForm.password && (
              <div className="alert-error" style={{ background: "rgba(255,149,0,.08)", borderColor: "rgba(255,149,0,.25)", color: "#c93400" }}>
                重置密码后，该用户已上传的端到端加密材料将无法再解密（加密密钥由旧密码包裹），请谨慎操作
              </div>
            )}
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={() => setEditUser(null)} className="btn btn-ghost flex-1">
                取消
              </button>
              <button type="submit" className="btn btn-ink flex-1">
                保存
              </button>
            </div>
          </div>
        </form>
      </Modal>

      <ConfirmModal
        open={!!confirmUser}
        danger
        icon="👤"
        title="删除用户账号？"
        description={
          confirmUser
            ? `确定删除「${confirmUser.nickname}（${confirmUser.account}）」吗？`
            : undefined
        }
        confirmText="彻底删除"
        cancelText="取消"
        loading={deleting}
        onClose={() => setConfirmUser(null)}
        onConfirm={executeRemoveUser}
      />
    </div>
  );
}
