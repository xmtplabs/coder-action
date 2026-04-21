# ─── Mock providers ──────────────────────────────────────────────────────────

mock_provider "coder" {
  override_data {
    target = data.coder_workspace.me
    values = {
      start_count = 0
      name        = "test"
      id          = "00000000-0000-0000-0000-000000000000"
      access_url  = "https://example.test"
    }
  }
  override_data {
    target = data.coder_workspace_owner.me
    values = {
      full_name = "Test User"
      email     = "test@example.test"
      name      = "test"
    }
  }
}

mock_provider "kubernetes" {}

# ─── Shared variables ────────────────────────────────────────────────────────

variables {
  claude_code_oauth_token = "fake-oauth-token"
  github_pat              = "fake-pat"
}

# ─── Smoke test ──────────────────────────────────────────────────────────────

run "golden_path_parses" {
  command = plan

  override_data {
    target = data.coder_workspace.me
    values = {
      start_count = 1
      name        = "t"
      id          = "00000000-0000-0000-0000-000000000000"
      access_url  = "https://example.test"
    }
  }
  override_data {
    target = data.coder_task.me
    values = {
      prompt = "{\"repo_url\":\"https://github.com/acme/widget\",\"repo_name\":\"widget\",\"ai_prompt\":\"Do the thing\"}"
    }
  }

  assert {
    condition     = output.task_metadata.repo_url == "https://github.com/acme/widget"
    error_message = "repo_url did not round-trip from JSON prompt"
  }
  assert {
    condition     = output.task_metadata.json_valid == true
    error_message = "json_valid should be true for a well-formed JSON prompt"
  }
}

# ─── Precondition firing ─────────────────────────────────────────────────────
#
# Each fixture below violates EXACTLY ONE precondition. Other required fields
# remain non-blank and the JSON remains structurally valid so the NAMED
# precondition is the one that trips — not a sibling. When adding new
# preconditions or reordering the `lifecycle.precondition` list in
# terraform/main.tf, update these fixtures in lockstep; otherwise
# `expect_failures` may pass for the wrong reason.

run "invalid_json_fails_precondition" {
  command = plan

  override_data {
    target = data.coder_workspace.me
    values = {
      start_count = 1
      name        = "t"
      id          = "00000000-0000-0000-0000-000000000001"
      access_url  = "https://example.test"
    }
  }
  override_data {
    target = data.coder_task.me
    values = { prompt = "not-json" }
  }

  expect_failures = [resource.coder_agent.dev]
}

run "non_object_json_fails_precondition" {
  command = plan

  override_data {
    target = data.coder_workspace.me
    values = {
      start_count = 1
      name        = "t"
      id          = "00000000-0000-0000-0000-000000000008"
      access_url  = "https://example.test"
    }
  }
  override_data {
    target = data.coder_task.me
    values = { prompt = "[1,2,3]" }
  }

  # Valid JSON but not a TaskMetadata object. json_valid must be false so
  # EARS-1 trips (not EARS-2 via try() returning ""). Guards the can()-based
  # tightening of local.json_valid in terraform/main.tf against regression.
  expect_failures = [resource.coder_agent.dev]
}

run "blank_repo_url_fails_precondition" {
  command = plan

  override_data {
    target = data.coder_workspace.me
    values = {
      start_count = 1
      name        = "t"
      id          = "00000000-0000-0000-0000-000000000002"
      access_url  = "https://example.test"
    }
  }
  override_data {
    target = data.coder_task.me
    values = { prompt = "{\"repo_url\":\"\",\"repo_name\":\"x\",\"ai_prompt\":\"y\"}" }
  }

  expect_failures = [resource.coder_agent.dev]
}

run "blank_repo_name_fails_precondition" {
  command = plan

  override_data {
    target = data.coder_workspace.me
    values = {
      start_count = 1
      name        = "t"
      id          = "00000000-0000-0000-0000-000000000003"
      access_url  = "https://example.test"
    }
  }
  override_data {
    target = data.coder_task.me
    values = { prompt = "{\"repo_url\":\"https://github.com/a/b\",\"repo_name\":\"\",\"ai_prompt\":\"y\"}" }
  }

  expect_failures = [resource.coder_agent.dev]
}

