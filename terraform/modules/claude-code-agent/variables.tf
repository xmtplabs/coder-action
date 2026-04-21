variable "start_count" {
  type        = number
  description = "data.coder_workspace.me.start_count"
}

variable "agent_id" {
  type        = string
  description = "coder_agent resource ID"
}

variable "work_dir" {
  type        = string
  description = "Working directory for Claude Code"
}

variable "oauth_token" {
  type        = string
  sensitive   = true
  description = "Claude Code OAuth token"
}

variable "ai_prompt" {
  type        = string
  description = "Optional AI prompt. When set, enables autonomous mode (skipDangerousModePermissionPrompt)"
  default     = ""
}

variable "marketplaces" {
  type        = list(string)
  description = "Extra known marketplaces added to settings.json"
  default     = ["xmtplabs/code-factory"]
}

variable "plugins" {
  type        = list(string)
  description = "Plugins to install via 'claude plugin install <name> --scope user' and enable in settings"
  default = [
    "code-factory@code-factory",
    "ralph-loop@claude-plugins-official",
    "code-simplifier@claude-plugins-official",
    "rust-analyzer-lsp@claude-plugins-official",
    "gopls-lsp@claude-plugins-official",
    "typescript-lsp@claude-plugins-official",
  ]
}

variable "mcp" {
  type        = string
  description = "MCP server configuration JSON string passed to the Claude Code module"
  default     = ""
}

variable "post_install_script" {
  type        = string
  description = "Script to run after Claude Code and plugin installation"
  default     = ""
}
