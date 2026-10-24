import assert from "node:assert/strict";

export const publicReleasePackages = ["cli", "agent-harness", "workspace", "memory-server"];

// Source may retain pre-migration versions; every generated release must converge.
export function validatePublicPackageVersions(extraFiles, version, packages) {
  for (const name of publicReleasePackages) {
    const path = `packages/${name}/package.json`;
    const updates = extraFiles.filter(entry => entry.path === path);
    assert.equal(updates.length, 1, `Release must update ${path} exactly once`);
    assert.equal(updates[0].type, "json", path);
    assert.equal(updates[0].jsonpath, "$.version", path);
    if (packages) assert.equal(packages[name].version, version, `Public package release version mismatch: ${path}`);
  }
}
