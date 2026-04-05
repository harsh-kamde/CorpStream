#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# scripts/ec2-setup.sh
# Run this ONCE on a fresh EC2 instance after `terraform apply`
# Usage: ssh ec2-user@<EC2_IP> 'bash -s' < scripts/ec2-setup.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

echo "==> [1/8] Updating system packages..."
sudo dnf update -y

echo "==> [2/8] Installing Node.js 20..."
sudo dnf install -y nodejs npm git

NODE_VERSION=$(node --version)
echo "    Node.js installed: $NODE_VERSION"

echo "==> [3/8] Installing PM2..."
sudo npm install -g pm2

echo "==> [4/8] Creating app directory..."
mkdir -p ~/app ~/logs

echo "==> [5/8] Cloning repository..."
# Replace with your actual GitHub repo URL
REPO_URL="${GITHUB_REPO:-https://github.com/YOUR_USERNAME/global-company-mcp.git}"
git clone "$REPO_URL" ~/app || (cd ~/app && git pull)

echo "==> [6/8] Installing dependencies..."
cd ~/app
npm ci --omit=dev
npm run build

echo "==> [7/8] Setting up PM2 startup..."
sudo env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd \
  -u ec2-user --hp /home/ec2-user
sudo systemctl enable pm2-ec2-user

echo "==> [8/8] Setup complete!"
echo ""
echo "Next steps:"
echo "  1. Create ~/app/packages/mcp-server/.env (see .env.example)"
echo "  2. Run: npm run db:push (from ~/app)"
echo "  3. Start server: pm2 start packages/mcp-server/dist/index.js --name mcp-server"
echo "  4. Save PM2: pm2 save"
echo "  5. Check: curl http://localhost:3000/health"
