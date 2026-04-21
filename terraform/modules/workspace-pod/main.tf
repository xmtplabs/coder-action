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

# ─── Deployment (long-lived workspaces) ──────────────────────────────────────

resource "kubernetes_deployment_v1" "workspace" {
  count = var.deployment_type == "deployment" ? var.start_count : 0

  metadata {
    name        = "${var.name_prefix}-${local.slug}"
    namespace   = "coder"
    labels      = local.labels
    annotations = local.labels
  }

  timeouts {
    create = "15m"
  }

  wait_for_rollout = true

  spec {
    replicas = 1

    strategy {
      type = "Recreate"
    }

    selector {
      match_labels = local.labels
    }

    template {
      metadata {
        labels      = local.labels
        annotations = local.pod_annotations
      }

      spec {
        affinity {
          node_affinity {
            preferred_during_scheduling_ignored_during_execution {
              weight = 100
              preference {
                match_expressions {
                  key      = "role"
                  operator = "In"
                  values   = ["workspace"]
                }
              }
            }
          }
        }

        # ── Dev container ──────────────────────────────────────────────
        container {
          name  = "dev"
          image = "ghcr.io/coder/envbuilder:1.3.0"

          env {
            name  = "ENVBUILDER_GIT_URL"
            value = var.git_url
          }
          env {
            name  = "ENVBUILDER_SKIP_REBUILD"
            value = "false"
          }
          env {
            name  = "ENVBUILDER_FALLBACK_IMAGE"
            value = "codercom/enterprise-base:ubuntu"
          }
          env {
            name  = "ENVBUILDER_SETUP_SCRIPT"
            value = local.setup_script
          }
          env {
            name  = "ENVBUILDER_INIT_SCRIPT"
            value = local.init_script
          }
          env {
            name  = "CODER_AGENT_TOKEN"
            value = var.agent_token
          }
          env {
            name  = "CODER_AGENT_URL"
            value = var.access_url
          }
          dynamic "env" {
            for_each = var.docker_enabled ? [1] : []
            content {
              name  = "DOCKER_HOST"
              value = "tcp://localhost:2375"
            }
          }
          env {
            name  = "ENVBUILDER_CACHE_REPO"
            value = "envbuilder-registry.coder.svc.cluster.local:5000/envbuilder-cache"
          }
          env {
            name  = "ENVBUILDER_INSECURE"
            value = "true"
          }

          volume_mount {
            name       = "workspace"
            mount_path = "/workspaces"
          }

          volume_mount {
            name       = "agent-state"
            mount_path = "/persist/agent-state"
          }

          dynamic "volume_mount" {
            for_each = local.dev_extra_mounts
            content {
              name       = volume_mount.value.name
              mount_path = volume_mount.value.mount_path
            }
          }

          resources {
            requests = var.dev_resources.requests
            limits   = var.dev_resources.limits
          }
        }

        # ── DinD sidecar ───────────────────────────────────────────────
        dynamic "container" {
          for_each = var.docker_enabled ? [1] : []
          content {
            name  = "dind"
            image = "docker:27-dind"

            security_context {
              privileged = true
            }

            env {
              name  = "DOCKER_TLS_CERTDIR"
              value = ""
            }

            port {
              container_port = 2375
              protocol       = "TCP"
            }

            # Always mount workspace for docker-compose bind mounts
            volume_mount {
              name       = "workspace"
              mount_path = "/workspaces"
            }

            dynamic "volume_mount" {
              for_each = local.dind_extra_mounts
              content {
                name       = volume_mount.value.name
                mount_path = volume_mount.value.mount_path
              }
            }

            resources {
              requests = var.dind_resources.requests
              limits   = var.dind_resources.limits
            }
          }
        }

        # ── Standard volumes ─────────────────────────────────────────
        volume {
          name = "workspace"
          persistent_volume_claim {
            claim_name = kubernetes_persistent_volume_claim_v1.workspace.metadata[0].name
          }
        }

        volume {
          name = "agent-state"
          persistent_volume_claim {
            claim_name = kubernetes_persistent_volume_claim_v1.agent_state.metadata[0].name
          }
        }

        # ── Extra persistent volumes ─────────────────────────────────
        dynamic "volume" {
          for_each = { for v in local.active_volumes : v.name => v if v.persistent }
          content {
            name = volume.key
            persistent_volume_claim {
              claim_name = kubernetes_persistent_volume_claim_v1.extra[volume.key].metadata[0].name
            }
          }
        }

        # ── Extra ephemeral volumes ──────────────────────────────────
        dynamic "volume" {
          for_each = { for v in local.active_volumes : v.name => v if !v.persistent }
          content {
            name = volume.key
            empty_dir {
              size_limit = volume.value.size
            }
          }
        }
      }
    }
  }
}

