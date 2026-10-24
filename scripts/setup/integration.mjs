import { readdirSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { randomBytes } from "node:crypto";
import { compareStableVersions } from "./releases.mjs";
import { hash, fail, stat, checked, identity, file, snapshot, atomic, allowed, required, parseJSON, writePreviewManifest } from "./activation.mjs";
import { mergePrimaryInstructions, PRIMARY_BEGIN, PRIMARY_END } from "../../packages/codex-adapter/src/primary-instructions.js";

export const receiptPath = ".alfred/setup/installation.json";
export const journalPath = ".alfred/setup/update-attempt.json";
const ids = ["codex-cli", "codex-app", "opencode"];
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const savedSelection = ({path, ...selection}) => selection;
const newerStable = (installed, target) => { try { return compareStableVersions(installed,target)>0; } catch { return false; } };
const plain = v => v !== null && typeof v === "object" && !Array.isArray(v);
const own = (v,k) => Object.hasOwn(v,k);
function block(text) {
  if (typeof text !== "string") fail("Missing managed Alfred instruction block.");
  const start = text.indexOf(PRIMARY_BEGIN), end = text.indexOf(PRIMARY_END);
  if (start < 0 || end < start || text.lastIndexOf(PRIMARY_BEGIN) !== start || text.lastIndexOf(PRIMARY_END) !== end) fail("Missing or ambiguous Alfred instruction markers.");
  return text.slice(start, end + PRIMARY_END.length).trimEnd();
}
function leaves(v, path = [], out = []) {
  for (const [k,x] of Object.entries(v)) {
    if (["__proto__", "constructor", "prototype"].includes(k)) fail("Unsafe configuration property.");
    if (plain(x)) leaves(x, [...path,k], out); else out.push({ path: [...path,k], value: x });
  }
  return out;
}
function get(v, path) { for (const k of path) { if (!plain(v) || !own(v,k)) return undefined; v=v[k]; } return v; }
function set(v, path, value) {
  let o=v;
  for (const k of path.slice(0,-1)) { if (!own(o,k)) o[k]={}; if (!plain(o[k])) fail(`Configuration structure changed: ${path.join(".")}`); o=o[k]; }
  if (value === undefined) delete o[path.at(-1)]; else o[path.at(-1)]=value;
}
function kind(target) { return target === "opencode.json" ? "json" : ["AGENTS.md","AGENTS.override.md"].includes(target) ? "block" : "file"; }
function record(entry, installed, previous) {
  const type=kind(entry.target), result={ harness:entry.harness, target:entry.target, kind:type, generatedHash:hash(entry.generated ?? entry.content) };
  if(type === "file") result.installedHash=hash(installed);
  if(type === "block") result.base=block(installed);
  if(type === "json") {
    const defaults=parseJSON(entry.generated ?? entry.content), actual=parseJSON(installed), prior=previous === undefined ? null : parseJSON(previous || "{}");
    result.base=leaves(defaults).flatMap(item => {
      const value=get(actual,item.path), before=prior && get(prior,item.path);
      if(item.path.length === 1 && item.path[0] === "instructions" && Array.isArray(item.value) && Array.isArray(value)) {
        const owned=item.value.filter(x=>value.includes(x) && (!prior || !(before ?? []).includes(x)));
        return owned.length ? [{path:item.path,value:owned}] : [];
      }
      return same(value,item.value) && (!prior || before === undefined) ? [item] : [];
    });
  }
  return result;
}
function validateRecord(r) {
  if(!r || !["codex","opencode"].includes(r.harness) || !(allowed(r.harness,r.target) || r.harness === "codex" && r.target === "AGENTS.override.md") || r.kind !== kind(r.target) || !/^[a-f0-9]{64}$/.test(r.generatedHash)) fail("Invalid integration receipt artifact.");
  if(r.kind === "file" && !/^[a-f0-9]{64}$/.test(r.installedHash)) fail("Invalid integration baseline.");
  if(r.kind === "block" && block(r.base) !== r.base) fail("Invalid instruction baseline.");
  if(r.kind === "json") {
    if(!Array.isArray(r.base) || r.base.length>512) fail("Invalid configuration baseline.");
    const seen=new Set();
    for(const item of r.base) {
      if(!Array.isArray(item.path) || item.path.length<1 || item.path.length>20 || item.path.some(k=>typeof k!=="string" || !k || ["__proto__","constructor","prototype"].includes(k)) || item.value === undefined || seen.has(JSON.stringify(item.path))) fail("Invalid configuration baseline path.");
      seen.add(JSON.stringify(item.path));
    }
  }
}
function validateReceipt(r, projectRoot) {
  if(r?.schema !== "alfred.setup.installation/v1" || r.project !== projectRoot || typeof r.integrationVersion !== "string" || !/^(?:legacy|\d+\.\d+\.\d+(?:[-+][\w.-]+)?)$/.test(r.integrationVersion) || !Array.isArray(r.harnesses) || !r.harnesses.length || new Set(r.harnesses).size!==r.harnesses.length || r.harnesses.some(h=>!ids.includes(h)) || !Array.isArray(r.files) || r.files.length>512) fail("Invalid installation receipt; preserve it and resolve the conflict.");
  if(r.selection && (!plain(r.selection) || Object.keys(r.selection).some(k=>!["edition","harnesses","memory","name","profiles"].includes(k)) || !["coding","memory","full"].includes(r.selection.edition) || !["decide-later","existing-tenant","local-sqlite","postgres"].includes(r.selection.memory) || typeof r.selection.profiles!=="boolean" || typeof r.selection.name!=="string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(r.selection.name) || !Array.isArray(r.selection.harnesses) || !same([...r.selection.harnesses].filter(h=>ids.includes(h)).sort(),[...r.harnesses].sort()))) fail("Invalid saved setup choices.");
  const targets=new Set();
  for(const entry of r.files) { validateRecord(entry); if(targets.has(entry.target)) fail("Duplicate receipt target."); targets.add(entry.target); }
  for(const h of [...new Set(r.harnesses.map(x=>x.startsWith("codex-")?"codex":x))]) for(const p of required(h)) if(!targets.has(p) && !(p === "AGENTS.md" && targets.has("AGENTS.override.md"))) fail(`Incomplete integration baseline: ${p}`);
  return r;
}
function readReceipt(projectRoot) {
  const raw=file(projectRoot,receiptPath);
  if(raw.content === null) return null;
  let value; try { value=JSON.parse(raw.content); } catch { fail("Invalid installation receipt JSON."); }
  return validateReceipt(value,projectRoot);
}
function readArtifacts(previewRoot,harness) {
  const prefix=`${harness}-install/`, mf=file(previewRoot,prefix+"activation-manifest.json");
  let manifest; try { manifest=JSON.parse(mf.content); } catch { fail(`Missing ${harness} preview manifest.`); }
  if(manifest.schema!=="alfred.activation-preview/v1" || manifest.harness!==harness || !Array.isArray(manifest.files) || manifest.files.length>512) fail("Invalid integration preview manifest.");
  const seen=new Set(), entries=[];
  for(const item of manifest.files) {
    if(!allowed(harness,item.target) || seen.has(item.target)) fail("Invalid or duplicate preview artifact.");
    seen.add(item.target);
    const source=prefix+item.source, f=file(previewRoot,source);
    if(f.content===null || f.digest!==item.sha256) fail(`Preview hash changed: ${source}`);
    entries.push({harness,target:item.target,generated:f.content,source,sourceHash:f.digest});
  }
  for(const p of required(harness)) if(!seen.has(p)) fail(`Incomplete preview: ${p}`);
  return entries;
}
function currentTarget(projectRoot,entry) {
  if(entry.target === "AGENTS.md" && file(projectRoot,"AGENTS.override.md").content?.trim()) return "AGENTS.override.md";
  return entry.target;
}
function matches(r, current) {
  if(current === null) return false;
  if(r.kind === "file") return hash(current)===r.installedHash;
  if(r.kind === "block") return block(current)===r.base;
  const parsed=parseJSON(current);
  return r.base.every(item=>item.path.length===1 && item.path[0]==="instructions" ? Array.isArray(parsed.instructions) && item.value.every(x=>parsed.instructions.includes(x)) : same(get(parsed,item.path),item.value));
}
function legacyReceipt(projectRoot) {
  const root=checked(projectRoot,".alfred/setup/previews"), s=stat(root);
  if(!s) return null;
  if(!s.isDirectory()) fail("Invalid legacy preview directory.");
  const sessions=readdirSync(root).sort(); if(sessions.length>128) fail("Too many legacy previews; select and preserve the intended installation evidence.");
  const candidates=new Map(), observed=new Set();
  for(const name of sessions) {
    const preview=checked(projectRoot,`.alfred/setup/previews/${name}`);
    if(!stat(preview)?.isDirectory()) continue;
    for(const h of ["codex","opencode"]) {
      if(!stat(checked(projectRoot,`.alfred/setup/previews/${name}/${h}-install/activation-manifest.json`))) continue;
      const artifacts=readArtifacts(preview,h), files=[];
      if(artifacts.some(e=>e.target.includes("/skills/alfred/SKILL.md") && file(projectRoot,e.target).content!==null)) observed.add(h);
      let intact=true;
      for(const e of artifacts) {
        const target=currentTarget(projectRoot,e), current=file(projectRoot,target).content;
        if(current===null) { intact=false; break; }
        const r=record({...e,target,content:e.generated},e.generated);
        if(!matches(r,current)) { intact=false; break; }
        files.push(r);
      }
      if(!intact) continue;
      const harnesses=h==="opencode"?["opencode"]:["codex-cli","codex-app"].filter(id=>stat(checked(projectRoot,`.alfred/setup/previews/${name}/${id}-install/activation-manifest.json`)));
      if(!harnesses.length) continue; // Update-only previews are not evidence of a legacy CLI/app selection.
      const candidate={files,harnesses}, existing=candidates.get(h);
      if(existing && !same(existing.files,files)) fail(`Ambiguous legacy ${h} installation evidence.`);
      candidates.set(h,{files,harnesses:[...new Set([...(existing?.harnesses??[]),...harnesses])].sort()});
    }
  }
  for(const h of observed) if(!candidates.has(h)) fail(`Legacy ${h} files differ from every verified preview; preserve local edits before updating.`);
  if(!candidates.size) return null;
  const files=[...candidates.values()].flatMap(x=>x.files), harnesses=[...candidates.values()].flatMap(x=>x.harnesses).sort();
  return validateReceipt({schema:"alfred.setup.installation/v1",project:projectRoot,integrationVersion:"legacy",runtimeVersion:"legacy",harnesses,files},projectRoot);
}
export function inspectIntegration(projectRoot,version) {
  try {
    identity(projectRoot);
    const receipt=readReceipt(projectRoot), legacy=receipt?null:recoverLegacy(projectRoot)??legacyReceipt(projectRoot), state=receipt??legacy;
    if(!state) return {status:"none",version:"",text:"Project integration: not installed by setup",canUpdate:false};
    return {status:receipt?"managed":"legacy",version:state.integrationVersion,text:`Project integration: ${state.integrationVersion}${receipt?.integrationVersion===version?" · current runtime":" · review update"}`,canUpdate:true,harnesses:state.harnesses,selection:state.selection};
  } catch(e) { return {status:"blocked",version:"",text:`Project integration blocked: ${e.code?.startsWith("E")?"cannot read installation evidence":e.message}`,canUpdate:false}; }
}
function writeState(projectRoot,name,value,write=atomic) {
  const p=checked(projectRoot,name); mkdirSync(dirname(p),{recursive:true}); checked(projectRoot,name); write(p,JSON.stringify(value,null,2)+"\n",0o600);
}
export function activationReceipt(plan,{version,selection}) {
  const harnesses=selection.harnesses.filter(h=>ids.includes(h));
  const prior=readReceipt(plan.project.root);
  if(prior) fail("This project already has a recorded integration. Use Update to preserve its installed baselines and saved harness selection.");
  return {schema:"alfred.setup.installation/v1",project:plan.project.root,runtimeVersion:version,integrationVersion:version,harnesses,selection:savedSelection(selection),files:plan.entries.map(e=>record({...e,generated:file(plan.preview.root,e.source).content},e.content,file(plan.project.root,e.target).content??"{}"))};
}
export function saveActivationReceipt(plan,receipt,{write=atomic}={}) {
  validateReceipt(receipt,plan.project.root);
  for(const e of plan.entries) if(file(plan.project.root,e.target).digest!==e.sha256) fail("Activation changed before recording installation.");
  if(file(plan.project.root,receiptPath).content!==null) fail("Installation receipt changed before recording activation.");
  writeState(plan.project.root,receiptPath,receipt,write);
}
export async function generateIntegrationPreview({installRoot,projectRoot,harnesses}) {
  const relative=`.alfred/setup/previews/${randomBytes(12).toString("hex")}`, previewRoot=checked(projectRoot,relative);
  mkdirSync(previewRoot,{recursive:true}); identity(previewRoot);
  for(const harness of [...new Set(harnesses.map(h=>h.startsWith("codex-")?"codex":h))]) {
    const mod=await import(pathToFileURL(join(installRoot,`packages/${harness}-adapter/src/runtime.js`)));
    const build=harness==="codex"?mod.buildCodexInstallPreview:mod.buildOpencodeInstallPreview;
    const preview=build({root:installRoot,projectRoot:installRoot,outputDir:`${harness}-install`});
    preview.files=preview.files.map(f=>{
      if(!allowed(harness,f.install_path)) fail("Adapter generated an unsupported update target.");
      const source=`${harness}-install/${f.install_path === "opencode.json"?"opencode.json.preview":f.install_path}`, path=checked(previewRoot,source);
      mkdirSync(dirname(path),{recursive:true}); checked(previewRoot,source); atomic(path,f.content);
      return {...f,path};
    });
    writePreviewManifest({root:previewRoot,preview});
  }
  return previewRoot;
}
function mergeConfig(current,base,generated) {
  const value=parseJSON(current), defaults=parseJSON(generated), old=new Map(base.map(x=>[JSON.stringify(x.path),x]));
  const next=[];
  for(const item of leaves(defaults)) {
    const key=JSON.stringify(item.path), prior=old.get(key), actual=get(value,item.path); old.delete(key);
    if(item.path.length===1 && item.path[0]==="instructions") {
      if(!Array.isArray(item.value) || item.value.some(x=>typeof x!=="string") || actual!==undefined && (!Array.isArray(actual) || actual.some(x=>typeof x!=="string"))) fail("Invalid OpenCode instructions.");
      const owned=prior?.value??[];
      if(owned.some(x=>!actual?.includes(x))) fail("Managed OpenCode instructions were removed.");
      const unrelated=(actual??[]).filter(x=>!owned.includes(x));
      const additions=item.value.filter(x=>!unrelated.includes(x));
      value.instructions=[...new Set([...unrelated,...item.value])];
      if(additions.length) next.push({path:item.path,value:additions});
    } else if(prior) {
      if(!same(actual,prior.value) && !same(actual,item.value)) fail(`Customized OpenCode setting: ${item.path.join(".")}`);
      set(value,item.path,item.value); next.push(item);
    } else if(actual===undefined) { set(value,item.path,item.value); next.push(item); }
  }
  for(const prior of old.values()) { if(!same(get(value,prior.path),prior.value)) fail(`Customized retired setting: ${prior.path.join(".")}`); set(value,prior.path,undefined); }
  return {content:JSON.stringify(value,null,2)+"\n",base:next};
}
function readAttempt(projectRoot) {
  const raw=file(projectRoot,journalPath); if(raw.content===null) return null;
  let j;try{j=JSON.parse(raw.content);}catch{fail("Invalid update recovery journal.");}
  if(j.schema!=="alfred.setup.attempt/v1" || j.project!==projectRoot || j.humanApproval!==true || !/^[a-f0-9]{64}$/.test(j.finalReceiptHash) || !/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(j.version??"") || !Array.isArray(j.entries) || j.entries.length>512) fail("Update recovery evidence changed; preserve and resolve it before retrying.");
  const seen=new Set();
  for(const e of j.entries) {
    validateRecord(e.record);
    if(e.target!==e.record.target || seen.has(e.target) || !/^[a-f0-9]{64}$/.test(e.after) || e.before!==null && !/^[a-f0-9]{64}$/.test(e.before) || e.record.kind==="file" && e.record.installedHash!==e.after) fail("Invalid update recovery artifact.");
    seen.add(e.target);
  }
  validateReceipt(j.baseInstallation,projectRoot);
  if(j.baseInstallation.files.some(e=>!seen.has(e.target))) fail("Incomplete update recovery baseline.");
  return j;
}
function recoverLegacy(projectRoot) {
  const j=readAttempt(projectRoot);
  if(!j) return null;
  if(j.baseReceiptHash!==null || j.baseInstallation.integrationVersion!=="legacy") fail("The recorded installation receipt is missing; restore it before retrying the update.");
  for(const e of j.entries) {
    const observed=file(projectRoot,e.target), actual=observed.digest;
    if(actual===e.after && !matches(e.record,observed.content)) fail(`Recovery baseline does not match the approved output: ${e.target}`);
    if(actual!==e.before && actual!==e.after) fail(`File changed after the approved update attempt: ${e.target}`);
  }
  return j.baseInstallation;
}
function journal(projectRoot,baseHash) {
  const j=readAttempt(projectRoot); if(!j) return null;
  if(j.finalReceiptHash === baseHash) return null;
  if(j.baseReceiptHash !== baseHash) fail("Update receipt changed since the recovery attempt.");
  return j;
}
export function buildIntegrationPlan({projectRoot,previewRoot,version,selection}) {
  const project=identity(projectRoot), preview=identity(previewRoot), receiptFile=file(projectRoot,receiptPath), base=readReceipt(projectRoot)??recoverLegacy(projectRoot)??legacyReceipt(projectRoot);
  if(!base) fail("No verified installation evidence. Complete initial setup once before using project updates.");
  if(!same([...selection.harnesses].filter(h=>ids.includes(h)).sort(),[...base.harnesses].sort())) fail("Saved harness selection changed. Reopen setup to review this project.");
  const recovery=journal(projectRoot,receiptFile.digest), journalFile=file(projectRoot,journalPath), previous=new Map(base.files.map(e=>[e.target,e])), entries=[];
  for(const installed of [base.integrationVersion,recovery?.version]) if(newerStable(installed,version)) fail(`This project requires Alfred ${installed} or newer. Upgrade the CLI before updating its integration.`);
  const dependencies=[{path:receiptPath,...snapshot(receiptFile)},{path:journalPath,...snapshot(journalFile)},{path:"AGENTS.override.md",...snapshot(file(projectRoot,"AGENTS.override.md"))},{path:"opencode.jsonc",...snapshot(file(projectRoot,"opencode.jsonc"))}];
  for(const harness of [...new Set(base.harnesses.map(h=>h.startsWith("codex-")?"codex":h))]) for(const generated of readArtifacts(previewRoot,harness)) {
    const target=currentTarget(projectRoot,generated), before=file(projectRoot,target), original=previous.get(target); previous.delete(target);
    let prior=original;
    if(recovery) {
      const recovered=recovery.entries.find(e=>e.target===target);
      if(recovered && before.digest===recovered.after) prior=recovered.record;
    }
    let content=generated.generated, next;
    if(prior && before.content===null) fail(`Managed file was removed: ${target}. It will not be recreated automatically.`);
    if(!prior && before.content!==null) fail(`Unmanaged target already exists: ${target}`);
    if(kind(target)==="block") {
      if(prior && !matches(prior,before.content) && block(before.content)!==block(content)) fail(`Customized Alfred instruction block: ${target}`);
      content=mergePrimaryInstructions(before.content??"",content);
      next=record({...generated,target},content);
    } else if(kind(target)==="json") {
      if(file(projectRoot,"opencode.jsonc").content!==null) fail("OpenCode JSONC requires explicit resolution before updating.");
      const merged=mergeConfig(before.content??"{}",prior?.base??[],content); content=merged.content;
      next={...record({...generated,target},content),base:merged.base};
    } else {
      if(prior && !matches(prior,before.content) && before.content!==content) fail(`Customized managed file: ${target}`);
      next=record({...generated,target},content);
    }
    entries.push({...generated,target,content,sha256:hash(content),before:snapshot(before),record:next,action:content===before.content?"unchanged":before.content===null?"create":"update"});
  }
  if(previous.size) fail(`Retired managed artifacts require explicit resolution: ${[...previous.keys()].join(", ")}. No files will be removed automatically.`);
  entries.sort((a,b)=>a.target.localeCompare(b.target));
  const nextReceipt={schema:"alfred.setup.installation/v1",project:projectRoot,runtimeVersion:version,integrationVersion:version,harnesses:base.harnesses,selection:savedSelection(selection),files:entries.map(e=>e.record)};
  const current=receiptFile.content!==null && base.integrationVersion===version && entries.every(e=>e.action==="unchanged") && same(base.files,nextReceipt.files);
  const plan={project,preview,version,selection,entries,dependencies,baseInstallation:{...base,selection:savedSelection(selection)},receipt:nextReceipt,adopting:receiptFile.content===null,baseReceiptHash:receiptFile.digest,current};
  return {...plan,digest:hash(JSON.stringify(plan))};
}
export function describeIntegration(plan) {
  return [`Project integration → ${plan.version}`,`Project: ${plan.project.root}`,`Harnesses: ${plan.receipt.harnesses.join(", ")}`,...(plan.adopting?["Adopt matching legacy artifacts using their verified project previews."]:[]),"",...plan.entries.map(e=>`${e.target} — ${e.action}\n  SHA-256 ${e.sha256}`),"",`Record verified integration version in ${receiptPath}.`,"Only reviewed files change. Unrelated settings stay in place. Start a new harness session afterward."].join("\n");
}
export function applyIntegration(plan,{signal,write=atomic}={}) {
  const written=[];
  try {
    if(signal?.aborted) fail("Update cancelled.");
    const fresh=buildIntegrationPlan({projectRoot:plan.project.root,previewRoot:plan.preview.root,version:plan.version,selection:plan.selection});
    if(fresh.digest!==plan.digest) fail("Update plan changed; review it again.");
    const attempt={schema:"alfred.setup.attempt/v1",project:plan.project.root,humanApproval:true,baseInstallation:plan.baseInstallation,baseReceiptHash:plan.baseReceiptHash,finalReceiptHash:hash(JSON.stringify(plan.receipt,null,2)+"\n"),version:plan.version,entries:plan.entries.map(e=>({target:e.target,before:e.before.digest,after:e.sha256,record:e.record}))};
    writeState(plan.project.root,journalPath,attempt,write);
    for(const e of plan.entries) {
      if(signal?.aborted) fail("Update cancelled.");
      if(e.action==="unchanged") continue;
      identity(plan.project.root);
      if(!same(snapshot(file(plan.project.root,e.target)),e.before)) fail(`Target changed: ${e.target}`);
      const target=checked(plan.project.root,e.target);mkdirSync(dirname(target),{recursive:true});checked(plan.project.root,e.target);
      write(target,e.content,e.before.mode??0o644);written.push(e.target);
    }
    for(const e of plan.entries) if(file(plan.project.root,e.target).digest!==e.sha256) fail(`Verification failed: ${e.target}`);
    if(file(plan.project.root,receiptPath).digest!==plan.baseReceiptHash) fail("Installation receipt changed during update; preserve the other session's state.");
    if(file(plan.project.root,journalPath).digest!==hash(JSON.stringify(attempt,null,2)+"\n")) fail("Update recovery journal changed during application; review both attempts before retrying.");
    writeState(plan.project.root,receiptPath,plan.receipt,write);
    return {status:"project_verified",written,text:`Project integration ${plan.version} verified. ${written.length} files updated.\nYour saved harness choices were reused. Start a NEW harness session.`};
  } catch(e) {
    return {status:written.length?"project_partial":"project_failed",written,text:`Project integration was NOT fully updated. ${e.code?.startsWith("E")?"Filesystem write failed.":e.message}\nWritten files: ${written.join(", ")||"none"}. Reopen Update to review recovery; do not repeat the setup questionnaire.`};
  }
}
