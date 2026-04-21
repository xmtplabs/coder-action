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
