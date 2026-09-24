// Cliente de la API. La sesión va en una cookie httpOnly, así que basta con fetch.

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function request(path, { method = "GET", body, json } = {}) {
  const opts = { method, headers: {} };
  if (json !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(json);
  } else if (body) {
    opts.body = body;
  }

  let res;
  try {
    res = await fetch(`/api${path}`, opts);
  } catch {
    throw new ApiError(0, "No hay conexión con el servidor.");
  }
  if (res.status === 204) return null;

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(res.status, data?.detail || `Error ${res.status}`);
  }
  return data;
}

export const api = {
  setupStatus: () => request("/setup"),
  setup: (data) => request("/setup", { method: "POST", json: data }),

  me: () => request("/auth/me"),
  publicGroups: () => request("/auth/groups"),
  register: (data) => request("/auth/register", { method: "POST", json: data }),
  login: (email, password) => request("/auth/login", { method: "POST", json: { email, password } }),
  logout: () => request("/auth/logout", { method: "POST" }),
  changePassword: (current, next) =>
    request("/auth/password", { method: "POST", json: { current, new: next } }),

  createGroup: (name) => request("/groups", { method: "POST", json: { name } }),
  groupsWithOwner: () => request("/groups"),
  setOwner: (slug, data) =>
    request(`/groups/${encodeURIComponent(slug)}/owner`, { method: "PUT", json: data }),
  requests: () => request("/requests"),
  approveRequest: (id) => request(`/requests/${id}/approve`, { method: "POST" }),
  rejectRequest: (id) => request(`/requests/${id}`, { method: "DELETE" }),
  deleteGroup: (slug) => request(`/groups/${encodeURIComponent(slug)}`, { method: "DELETE" }),

  members: (slug) => request(`/g/${encodeURIComponent(slug)}/members`),
  putMember: (slug, member) =>
    request(`/g/${encodeURIComponent(slug)}/members`, { method: "PUT", json: member }),
  removeMember: (slug, id) =>
    request(`/g/${encodeURIComponent(slug)}/members/${id}`, { method: "DELETE" }),

  schedule: (slug) => request(`/g/${encodeURIComponent(slug)}/schedule`),
  people: (slug) => request(`/g/${encodeURIComponent(slug)}/people`),
  person: (slug, name) =>
    request(`/g/${encodeURIComponent(slug)}/person?name=${encodeURIComponent(name)}`),
  addBlocks: (slug, data) =>
    request(`/g/${encodeURIComponent(slug)}/blocks`, { method: "POST", json: data }),
  updateBlock: (slug, id, name, data) =>
    request(`/g/${encodeURIComponent(slug)}/block/${id}?name=${encodeURIComponent(name)}`,
      { method: "PUT", json: data }),
  deleteBlock: (slug, id, name) =>
    request(`/g/${encodeURIComponent(slug)}/block/${id}?name=${encodeURIComponent(name)}`,
      { method: "DELETE" }),
  deleteAllPeople: (slug) =>
    request(`/g/${encodeURIComponent(slug)}/people`, { method: "DELETE" }),
  deletePerson: (slug, name) =>
    request(`/g/${encodeURIComponent(slug)}/person?name=${encodeURIComponent(name)}`, {
      method: "DELETE",
    }),
  upload: (slug, file) => {
    const form = new FormData();
    form.append("files", file);
    return request(`/g/${encodeURIComponent(slug)}/upload`, { method: "POST", body: form });
  },
};