run "blank_ai_prompt_fails_precondition" {
  command = plan

  override_data {
    target = data.coder_workspace.me
    values = {
      start_count = 1
      name        = "t"
      id          = "00000000-0000-0000-0000-000000000004"
      access_url  = "https://example.test"
    }
  }
  override_data {
    target = data.coder_task.me
    values = { prompt = "{\"repo_url\":\"https://github.com/a/b\",\"repo_name\":\"b\",\"ai_prompt\":\"\"}" }
  }

  expect_failures = [resource.coder_agent.dev]
}

# ─── Defaults and derivations ────────────────────────────────────────────────

run "defaults_applied_when_optionals_absent" {
  command = plan

  override_data {
    target = data.coder_workspace.me
    values = {
      start_count = 1
      name        = "t"
      id          = "00000000-0000-0000-0000-000000000005"
      access_url  = "https://example.test"
    }
  }
  override_data {
    target = data.coder_task.me
    values = {
      prompt = "{\"repo_url\":\"https://github.com/acme/widget\",\"repo_name\":\"widget\",\"ai_prompt\":\"Do the thing\"}"
    }
  }

  assert {
    condition     = output.task_metadata.size == "large"
    error_message = "size must default to 'large' when absent (EARS-6)"
  }
  assert {
    condition     = output.task_metadata.docker == false
    error_message = "docker must default to false when absent"
  }
  assert {
    condition     = output.task_metadata.base_branch == ""
    error_message = "base_branch must default to empty string when absent"
  }
  assert {
    condition     = length(output.task_metadata.extra_volumes) == 0
    error_message = "extra_volumes must default to empty list when absent"
  }
  assert {
    condition     = output.task_metadata.work_dir == "/workspaces/widget"
    error_message = "work_dir must be /workspaces/<repo_name> (EARS-16)"
  }
  assert {
    condition     = output.task_metadata.git_url == "https://github.com/acme/widget"
    error_message = "git_url must equal repo_url when base_branch is empty (EARS-14)"
  }
}

run "base_branch_composes_git_url_suffix" {
  command = plan

  override_data {
    target = data.coder_workspace.me
    values = {
      start_count = 1
      name        = "t"
      id          = "00000000-0000-0000-0000-000000000006"
      access_url  = "https://example.test"
    }
  }
  override_data {
    target = data.coder_task.me
    values = {
      prompt = "{\"repo_url\":\"https://github.com/acme/widget\",\"repo_name\":\"widget\",\"ai_prompt\":\"Do the thing\",\"base_branch\":\"feature-x\"}"
    }
  }

  assert {
    condition     = output.task_metadata.git_url == "https://github.com/acme/widget#refs/heads/feature-x"
    error_message = "git_url must append #refs/heads/<branch> when base_branch is set (EARS-14)"
  }
}

run "ai_prompt_passthrough_no_wrapping" {
  command = plan

  override_data {
    target = data.coder_workspace.me
    values = {
      start_count = 1
      name        = "t"
      id          = "00000000-0000-0000-0000-000000000007"
      access_url  = "https://example.test"
    }
  }
  override_data {
    target = data.coder_task.me
    values = {
      prompt = "{\"repo_url\":\"https://github.com/acme/widget\",\"repo_name\":\"widget\",\"ai_prompt\":\"LITERAL_PROMPT_TOKEN\"}"
    }
  }

  assert {
    condition     = output.task_metadata.ai_prompt == "LITERAL_PROMPT_TOKEN"
    error_message = "ai_prompt must be passed through verbatim, no template wrapping (EARS-15)"
  }
}

# ─── Dashboard metadata ──────────────────────────────────────────────────────

run "coder_metadata_exposes_repo_url" {
  command = plan

  override_data {
    target = data.coder_workspace.me
    values = {
      start_count = 1
      name        = "t"
      id          = "00000000-0000-0000-0000-000000000017"
      access_url  = "https://example.test"
    }
  }
  override_data {
    target = data.coder_task.me
    values = {
      prompt = "{\"repo_url\":\"https://github.com/acme/widget\",\"repo_name\":\"widget\",\"ai_prompt\":\"Do the thing\"}"
    }
  }

  assert {
    condition     = length([for i in coder_metadata.task_info[0].item : i if i.key == "repo" && i.value == "https://github.com/acme/widget"]) == 1
    error_message = "coder_metadata.task_info must expose repo_url via a 'repo' item (EARS-17)"
  }
}

