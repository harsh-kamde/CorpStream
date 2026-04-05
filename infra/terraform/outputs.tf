output "ec2_public_ip" {
  description = "Elastic IP of the MCP server — use this in Cursor mcp.json"
  value       = aws_eip.mcp_eip.public_ip
}

output "ec2_private_ip" {
  description = "Private IP for Lambda → EC2 communication (set in Lambda env)"
  value       = aws_instance.mcp_server.private_ip
}

output "mcp_endpoint" {
  description = "Full MCP endpoint URL for Cursor/Claude config"
  value       = "http://${aws_eip.mcp_eip.public_ip}:3000/mcp"
}

output "health_endpoint" {
  description = "Health check URL"
  value       = "http://${aws_eip.mcp_eip.public_ip}:3000/health"
}

output "rds_endpoint" {
  description = "RDS connection endpoint — use in DATABASE_URL"
  value       = aws_db_instance.company_db.endpoint
  sensitive   = true
}

output "rds_connection_string" {
  description = "Full DATABASE_URL — add to EC2 .env"
  value       = "postgresql://${var.db_username}:${var.db_password}@${aws_db_instance.company_db.endpoint}/companies?sslmode=require"
  sensitive   = true
}

output "s3_bucket_name" {
  description = "S3 bucket name for CSV exports"
  value       = aws_s3_bucket.exports.bucket
}

output "ssh_command" {
  description = "SSH command to connect to EC2"
  value       = "ssh -i ~/.ssh/id_rsa ec2-user@${aws_eip.mcp_eip.public_ip}"
}
