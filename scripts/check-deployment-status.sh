#!/bin/bash

# ============================================================================
# CDK Deployment Status Checker
# ============================================================================
# Checks if the CDK stack is deployed and healthy
#
# Usage:
#   ./check-deployment-status.sh [STACK_NAME]
#
# Exit codes:
#   0 - Stack deployed and healthy
#   1 - Stack not deployed or unhealthy
#   2 - Stack deployment in progress
# ============================================================================

set -o pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Stack name
STACK_NAME="${1:-InfluxDbCrudStack}"

# ============================================================================
# Helper Functions
# ============================================================================

log_info() {
    echo -e "${BLUE}ℹ${NC} $1"
}

log_success() {
    echo -e "${GREEN}✓${NC} $1"
}

log_error() {
    echo -e "${RED}✗${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

print_header() {
    echo ""
    echo -e "${CYAN}╔══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║        CDK Deployment Status Checker                         ║${NC}"
    echo -e "${CYAN}╚══════════════════════════════════════════════════════════════╝${NC}"
    echo ""
}

# ============================================================================
# Main Functions
# ============================================================================

check_prerequisites() {
    if ! command -v aws &> /dev/null; then
        log_error "AWS CLI is not installed"
        exit 1
    fi
    
    if ! command -v curl &> /dev/null; then
        log_error "curl is not installed"
        exit 1
    fi
    
    if ! command -v jq &> /dev/null; then
        log_warning "jq is not installed (optional, but recommended)"
    fi
}

check_stack_status() {
    log_info "Checking CloudFormation stack: $STACK_NAME"
    echo ""
    
    # Get stack information
    local stack_info=$(aws cloudformation describe-stacks \
        --stack-name "$STACK_NAME" \
        2>&1)
    
    # Check for permission errors
    if echo "$stack_info" | grep -q "AccessDenied\|UnauthorizedOperation"; then
        log_warning "AWS permissions issue - cannot check CloudFormation stack"
        log_info "Your AWS user lacks CloudFormation:DescribeStacks permission"
        echo ""
        log_info "Skipping stack status check (will try direct health check)"
        return 0
    fi
    
    if echo "$stack_info" | grep -q "does not exist"; then
        log_error "Stack '$STACK_NAME' does not exist"
        echo ""
        log_info "Deploy the stack first:"
        echo "  npm run deploy"
        echo ""
        return 1
    fi
    
    # Extract stack status
    local stack_status=$(echo "$stack_info" | jq -r '.Stacks[0].StackStatus' 2>/dev/null)
    
    if [ -z "$stack_status" ]; then
        # Fallback if jq is not available
        stack_status=$(echo "$stack_info" | grep -o '"StackStatus": "[^"]*"' | cut -d'"' -f4)
    fi
    
    if [ -z "$stack_status" ]; then
        log_warning "Could not determine stack status"
        return 0
    fi
    
    echo "  Status: $stack_status"
    
    # Check status
    case "$stack_status" in
        CREATE_COMPLETE|UPDATE_COMPLETE)
            log_success "Stack is deployed successfully"
            return 0
            ;;
        CREATE_IN_PROGRESS|UPDATE_IN_PROGRESS)
            log_warning "Stack deployment is in progress"
            log_info "Wait for deployment to complete, then run this script again"
            return 2
            ;;
        ROLLBACK_*|*_FAILED)
            log_error "Stack deployment failed or rolled back"
            log_info "Check AWS Console or CloudFormation events for details"
            return 1
            ;;
        DELETE_*)
            log_error "Stack is being deleted or has been deleted"
            return 1
            ;;
        *)
            log_warning "Unknown stack status: $stack_status"
            return 1
            ;;
    esac
}

get_stack_outputs() {
    log_info "Retrieving stack outputs..."
    echo ""
    
    # Try CloudFormation first
    local alb_dns=$(aws cloudformation describe-stacks \
        --stack-name "$STACK_NAME" \
        --query "Stacks[0].Outputs[?OutputKey=='ALBDnsName'].OutputValue" \
        --output text 2>&1 | grep -v "AccessDenied\|UnauthorizedOperation\|error occurred")
    
    # If CloudFormation failed, try CDK outputs file
    if [ -z "$alb_dns" ] || [ "$alb_dns" == "None" ]; then
        log_warning "Cannot access CloudFormation outputs (permission issue)"
        log_info "Trying CDK outputs file as fallback..."
        echo ""
        
        if [ -f "cdk.out/$STACK_NAME.template.json" ]; then
            # CDK template files don't have actual output values, only definitions
            log_warning "CDK outputs file found but doesn't contain runtime values"
            log_info "Please check deployment logs or AWS Console for ALB DNS"
            return 1
        else
            log_error "Could not find CDK outputs file"
            return 1
        fi
    fi
    
    echo -e "  ${GREEN}ALB DNS:${NC} $alb_dns"
    echo ""
    
    # Export for health check
    export ALB_DNS="$alb_dns"
    return 0
}

