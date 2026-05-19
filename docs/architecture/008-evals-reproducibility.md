# Evals And Reproducibility

## Eval Types

- Contract evals.
- Routing evals.
- Skill activation evals.
- Safety evals.
- Quality evals.
- Regression evals.
- Harness evals.

## Reproducibility Metadata

Record agent version, prompt hash, skill version, policy hash, harness adapter version, model id, model parameters, fixture hash, tool outputs or mocks, environment metadata, timestamp, and seed if available.

## Promotion Gate

Prompt, agent, skill, or policy changes require eval comparison against baseline. Baselines update only after human approval.
