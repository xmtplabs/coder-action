# ─── Identity ────────────────────────────────────────────────────────────────

variable "workspace_name" {
  type        = string
  description = "Coder workspace name"
}

variable "workspace_id" {
  type        = string
  description = "Coder workspace ID"
}

variable "start_count" {
  type        = number
  description = "data.coder_workspace.me.start_count — controls whether pod/deployment is created"
}

variable "owner_name" {
  type        = string
  description = "Workspace owner full name"
}

variable "owner_email" {
  type        = string
  description = "Workspace owner email"
}

variable "owner_username" {
  type        = string
  description = "Workspace owner username"
}

# ─── Agent ───────────────────────────────────────────────────────────────────

variable "agent_token" {
  type        = string
  sensitive   = true
  description = "Coder agent token"
}

variable "agent_init_script" {
  type        = string
  description = "Coder agent init_script (base64-encoded and executed via setpriv)"
  default     = ""
}

variable "access_url" {
  type        = string
  description = "Coder access URL"
}

# ─── Workload type ───────────────────────────────────────────────────────────

variable "deployment_type" {
  type        = string
  description = "Kubernetes workload type: 'deployment' or 'pod'"
  default     = "deployment"

  validation {
    condition     = contains(["deployment", "pod"], var.deployment_type)
    error_message = "deployment_type must be 'deployment' or 'pod'"
  }
}

variable "restart_policy" {
  type        = string
  description = "Pod restart policy (only used when deployment_type = 'pod')"
  default     = "Always"
}

variable "termination_grace_period_seconds" {
  type        = number
  description = "Termination grace period (only used when deployment_type = 'pod')"
  default     = 30
}

variable "do_not_disrupt" {
  type        = bool
  description = "Add karpenter.sh/do-not-disrupt annotation"
  default     = false
}

variable "docker_enabled" {
  type        = bool
  description = "When false, the dind sidecar, DOCKER_HOST env on dev, and any containers=\"dind\" or \"both\" volume mounts are omitted from the rendered pod spec."
  default     = true
}

# ─── Git / envbuilder ────────────────────────────────────────────────────────

variable "git_url" {
  type        = string
  description = "Git URL for envbuilder (may include #refs/heads/branch suffix)"
}

variable "setup_script" {
  type        = string
  description = "Additional setup script lines appended after the standard chown"
  default     = ""
}

# ─── Resource profiles ───────────────────────────────────────────────────────

variable "dev_resources" {
  type = object({
    requests = map(string)
    limits   = map(string)
  })
  description = "Resource requests/limits for the dev (envbuilder) container"
  default = {
    requests = { cpu = "500m", memory = "8Gi", "ephemeral-storage" = "1Gi" }
    limits   = { cpu = "16", memory = "32Gi", "ephemeral-storage" = "10Gi" }
  }
}

variable "dind_resources" {
  type = object({
    requests = map(string)
    limits   = map(string)
  })
  description = "Resource requests/limits for the dind sidecar"
  default = {
    requests = { cpu = "250m", memory = "1Gi", "ephemeral-storage" = "1Gi" }
    limits   = { cpu = "4", memory = "8Gi", "ephemeral-storage" = "10Gi" }
  }
}

# ─── Storage ─────────────────────────────────────────────────────────────────

variable "workspace_size" {
  type        = string
  description = "Size of the workspace PVC (e.g. '10Gi', '30Gi')"
  default     = "10Gi"
}

variable "volumes" {
  type = list(object({
    name       = string
    size       = string
    mount_path = string
    persistent = optional(bool, true)
    count      = optional(number, 1)
    # Which containers get this mount: "dev", "dind", or "both"
    containers = optional(string, "dev")
  }))
  description = "Additional volumes beyond workspace and agent-state"
  default     = []
}

# ─── Labels ──────────────────────────────────────────────────────────────────

variable "app_name" {
  type        = string
  description = "Value for app.kubernetes.io/name label"
  default     = "coder-workspace"
}

variable "name_prefix" {
  type        = string
  description = "Prefix for Kubernetes resource names"
  default     = "workspace"
}
