# CorpStream: Global Company Intelligence MCP Server

> An MCP (Model Context Protocol) server that aggregates **freshly registered companies** from 4+ global registries daily — Companies House UK, SEC EDGAR USA, MCA India, and OpenCorporates. Query everything through Claude or Cursor IDE using natural language.

---

## What you can ask (via Cursor or Claude)

```
"Show me all companies registered in the UK yesterday"
"Find tech companies incorporated in India in the last 3 days"
"What's the status of my last scrape run?"
"Get me a CSV of all US companies registered this week"
"Search for fintech companies registered in London"
```

---

## Data Sources

| Registry | Country | Method | Daily Volume | Free? |
|---|---|---|---|---|
| Companies House | UK | Official REST API | 300–500 | Yes — free API key |
| SEC EDGAR | USA | Official REST API | 50–200 | Yes — no key needed |
| MCA India | India | Apify scraper | 500–1000 | Yes — Apify free tier |
| OpenCorporates | Global | REST API | 100+ | Yes — 500 req/day |
| data.gov.in | India | Bulk dataset | Monthly refresh | Yes — MCA fallback |

---

## MCP Tools

| Tool | Description |
|---|---|
| `scrapeCompanies` | Trigger a scrape of newly registered companies |
| `searchCompanies` | Search the database by name, country, date, status |
| `getScrapeStatus` | Check the status of a scrape run (including async MCA) |
| `getResults` | Fetch results with JSON preview or CSV download URL |
| `listRuns` | Audit log of all scrape runs |

---

**Stack:** Node.js · TypeScript · PostgreSQL (AWS RDS) · AWS Lambda · Apify  
**Cost:** $0 — runs entirely on AWS free tier + free API tiers  
**Deployment:** EC2 t2.micro + RDS t3.micro + Lambda (all free tier)


## Architecture

```
EventBridge (daily cron)
        │
        ▼
   AWS Lambda ──────────────► EC2 t2.micro
   (scheduler)                (MCP Server, Node.js)
                                    │
                    ┌───────────────┼───────────────┐
                    ▼               ▼               ▼
             Companies House   SEC EDGAR       Apify (MCA)
             (free API)        (free API)      (free tier)
                    │               │               │
                    └───────────────┴───────────────┘
                                    │
                              RDS PostgreSQL        S3 (CSV exports)
                              (t3.micro free)       (5GB free)
```

---

## Quick Start — Connect to Cursor

Add to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "global-companies": {
      "url": "http://YOUR_EC2_IP:3000/mcp",
      "headers": {
        "x-api-key": "YOUR_API_KEY"
      }
    }
  }
}
```

Then in Cursor chat: *"Scrape the latest UK company registrations"*

---

## Deployment Guide (Step by Step)

### Prerequisites

Install these on your local machine:
- [AWS CLI](https://aws.amazon.com/cli/) — `aws --version`
- [Terraform](https://developer.hashicorp.com/terraform/install) — `terraform --version`
- [Node.js 20+](https://nodejs.org/) — `node --version`
- SSH key pair — `ls ~/.ssh/id_rsa.pub` (generate with `ssh-keygen -t rsa -b 4096` if missing)

---

### Step 1 — AWS Account Setup

1. Create an AWS account at https://aws.amazon.com (free tier — no charge with our config)

2. Create an IAM user for Terraform + GitHub Actions:
   ```
   AWS Console → IAM → Users → Create user
   Username: global-company-mcp-deployer
   Permissions: AdministratorAccess (or use the minimal policy below)
   Create access key → Application running outside AWS
   Save: Access Key ID and Secret Access Key
   ```

3. Configure AWS CLI:
   ```bash
   aws configure
   # Enter: Access Key ID, Secret Access Key, Region (ap-south-1), Output (json)
   ```

4. Verify:
   ```bash
   aws sts get-caller-identity
   # Should show your account ID
   ```

---

### Step 2 — Get Free API Keys

**Companies House UK** (takes 2 minutes):
1. Go to https://developer.company-information.service.gov.uk
2. Register → Create application → Copy API key
3. Save as `CH_API_KEY`

**SEC EDGAR** — no key needed. Just set `CONTACT_EMAIL` to your email.

**Apify** (for MCA India):
1. Register at https://apify.com
2. Go to https://console.apify.com/account/integrations
3. Copy Personal API token → save as `APIFY_TOKEN`

**OpenCorporates** (optional):
1. Register at https://opencorporates.com/api_accounts/new
2. Copy API token → save as `OPENCORP_API_KEY`
3. Without a key, 500 free requests/day still work

---

### Step 3 — Deploy AWS Infrastructure with Terraform

```bash
# Clone this repo
git clone https://github.com/YOUR_USERNAME/global-company-mcp.git
cd global-company-mcp

