# Observability And Traceability

Traceability records what happened. Observability explains why, how often, and whether behavior improved.

## Trace Event Categories

- task_received
- task_classified
- skill_detected
- skill_loaded
- delegation_decision
- subagent_started
- tool_requested
- permission_allowed
- permission_denied
- provider_request_avoided
- provider_request_reduced
- provider_request_sent
- model_request_retry
- model_fallback_selected
- model_fallback_exhausted
- temporary_agent_created
- temporary_agent_promoted
- temporary_agent_discarded
- handoff_completed
- final_answer_generated

## Metrics

- eval_pass_rate
- regression_count
- delegation_accuracy
- unnecessary_delegation_rate
- skill_activation_precision
- skill_activation_recall
- unsafe_action_attempts
- provider_requests_avoided
- estimated_tokens_saved
- average_steps_to_completion