# ─── Size profiles ───────────────────────────────────────────────────────────

run "size_default_large_profile" {
  command = plan

  override_data {
    target = data.coder_workspace.me
    values = {
      start_count = 1
      name        = "t"
      id          = "00000000-0000-0000-0000-000000000009"
      access_url  = "https://example.test"
    }
  }
  override_data {
    target = data.coder_task.me
    values = {
      prompt = "{\"repo_url\":\"https://github.com/acme/widget\",\"repo_name\":\"widget\",\"ai_prompt\":\"x\"}"
    }
  }

  assert {
    condition     = output.dev_resources.requests.cpu == "2"
    error_message = "default size (absent) must apply the large profile — requests.cpu (EARS-6, EARS-9)"
  }
  assert {
    condition     = output.dev_resources.requests.memory == "8Gi"
    error_message = "default (large) requests.memory (EARS-9)"
  }
  assert {
    condition     = output.dev_resources.requests["ephemeral-storage"] == "30Gi"
    error_message = "default (large) requests.ephemeral-storage (EARS-9)"
  }
  assert {
    condition     = output.dev_resources.limits.cpu == "8"
    error_message = "default (large) limits.cpu (EARS-9)"
  }
  assert {
    condition     = output.dev_resources.limits.memory == "24Gi"
    error_message = "default (large) limits.memory (EARS-9)"
  }
  assert {
    condition     = output.dev_resources.limits["ephemeral-storage"] == "50Gi"
    error_message = "default (large) limits.ephemeral-storage (EARS-9)"
  }
}

run "size_small_profile" {
  command = plan

  override_data {
    target = data.coder_workspace.me
    values = {
      start_count = 1
      name        = "t"
      id          = "00000000-0000-0000-0000-000000000010"
      access_url  = "https://example.test"
    }
  }
  override_data {
    target = data.coder_task.me
    values = {
      prompt = "{\"repo_url\":\"https://github.com/acme/widget\",\"repo_name\":\"widget\",\"ai_prompt\":\"x\",\"size\":\"small\"}"
    }
  }

  assert {
    condition     = output.dev_resources.requests.cpu == "1" && output.dev_resources.requests.memory == "4Gi" && output.dev_resources.requests["ephemeral-storage"] == "10Gi"
    error_message = "small profile requests mismatch (EARS-7): expected {cpu=1, memory=4Gi, ephemeral-storage=10Gi}"
  }
  assert {
    condition     = output.dev_resources.limits.cpu == "4" && output.dev_resources.limits.memory == "8Gi" && output.dev_resources.limits["ephemeral-storage"] == "20Gi"
    error_message = "small profile limits mismatch (EARS-7): expected {cpu=4, memory=8Gi, ephemeral-storage=20Gi}"
  }
  # EARS-10: dind resources must be identical across all sizes.
  assert {
    condition     = output.dind_resources.requests.cpu == "250m" && output.dind_resources.requests.memory == "1Gi" && output.dind_resources.requests["ephemeral-storage"] == "5Gi"
    error_message = "dind requests must be {cpu=250m, memory=1Gi, ephemeral-storage=5Gi} across all sizes (EARS-10)"
  }
  assert {
    condition     = output.dind_resources.limits.cpu == "2" && output.dind_resources.limits.memory == "4Gi" && output.dind_resources.limits["ephemeral-storage"] == "20Gi"
    error_message = "dind limits must be {cpu=2, memory=4Gi, ephemeral-storage=20Gi} across all sizes (EARS-10)"
  }
}

