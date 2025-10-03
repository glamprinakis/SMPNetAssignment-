# InfluxDB CRUD Service - AWS CDK

A production-ready, modular AWS infrastructure for deploying a private InfluxDB instance with a serverless CRUD API.

## 📊 Architecture

```mermaid
graph TB
    Internet((Internet))
    
    subgraph AWS["AWS Cloud"]
        subgraph VPC["VPC: 10.0.0.0/16"]
            subgraph Public["Public Subnets"]
                ALB["Application Load Balancer<br/>Port 80"]
                NAT["NAT Gateway"]
            end
            
            subgraph Private["Private Subnets"]
                Lambda["Lambda Function<br/>Python 3.11<br/>CRUD API"]
                InfluxDB["InfluxDB EC2<br/>t3.small<br/>Port 8086<br/>No Public IP"]
            end
        end
        
        SSM["SSM Parameter Store<br/>Age Private Key"]
    end
    
    Internet -->|HTTP| ALB
    ALB -->|Invoke| Lambda
    Lambda -->|HTTP:8086| InfluxDB
    InfluxDB -->|Decrypt Secrets| SSM
    
    style ALB fill:#ff9900
    style Lambda fill:#ff9900
    style InfluxDB fill:#ff9900
    style SSM fill:#28a745
```

**Key Features:**
- 🔒 **Private InfluxDB** - No public IP, accessible only from Lambda
- ⚡ **Serverless API** - Lambda with automatic scaling
- 🔐 **Secrets Management** - SOPS/Age encryption (no hardcoded credentials)
- 📦 **Modern Tooling** - UV package manager, Jest testing
- 🏗️ **Modular Design** - 6 reusable CDK constructs

## 🚀 Quick Start

### Prerequisites

```bash
# Install UV package manager
curl -LsSf https://astral.sh/uv/install.sh | sh

# Install SOPS and Age
brew install sops age  # macOS
# OR
# Linux: Download from GitHub releases

# Verify installations
uv --version
sops --version
age --version

# Install project dependencies
npm install
uv sync
```

### Deploy

```bash
# 1. Bootstrap CDK (first time only)
cdk bootstrap

# 2. Store age private key in AWS SSM
aws ssm put-parameter \
  --name "/influxdb/age-private-key" \
  --value "$(cat age-key.txt)" \
  --type SecureString

# 3. Deploy the stack
npm run deploy

# Note your ALB DNS from the output:
# Outputs:
# InfluxDbCrudStack.ALBDnsName = your-alb-xxxxx.region.elb.amazonaws.com
```

**Deployment time:** ~12-15 minutes

### Cleanup

```bash
npm run destroy
```

## 🧪 Testing

### Unit Tests

Run the full test suite (70 tests across 7 test files):

```bash
# Run all tests
npm test

# Watch mode (auto-rerun on changes)
npm run test:watch

# Generate coverage report
npm run test:coverage
```

**Expected output:**
```
Test Suites: 7 passed, 7 total
Tests:       70 passed, 70 total
Time:        ~6s
Coverage:    80%+
```

### API Endpoint Testing

#### Option 1: Manual Testing with cURL

Replace `<ALB-DNS>` with your actual ALB DNS name from deployment outputs.

**1. Health Check**
```bash
curl http://<ALB-DNS>/health
```
**Expected Response:**
```json
{"status": "healthy", "timestamp": "2025-10-03T10:30:00.000000"}
```

**2. Create Data**
```bash
curl -X POST http://<ALB-DNS>/data \
  -H "Content-Type: application/json" \
  -d '{
    "measurement": "temperature",
    "tags": {"sensor_id": "sensor_001", "location": "office"},
    "fields": {"value": 22.5, "humidity": 65}
  }'
```
**Expected Response:**
```json
{"message": "Data created successfully"}
```

**3. Get All Data**
```bash
curl http://<ALB-DNS>/data
```
**Expected Response:**
```json
{
  "data": [
    {
      "_time": "2025-10-03T10:30:00Z",
      "_measurement": "temperature",
      "sensor_id": "sensor_001",
      "value": "22.5",
      "humidity": "65"
    }
  ]
}
```

**4. Update Data**
```bash
curl -X PUT http://<ALB-DNS>/data/sensor_001 \
  -H "Content-Type: application/json" \
  -d '{
    "measurement": "temperature",
    "tags": {"sensor_id": "sensor_001"},
    "fields": {"value": 25.0, "humidity": 70}
  }'
```
**Expected Response:**
```json
{"message": "Data sensor_001 updated successfully"}
```

**5. Delete Data**
```bash
curl -X DELETE http://<ALB-DNS>/data/sensor_001
```
**Expected Response:**
```json
{"message": "Data sensor_001 deleted successfully"}
```

#### Option 2: Automated Testing Script

Run the comprehensive test script:

```bash
# Make script executable (first time only)
chmod +x scripts/test-api.sh

# Run all tests
./scripts/test-api.sh <ALB-DNS>

# Example:
./scripts/test-api.sh my-alb-123456.eu-central-1.elb.amazonaws.com
```

The script will:
- ✅ Test health check endpoint
- ✅ Create two data points
- ✅ Retrieve all data
- ✅ Update a data point
- ✅ Delete a data point
- ✅ Verify deletion

**Sample Output:**
```
================================================
Testing CRUD API at: http://your-alb.elb.amazonaws.com
================================================

Test 1: Health Check
GET /health
---
{
  "status": "healthy",
  "timestamp": "2025-10-03T12:34:56.123456"
}
Status: 200

================================================
Test 2: Create Data Point
POST /data
---
{
  "message": "Data created successfully"
}
Status: 200

...

================================================
All tests completed!
================================================
```