# Configure Terraform variables
cd infra/terraform
cp terraform.tfvars.example terraform.tfvars
```

Edit `terraform.tfvars`:
```hcl
ssh_public_key = "ssh-rsa AAAA..."   # cat ~/.ssh/id_rsa.pub
db_password    = "StrongPassword123!"
internal_key   = "$(openssl rand -hex 32)"
alert_email    = "your@email.com"
```

```bash
# Initialize and apply
terraform init
terraform plan    # Review what will be created
terraform apply   # Type 'yes' to confirm

# Save the outputs — you'll need these
terraform output
```

You'll see:
```
ec2_public_ip    = "13.x.x.x"
mcp_endpoint     = "http://13.x.x.x:3000/mcp"
rds_endpoint     = "company-db.xxxx.ap-south-1.rds.amazonaws.com:5432"
s3_bucket_name   = "global-company-mcp-exports-xxxx"
ssh_command      = "ssh -i ~/.ssh/id_rsa ec2-user@13.x.x.x"
```

> RDS takes ~5 minutes to provision. EC2 is ready in ~1 minute.

---

### Step 4 — Set Up the EC2 Server

```bash
# SSH into EC2
ssh -i ~/.ssh/id_rsa ec2-user@YOUR_EC2_IP

# Run the setup script (installs Node.js, PM2, clones repo)
bash -s << 'EOF'
  sudo dnf update -y
  sudo dnf install -y nodejs npm git
  sudo npm install -g pm2
  mkdir -p ~/app ~/logs
  git clone https://github.com/YOUR_USERNAME/global-company-mcp.git ~/app
  cd ~/app && npm ci && npm run build
  sudo env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd \
    -u ec2-user --hp /home/ec2-user
EOF

# Create .env file on EC2
cat > ~/app/packages/mcp-server/.env << EOF
NODE_ENV=production
PORT=3000
DATABASE_URL=postgresql://mcpuser:YOUR_PASSWORD@YOUR_RDS_ENDPOINT/companies?sslmode=require
API_KEY=$(openssl rand -hex 32)
INTERNAL_KEY=YOUR_INTERNAL_KEY
CH_API_KEY=YOUR_CH_API_KEY
CONTACT_EMAIL=your@email.com
APIFY_TOKEN=YOUR_APIFY_TOKEN
MCA_ACTOR_ID=your-username/mca-india-scraper
AWS_REGION=ap-south-1
S3_BUCKET=YOUR_S3_BUCKET_NAME
DATA_GOV_API_KEY=579b464db66ec23bdd000001cdd3946e44ce4aab825d70c01ca5
EOF

# Note your API_KEY — you'll need it for Cursor and GitHub Secrets
cat ~/app/packages/mcp-server/.env | grep API_KEY
```

---

### Step 5 — Run Database Migrations

```bash
# Still on EC2
cd ~/app
npx tsx scripts/seed-db.ts
# This creates all tables and prints a demo API key
```

---

### Step 6 — Start the MCP Server

```bash
# On EC2
cd ~/app
pm2 start packages/mcp-server/dist/index.js \
  --name mcp-server \
  --cwd ~/app/packages/mcp-server \
  --log ~/logs/mcp-server.log \
  --time \
  --restart-delay=3000 \
  --max-restarts=10

