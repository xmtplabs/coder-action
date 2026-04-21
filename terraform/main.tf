terraform {
  required_providers {
    coder      = { source = "coder/coder" }
    kubernetes = { source = "hashicorp/kubernetes", version = "~> 2.35.0" }
  }
}

provider "kubernetes" {
  # Coder injects cluster credentials via the provisioner's service account
}

# ─── Variables (baked into the template, not user-facing) ────────────────────

variable "claude_code_oauth_token" {
  type        = string
  sensitive   = true
  description = "Claude Code OAuth token for AI agent authentication"
  default     = ""
}

variable "github_pat" {
  type        = string
  sensitive   = true
  description = "GitHub PAT for a non-org-member service account. Used to fork repos, comment on issues, and create cross-fork PRs."
}

variable "ai_provider" {
  type        = string
  description = "AI coding agent: claude_code or codex"
  default     = "claude_code"

  validation {
    condition     = contains(["claude_code", "codex"], var.ai_provider)
    error_message = "ai_provider must be 'claude_code' or 'codex'"
  }
}

variable "codex_auth_token_json" {
  type        = string
  sensitive   = true
  description = "Base64-encoded Codex auth.json for CI/CD file-based authentication"
  default     = ""
}

# ─── Data sources ─────────────────────────────────────────────────────────────

data "coder_workspace" "me" {}
data "coder_workspace_owner" "me" {}
data "coder_task" "me" {}

# ─── Locals ───────────────────────────────────────────────────────────────────

locals {
  use_claude = var.ai_provider == "claude_code"

  # ── Prompt decode ──────────────────────────────────────────────────────
  raw_prompt = data.coder_task.me.prompt
  parsed     = try(jsondecode(local.raw_prompt), null)
  json_valid = local.parsed != null

  # ── Required fields (validated in preconditions) ───────────────────────
  repo_url  = try(local.parsed.repo_url, "")
  repo_name = try(local.parsed.repo_name, "")
  ai_prompt = try(local.parsed.ai_prompt, "")

  # ── Optional fields (defaults applied here) ────────────────────────────
  base_branch   = try(local.parsed.base_branch, "")
  size          = try(local.parsed.size, "large")
  docker        = try(local.parsed.docker, false)
  extra_volumes = try(local.parsed.extra_volumes, [])

  # ── Derived ────────────────────────────────────────────────────────────
  work_dir = "/workspaces/${local.repo_name}"
  git_url  = local.base_branch == "" ? local.repo_url : "${local.repo_url}#refs/heads/${local.base_branch}"
}

# ─── Coder Agent ─────────────────────────────────────────────────────────────

resource "coder_agent" "dev" {
  count              = data.coder_workspace.me.start_count
  arch               = "amd64"
  auth               = "token"
  os                 = "linux"
  dir                = local.work_dir
  connection_timeout = 600

  lifecycle {
    precondition {
      condition     = local.json_valid
      error_message = "data.coder_task.me.prompt must be valid JSON matching the TaskMetadata schema"
    }
    precondition {
      condition     = local.repo_url != ""
      error_message = "TaskMetadata.repo_url is required and must be non-blank"
    }
    precondition {
      condition     = local.repo_name != ""
      error_message = "TaskMetadata.repo_name is required and must be non-blank"
    }
    precondition {
      condition     = local.ai_prompt != ""
      error_message = "TaskMetadata.ai_prompt is required and must be non-blank"
    }
    precondition {
      condition     = !local.use_claude || var.claude_code_oauth_token != ""
      error_message = "claude_code_oauth_token is required when ai_provider is claude_code"
    }
    precondition {
      condition     = local.use_claude || var.codex_auth_token_json != ""
      error_message = "codex_auth_token_json is required when ai_provider is codex"
    }
  }

  env = {
    GITHUB_TOKEN = var.github_pat
  }

  startup_script = <<-EOT
    # Trust GitHub's SSH host key so git operations don't prompt
    mkdir -p ~/.ssh && chmod 700 ~/.ssh
    ssh-keyscan -t ed25519 github.com >> ~/.ssh/known_hosts 2>/dev/null

    # Install gh CLI if missing (Debian; https://github.com/cli/cli/blob/trunk/docs/install_linux.md#debian)
    if ! command -v gh >/dev/null 2>&1; then
      SUDO=""
      [ "$(id -u)" -ne 0 ] && SUDO="sudo"
      (type -p wget >/dev/null || ($SUDO apt update && $SUDO apt-get install wget -y)) \
        && $SUDO mkdir -p -m 755 /etc/apt/keyrings \
        && out=$(mktemp) && wget -nv -O"$out" https://cli.github.com/packages/githubcli-archive-keyring.gpg \
        && cat "$out" | $SUDO tee /etc/apt/keyrings/githubcli-archive-keyring.gpg > /dev/null \
        && $SUDO chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
        && $SUDO mkdir -p -m 755 /etc/apt/sources.list.d \
        && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | $SUDO tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
        && $SUDO apt update \
        && $SUDO apt install gh -y
    fi

    # Authenticate gh CLI with the baked-in PAT and configure git credentials
    echo "$GITHUB_TOKEN" | gh auth login --with-token
    gh auth setup-git

    # Configure git identity from the GitHub PAT user
    git config --global user.name "$(gh api user --jq .login)"
    git config --global user.email "$(gh api user --jq '.id | tostring + "+\(.login)@users.noreply.github.com"')"
  EOT

  metadata {
    key          = "cpu"
    display_name = "CPU Usage"
    interval     = 5
    timeout      = 5
    script       = "coder stat cpu"
  }

  metadata {
    key          = "memory"
    display_name = "Memory Usage"
    interval     = 5
    timeout      = 5
    script       = "coder stat mem"
  }
}

