output "task_app_id" {
  description = "Claude Code task app ID (for coder_ai_task)"
  value       = length(module.claude-code) > 0 ? module.claude-code[0].task_app_id : ""
}