run "size_medium_profile" {
  command = plan

  override_data {
    target = data.coder_workspace.me
    values = {
      start_count = 1
      name        = "t"
      id          = "00000000-0000-0000-0000-000000000011"
      access_url  = "https://example.test"
    }
  }
  override_data {
    target = data.coder_task.me
    values = {
      prompt = "{\"repo_url\":\"https://github.com/acme/widget\",\"repo_name\":\"widget\",\"ai_prompt\":\"x\",\"size\":\"medium\"}"
    }
  }

  assert {
    condition     = output.dev_resources.requests.cpu == "1" && output.dev_resources.requests.memory == "4Gi" && output.dev_resources.requests["ephemeral-storage"] == "20Gi"
    error_message = "medium profile requests mismatch (EARS-8): expected {cpu=1, memory=4Gi, ephemeral-storage=20Gi}"
  }
  assert {
    condition     = output.dev_resources.limits.cpu == "8" && output.dev_resources.limits.memory == "12Gi" && output.dev_resources.limits["ephemeral-storage"] == "30Gi"
    error_message = "medium profile limits mismatch (EARS-8): expected {cpu=8, memory=12Gi, ephemeral-storage=30Gi}"
  }
  # EARS-10: dind resources must be identical across all sizes.
  assert {
    condition     = output.dind_resources.requests.cpu == "250m" && output.dind_resources.requests.memory == "1Gi" && output.dind_resources.requests["ephemeral-storage"] == "5Gi"
    error_message = "dind requests must be {cpu=250m, memory=1Gi, ephemeral-storage=5Gi} across all sizes (EARS-10)"
  }
  assert {
    condition     = output.dind_resources.limits.cpu == "2" && output.dind_resources.limits.memory == "4Gi" && output.dind_resources.limits["ephemeral-storage"] == "20Gi"
    error_message = "dind limits must be {cpu=2, memory=4Gi, ephemeral-storage=20Gi} across all sizes (EARS-10)"
  }
}

run "size_large_profile_explicit" {
  command = plan

  override_data {
    target = data.coder_workspace.me
    values = {
      start_count = 1
      name        = "t"
      id          = "00000000-0000-0000-0000-000000000012"
      access_url  = "https://example.test"
    }
  }
  override_data {
    target = data.coder_task.me
    values = {
      prompt = "{\"repo_url\":\"https://github.com/acme/widget\",\"repo_name\":\"widget\",\"ai_prompt\":\"x\",\"size\":\"large\"}"
    }
  }

  assert {
    condition     = output.dev_resources.requests.cpu == "2" && output.dev_resources.requests.memory == "8Gi" && output.dev_resources.requests["ephemeral-storage"] == "30Gi"
    error_message = "explicit large profile requests mismatch (EARS-9)"
  }
  assert {
    condition     = output.dev_resources.limits.cpu == "8" && output.dev_resources.limits.memory == "24Gi" && output.dev_resources.limits["ephemeral-storage"] == "50Gi"
    error_message = "explicit large profile limits mismatch (EARS-9)"
  }
  # EARS-10: dind resources must be identical across all sizes.
  assert {
    condition     = output.dind_resources.requests.cpu == "250m" && output.dind_resources.requests.memory == "1Gi" && output.dind_resources.requests["ephemeral-storage"] == "5Gi"
    error_message = "dind requests must be {cpu=250m, memory=1Gi, ephemeral-storage=5Gi} across all sizes (EARS-10)"
  }
  assert {
    condition     = output.dind_resources.limits.cpu == "2" && output.dind_resources.limits.memory == "4Gi" && output.dind_resources.limits["ephemeral-storage"] == "20Gi"
    error_message = "dind limits must be {cpu=2, memory=4Gi, ephemeral-storage=20Gi} across all sizes (EARS-10)"
  }
}

run "size_invalid_fails_precondition" {
  command = plan

  override_data {
    target = data.coder_workspace.me
    values = {
      start_count = 1
      name        = "t"
      id          = "00000000-0000-0000-0000-000000000013"
      access_url  = "https://example.test"
    }
  }
  override_data {
    target = data.coder_task.me
    values = {
      prompt = "{\"repo_url\":\"https://github.com/acme/widget\",\"repo_name\":\"widget\",\"ai_prompt\":\"x\",\"size\":\"xl\"}"
    }
  }

  # Violates the size-allowlist precondition ONLY — other required fields
  # remain non-blank and the JSON is valid. Maintains the one-violation-per-
  # fixture invariant documented above the Phase 2 precondition block.
  expect_failures = [resource.coder_agent.dev]
}

