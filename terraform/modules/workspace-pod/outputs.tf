output "pod_name" {
  description = "Computed name of the pod or deployment (used by callers and coder_metadata)"
  value       = "${var.name_prefix}-${local.slug}"
}

output "docker_enabled" {
  value = var.docker_enabled
}

# ─── Outputs consumed by root-level kubernetes resources ─────────────────────
# These expose internal computed values so the root module can create the
# kubernetes_pod_v1 / kubernetes_deployment_v1 resources at root scope, which
# allows terraform test assertions to reference them without module prefix.

output "labels" {
  value = local.labels
}

output "pod_annotations" {
  value = local.pod_annotations
}

output "workspace_pvc_name" {
  value = kubernetes_persistent_volume_claim_v1.workspace.metadata[0].name
}

output "agent_state_pvc_name" {
  value = kubernetes_persistent_volume_claim_v1.agent_state.metadata[0].name
}

output "extra_pvc_names" {
  description = "Map of extra volume name => PVC claim name for persistent extra volumes"
  value       = { for k, v in kubernetes_persistent_volume_claim_v1.extra : k => v.metadata[0].name }
}

output "init_script" {
  value = local.init_script
}

output "setup_script" {
  value = local.setup_script
}

output "dev_extra_mounts" {
  description = "Active volume entries destined for the dev container"
  value       = local.dev_extra_mounts
}

output "dind_extra_mounts" {
  description = "Active volume entries destined for the dind sidecar"
  value       = local.dind_extra_mounts
}

output "active_volumes" {
  description = "All active (count > 0) volume entries, for declaring kubernetes Volume objects"
  value       = local.active_volumes
}

output "deployment_type" {
  value = var.deployment_type
}
