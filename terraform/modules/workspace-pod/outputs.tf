output "pod_name" {
  description = "Name of the created pod or deployment"
  value = var.deployment_type == "deployment" ? (
    length(kubernetes_deployment_v1.workspace) > 0 ? kubernetes_deployment_v1.workspace[0].metadata[0].name : ""
    ) : (
    length(kubernetes_pod_v1.workspace) > 0 ? kubernetes_pod_v1.workspace[0].metadata[0].name : ""
  )
}

# Test-introspection outputs. Internal contract — consumed only by
# terraform/tests/*.tftest.hcl, not by the root module's production path.

output "docker_enabled" {
  description = "Test-only. Echoes var.docker_enabled so root-level tests can assert on the value the module received."
  value       = var.docker_enabled
}

# Test-introspection only. Consumed by terraform/tests/*.tftest.hcl.
# Deliberately redacted projection — ONLY container names and env VAR NAMES
# are exposed. Env values are omitted because they include
# CODER_AGENT_TOKEN, GITHUB_TOKEN, and other sensitive strings; re-exporting
# those via an output would print them in plaintext in CI logs and
# `terraform output` listings.
output "pod_containers" {
  description = "Test-only. Redacted container list: name + env var names only. Not a production contract."
  value = [
    for c in(var.deployment_type == "pod" ? (
      length(kubernetes_pod_v1.workspace) > 0 ? kubernetes_pod_v1.workspace[0].spec[0].container : []
      ) : (
      length(kubernetes_deployment_v1.workspace) > 0 ? kubernetes_deployment_v1.workspace[0].spec[0].template[0].spec[0].container : []
      )) : {
      name = c.name
      env  = [for e in c.env : { name = e.name }]
    }
  ]
}