check_api_health() {
    log_info "Checking API health..."
    echo ""
    
    local health_url="http://$ALB_DNS/health"
    local max_attempts=3
    local attempt=1
    
    while [ $attempt -le $max_attempts ]; do
        echo -n "  Attempt $attempt/$max_attempts: "
        
        # Use temp file to avoid head -n -1 issue on macOS
        local temp_file=$(mktemp)
        curl -s -w "\n%{http_code}" --max-time 10 "$health_url" > "$temp_file" 2>/dev/null
        
        # Get status code (last line)
        local status=$(tail -n 1 "$temp_file")
        # Get body (all lines except last)
        local body=$(sed '$d' "$temp_file")
        
        rm -f "$temp_file"
        
        if [ "$status" = "200" ]; then
            echo -e "${GREEN}OK${NC}"
            
            if command -v jq &> /dev/null; then
                local health_status=$(echo "$body" | jq -r '.status' 2>/dev/null)
                if [ "$health_status" = "healthy" ]; then
                    log_success "API is healthy and responding"
                    echo ""
                    return 0
                else
                    # Status 200 but not healthy, keep trying
                    echo -e "    ${YELLOW}Status field: $health_status${NC}"
                fi
            else
                # No jq, but status 200 is good enough
                log_success "API is responding (status 200)"
                echo ""
                return 0
            fi
        else
            echo -e "${YELLOW}Status $status${NC}"
        fi
        
        if [ $attempt -lt $max_attempts ]; then
            sleep 3
        fi
        
        attempt=$((attempt + 1))
    done
    
    log_warning "API health check failed after $max_attempts attempts"
    log_info "The Lambda function may still be initializing (cold start)"
    log_info "Wait a few minutes and try again, or check CloudWatch logs"
    echo ""
    return 1
}

check_local_processes() {
    log_info "Checking for active CDK deployment processes..."
    echo ""
    
    # Check for CDK processes
    local cdk_procs=$(ps aux | grep -E "(cdk deploy|npm run deploy)" | grep -v grep | wc -l)
    local node_cdk=$(ps aux | grep "node.*cdk" | grep -v grep | wc -l)
    local aws_cli=$(ps aux | grep "aws cloudformation" | grep -v grep | wc -l)
    
    local total_procs=$((cdk_procs + node_cdk + aws_cli))
    
    if [ $total_procs -eq 0 ]; then
        log_success "No active deployment processes detected"
        return 0
    else
        log_warning "Active deployment processes detected:"
        echo "    CDK deploy: $cdk_procs"
        echo "    Node CDK: $node_cdk"
        echo "    AWS CLI: $aws_cli"
        echo ""
        log_info "If these are stuck, stop them with:"
        echo "  pkill -9 -f 'cdk deploy'"
        return 2
    fi
}

print_summary() {
    local overall_status=$1
    
    echo ""
    echo -e "${CYAN}╔══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║  Summary                                                     ║${NC}"
    echo -e "${CYAN}╚══════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    
    if [ $overall_status -eq 0 ]; then
        log_success "Deployment is complete and healthy! 🚀"
        echo ""
        echo "  You can now test the API:"
        echo -e "    ${CYAN}./scripts/test-api.sh${NC}"
        echo ""
        echo "  Or manually test endpoints:"
        echo -e "    ${CYAN}curl http://$ALB_DNS/health${NC}"
        echo ""
    elif [ $overall_status -eq 2 ]; then
        log_warning "Deployment is in progress"
        echo ""
        echo "  Check status again in a few minutes:"
        echo -e "    ${CYAN}./scripts/check-deployment-status.sh${NC}"
        echo ""
    else
        log_error "Deployment has issues"
        echo ""
        echo "  Check CloudFormation events:"
        echo -e "    ${CYAN}aws cloudformation describe-stack-events --stack-name $STACK_NAME${NC}"
        echo ""
        echo "  Or view in AWS Console:"
        echo "    https://console.aws.amazon.com/cloudformation"
        echo ""
    fi
}

# ============================================================================
# Main Execution
# ============================================================================

main() {
    print_header
    
    check_prerequisites
    
    local exit_code=0
    
    # Check CloudFormation stack
    check_stack_status
    local stack_status=$?
    
    if [ $stack_status -eq 0 ]; then
        # Stack is deployed, check outputs and health
        get_stack_outputs
        local outputs_status=$?
        
        if [ $outputs_status -eq 0 ]; then
            check_api_health
            local health_status=$?
            
            if [ $health_status -ne 0 ]; then
                exit_code=1
            fi
        else
            exit_code=1
        fi
        
        # Check for local processes (informational)
        check_local_processes
        
    elif [ $stack_status -eq 2 ]; then
        # Stack deployment in progress
        check_local_processes
        exit_code=2
    else
        # Stack has issues
        exit_code=1
    fi
    
    print_summary $exit_code
    exit $exit_code
}

# Run main function
main
