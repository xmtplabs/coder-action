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
  value = var.docker_enabled
}

# Test-introspection output. Exposes the rendered container list from the
# active resource (pod or deployment) so terraform tests can assert on
# container presence and env without addressing module internals directly.
output "pod_containers" {
  value = var.deployment_type == "pod" ? (
    length(kubernetes_pod_v1.workspace) > 0 ? kubernetes_pod_v1.workspace[0].spec[0].container : []
    ) : (
    length(kubernetes_deployment_v1.workspace) > 0 ? kubernetes_deployment_v1.workspace[0].spec[0].template[0].spec[0].container : []
  )
}
