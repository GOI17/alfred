// Pure policy only. A verified host bridge owns delegation and Git lifecycle I/O.
const requiredFalseFacts = ["requires_analysis", "requires_code", "requires_actions", "requires_external_state", "requires_tools"];
const text = value => typeof value === "string" && value.trim().length > 0;

export function isQuickAnswer(requestFacts = {}, workItems) {
  return (workItems === undefined || (Array.isArray(workItems) && workItems.length === 0)) &&
    requestFacts?.question_count === 1 && requestFacts.answer_known === true &&
    requiredFalseFacts.every(key => requestFacts[key] === false);
}

export function decideToolNecessity({ requestFacts = {}, workItems, quickAnswer = isQuickAnswer(requestFacts, workItems) } = {}) {
  const facts = requestFacts ?? {};
  const declaredWrites = Array.isArray(workItems) && workItems.some(item => Array.isArray(item?.write_scopes) && item.write_scopes.length > 0);
  const taskRequired = declaredWrites || ["requires_code", "requires_actions", "requires_external_state", "requires_tools"].some(key => facts[key] === true);
  const knownWithoutTools = facts.answer_known === true &&
    ["requires_code", "requires_actions", "requires_external_state", "requires_tools"].every(key => facts[key] === false);
  return {
    task_tools: taskRequired ? "required" : knownWithoutTools ? "not_needed" : "undetermined",
    orchestration_tools: quickAnswer ? "none" : "required",
    obligations: quickAnswer ? [] : ["delegate", "establish_or_verify_task_worktree"],
    optional_tools_allowed: false,
    provider_request_authorized: false,
    reason: quickAnswer ? "Answer already known; no tools are necessary" :
      "Use tools only for established task needs and required delegation/worktree mechanics; unknown needs do not authorize calls"
  };
}

export function planTaskWorktree({ taskContext = {}, quickAnswer = false } = {}) {
  if (quickAnswer) return { action: "none", reason: "Quick conversational answer is the explicit no-worktree exception" };
  const context = taskContext ?? {};
  const candidate = context.worktree;
  const sameTask = text(context.task_id) && candidate?.task_id === context.task_id &&
    (!context.continuation_of || context.continuation_of === context.task_id);
  const evidenceMatches = ["repository_root", "branch"].every(key => text(context[key]) && candidate?.[key] === context[key]) &&
    text(context.worktree_path) && candidate?.path === context.worktree_path;
  if (sameTask && candidate.verified === true && evidenceMatches) {
    return { action: "reuse_verified", task_id: context.task_id, path: candidate.path,
      reason: "Verified dedicated worktree belongs to this task; continuations and specialists reuse it" };
  }
  if (sameTask) return { action: "reuse_requires_verification", task_id: context.task_id,
    preserve_existing: true, reason: "Verify task repository, canonical worktree path and branch against expected identity before reuse" };
  return { action: "create_required", task_id: context.task_id ?? null, mechanism: "native_git",
    preserve_existing: true, reason: "Every substantive independent task requires its own verified task worktree, including read-only work" };
}

// Scope declarations are repository-relative paths, not globs. Unknown scopes
// cannot prove independence. A parent path overlaps all its descendants.
function validScope(scope) {
  return text(scope) && !scope.startsWith("/") && !scope.includes("\\") &&
    !/[?*\[\]{}]/.test(scope) && !scope.split("/").some(part => part === ".." || (part === "." && scope !== ".") || part === "");
}
const overlaps = (a, b) => {
  a = a.toLowerCase(); b = b.toLowerCase();
  return a === "." || b === "." || a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
};

export function planTaskExecution(workItems) {
  if (workItems === undefined || (Array.isArray(workItems) && workItems.length === 0)) {
    return { mode: "sequential", order: [], reason: "No independent decomposition supplied" };
  }
  const blocked = reason => ({ mode: "blocked", order: [], reason });
  if (!Array.isArray(workItems) || workItems.some(item => !item || !text(item.id))) return blocked("Invalid work items");
  const ids = new Set(workItems.map(item => item.id));
  if (ids.size !== workItems.length) return blocked("Duplicate work item IDs");
  if (workItems.some(item => item.depends_on !== undefined && (!Array.isArray(item.depends_on) ||
      item.depends_on.some(id => !ids.has(id) || id === item.id)))) return blocked("Invalid dependency references");
  const remaining = [...workItems];
  const order = [];
  while (remaining.length) {
    const index = remaining.findIndex(item => (item.depends_on ?? []).every(id => order.includes(id)));
    if (index < 0) return blocked("Cyclic dependencies");
    order.push(remaining.splice(index, 1)[0].id);
  }
  const knownIndependent = workItems.every(item => item.independent === true &&
    Array.isArray(item.depends_on) && item.depends_on.length === 0 &&
    Array.isArray(item.write_scopes) && item.write_scopes.every(validScope));
  const conflicts = knownIndependent && workItems.some((item, i) => workItems.slice(i + 1).some(other =>
    (item.write_scopes ?? []).some(a => (other.write_scopes ?? []).some(b => overlaps(a, b)))));
  return { mode: workItems.length > 1 && knownIndependent && !conflicts ? "parallel" : "sequential", order,
    reason: knownIndependent && !conflicts ? "Explicit independence and disjoint known write scopes" :
      "Dependencies, shared writes or unknown independence require sequential work" };
}

export function evaluateOrchestrationPolicy({ requestFacts, taskContext, workItems } = {}) {
  const quickAnswer = isQuickAnswer(requestFacts, workItems);
  const execution_plan = quickAnswer ? { mode: "direct", order: [], reason: "One known plain answer" } : planTaskExecution(workItems);
  return {
    quick_answer: quickAnswer,
    delegation_required: !quickAnswer,
    authority: "alfred_within_platform_security",
    tool_decision: decideToolNecessity({ requestFacts, workItems, quickAnswer }),
    worktree: planTaskWorktree({ taskContext, quickAnswer }),
    cleanup: { ask_at_completion: !quickAnswer, automatic_removal: false, removal_requires_explicit_user_choice: true,
      preserve_branches_remotes_and_changes: true },
    execution_plan,
    lifecycle_owner: "adapter_or_orchestrator",
    host_lifecycle_executed: false
  };
}
