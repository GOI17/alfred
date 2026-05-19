# Security Model

## Defaults

- Deny by default.
- Least privilege.
- No self-permission broadening.
- Human approval for escalation.
- Skills cannot override security policy.

## Permission Actions

- `read_files`
- `write_files`
- `write_tests`
- `write_production_code`
- `run_tests`
- `run_build`
- `install_dependencies`
- `network_access`
- `create_agent`
- `modify_permissions`
- `access_secrets`
- `delete_files`
- `git_commit`
- `git_push`
- `provider_request`

## Temporary Agents

Temporary agents start with minimal permissions and require approval before promotion.