# ─── Pod (ephemeral tasks) ───────────────────────────────────────────────────

resource "kubernetes_pod_v1" "workspace" {
  count = var.deployment_type == "pod" ? var.start_count : 0

  metadata {
    name        = "${var.name_prefix}-${local.slug}"
    namespace   = "coder"
    labels      = local.labels
    annotations = local.pod_annotations
  }

  spec {
    affinity {
      node_affinity {
        preferred_during_scheduling_ignored_during_execution {
          weight = 100
          preference {
            match_expressions {
              key      = "role"
              operator = "In"
              values   = ["workspace"]
            }
          }
        }
      }
    }

    restart_policy                   = var.restart_policy
    termination_grace_period_seconds = var.termination_grace_period_seconds

    # ── Dev container ──────────────────────────────────────────────
    container {
      name  = "dev"
      image = "ghcr.io/coder/envbuilder:1.3.0"

      env {
        name  = "ENVBUILDER_GIT_URL"
        value = var.git_url
      }
      env {
        name  = "ENVBUILDER_SKIP_REBUILD"
        value = "false"
      }
      env {
        name  = "ENVBUILDER_FALLBACK_IMAGE"
        value = "codercom/enterprise-base:ubuntu"
      }
      env {
        name  = "ENVBUILDER_SETUP_SCRIPT"
        value = local.setup_script
      }
      env {
        name  = "ENVBUILDER_INIT_SCRIPT"
        value = local.init_script
      }
      env {
        name  = "CODER_AGENT_TOKEN"
        value = var.agent_token
      }
      env {
        name  = "CODER_AGENT_URL"
        value = var.access_url
      }
      dynamic "env" {
        for_each = var.docker_enabled ? [1] : []
        content {
          name  = "DOCKER_HOST"
          value = "tcp://localhost:2375"
        }
      }
      env {
        name  = "ENVBUILDER_CACHE_REPO"
        value = "envbuilder-registry.coder.svc.cluster.local:5000/envbuilder-cache"
      }
      env {
        name  = "ENVBUILDER_INSECURE"
        value = "true"
      }

      volume_mount {
        name       = "workspace"
        mount_path = "/workspaces"
      }

      volume_mount {
        name       = "agent-state"
        mount_path = "/persist/agent-state"
      }

      dynamic "volume_mount" {
        for_each = local.dev_extra_mounts
        content {
          name       = volume_mount.value.name
          mount_path = volume_mount.value.mount_path
        }
      }

      resources {
        requests = var.dev_resources.requests
        limits   = var.dev_resources.limits
      }
    }

    # ── DinD sidecar ───────────────────────────────────────────────
    dynamic "container" {
      for_each = var.docker_enabled ? [1] : []
      content {
        name  = "dind"
        image = "docker:27-dind"

        security_context {
          privileged = true
        }

        env {
          name  = "DOCKER_TLS_CERTDIR"
          value = ""
        }

        port {
          container_port = 2375
          protocol       = "TCP"
        }

        volume_mount {
          name       = "workspace"
          mount_path = "/workspaces"
        }

        dynamic "volume_mount" {
          for_each = local.dind_extra_mounts
          content {
            name       = volume_mount.value.name
            mount_path = volume_mount.value.mount_path
          }
        }

        resources {
          requests = var.dind_resources.requests
          limits   = var.dind_resources.limits
        }
      }
    }

    # ── Standard volumes ─────────────────────────────────────────
    volume {
      name = "workspace"
      persistent_volume_claim {
        claim_name = kubernetes_persistent_volume_claim_v1.workspace.metadata[0].name
      }
    }

    volume {
      name = "agent-state"
      persistent_volume_claim {
        claim_name = kubernetes_persistent_volume_claim_v1.agent_state.metadata[0].name
      }
    }

    # ── Extra persistent volumes ─────────────────────────────────
    dynamic "volume" {
      for_each = { for v in local.active_volumes : v.name => v if v.persistent }
      content {
        name = volume.key
        persistent_volume_claim {
          claim_name = kubernetes_persistent_volume_claim_v1.extra[volume.key].metadata[0].name
        }
      }
    }

    # ── Extra ephemeral volumes ──────────────────────────────────
    dynamic "volume" {
      for_each = { for v in local.active_volumes : v.name => v if !v.persistent }
      content {
        name = volume.key
        empty_dir {
          size_limit = volume.value.size
        }
      }
    }
  }
}
