variable "project_name" {
  description = "Project name prefix for all resources"
  type        = string
  default     = "global-company-mcp"
}

variable "aws_region" {
  description = "AWS region. ap-south-1 = Mumbai (closest to India, low latency)"
  type        = string
  default     = "ap-south-1"
}

variable "ssh_public_key" {
  description = "Your SSH public key (~/.ssh/id_rsa.pub). Used to SSH into EC2."
  type        = string
}

variable "db_username" {
  description = "RDS PostgreSQL master username"
  type        = string
  default     = "mcpuser"
}

variable "db_password" {
  description = "RDS PostgreSQL master password (min 8 chars)"
  type        = string
  sensitive   = true
}

variable "internal_key" {
  description = "Secret key for Lambda → EC2 internal communication"
  type        = string
  sensitive   = true
}

variable "alert_email" {
  description = "Email for billing alerts (leave empty to skip)"
  type        = string
  default     = ""
}
