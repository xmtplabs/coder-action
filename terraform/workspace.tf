# ─── Workspace Pod / Deployment ──────────────────────────────────────────────
# Declared at root scope so that terraform test assertions can reference
# kubernetes_pod_v1.workspace and kubernetes_deployment_v1.workspace directly
# without a module prefix.  The workspace-pod module owns PVCs and computes
# labels/scripts; these resources consume its outputs.

# ─── Deployment (long-lived workspaces) ──────────────────────────────────────

resource "kubernetes_deployment_v1" "workspace" {
  count = module.workspace.deployment_type == "deployment" ? data.coder_workspace.me.start_count : 0

  metadata {
    name        = module.workspace.pod_name
    namespace   = "coder"
    labels      = module.workspace.labels
    annotations = module.workspace.labels
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
      match_labels = module.workspace.labels
    }

    template {
      metadata {
        labels      = module.workspace.labels
        annotations = module.workspace.pod_annotations
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
            value = local.git_url
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
            value = module.workspace.setup_script
          }
          env {
            name  = "ENVBUILDER_INIT_SCRIPT"
            value = module.workspace.init_script
          }
          env {
            name  = "CODER_AGENT_TOKEN"
            value = try(coder_agent.dev[0].token, "")
          }
          env {
            name  = "CODER_AGENT_URL"
            value = data.coder_workspace.me.access_url
          }
          dynamic "env" {
            for_each = local.docker ? [1] : []
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
            for_each = module.workspace.dev_extra_mounts
            content {
              name       = volume_mount.value.name
              mount_path = volume_mount.value.mount_path
            }
          }

          resources {
            requests = local.dev_resources.requests
            limits   = local.dev_resources.limits
          }
        }

        # ── DinD sidecar ───────────────────────────────────────────────
        dynamic "container" {
          for_each = local.docker ? [1] : []
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
              for_each = module.workspace.dind_extra_mounts
              content {
                name       = volume_mount.value.name
                mount_path = volume_mount.value.mount_path
              }
            }

            resources {
              requests = local.dind_resources.requests
              limits   = local.dind_resources.limits
            }
          }
        }

        # ── Standard volumes ─────────────────────────────────────────
        volume {
          name = "workspace"
          persistent_volume_claim {
            claim_name = module.workspace.workspace_pvc_name
          }
        }

        volume {
          name = "agent-state"
          persistent_volume_claim {
            claim_name = module.workspace.agent_state_pvc_name
          }
        }

        # ── Extra persistent volumes ─────────────────────────────────
        dynamic "volume" {
          for_each = { for v in module.workspace.active_volumes : v.name => v if v.persistent }
          content {
            name = volume.key
            persistent_volume_claim {
              claim_name = module.workspace.extra_pvc_names[volume.key]
            }
          }
        }

        # ── Extra ephemeral volumes ──────────────────────────────────
        dynamic "volume" {
          for_each = { for v in module.workspace.active_volumes : v.name => v if !v.persistent }
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
  count = module.workspace.deployment_type == "pod" ? data.coder_workspace.me.start_count : 0

  metadata {
    name        = module.workspace.pod_name
    namespace   = "coder"
    labels      = module.workspace.labels
    annotations = module.workspace.pod_annotations
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

    restart_policy                   = "Never"
    termination_grace_period_seconds = 30

    # ── Dev container ──────────────────────────────────────────────
    container {
      name  = "dev"
      image = "ghcr.io/coder/envbuilder:1.3.0"

      env {
        name  = "ENVBUILDER_GIT_URL"
        value = local.git_url
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
        value = module.workspace.setup_script
      }
      env {
        name  = "ENVBUILDER_INIT_SCRIPT"
        value = module.workspace.init_script
      }
      env {
        name  = "CODER_AGENT_TOKEN"
        value = try(coder_agent.dev[0].token, "")
      }
      env {
        name  = "CODER_AGENT_URL"
        value = data.coder_workspace.me.access_url
      }
      dynamic "env" {
        for_each = local.docker ? [1] : []
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
        for_each = module.workspace.dev_extra_mounts
        content {
          name       = volume_mount.value.name
          mount_path = volume_mount.value.mount_path
        }
      }

      resources {
        requests = local.dev_resources.requests
        limits   = local.dev_resources.limits
      }
    }

    # ── DinD sidecar ───────────────────────────────────────────────
    dynamic "container" {
      for_each = local.docker ? [1] : []
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
          for_each = module.workspace.dind_extra_mounts
          content {
            name       = volume_mount.value.name
            mount_path = volume_mount.value.mount_path
          }
        }

        resources {
          requests = local.dind_resources.requests
          limits   = local.dind_resources.limits
        }
      }
    }

    # ── Standard volumes ─────────────────────────────────────────
    volume {
      name = "workspace"
      persistent_volume_claim {
        claim_name = module.workspace.workspace_pvc_name
      }
    }

    volume {
      name = "agent-state"
      persistent_volume_claim {
        claim_name = module.workspace.agent_state_pvc_name
      }
    }

    # ── Extra persistent volumes ─────────────────────────────────
    dynamic "volume" {
      for_each = { for v in module.workspace.active_volumes : v.name => v if v.persistent }
      content {
        name = volume.key
        persistent_volume_claim {
          claim_name = module.workspace.extra_pvc_names[volume.key]
        }
      }
    }

    # ── Extra ephemeral volumes ──────────────────────────────────
    dynamic "volume" {
      for_each = { for v in module.workspace.active_volumes : v.name => v if !v.persistent }
      content {
        name = volume.key
        empty_dir {
          size_limit = volume.value.size
        }
      }
    }
  }
}
