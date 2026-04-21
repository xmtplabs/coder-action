terraform {
  required_providers {
    coder = { source = "coder/coder" }
  }
}

# ─── Locals ──────────────────────────────────────────────────────────────────

locals {
  enabled_plugins = { for p in var.plugins : p => true }

  marketplace_map = { for m in var.marketplaces : split("/", m)[1] => {
    source = { source = "github", repo = m }
  } }

  settings = jsonencode({
    permissions = {
      defaultMode = "bypassPermissions"
    }
    enableRemoteControl               = true
    skipDangerousModePermissionPrompt = true
    extraKnownMarketplaces            = local.marketplace_map
    enabledPlugins                    = local.enabled_plugins
  })

  plugin_install_commands = join("\n", [for p in var.plugins : "claude plugin install ${p} --scope user"])

  post_install_script = join("\n", compact([
    var.post_install_script,
    local.plugin_install_commands,
  ]))
}

# ─── Claude Code Module ──────────────────────────────────────────────────────

module "claude-code" {
  count                   = var.start_count
  source                  = "registry.coder.com/coder/claude-code/coder"
  version                 = "4.9.1"
  agent_id                = var.agent_id
  workdir                 = var.work_dir
  model                   = "opus"
  claude_code_oauth_token = var.oauth_token

  pre_install_script = <<-EOT
  # Symlink persistent agent state into $HOME so it survives workspace restarts
  mkdir -p /persist/agent-state/claude /persist/agent-state/claude-module
  ln -sfn /persist/agent-state/claude        "$HOME/.claude"
  ln -sfn /persist/agent-state/claude-module "$HOME/.claude-module"

  # Configure Claude Code settings
  mkdir -p ~/.claude
  cat > ~/.claude/settings.json <<'SETTINGS'
  ${local.settings}
  SETTINGS
  EOT

  post_install_script = local.post_install_script
  ai_prompt           = var.ai_prompt
  mcp                 = var.mcp != "" ? var.mcp : null
}