# COVERAGE NOTE: the three docker-gating runs below all exercise
# var.deployment_type == "pod" (the root template's default). The
# workspace-pod module also gates dind/DOCKER_HOST inside a mirrored
# kubernetes_deployment_v1 branch that is NOT exercised by these tests.
# If the template ever enables `deployment_type = "deployment"`, add a
# module-level tftest under terraform/modules/workspace-pod/tests/ that
# asserts the same invariants with deployment_type="deployment".

# ─── Docker sidecar gating ──────────────────────────────────────────────────

run "docker_false_by_default" {
  command = plan

  override_data {
    target = data.coder_workspace.me
    values = {
      start_count = 1
      name        = "t"
      id          = "00000000-0000-0000-0000-000000000015"
      access_url  = "https://example.test"
    }
  }
  override_data {
    target = data.coder_task.me
    values = {
      prompt = "{\"repo_url\":\"https://github.com/acme/widget\",\"repo_name\":\"widget\",\"ai_prompt\":\"x\"}"
    }
  }

  # EARS-6 default-docker behavior: absent => false => dind container omitted
  assert {
    condition     = output.docker_enabled == false
    error_message = "docker must default to false when absent, and the workspace-pod module must receive docker_enabled=false (EARS-11)"
  }
  assert {
    condition     = length([for c in module.workspace.pod_containers : c if c.name == "dind"]) == 0
    error_message = "dind container must not be rendered when docker=false (EARS-11)"
  }
}

run "docker_true_enables_sidecar" {
  command = plan

  override_data {
    target = data.coder_workspace.me
    values = {
      start_count = 1
      name        = "t"
      id          = "00000000-0000-0000-0000-000000000016"
      access_url  = "https://example.test"
    }
  }
  override_data {
    target = data.coder_task.me
    values = {
      prompt = "{\"repo_url\":\"https://github.com/acme/widget\",\"repo_name\":\"widget\",\"ai_prompt\":\"x\",\"docker\":true}"
    }
  }

  assert {
    condition     = output.docker_enabled == true
    error_message = "docker=true must propagate to workspace-pod.docker_enabled (EARS-12)"
  }
  assert {
    condition     = length([for c in module.workspace.pod_containers : c if c.name == "dind"]) == 1
    error_message = "dind container must be rendered exactly once when docker=true (EARS-12)"
  }
  assert {
    condition     = length([for c in module.workspace.pod_containers : c if c.name == "dev" && length([for e in c.env : e if e.name == "DOCKER_HOST"]) > 0]) == 1
    error_message = "DOCKER_HOST env must be present on dev container when docker=true (EARS-12)"
  }
}

run "docker_false_sets_no_docker_host" {
  command = plan

  override_data {
    target = data.coder_workspace.me
    values = {
      start_count = 1
      name        = "t"
      id          = "00000000-0000-0000-0000-000000000018"
      access_url  = "https://example.test"
    }
  }
  override_data {
    target = data.coder_task.me
    values = {
      prompt = "{\"repo_url\":\"https://github.com/acme/widget\",\"repo_name\":\"widget\",\"ai_prompt\":\"x\",\"docker\":false}"
    }
  }

  # EARS-11: when docker=false, DOCKER_HOST must NOT appear on the dev container
  assert {
    condition     = length([for c in module.workspace.pod_containers : c if c.name == "dev" && length([for e in c.env : e if e.name == "DOCKER_HOST"]) > 0]) == 0
    error_message = "DOCKER_HOST env must not be set on dev container when docker=false (EARS-11)"
  }
}

# ─── Volume mapping ──────────────────────────────────────────────────────────

run "extra_volumes_mapped_to_module_shape" {
  command = plan

  override_data {
    target = data.coder_workspace.me
    values = {
      start_count = 1
      name        = "t"
      id          = "00000000-0000-0000-0000-000000000019"
      access_url  = "https://example.test"
    }
  }
  override_data {
    target = data.coder_task.me
    values = {
      prompt = "{\"repo_url\":\"https://github.com/acme/widget\",\"repo_name\":\"widget\",\"ai_prompt\":\"x\",\"extra_volumes\":[{\"path\":\"/home/runner/cache\",\"size\":\"5Gi\"}]}"
    }
  }

  assert {
    condition     = length(output.mapped_extra_volumes) == 1
    error_message = "one extra_volume entry must produce one module volume (EARS-13)"
  }
  assert {
    condition     = output.mapped_extra_volumes[0].mount_path == "/home/runner/cache"
    error_message = "mount_path must equal input path (EARS-13)"
  }
  assert {
    condition     = output.mapped_extra_volumes[0].persistent == true
    error_message = "extra volumes must be persistent by default (per user clarification)"
  }
  assert {
    condition     = output.mapped_extra_volumes[0].containers == "dev"
    error_message = "extra volumes must mount on dev container only"
  }
  assert {
    condition     = output.mapped_extra_volumes[0].size == "5Gi"
    error_message = "extra volume size must pass through verbatim"
  }
  assert {
    condition     = output.mapped_extra_volumes[0].name == "home-runner-cache"
    error_message = "PVC name must be input path with leading slash trimmed and remaining slashes replaced with dashes"
  }
}