# ─── Claude Code ────────────────────────────────────────────────────────���────

module "claude-code" {
  count  = local.use_claude ? data.coder_workspace.me.start_count : 0
  source = "./modules/claude-code-agent"

  start_count = 1
  agent_id    = coder_agent.dev[0].id
  work_dir    = local.work_dir
  oauth_token = var.claude_code_oauth_token
  ai_prompt   = local.ai_prompt

}

# ─── Codex ───────────────────────────────────────────────────────────────────

module "codex" {
  count     = local.use_claude ? 0 : data.coder_workspace.me.start_count
  source    = "registry.coder.com/coder-labs/codex/coder"
  version   = "4.3.1"
  agent_id  = coder_agent.dev[count.index].id
  workdir   = local.work_dir
  ai_prompt = replace(local.ai_prompt, "/coder-task", "$coder-task")

  pre_install_script = <<-EOT
  # Symlink persistent agent state
  mkdir -p /persist/agent-state/codex /persist/agent-state/codex-module
  ln -sfn /persist/agent-state/codex        "$HOME/.codex"
  ln -sfn /persist/agent-state/codex-module "$HOME/.codex-module"

  # Install code-factory plugin for Codex
  git clone --depth 1 https://github.com/xmtplabs/code-factory.git /tmp/code-factory

  mkdir -p ~/.agents/skills
  cp -R /tmp/code-factory/skills/* ~/.agents/skills/

  mkdir -p ~/.codex/agents
  cp -R /tmp/code-factory/.codex/agents/* ~/.codex/agents/

  mkdir -p ~/.agents/plugins/plugins
  cp -R /tmp/code-factory ~/.agents/plugins/plugins/code-factory
  cat > ~/.agents/plugins/marketplace.json <<'MKJSON'
  {
    "name": "personal-plugins",
    "interface": {
      "displayName": "Personal Plugins"
    },
    "plugins": [
      {
        "name": "code-factory",
        "source": {
          "source": "local",
          "path": "./plugins/code-factory"
        },
        "policy": {
          "installation": "INSTALLED_BY_DEFAULT",
          "authentication": "ON_INSTALL"
        },
        "category": "Development"
      }
    ]
  }
  MKJSON

  rm -rf /tmp/code-factory
  EOT

  post_install_script = <<-EOT
  echo -n '${var.codex_auth_token_json}' | base64 -d > "$HOME/.codex/auth.json"
  chmod 600 "$HOME/.codex/auth.json"
  EOT

  base_config_toml = <<-EOT
  sandbox_mode = "danger-full-access"
  approval_policy = "never"
  cli_auth_credentials_store = "file"
  [projects."${local.work_dir}"]
  trust_level = "trusted"
  EOT
}

# ─── Workspace Pod ──────────────────────────────────��────────────────────────

module "workspace" {
  source = "./modules/workspace-pod"

  workspace_name = data.coder_workspace.me.name
  workspace_id   = data.coder_workspace.me.id
  start_count    = data.coder_workspace.me.start_count
  owner_name     = data.coder_workspace_owner.me.full_name
  owner_email    = data.coder_workspace_owner.me.email
  owner_username = data.coder_workspace_owner.me.name

  agent_token       = try(coder_agent.dev[0].token, "")
  agent_init_script = try(coder_agent.dev[0].init_script, "")
  access_url        = data.coder_workspace.me.access_url

  deployment_type                  = "pod"
  restart_policy                   = "Never"
  termination_grace_period_seconds = 30
  do_not_disrupt                   = true
  git_url                          = local.git_url
  workspace_size                   = "30Gi"
  app_name                         = "coder-task"
  name_prefix                      = "task"

  dev_resources = {
    requests = { cpu = "2", memory = "8Gi", "ephemeral-storage" = "30Gi" }
    limits   = { cpu = "8", memory = "24Gi", "ephemeral-storage" = "50Gi" }
  }

  dind_resources = {
    requests = { cpu = "250m", memory = "1Gi", "ephemeral-storage" = "5Gi" }
    limits   = { cpu = "2", memory = "4Gi", "ephemeral-storage" = "20Gi" }
  }

  volumes = [
    { name = "docker-cache", size = "10Gi", mount_path = "/var/lib/docker", persistent = false, containers = "dind" },
  ]
}

# ─── AI Task ───────────────────────────────────────────────────────���─────────

resource "coder_ai_task" "task" {
  count  = data.coder_workspace.me.start_count
  app_id = local.use_claude ? module.claude-code[0].task_app_id : module.codex[0].task_app_id
}

# ─── Dashboard metadata ─────────────────────────────��────────────────────────

resource "coder_metadata" "task_info" {
  count       = data.coder_workspace.me.start_count
  resource_id = coder_agent.dev[count.index].id

  item {
    key   = "pod"
    value = module.workspace.pod_name
  }
  item {
    key   = "repo"
    value = local.repo_url
  }
}
