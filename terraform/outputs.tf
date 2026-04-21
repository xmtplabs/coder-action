# ─── Test-introspection outputs ──────────────────────────────────────────────
# Consumed by terraform/tests/*.tftest.hcl. Every key uses try() so this file
# stays valid as later phases introduce additional locals.

output "task_metadata" {
  value = {
    repo_url      = try(local.repo_url, "")
    repo_name     = try(local.repo_name, "")
    ai_prompt     = try(local.ai_prompt, "")
    base_branch   = try(local.base_branch, "")
    size          = try(local.size, "")
    docker        = try(local.docker, false)
    extra_volumes = try(local.extra_volumes, [])
    work_dir      = try(local.work_dir, "")
    git_url       = try(local.git_url, "")
    json_valid    = try(local.json_valid, false)
  }
}

output "dev_resources" {
  value = try(local.dev_resources, null)
}

output "dind_resources" {
  value = try(local.dind_resources, null)
}

output "docker_enabled" {
  value = try(module.workspace.docker_enabled, null)
}

output "all_volumes" {
  value = try(local.all_volumes, [])
}

output "mapped_extra_volumes" {
  value = try(local.mapped_extra_volumes, [])
}