run "extra_volumes_default_empty" {
  command = plan

  override_data {
    target = data.coder_workspace.me
    values = {
      start_count = 1
      name        = "t"
      id          = "00000000-0000-0000-0000-000000000020"
      access_url  = "https://example.test"
    }
  }
  override_data {
    target = data.coder_task.me
    values = {
      prompt = "{\"repo_url\":\"https://github.com/acme/widget\",\"repo_name\":\"widget\",\"ai_prompt\":\"x\"}"
    }
  }

  # When extra_volumes is omitted, mapped_extra_volumes must be empty and
  # all_volumes must be empty (docker is absent => false => no docker-cache).
  assert {
    condition     = length(output.mapped_extra_volumes) == 0
    error_message = "mapped_extra_volumes must be empty when extra_volumes is absent"
  }
  assert {
    condition     = length(output.all_volumes) == 0
    error_message = "all_volumes must be empty when docker=false and no extra_volumes"
  }
}

run "docker_cache_volume_present_when_docker_true" {
  command = plan

  override_data {
    target = data.coder_workspace.me
    values = {
      start_count = 1
      name        = "t"
      id          = "00000000-0000-0000-0000-000000000021"
      access_url  = "https://example.test"
    }
  }
  override_data {
    target = data.coder_task.me
    values = {
      prompt = "{\"repo_url\":\"https://github.com/acme/widget\",\"repo_name\":\"widget\",\"ai_prompt\":\"x\",\"docker\":true}"
    }
  }

  # Exactly one volume named "docker-cache" must be present, mounted on dind.
  assert {
    condition     = length([for v in output.all_volumes : v if v.name == "docker-cache"]) == 1
    error_message = "all_volumes must include exactly one docker-cache volume when docker=true (EARS-12)"
  }
  assert {
    condition     = [for v in output.all_volumes : v if v.name == "docker-cache"][0].containers == "dind"
    error_message = "docker-cache volume must mount on dind container (EARS-12)"
  }
  assert {
    condition     = [for v in output.all_volumes : v if v.name == "docker-cache"][0].persistent == false
    error_message = "docker-cache volume must be ephemeral (not persistent)"
  }
  assert {
    condition     = [for v in output.all_volumes : v if v.name == "docker-cache"][0].mount_path == "/var/lib/docker"
    error_message = "docker-cache mount_path must be /var/lib/docker"
  }
}

run "docker_cache_volume_absent_when_docker_false" {
  command = plan

  override_data {
    target = data.coder_workspace.me
    values = {
      start_count = 1
      name        = "t"
      id          = "00000000-0000-0000-0000-000000000022"
      access_url  = "https://example.test"
    }
  }
  override_data {
    target = data.coder_task.me
    values = {
      prompt = "{\"repo_url\":\"https://github.com/acme/widget\",\"repo_name\":\"widget\",\"ai_prompt\":\"x\",\"docker\":false,\"extra_volumes\":[{\"path\":\"/cache\",\"size\":\"2Gi\"}]}"
    }
  }

  # docker=false: no docker-cache volume. But extra_volumes still maps.
  assert {
    condition     = length([for v in output.all_volumes : v if v.name == "docker-cache"]) == 0
    error_message = "docker-cache volume must NOT be in all_volumes when docker=false (EARS-11)"
  }
  assert {
    condition     = length([for v in output.all_volumes : v if v.name == "cache"]) == 1
    error_message = "extra_volumes must still be mapped into all_volumes when docker=false"
  }
}
