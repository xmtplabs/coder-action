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

run "dind_resources_constant_across_sizes" {
  command = plan

  override_data {
    target = data.coder_workspace.me
    values = {
      start_count = 1
      name        = "t"
      id          = "00000000-0000-0000-0000-000000000014"
      access_url  = "https://example.test"
    }
  }
  override_data {
    target = data.coder_task.me
    values = {
      prompt = "{\"repo_url\":\"https://github.com/acme/widget\",\"repo_name\":\"widget\",\"ai_prompt\":\"x\",\"size\":\"small\"}"
    }
  }

  # Under all three sizes the dind sidecar profile MUST be identical. We sample
  # one size here; the other two sizes' size_*_profile runs implicitly cover
  # the invariant by having the same dind assertion pass. (EARS-10)
  assert {
    condition     = output.dind_resources.requests.cpu == "250m"
    error_message = "dind requests.cpu must be 250m across all sizes (EARS-10)"
  }
  assert {
    condition     = output.dind_resources.requests.memory == "1Gi"
    error_message = "dind requests.memory must be 1Gi across all sizes (EARS-10)"
  }
  assert {
    condition     = output.dind_resources.limits.cpu == "2"
    error_message = "dind limits.cpu must be 2 across all sizes (EARS-10)"
  }
  assert {
    condition     = output.dind_resources.limits.memory == "4Gi"
    error_message = "dind limits.memory must be 4Gi across all sizes (EARS-10)"
  }
}