## 📋 Useful Commands

### Development

```bash
# Build TypeScript
npm run build

# Generate CloudFormation template
npm run synth

# Show deployment diff
npm run diff

# Compile in watch mode
npm run watch
```

### Python Dependencies (UV)

```bash
# Add a new dependency
uv add <package-name>

# Update dependencies
uv lock --upgrade

# Sync dependencies after git pull
uv sync
```

### Secrets Management (SOPS)

```bash
# View encrypted secrets
export SOPS_AGE_KEY_FILE=age-key.txt
sops secrets.yaml

# Edit secrets (auto-encrypts on save)
sops secrets.yaml

# Decrypt to view
sops -d secrets.yaml
```

### AWS/Monitoring

```bash
# View Lambda logs
aws logs tail /aws/lambda/InfluxDbCrudStack-CrudLambdaFunction --follow

# Check CloudWatch alarms
aws cloudwatch describe-alarms

# Connect to InfluxDB instance (via SSM)
INSTANCE_ID=$(aws ec2 describe-instances \
  --filters "Name=tag:Name,Values=*InfluxDbInstance*" \
  --query "Reservations[0].Instances[0].InstanceId" \
  --output text)
aws ssm start-session --target $INSTANCE_ID
```

## 📁 Project Structure

```
├── lib/
│   ├── constructs/              # Modular CDK constructs
│   │   ├── networking.ts        # VPC, subnets, NAT (85 lines)
│   │   ├── security-groups.ts   # Security groups (81 lines)
│   │   ├── influxdb-instance.ts # InfluxDB EC2 (245 lines)
│   │   ├── lambda-crud-api.ts   # Lambda function (97 lines)
│   │   ├── load-balancer.ts     # ALB setup (108 lines)
│   │   └── monitoring.ts        # CloudWatch alarms (128 lines)
│   └── influxdb-crud-stack.ts   # Main stack (108 lines)
├── lambda/
│   └── index.py                 # Lambda CRUD function
├── test/
│   ├── constructs/              # Unit tests per construct
│   └── influxdb-crud-stack.test.ts
├── scripts/
│   ├── test-api.sh              # API testing script
│   └── check-deployment-status.sh
├── pyproject.toml               # Python dependencies (UV)
├── package.json                 # Node.js dependencies
└── secrets.yaml                 # Encrypted secrets (SOPS)
```

## 🔧 Technical Specifications

| Component | Details |
|-----------|---------|
| **Region** | eu-central-1 (configurable) |
| **VPC** | 10.0.0.0/16, 2 AZs, 4 subnets |
| **InfluxDB** | EC2 t3.small, 20GB GP3, Amazon Linux 2023 |
| **Lambda** | Python 3.11, 30s timeout, VPC-enabled |
| **ALB** | Internet-facing, HTTP port 80 |
| **Secrets** | SOPS + Age encryption |
| **Package Manager** | UV (10-100x faster than pip) |
| **Testing** | Jest + CDK Assertions, 70 tests |

## 💰 Cost Estimate

| Resource | Monthly Cost |
|----------|--------------|
| EC2 t3.small | ~$15 |
| NAT Gateway | ~$33 |
| ALB | ~$17 |
| Lambda | Free tier |
| **Total** | **~$70-100/month** |

💡 **Tip:** Run `npm run destroy` when not in use to avoid charges.

## 🐛 Troubleshooting

### Lambda can't connect to InfluxDB
- Wait 5-10 minutes after deployment for InfluxDB to initialize
- Check security groups allow port 8086 traffic
- Verify Lambda is in correct VPC

### Health check returns 503
```bash
# Check Lambda logs
aws logs tail /aws/lambda/InfluxDbCrudStack-CrudLambdaFunction --follow

# Verify InfluxDB is running
aws ssm start-session --target <INSTANCE-ID>
sudo systemctl status influxdb
```

### SOPS decryption fails
```bash
# Verify age key is set
export SOPS_AGE_KEY_FILE=age-key.txt

# Test decryption
sops -d secrets.yaml

# Check SSM parameter exists
aws ssm get-parameter --name "/influxdb/age-private-key" --with-decryption
```

### Tests failing
```bash
# Clear Jest cache and rebuild
npm test -- --clearCache
npm run build && npm test
```

## 📚 API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check |
| POST | `/data` | Create time-series data |
| GET | `/data` | Retrieve all data |
| PUT | `/data/:id` | Update specific data point |
| DELETE | `/data/:id` | Delete specific data point |

**Request Body Format (POST/PUT):**
```json
{
  "measurement": "sensor_data",
  "tags": {
    "sensor_id": "sensor_001",
    "location": "office"
  },
  "fields": {
    "temperature": 22.5,
    "humidity": 65
  }
}
```

## 🏆 Key Features

- ✅ **Modular Architecture** - 6 independent, reusable constructs
- ✅ **Secure by Default** - Private networking, encrypted secrets
- ✅ **Production Ready** - 70 tests, 80%+ coverage
- ✅ **Modern Tooling** - UV package manager, SOPS encryption
- ✅ **Well Documented** - Comprehensive README and inline docs
- ✅ **Cost Optimized** - Serverless Lambda, single NAT Gateway
- ✅ **Observable** - CloudWatch logs and alarms

## 🤝 Contributing

This is a demonstration project showcasing AWS CDK best practices. Feel free to use it as a template for your own infrastructure.

## 📄 License

MIT

---

**Status:** Production-Ready | **Tests:** 70/70 Passing | **Coverage:** 80%+
