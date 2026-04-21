terraform {
  required_providers {
    kubernetes = { source = "hashicorp/kubernetes", version = "~> 2.35.0" }
  }
}

# ─── Locals ──────────────────────────────────────────────────────────────────

locals {
  hostname = lower(var.workspace_name)
  ws_id    = substr(var.workspace_id, 0, 8)
  slug     = "${local.hostname}-${local.ws_id}"

  labels = {
    "app.kubernetes.io/name"       = var.app_name
    "app.kubernetes.io/instance"   = local.hostname
    "app.kubernetes.io/managed-by" = "coder"
  }

  annotations = {
    "coder.com/owner-name"  = var.owner_name
    "coder.com/owner-email" = var.owner_email
    "coder.com/owner"       = var.owner_username
    "coder.com/workspace"   = var.workspace_name
  }

  # Standard setup script + optional caller additions
  setup_script = join("; ", compact([
    "chown -R 1000:1000 /workspaces /persist/agent-state",
    var.setup_script,
  ]))

  # Init script: drop to UID 1000 if root, then run agent init
  init_script = join(" && ", [
    "echo ${base64encode(var.agent_init_script)} | base64 -d > /tmp/init.sh",
    "chmod +x /tmp/init.sh",
    "if [ \"$(id -u)\" = \"0\" ]; then export HOME=$(getent passwd 1000 | cut -d: -f6); exec setpriv --reuid=1000 --regid=1000 --init-groups /bin/bash /tmp/init.sh; else exec /bin/bash /tmp/init.sh; fi",
  ])

  # Filter volumes by count > 0
  active_volumes = [for v in var.volumes : v if v.count > 0]

  # Volumes for dev container (all standard + volumes with containers "dev" or "both")
  dev_extra_mounts  = [for v in local.active_volumes : v if contains(["dev", "both"], v.containers)]
  dind_extra_mounts = [for v in local.active_volumes : v if contains(["dind", "both"], v.containers)]

  pod_annotations = var.do_not_disrupt ? merge(local.annotations, {
    "karpenter.sh/do-not-disrupt" = "true"
  }) : local.annotations
}

# ─── Standard PVCs ───────────────────────────────────────────────────────────

resource "kubernetes_persistent_volume_claim_v1" "workspace" {
  metadata {
    name        = "${var.name_prefix}-workspace-${local.slug}"
    namespace   = "coder"
    labels      = local.labels
    annotations = local.annotations
  }

  spec {
    access_modes       = ["ReadWriteOnce"]
    storage_class_name = "gp3"

    resources {
      requests = {
        storage = var.workspace_size
      }
    }
  }

  wait_until_bound = false

  lifecycle {
    ignore_changes = [spec[0].resources[0].requests]
  }
}

resource "kubernetes_persistent_volume_claim_v1" "agent_state" {
  metadata {
    name        = "${var.name_prefix}-agent-state-${local.slug}"
    namespace   = "coder"
    labels      = local.labels
    annotations = local.annotations
  }

  spec {
    access_modes       = ["ReadWriteOnce"]
    storage_class_name = "gp3"

    resources {
      requests = {
        storage = "1Gi"
      }
    }
  }

  wait_until_bound = false

  lifecycle {
    ignore_changes = [spec[0].resources[0].requests]
  }
}

# ─── Extra PVCs (persistent volumes from var.volumes) ────────────────────────

resource "kubernetes_persistent_volume_claim_v1" "extra" {
  for_each = { for v in local.active_volumes : v.name => v if v.persistent }

  metadata {
    name        = "${each.key}-${local.slug}"
    namespace   = "coder"
    labels      = local.labels
    annotations = local.annotations
  }

  spec {
    access_modes       = ["ReadWriteOnce"]
    storage_class_name = "gp3"

    resources {
      requests = {
        storage = each.value.size
      }
    }
  }

  wait_until_bound = false
}
