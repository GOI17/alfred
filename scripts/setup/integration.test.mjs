import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, cpSync, unlinkSync, symlinkSync, chmodSync, statSync } from "node:fs";
import { join } from "node:path";
import { fixture, generate, put } from "./activation-fixture.mjs";
import { buildActivationPlan, activatePlan, hash, atomic } from "./activation.mjs";
import { activationReceipt, saveActivationReceipt, inspectIntegration, buildIntegrationPlan, applyIntegration, receiptPath, journalPath } from "./integration.mjs";
const selection = {edition:"coding",harnesses:["codex-cli","opencode"],memory:"decide-later",name:"saved",path:"/not-reused",profiles:false};
function initial(t,{legacy=false}={}) {
  const f=fixture(t);
  generate(f.previewRoot,"codex");generate(f.previewRoot,"opencode");
  cpSync(join(f.previewRoot,"codex-install"),join(f.previewRoot,"codex-cli-install"),{recursive:true});
  put(join(f.projectRoot,"AGENTS.md"),"Project notes stay here.\n");
  put(join(f.projectRoot,"opencode.json"),JSON.stringify({model:"my-model",secret:"do-not-record",permission:{read:"allow"}}));
  const plan=buildActivationPlan(f), receipt=activationReceipt(plan,{version:"1.0.1",selection});
  assert.equal(activatePlan(plan).status,"activation_verified");
  if(!legacy) saveActivationReceipt(plan,receipt);
  return {...f,selection};
}
function next(f) {
  const previewRoot=join(f.projectRoot,".alfred/setup/previews/next");
  generate(previewRoot,"codex");generate(previewRoot,"opencode");
  for(const [h,target] of [["codex",".codex/agents/developer.toml"],["opencode",".opencode/skills/alfred/SKILL.md"]]) {
    const base=join(previewRoot,`${h}-install`), manifestPath=join(base,"activation-manifest.json"), manifest=JSON.parse(readFileSync(manifestPath,"utf8"));
    const entry=manifest.files.find(e=>e.target===target), path=join(base,entry.source), content=readFileSync(path,"utf8")+"\nUpdated integration behavior.\n";
    writeFileSync(path,content);entry.sha256=hash(content);writeFileSync(manifestPath,JSON.stringify(manifest));
  }
  return {projectRoot:f.projectRoot,previewRoot,version:"1.1.0",selection:f.selection};
}
test("receipt records choices and owned defaults without unrelated user values",t=>{
  const f=initial(t), raw=readFileSync(join(f.projectRoot,receiptPath),"utf8"), r=JSON.parse(raw);
  assert.equal(r.integrationVersion,"1.0.1");assert.deepEqual(r.harnesses,selection.harnesses);
  assert.ok(!raw.includes("do-not-record"));assert.ok(!raw.includes("my-model"));assert.equal(r.selection.path,undefined);
  assert.equal(statSync(join(f.projectRoot,receiptPath)).mode&0o777,0o600);
  assert.equal(inspectIntegration(f.projectRoot,"1.1.0").canUpdate,true);
});
test("actual agent and skill updates reuse selection, preserve unrelated settings/modes, and are idempotent",t=>{
  const f=initial(t), options=next(f);
  chmodSync(join(f.projectRoot,"AGENTS.md"),0o600);chmodSync(join(f.projectRoot,"opencode.json"),0o600);
  const plan=buildIntegrationPlan(options), result=applyIntegration(plan);
  assert.equal(result.status,"project_verified",result.text);assert.equal(result.written.length,2);
  assert.match(readFileSync(join(f.projectRoot,".codex/agents/developer.toml"),"utf8"),/Updated integration behavior/);
  assert.match(readFileSync(join(f.projectRoot,".opencode/skills/alfred/SKILL.md"),"utf8"),/Updated integration behavior/);
  assert.match(readFileSync(join(f.projectRoot,"AGENTS.md"),"utf8"),/^Project notes/);
  assert.equal(JSON.parse(readFileSync(join(f.projectRoot,"opencode.json"))).model,"my-model");
  assert.equal(statSync(join(f.projectRoot,"AGENTS.md")).mode&0o777,0o600);
  assert.equal(statSync(join(f.projectRoot,"opencode.json")).mode&0o777,0o600);
  assert.equal(buildIntegrationPlan(options).current,true);
});
test("legacy1.0.1 adopts matching project preview evidence without repeating setup",t=>{
  const f=initial(t,{legacy:true});
  const state=inspectIntegration(f.projectRoot,"1.1.0");assert.equal(state.status,"legacy",state.text);assert.deepEqual(state.harnesses,selection.harnesses);
  const plan=buildIntegrationPlan(next(f));assert.equal(plan.adopting,true);
  const result=applyIntegration(plan);assert.equal(result.status,"project_verified",result.text);
  assert.equal(JSON.parse(readFileSync(join(f.projectRoot,receiptPath))).integrationVersion,"1.1.0");
});
test("legacy refuses customized artifacts rather than adopting current contents as baseline",t=>{
  const f=initial(t,{legacy:true});put(join(f.projectRoot,".codex/agents/developer.toml"),"customized");
  assert.equal(inspectIntegration(f.projectRoot,"1.1.0").status,"blocked");
  assert.throws(()=>buildIntegrationPlan(next(f)),/differ|evidence/);
});
test("managed edits, deletion, symlink and stale preview block writes",t=>{
  for(const mode of ["edit","delete","symlink","stale"]) {
    const f=initial(t), options=next(f), target=join(f.projectRoot,".codex/agents/developer.toml");
    if(mode==="stale") {const plan=buildIntegrationPlan(options);put(target,"late edit");assert.equal(applyIntegration(plan).status,"project_failed");continue;}
    if(mode==="edit") put(target,"local customization");
    else {unlinkSync(target);if(mode==="symlink")symlinkSync(join(f.projectRoot,"AGENTS.md"),target);}
    assert.throws(()=>buildIntegrationPlan(options),/Customized|removed|symlink/);
  }
});
test("partial update retry recognizes exact approved outputs and preserves old receipt until completion",t=>{
  const f=initial(t), options=next(f), plan=buildIntegrationPlan(options);let count=0;
  const result=applyIntegration(plan,{write:(p,c,m)=>{if(p.includes("/.opencode/skills/"))throw new Error("injected");atomic(p,c,m);count++;}});
  assert.equal(result.status,"project_partial",result.text);assert.ok(count>1);
  assert.equal(JSON.parse(readFileSync(join(f.projectRoot,receiptPath))).integrationVersion,"1.0.1");
  const retry=buildIntegrationPlan(options);assert.equal(applyIntegration(retry).status,"project_verified");
  assert.equal(JSON.parse(readFileSync(join(f.projectRoot,receiptPath))).integrationVersion,"1.1.0");
});
test("receipt-write failure remains recoverable without claiming complete version",t=>{
  const f=initial(t), options=next(f);
  const result=applyIntegration(buildIntegrationPlan(options),{write:(p,c,m)=>{if(p.endsWith("installation.json"))throw new Error("injected");atomic(p,c,m);}});
  assert.equal(result.status,"project_partial");assert.equal(JSON.parse(readFileSync(join(f.projectRoot,receiptPath))).integrationVersion,"1.0.1");
  assert.equal(applyIntegration(buildIntegrationPlan(options)).status,"project_verified");
});
test("post-partial edits and manipulated recovery paths fail closed",t=>{
  const f=initial(t), options=next(f);
  applyIntegration(buildIntegrationPlan(options),{write:(p,c,m)=>{if(p.endsWith("installation.json"))throw new Error("injected");atomic(p,c,m);}});
  put(join(f.projectRoot,".codex/agents/developer.toml"),"user edited after failure");
  assert.throws(()=>buildIntegrationPlan(options),/Customized/);
  const path=join(f.projectRoot,journalPath), j=JSON.parse(readFileSync(path));j.entries[0].record.target="../../outside";writeFileSync(path,JSON.stringify(j));
  assert.throws(()=>buildIntegrationPlan(options),/Invalid/);
});
test("retired artifacts report conflict and never mark the integration complete",t=>{
  const f=initial(t), options=next(f), path=join(f.projectRoot,receiptPath), r=JSON.parse(readFileSync(path));
  r.files.push({harness:"codex",target:".agents/skills/old-skill/SKILL.md",kind:"file",installedHash:hash("old"),generatedHash:hash("old")});put(join(f.projectRoot,".agents/skills/old-skill/SKILL.md"),"old");writeFileSync(path,JSON.stringify(r));
  assert.throws(()=>buildIntegrationPlan(options),/Retired managed artifacts/);
  assert.equal(JSON.parse(readFileSync(path)).integrationVersion,"1.0.1");
});
