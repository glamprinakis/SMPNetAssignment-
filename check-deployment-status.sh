#!/bin/bash
# Quick check if any CDK deployment is running

echo "🔍 Checking for active CDK deployments..."
echo ""

# Check for CDK processes
CDK_PROCS=$(ps aux | grep -E "(cdk deploy|npm run deploy)" | grep -v grep | wc -l)
echo "CDK deployment processes: $CDK_PROCS"

# Check for Node.js CDK processes
NODE_CDK=$(ps aux | grep "node.*cdk" | grep -v grep | wc -l)
echo "Node CDK processes: $NODE_CDK"

# Check AWS CLI processes
AWS_CLI=$(ps aux | grep "aws cloudformation" | grep -v grep | wc -l)
echo "AWS CLI processes: $AWS_CLI"

echo ""
if [ $CDK_PROCS -eq 0 ] && [ $NODE_CDK -eq 0 ] && [ $AWS_CLI -eq 0 ]; then
    echo "✅ ALL CLEAR - No deployment running"
    echo "Your system is safe!"
else
    echo "⚠️  WARNING - Deployment processes detected!"
    echo "Run: pkill -9 -f 'cdk deploy' to stop them"
fi
