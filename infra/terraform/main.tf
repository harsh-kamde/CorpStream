terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

resource "random_id" "suffix" {
  byte_length = 4
}

# ── Data sources ───────────────────────────────────────────────────────────────
data "aws_availability_zones" "available" { state = "available" }
data "aws_ami" "amazon_linux_2023" {
  most_recent = true
  owners      = ["amazon"]
  filter {
    name   = "name"
    values = ["al2023-ami-*-x86_64"]
  }
  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

# ── VPC + Networking ───────────────────────────────────────────────────────────
resource "aws_vpc" "main" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_hostnames = true
  enable_dns_support   = true
  tags = { Name = "${var.project_name}-vpc" }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "${var.project_name}-igw" }
}

resource "aws_subnet" "public" {
  count                   = 2
  vpc_id                  = aws_vpc.main.id
  cidr_block              = "10.0.${count.index}.0/24"
  availability_zone       = data.aws_availability_zones.available.names[count.index]
  map_public_ip_on_launch = true
  tags = { Name = "${var.project_name}-public-${count.index}" }
}

resource "aws_subnet" "private" {
  count             = 2
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.${count.index + 10}.0/24"
  availability_zone = data.aws_availability_zones.available.names[count.index]
  tags = { Name = "${var.project_name}-private-${count.index}" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }
  tags = { Name = "${var.project_name}-public-rt" }
}

resource "aws_route_table_association" "public" {
  count          = 2
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

# ── Security Groups ────────────────────────────────────────────────────────────
resource "aws_security_group" "ec2_sg" {
  name        = "${var.project_name}-ec2-sg"
  description = "MCP server security group"
  vpc_id      = aws_vpc.main.id

  ingress {
    description = "MCP port"
    from_port   = 3000
    to_port     = 3000
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "SSH"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${var.project_name}-ec2-sg" }
}

resource "aws_security_group" "rds_sg" {
  name        = "${var.project_name}-rds-sg"
  description = "RDS — only EC2 and Lambda"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "PostgreSQL from EC2"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.ec2_sg.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${var.project_name}-rds-sg" }
}

# ── IAM: EC2 role (access S3, no hardcoded keys) ──────────────────────────────
resource "aws_iam_role" "ec2_role" {
  name = "${var.project_name}-ec2-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy" "ec2_s3_policy" {
  name = "${var.project_name}-ec2-s3"
  role = aws_iam_role.ec2_role.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["s3:PutObject", "s3:GetObject", "s3:ListBucket"]
      Resource = [
        aws_s3_bucket.exports.arn,
        "${aws_s3_bucket.exports.arn}/*"
      ]
    }]
  })
}

resource "aws_iam_instance_profile" "ec2_profile" {
  name = "${var.project_name}-ec2-profile"
  role = aws_iam_role.ec2_role.name
}

# ── SSH Key Pair ───────────────────────────────────────────────────────────────
resource "aws_key_pair" "deployer" {
  key_name   = "${var.project_name}-deployer-key"
  public_key = var.ssh_public_key
}

# ── EC2 t2.micro (750 hrs/mo FREE) ────────────────────────────────────────────
resource "aws_instance" "mcp_server" {
  ami                    = data.aws_ami.amazon_linux_2023.id
  instance_type          = "t2.micro"
  key_name               = aws_key_pair.deployer.key_name
  subnet_id              = aws_subnet.public[0].id
  vpc_security_group_ids = [aws_security_group.ec2_sg.id]
  iam_instance_profile   = aws_iam_instance_profile.ec2_profile.name

  user_data = <<-EOF
    #!/bin/bash
    set -e
    dnf update -y

    # Install Node.js 20
    dnf install -y nodejs npm git

    # Install PM2 globally
    npm install -g pm2

    # Create app directory
    mkdir -p /home/ec2-user/app
    chown ec2-user:ec2-user /home/ec2-user/app

    # PM2 startup on reboot
    env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd -u ec2-user --hp /home/ec2-user
    systemctl enable pm2-ec2-user

    echo "Bootstrap complete" >> /var/log/user-data.log
  EOF

  tags = { Name = "${var.project_name}-mcp-server" }

  lifecycle {
    ignore_changes = [ami]  # Don't replace instance on AMI updates
  }
}

# Elastic IP so the public IP doesn't change on stop/start
resource "aws_eip" "mcp_eip" {
  instance = aws_instance.mcp_server.id
  domain   = "vpc"
  tags     = { Name = "${var.project_name}-eip" }
}