pm2 save

# Verify it's running
pm2 status
curl http://localhost:3000/health
# {"status":"ok","version":"1.0.0","uptime":5}
```

Test from your local machine:
```bash
curl http://YOUR_EC2_IP:3000/health
```

---

### Step 7 — Deploy the MCA Apify Actor

```bash
# On your local machine
cd packages/apify-actors/mca-scraper
npm install -g apify-cli
apify login   # Enter your Apify token

# Deploy to Apify cloud
apify push

# Copy the Actor ID from the output (format: username/mca-india-scraper)
# Add it to EC2 .env as MCA_ACTOR_ID
```

---

### Step 8 — Configure GitHub Actions (CI/CD)

Go to your GitHub repo → **Settings → Secrets and variables → Actions** → New repository secret

Add these secrets:

| Secret | Value |
|---|---|
| `EC2_HOST` | Your EC2 public IP |
| `EC2_SSH_KEY` | Contents of `~/.ssh/id_rsa` (private key) |
| `DATABASE_URL` | From terraform output |
| `API_KEY` | From EC2 .env |
| `INTERNAL_KEY` | From terraform.tfvars |
| `CH_API_KEY` | Companies House key |
| `CONTACT_EMAIL` | Your email |
| `APIFY_TOKEN` | Apify API token |
| `MCA_ACTOR_ID` | Apify actor ID |
| `OPENCORP_API_KEY` | OpenCorporates key |
| `AWS_ACCESS_KEY_ID` | IAM user key (for Lambda updates) |
| `AWS_SECRET_ACCESS_KEY` | IAM user secret |
| `AWS_REGION` | `ap-south-1` |
| `S3_BUCKET` | From terraform output |
| `DATA_GOV_API_KEY` | data.gov.in key |

Now every push to `main` automatically deploys to EC2.

---

### Step 9 — Connect to Cursor IDE

1. Open `~/.cursor/mcp.json` (create if missing)
2. Add:
```json
{
  "mcpServers": {
    "global-companies": {
      "url": "http://YOUR_EC2_IP:3000/mcp",
      "headers": {
        "x-api-key": "YOUR_API_KEY"
      }
    }
  }
}
```
3. Restart Cursor
4. In Cursor chat, try: *"Use the global-companies tool to scrape UK companies from yesterday"*

---

### Step 10 — Verify the Daily Scheduler

The Lambda runs daily at 06:00 UTC (11:30 AM IST). To test it manually:

```bash
# Trigger Lambda manually
aws lambda invoke \
  --function-name global-company-mcp-scheduler \
  --region ap-south-1 \
  output.json
cat output.json
```

Or test the internal endpoint directly from EC2:
```bash
curl -X POST http://localhost:3000/internal/scrape \
  -H "Content-Type: application/json" \
  -H "x-internal-key: YOUR_INTERNAL_KEY" \
  -d '{"source":"companies_house","daysBack":1,"limit":10}'
```

---

## Free Tier Monitoring

Set up these safeguards to ensure you never pay:

```bash
# 1. AWS Budget alert (from local machine)
aws budgets create-budget \
  --account-id $(aws sts get-caller-identity --query Account --output text) \
  --budget '{"BudgetName":"free-tier-guard","BudgetLimit":{"Amount":"1","Unit":"USD"},"TimeUnit":"MONTHLY","BudgetType":"COST"}' \
  --notifications-with-subscribers '[{"Notification":{"NotificationType":"ACTUAL","ComparisonOperator":"GREATER_THAN","Threshold":80},"Subscribers":[{"SubscriptionType":"EMAIL","Address":"your@email.com"}]}]'

# 2. Stop RDS when not using it (saves free hours for testing)
aws rds stop-db-instance --db-instance-identifier global-company-mcp-db --region ap-south-1

