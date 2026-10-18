import test from "node:test";
import assert from "node:assert/strict";
import "./profile-view.js";

test("profile display removes repeated content while preserving distinct roles and sources", () => {
  const firstRole = { title: "Engineer", company: "Acme", start: "2023", end: "2024" };
  const secondRole = { ...firstRole, start: "2025", end: "" };
  const source = { type: "github", url: "https://github.com/asha", status: "read" };
  const profile = {
    data: {
      skills: ["JavaScript", " javascript ", "SQL", ""],
      email: "asha@example.com", phone: "  ",
      experience: [firstRole, { ...firstRole, title: " engineer " }, secondRole],
      education: [{ degree: "BSc", institution: "College", year: "2020" }, { degree: "bsc", institution: "college", year: "2020" }],
    },
    sources: [source, { ...source, url: "https://www.github.com/asha/" }, { ...source, url: "https://github.com/asha/project" }],
  };
  const result = globalThis.MayaProfileView(profile);
  assert.deepEqual(result.skills, ["JavaScript", "SQL"]);
  assert.deepEqual(result.contacts, ["asha@example.com"]);
  assert.equal(result.experience.length, 2);
  assert.equal(result.education.length, 1);
  assert.equal(result.sources.length, 2);
  assert.equal(profile.data.skills.length, 4, "saved data is not modified");
});