# ── RDS PostgreSQL db.t3.micro (750 hrs/mo FREE) ──────────────────────────────
resource "aws_db_subnet_group" "rds_subnet_group" {
  name       = "${var.project_name}-rds-subnet-group"
  subnet_ids = aws_subnet.private[*].id
  tags       = { Name = "${var.project_name}-rds-subnet-group" }
}

resource "aws_db_instance" "company_db" {
  identifier             = "${var.project_name}-db"
  engine                 = "postgres"
  engine_version         = "15.5"
  instance_class         = "db.t3.micro"   # FREE TIER
  allocated_storage      = 20              # FREE TIER max (GB)
  storage_type           = "gp2"
  db_name                = "companies"
  username               = var.db_username
  password               = var.db_password
  db_subnet_group_name   = aws_db_subnet_group.rds_subnet_group.name
  vpc_security_group_ids = [aws_security_group.rds_sg.id]
  publicly_accessible    = false
  skip_final_snapshot    = true
  deletion_protection    = false
  backup_retention_period = 1              # 1 day backup — free

  tags = { Name = "${var.project_name}-db" }
}

# ── S3 bucket (5 GB free) ─────────────────────────────────────────────────────
resource "aws_s3_bucket" "exports" {
  bucket        = "${var.project_name}-exports-${random_id.suffix.hex}"
  force_destroy = true
  tags          = { Name = "${var.project_name}-exports" }
}

resource "aws_s3_bucket_lifecycle_configuration" "exports_lifecycle" {
  bucket = aws_s3_bucket.exports.id
  rule {
    id     = "delete-old-exports"
    status = "Enabled"
    expiration { days = 30 }  # Auto-delete after 30 days — saves storage
  }
}

resource "aws_s3_bucket_public_access_block" "exports_block" {
  bucket                  = aws_s3_bucket.exports.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# ── Lambda scheduler (1M invocations/mo FREE — forever) ───────────────────────
resource "aws_iam_role" "lambda_role" {
  name = "${var.project_name}-lambda-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "lambda_basic" {
  role       = aws_iam_role.lambda_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_lambda_function" "scheduler" {
  function_name = "${var.project_name}-scheduler"
  runtime       = "nodejs20.x"
  handler       = "scheduler.handler"
  role          = aws_iam_role.lambda_role.arn
  filename      = "${path.module}/../lambda/scheduler.zip"
  timeout       = 120
  memory_size   = 128

  environment {
    variables = {
      EC2_PRIVATE_IP = aws_instance.mcp_server.private_ip
      INTERNAL_KEY   = var.internal_key
    }
  }

  tags = { Name = "${var.project_name}-scheduler" }
}

# CloudWatch log group for Lambda — 7-day retention to stay in free tier
resource "aws_cloudwatch_log_group" "lambda_logs" {
  name              = "/aws/lambda/${aws_lambda_function.scheduler.function_name}"
  retention_in_days = 7
}

# ── EventBridge cron — daily at 06:00 UTC (11:30 AM IST) FREE ─────────────────
resource "aws_cloudwatch_event_rule" "daily_scrape" {
  name                = "${var.project_name}-daily-scrape"
  description         = "Triggers daily company scrape"
  schedule_expression = "cron(0 6 * * ? *)"
}

resource "aws_cloudwatch_event_target" "trigger_lambda" {
  rule      = aws_cloudwatch_event_rule.daily_scrape.name
  target_id = "DailyScrapeScheduler"
  arn       = aws_lambda_function.scheduler.arn
}

resource "aws_lambda_permission" "allow_eventbridge" {
  statement_id  = "AllowEventBridgeInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.scheduler.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.daily_scrape.arn
}

# ── CloudWatch billing alert — get email if anything would charge ──────────────
resource "aws_cloudwatch_metric_alarm" "billing_alert" {
  alarm_name          = "${var.project_name}-billing-alert"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "EstimatedCharges"
  namespace           = "AWS/Billing"
  period              = 86400
  statistic           = "Maximum"
  threshold           = 1  # Alert at $1
  alarm_description   = "Alert if AWS charges exceed $1"
  dimensions          = { Currency = "USD" }
  alarm_actions       = var.alert_email != "" ? [aws_sns_topic.billing_alerts[0].arn] : []
}

resource "aws_sns_topic" "billing_alerts" {
  count = var.alert_email != "" ? 1 : 0
  name  = "${var.project_name}-billing-alerts"
}

resource "aws_sns_topic_subscription" "billing_email" {
  count     = var.alert_email != "" ? 1 : 0
  topic_arn = aws_sns_topic.billing_alerts[0].arn
  protocol  = "email"
  endpoint  = var.alert_email
}