# 3. Set CloudWatch log retention
aws logs put-retention-policy \
  --log-group-name /aws/lambda/global-company-mcp-scheduler \
  --retention-in-days 7 \
  --region ap-south-1
```

---

## Local Development

```bash
# 1. Clone and install
git clone https://github.com/YOUR_USERNAME/global-company-mcp.git
cd global-company-mcp
npm install

# 2. Set up local .env
cp .env.example packages/mcp-server/.env
# Edit with your keys (use a local PostgreSQL for DATABASE_URL)

# 3. Run DB migrations locally
cd packages/mcp-server
npm run db:push

# 4. Start in dev mode (hot reload)
npm run dev

# 5. Test tools
MCP_URL=http://localhost:3000 API_KEY=your_key npx tsx scripts/test-tools.ts
```

---

## API Reference (REST)

The server also exposes a REST API via the internal endpoint for non-MCP use:

```bash
# Health check
GET /health

# Trigger scrape (Lambda uses this)
POST /internal/scrape
Headers: x-internal-key: YOUR_INTERNAL_KEY
Body: {"source":"companies_house","daysBack":1,"limit":100}

# MCP endpoint (all tools via JSON-RPC)
POST /mcp
Headers: x-api-key: YOUR_API_KEY
Body: {"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"searchCompanies","arguments":{"country":"GB","limit":10}}}
```

---

## Project Structure

```
global-company-mcp/
├── packages/
│   ├── mcp-server/
│   │   └── src/
│   │       ├── index.ts          # MCP server + HTTP entry point
│   │       ├── types.ts          # Shared types + helpers
│   │       ├── tools/
│   │       │   ├── scrape.ts     # Main scrape orchestrator
│   │       │   ├── search.ts     # PostgreSQL search queries
│   │       │   ├── runs.ts       # Run status + polling
│   │       │   └── results.ts    # Result fetch + CSV export
│   │       ├── sources/
│   │       │   ├── companies-house.ts
│   │       │   ├── sec-edgar.ts
│   │       │   ├── mca-india.ts
│   │       │   └── opencorporates.ts
│   │       ├── db/
│   │       │   ├── schema.ts     # Drizzle ORM schema
│   │       │   └── client.ts     # PostgreSQL connection pool
│   │       ├── storage/
│   │       │   └── s3.ts         # CSV upload to S3
│   │       └── middleware/
│   │           └── auth.ts       # API key validation
│   └── apify-actors/
│       └── mca-scraper/          # Apify actor for MCA India
├── infra/
│   ├── terraform/                # AWS infrastructure as code
│   ├── lambda/                   # EventBridge scheduler
│   └── docker/                   # Dockerfile
├── scripts/
│   ├── ec2-setup.sh              # One-time EC2 bootstrap
│   ├── seed-db.ts                # DB migrations + demo key
│   └── test-tools.ts             # End-to-end tool tests
└── .github/
    └── workflows/
        ├── ci.yml                # PR checks
        └── deploy.yml            # Auto-deploy to EC2
```

---

## Troubleshooting

**MCP server not responding:**
```bash
ssh ec2-user@YOUR_EC2_IP
pm2 logs mcp-server --lines 50
pm2 restart mcp-server
```

**RDS connection refused:**
```bash
# Check security group allows EC2 → RDS on port 5432
# Check DATABASE_URL has ?sslmode=require for RDS
```

**Companies House returns 429:**
```bash
# You're hitting the 600 req/5min limit
# The adapter auto-waits 6 seconds on 429 — just retry
```

**Apify MCA run stuck in PENDING:**
```bash
# Call getScrapeStatus — it auto-polls Apify and saves results when done
# Or check Apify console: https://console.apify.com/actors/runs
```

**Free tier alert triggered:**
```bash
# Check which service is charging:
aws ce get-cost-and-usage \
  --time-period Start=2024-01-01,End=2024-01-31 \
  --granularity MONTHLY \
  --metrics BlendedCost \
  --group-by Type=DIMENSION,Key=SERVICE
```

---

## License

MIT — use freely, attribution appreciated.
