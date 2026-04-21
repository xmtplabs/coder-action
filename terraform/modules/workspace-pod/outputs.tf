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
