# Alfred Evals

Eval runner, baseline comparison, regression reports, and replay support.

This package depends on core and uses adapters only through core ports.

## Runtime Contract

- Discovers eval baselines from `.ai/evals/baselines`.
- Computes current deterministic results from generated local traces and model-readable artifacts.
- Runs the existing core regression gate without provider calls.
- Keeps adapter execution outside the eval runner package; validators generate traces before the runner reads them.
