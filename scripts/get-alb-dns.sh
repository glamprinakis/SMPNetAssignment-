#!/bin/bash

# ============================================================================
# Get ALB DNS Helper Script
# ============================================================================
# Extracts ALB DNS from various sources
#
# Usage:
#   ./get-alb-dns.sh
# ============================================================================

STACK_NAME="InfluxDbCrudStack"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "Searching for ALB DNS..."
echo ""

# Method 1: Try CloudFormation
echo "1. Checking CloudFormation stack outputs..."
ALB_DNS=$(aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --query "Stacks[0].Outputs[?OutputKey=='ALBDnsName'].OutputValue" \
    --output text 2>&1 | grep -v "AccessDenied\|UnauthorizedOperation\|error occurred")

if [ -n "$ALB_DNS" ] && [ "$ALB_DNS" != "None" ]; then
    echo -e "${GREEN}✓ Found via CloudFormation:${NC}"
    echo "  $ALB_DNS"
    echo ""
    echo "Copy this command to test:"
    echo "  ./scripts/test-api.sh \"$ALB_DNS\""
    exit 0
fi

echo "  ✗ Cannot access CloudFormation (permission issue)"
echo ""

# Method 2: Check CDK context file
echo "2. Checking cdk.context.json..."
if [ -f "cdk.context.json" ]; then
    echo "  ✗ Context file exists but doesn't contain output values"
else
    echo "  ✗ File not found"
fi
echo ""

# Method 3: Search deployment logs
echo "3. Checking for deployment output in npm logs..."
if [ -f "npm-debug.log" ]; then
    ALB_DNS=$(grep -A 5 "Outputs:" npm-debug.log | grep "ALBDnsName" | awk '{print $NF}' | head -1)
    if [ -n "$ALB_DNS" ]; then
        echo -e "${GREEN}✓ Found in npm logs:${NC}"
        echo "  $ALB_DNS"
        exit 0
    fi
fi
echo "  ✗ No deployment logs found"
echo ""

# Method 4: AWS Load Balancer query
echo "4. Searching for Load Balancers in your AWS account..."
ALB_DNS=$(aws elbv2 describe-load-balancers \
    --query "LoadBalancers[?contains(LoadBalancerName, 'Influx')].DNSName" \
    --output text 2>&1 | grep -v "AccessDenied\|UnauthorizedOperation\|error occurred" | head -1)

if [ -n "$ALB_DNS" ] && [ "$ALB_DNS" != "None" ]; then
    echo -e "${GREEN}✓ Found via ELB query:${NC}"
    echo "  $ALB_DNS"
    echo ""
    echo "Copy this command to test:"
    echo "  ./scripts/test-api.sh \"$ALB_DNS\""
    exit 0
fi
echo "  ✗ Cannot query load balancers (permission issue)"
echo ""

# No method worked
echo -e "${YELLOW}Could not automatically find ALB DNS${NC}"
echo ""
echo "Manual methods to find your ALB DNS:"
echo ""
echo "  1. AWS Console:"
echo "     Go to: EC2 > Load Balancers > Look for 'Influx-CrudA-*'"
echo ""
echo "  2. Terminal (if you have permissions):"
echo "     aws elbv2 describe-load-balancers \\"
echo "       --query 'LoadBalancers[?contains(LoadBalancerName, \"Influx\")].DNSName' \\"
echo "       --output text"
echo ""
echo "  3. Check your deployment terminal output for:"
echo "     'InfluxDbCrudStack.ALBDnsName = ...'"
echo ""
echo "Once you have the DNS, run:"
echo "  ./scripts/test-api.sh <ALB_DNS>"
echo ""

exit 1
