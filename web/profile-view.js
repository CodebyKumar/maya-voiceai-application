// Presentation-only cleanup: preserve saved profile data while avoiding duplicate rows.
(() => {
  const text = (value) => typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  const key = (value) => text(value).toLocaleLowerCase();
  const unique = (items, identity) => {
    const seen = new Set();
    return (Array.isArray(items) ? items : []).filter((item) => {
      const id = identity(item);
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  };

  globalThis.MayaProfileView = (profile = {}) => {
    const data = profile.data || {};
    const records = (value, fields) => unique(value, (item) => {
      if (!item || typeof item !== "object") return "";
      const parts = fields.map((field) => key(item[field]));
      return parts.some(Boolean) ? JSON.stringify(parts) : "";
    });
    const sources = unique(profile.sources, (source) => {
      if (!source || typeof source !== "object") return "";
      return key(source.url).replace(/^https?:\/\/(www\.)?/, "").replace(/\/+$/, "") || [key(source.type), key(source.status)].filter(Boolean).join(":");
    });
    return {
      skills: unique((Array.isArray(data.skills) ? data.skills : []).map(text), key),
      experience: records(data.experience, ["title", "company", "start", "end"]),
      education: records(data.education, ["degree", "institution", "year"]),
      contacts: unique([text(data.email), text(data.phone)], key),
      sources,
    };
  };
})();
