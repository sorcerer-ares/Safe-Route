data "aws_vpc" "default" {
  default = true
}

# Security Group for Elastic Beanstalk EC2 Instances
resource "aws_security_group" "eb_sg" {
  name        = "${var.project_name}-eb-sg"
  description = "Allow public HTTP traffic to SafeRoute Beanstalk instances"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description = "Public HTTP traffic"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    description = "Allow all outbound traffic (OSRM, Overpass, Gemini, RDS)"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# Security Group for RDS PostgreSQL
resource "aws_security_group" "rds_sg" {
  name        = "${var.project_name}-rds-sg"
  description = "Allow PostgreSQL inbound strictly from Elastic Beanstalk SG"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description     = "PostgreSQL access from Beanstalk EC2 instances only"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.eb_sg.id]
  }
}
